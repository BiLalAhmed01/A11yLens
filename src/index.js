#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { runAudit, AuditError } from "./pipeline.js";
import { parseSiteUrl, ValidationError } from "./validate.js";
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
  try {
    args.siteUrl = parseSiteUrl(positional[0]);
  } catch (err) {
    if (err instanceof ValidationError) throw new UsageError(err.message);
    throw err;
  }
  return args;
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

  let result;
  try {
    result = await runAudit(siteUrl, {
      maxPages: args.maxPages,
      onProgress: (msg) => console.log(msg),
    });
  } catch (err) {
    if (err instanceof AuditError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const html = renderReportHtml({
    siteUrl: result.siteUrl,
    score: result.score,
    passedCount: result.passedCount,
    issues: result.issues,
    summary: result.summary,
    perfSummary: result.perfSummary,
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

main().catch((err) => {
  console.error("\nA11yLens failed:", err);
  process.exit(1);
});
