#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { discoverPages } from "./crawler.js";
import { scanSite, aggregateViolations, computeScore, countPassedRules } from "./scanner.js";
import { explainViolations } from "./llm.js";
import { renderReportHtml } from "./report.js";

const USAGE = "Usage: a11ylens <url> [--max-pages N] [--out dir] [--pdf]";

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { maxPages: 5, outDir: "reports", pdf: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-pages") {
      const raw = argv[++i];
      args.maxPages = Number(raw);
      if (!Number.isInteger(args.maxPages) || args.maxPages < 1) {
        throw new UsageError(`--max-pages must be a positive integer (got ${raw ?? "nothing"})`);
      }
    } else if (a === "--out") {
      args.outDir = argv[++i];
      if (!args.outDir) throw new UsageError("--out requires a directory path");
    } else if (a === "--pdf") {
      args.pdf = true;
    } else if (a.startsWith("-")) {
      throw new UsageError(`Unknown option: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    throw new UsageError(positional.length ? "Expected exactly one URL" : "Missing target URL");
  }
  args.siteUrl = parseSiteUrl(positional[0]);
  return args;
}

/**
 * Accepts "example.com" or a full URL; rejects anything that isn't http(s).
 * A scheme is only recognized when followed by "//", so "localhost:3000"
 * is treated as a host:port and not as a "localhost:" scheme.
 */
function parseSiteUrl(input) {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  let url;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    throw new UsageError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`Only http and https URLs can be scanned (got ${url.protocol})`);
  }
  return url.href;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n${USAGE}`);
    process.exit(1);
  }
  const siteUrl = args.siteUrl;

  fs.mkdirSync(args.outDir, { recursive: true });

  console.log(`\nA11yLens — scanning ${siteUrl}\n`);

  const browser = await chromium.launch();
  let scans;
  try {
    const page = await browser.newPage();

    console.log("Discovering pages...");
    const urls = await discoverPages(page, siteUrl, args.maxPages);
    if (!urls.length) {
      console.error(`Could not load ${siteUrl} — check the URL is reachable and try again.`);
      process.exitCode = 1;
      return;
    }
    console.log(`  Found ${urls.length} page(s): ${urls.join(", ")}`);

    console.log("Running axe-core + performance checks (desktop + mobile)...");
    scans = await scanSite(page, urls, {
      onProgress: (url, viewport) => console.log(`  Scanning ${url} [${viewport}]`),
      onError: (url, viewport, err) =>
        console.warn(`  Skipped ${url} [${viewport}]: ${err.message}`),
    });
  } finally {
    await browser.close();
  }

  if (!scans.length) {
    console.error("Every page failed to scan — no report generated.");
    process.exitCode = 1;
    return;
  }

  const aggregated = aggregateViolations(scans);
  const score = computeScore(aggregated);
  const passedCount = countPassedRules(scans);

  console.log(`\nScore: ${score}/100 — ${aggregated.length} distinct issue types found.`);
  console.log("Generating plain-language report...");

  const { summary, issues } = await explainViolations(aggregated, { siteUrl, score });

  const perfSummary = summarizePerf(scans);

  const html = renderReportHtml({
    siteUrl,
    score,
    passedCount,
    issues,
    summary,
    perfSummary,
    scannedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  });

  const slug = new URL(siteUrl).hostname.replace(/\W+/g, "-");
  const htmlPath = path.join(args.outDir, `${slug}-report.html`);
  fs.writeFileSync(htmlPath, html, "utf-8");
  console.log(`\nHTML report written to ${htmlPath}`);

  if (args.pdf) {
    const pdfPath = path.join(args.outDir, `${slug}-report.pdf`);
    try {
      await renderPdf(htmlPath, pdfPath);
      console.log(`PDF report written to ${pdfPath}`);
    } catch (err) {
      // The HTML report is already on disk — a PDF failure shouldn't fail the run.
      console.warn(`PDF generation failed (${err.message}); HTML report is still available.`);
      process.exitCode = 1;
    }
  }
}

async function renderPdf(htmlPath, pdfPath) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // pathToFileURL handles Windows drive letters, backslashes and spaces correctly.
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: "load" });
    // Web fonts are cosmetic — don't let an offline machine block the PDF.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px" },
    });
  } finally {
    await browser.close();
  }
}

function summarizePerf(scans) {
  return {
    avgLoadMs: avg(scans.map((s) => s.perf.loadEventMs)),
    avgLcpMs: avg(scans.map((s) => s.perf.lcpMs)),
    avgTransferKb: avg(scans.map((s) => s.perf.transferKb)),
    pagesScanned: new Set(scans.map((s) => s.url)).size,
  };
}

/** Averages the usable samples; 0/null show up when a timing never fired. */
function avg(values) {
  const nums = values.filter((n) => typeof n === "number" && n > 0);
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

main().catch((err) => {
  console.error("\nA11yLens failed:", err);
  process.exit(1);
});
