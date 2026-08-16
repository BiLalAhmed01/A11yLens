#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { discoverPages } from "./crawler.js";
import { scanSite, aggregateViolations, computeScore, countPassedRules } from "./scanner.js";
import { explainViolations } from "./llm.js";
import { renderReportHtml } from "./report.js";

function parseArgs(argv) {
  const args = { maxPages: 5, outDir: "reports", pdf: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-pages") args.maxPages = Number(argv[++i]);
    else if (a === "--out") args.outDir = argv[++i];
    else if (a === "--pdf") args.pdf = true;
    else positional.push(a);
  }
  args.url = positional[0];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error("Usage: node src/index.js <url> [--max-pages N] [--out dir] [--pdf]");
    process.exit(1);
  }
  const siteUrl = args.url.startsWith("http") ? args.url : `https://${args.url}`;

  fs.mkdirSync(args.outDir, { recursive: true });

  console.log(`\nA11yLens — scanning ${siteUrl}\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Discovering pages...");
  const urls = await discoverPages(page, siteUrl, args.maxPages);
  console.log(`  Found ${urls.length} page(s): ${urls.join(", ")}`);

  console.log("Running axe-core + performance checks (desktop + mobile)...");
  const scans = await scanSite(page, urls, {
    onProgress: (url, viewport) => console.log(`  Scanning ${url} [${viewport}]`),
  });

  await browser.close();

  const aggregated = aggregateViolations(scans);
  const score = computeScore(aggregated);
  const passedCount = countPassedRules(scans);

  console.log(`\nScore: ${score}/100 — ${aggregated.length} distinct issue types found.`);
  console.log("Generating plain-language report with Gemini...");

  const { summary, issues } = await explainViolations(aggregated, { siteUrl, score });

  const perfSummary = summarizePerf(scans, urls.length);

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
    const pdfBrowser = await chromium.launch();
    const pdfPage = await pdfBrowser.newPage();
    await pdfPage.goto(`file://${path.resolve(htmlPath)}`, { waitUntil: "networkidle" });
    const pdfPath = path.join(args.outDir, `${slug}-report.pdf`);
    await pdfPage.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "20px", bottom: "20px" } });
    await pdfBrowser.close();
    console.log(`PDF report written to ${pdfPath}`);
  }
}

function summarizePerf(scans, pagesScanned) {
  const loads = scans.map((s) => s.perf.loadEventMs).filter((n) => typeof n === "number");
  const lcps = scans.map((s) => s.perf.lcpMs).filter((n) => typeof n === "number");
  const transfers = scans.map((s) => s.perf.transferKb).filter((n) => typeof n === "number");
  return {
    avgLoadMs: avg(loads),
    avgLcpMs: avg(lcps),
    avgTransferKb: avg(transfers),
    pagesScanned,
  };
}

function avg(nums) {
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

main().catch((err) => {
  console.error("\nA11yLens failed:", err);
  process.exit(1);
});
