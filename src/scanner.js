import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const axeSource = fs.readFileSync(
  path.join(__dirname, "..", "node_modules", "axe-core", "axe.min.js"),
  "utf-8"
);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

/**
 * Runs axe-core plus basic Navigation/Resource Timing performance checks
 * against a single URL at a single viewport.
 */
async function scanPage(page, url, viewportName) {
  await page.setViewportSize(VIEWPORTS[viewportName]);
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
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
      loadEventMs: nav ? nav.loadEventEnd : null,
      transferKb: Math.round(transferBytes / 1024),
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
export async function scanSite(page, urls, { onProgress, onError } = {}) {
  const scans = [];
  for (const url of urls) {
    for (const viewport of Object.keys(VIEWPORTS)) {
      onProgress?.(url, viewport);
      try {
        scans.push(await scanPage(page, url, viewport));
      } catch (err) {
        // One flaky page shouldn't discard the whole audit.
        onError?.(url, viewport, err);
      }
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
          nodesPerPage: new Map(),
          affectedPages: new Set(),
          sampleHtml: v.nodes[0]?.html ?? "",
        });
      }
      const entry = byRule.get(v.id);
      if (impactRank(v.impact) > impactRank(entry.impact)) entry.impact = v.impact;
      // Each page is scanned once per viewport; counting the worst viewport
      // rather than summing avoids reporting every occurrence twice.
      entry.nodesPerPage.set(
        scan.url,
        Math.max(entry.nodesPerPage.get(scan.url) ?? 0, v.nodes.length)
      );
      entry.affectedPages.add(`${scan.url} (${scan.viewport})`);
    }
  }

  return [...byRule.values()]
    .map(({ nodesPerPage, affectedPages, ...v }) => ({
      ...v,
      nodeCount: [...nodesPerPage.values()].reduce((a, b) => a + b, 0),
      affectedPages: [...affectedPages],
    }))
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
