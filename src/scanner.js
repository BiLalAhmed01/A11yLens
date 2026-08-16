import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const axeSource = fs.readFileSync(
  path.join(__dirname, "..", "node_modules", "axe-core", "axe.min.js"),
  "utf-8"
);

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

/**
 * Runs axe-core plus basic Navigation/Resource Timing performance checks
 * against a single URL at a single viewport.
 */
export async function scanPage(page, url, viewportName) {
  await page.setViewportSize(VIEWPORTS[viewportName]);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(axeSource);

  const axeResults = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return await axe.run(document, {
      resultTypes: ["violations", "passes"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
    });
  });

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const transferBytes = resources.reduce(
      (sum, r) => sum + (r.transferSize || 0),
      0
    );
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lcp = lcpEntries.length
      ? lcpEntries[lcpEntries.length - 1].startTime
      : null;

    return {
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      loadEventMs: nav ? nav.loadEventEnd : null,
      transferKb: Math.round(transferBytes / 1024),
      requestCount: resources.length,
      lcpMs: lcp,
    };
  });

  return {
    url,
    viewport: viewportName,
    violations: axeResults.violations,
    passes: axeResults.passes,
    perf,
  };
}

/**
 * Scans a list of URLs across desktop + mobile viewports and merges results.
 */
export async function scanSite(page, urls, { onProgress } = {}) {
  const scans = [];
  for (const url of urls) {
    for (const viewport of Object.keys(VIEWPORTS)) {
      onProgress?.(url, viewport);
      const result = await scanPage(page, url, viewport);
      scans.push(result);
    }
  }
  return scans;
}

/**
 * Dedupes axe violations by rule id across pages/viewports, keeping a list
 * of affected pages and a representative sample node per rule.
 */
export function aggregateViolations(scans) {
  const byRule = new Map();

  for (const scan of scans) {
    for (const v of scan.violations) {
      if (!byRule.has(v.id)) {
        byRule.set(v.id, {
          id: v.id,
          impact: v.impact,
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags,
          nodeCount: 0,
          affectedPages: new Set(),
          sampleHtml: v.nodes[0]?.html ?? "",
          sampleTarget: v.nodes[0]?.target?.join(" ") ?? "",
        });
      }
      const entry = byRule.get(v.id);
      entry.nodeCount += v.nodes.length;
      entry.affectedPages.add(`${scan.url} (${scan.viewport})`);
    }
  }

  return [...byRule.values()]
    .map((v) => ({ ...v, affectedPages: [...v.affectedPages] }))
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact));
}

/**
 * Counts distinct axe rule ids that passed on at least one page and never
 * appeared as a violation anywhere else in the scan.
 */
export function countPassedRules(scans) {
  const violated = new Set(scans.flatMap((s) => s.violations.map((v) => v.id)));
  const passed = new Set(scans.flatMap((s) => s.passes.map((p) => p.id)));
  for (const id of violated) passed.delete(id);
  return passed.size;
}

function impactRank(impact) {
  return { critical: 4, serious: 3, moderate: 2, minor: 1 }[impact] ?? 0;
}

/**
 * Computes a 0-100 accessibility score from aggregated violations, weighted
 * by axe impact severity. This is a heuristic, not a certified metric.
 */
export function computeScore(aggregated) {
  const weights = { critical: 10, serious: 6, moderate: 3, minor: 1 };
  const penalty = aggregated.reduce(
    (sum, v) => sum + (weights[v.impact] ?? 1) * Math.min(v.nodeCount, 10),
    0
  );
  return Math.max(0, Math.round(100 - penalty));
}
