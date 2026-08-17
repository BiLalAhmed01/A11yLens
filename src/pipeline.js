import { discoverPages } from "./crawler.js";
import { scanSite, aggregateViolations, computeScore, countPassedRules } from "./scanner.js";
import { explainViolations } from "./llm.js";

/** Thrown for expected failure modes (unreachable site, everything failed to scan) -- never for bugs. */
export class AuditError extends Error {}

/**
 * Runs the full crawl -> scan -> explain pipeline and returns structured
 * results. Shared by the CLI (src/index.js) and local dev server
 * (scripts/serve.mjs), which both launch a real desktop Chromium via the
 * full "playwright" package, and by the Vercel serverless function
 * (api/scan.js), which needs a different, serverless-sized Chromium build
 * (playwright-core + @sparticuz/chromium) instead. launchBrowser is
 * required rather than defaulted so this module never hardcodes either
 * choice, and so the full "playwright" package -- irrelevant and oversized
 * for a serverless bundle -- is never pulled in by a caller that doesn't
 * import it itself.
 */
export async function runAudit(siteUrl, { maxPages = 5, onProgress = () => {}, launchBrowser } = {}) {
  if (typeof launchBrowser !== "function") {
    throw new TypeError("runAudit requires a launchBrowser() function that returns a launched Playwright browser");
  }
  const browser = await launchBrowser();
  let scans;
  let urls;
  try {
    const page = await browser.newPage();

    onProgress("Discovering pages...");
    urls = await discoverPages(page, siteUrl, maxPages);
    if (!urls.length) {
      throw new AuditError(`Could not load ${siteUrl} — check the URL is reachable and try again.`);
    }
    onProgress(`  Found ${urls.length} page(s): ${urls.join(", ")}`);

    onProgress("Running axe-core + performance checks (desktop + mobile)...");
    scans = await scanSite(page, urls, {
      onProgress: (url, viewport) => onProgress(`  Scanning ${url} [${viewport}]`),
      onError: (url, viewport, err) => onProgress(`  Skipped ${url} [${viewport}]: ${err.message}`),
    });
  } finally {
    await browser.close();
  }

  if (!scans.length) {
    throw new AuditError("Every page failed to scan — no report generated.");
  }

  const aggregated = aggregateViolations(scans);
  const score = computeScore(aggregated);
  const passedCount = countPassedRules(scans);

  onProgress(`\nScore: ${score}/100 — ${aggregated.length} distinct issue types found.`);
  onProgress("Generating plain-language report...");
  const { summary, issues } = await explainViolations(aggregated, { siteUrl, score });

  const perfSummary = summarizePerf(scans);

  return { siteUrl, score, passedCount, issues, summary, perfSummary, scannedPages: urls };
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
