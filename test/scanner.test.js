import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateViolations, computeScore, countPassedRules } from "../src/scanner.js";

function violation(id, impact, nodeCount = 1, overrides = {}) {
  return {
    id,
    impact,
    description: `${id} description`,
    help: `${id} help`,
    helpUrl: `https://example.com/${id}`,
    nodes: Array.from({ length: nodeCount }, () => ({ html: `<div>${id}</div>` })),
    ...overrides,
  };
}

function scan(url, viewport, violations, passes = []) {
  return { url, viewport, violations, passes, perf: { loadEventMs: 100, transferKb: 10, lcpMs: 200 } };
}

test("aggregateViolations: dedupes by rule id across pages/viewports", () => {
  const scans = [
    scan("https://a.com/", "desktop", [violation("label", "critical", 2)]),
    scan("https://a.com/", "mobile", [violation("label", "critical", 2)]),
  ];
  const result = aggregateViolations(scans);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "label");
  assert.equal(result[0].nodeCount, 2, "same page, worse-viewport-count only, not summed across viewports");
  assert.deepEqual(result[0].affectedPages, ["https://a.com/ (desktop)", "https://a.com/ (mobile)"]);
});

test("aggregateViolations: sums the same rule's node count across distinct pages", () => {
  const scans = [
    scan("https://a.com/", "desktop", [violation("label", "critical", 2)]),
    scan("https://a.com/page2", "desktop", [violation("label", "critical", 3)]),
  ];
  const result = aggregateViolations(scans);
  assert.equal(result[0].nodeCount, 5);
});

test("aggregateViolations: keeps the worst impact seen for a rule", () => {
  const scans = [
    scan("https://a.com/", "desktop", [violation("region", "moderate", 1)]),
    scan("https://a.com/page2", "desktop", [violation("region", "critical", 1)]),
  ];
  const result = aggregateViolations(scans);
  assert.equal(result[0].impact, "critical");
});

test("aggregateViolations: sorts by impact severity, critical first", () => {
  const scans = [
    scan("https://a.com/", "desktop", [
      violation("minor-rule", "minor", 1),
      violation("critical-rule", "critical", 1),
      violation("serious-rule", "serious", 1),
      violation("moderate-rule", "moderate", 1),
    ]),
  ];
  const result = aggregateViolations(scans);
  assert.deepEqual(result.map((r) => r.id), ["critical-rule", "serious-rule", "moderate-rule", "minor-rule"]);
});

test("aggregateViolations: empty scans produce an empty result", () => {
  assert.deepEqual(aggregateViolations([]), []);
});

test("computeScore: no violations scores 100", () => {
  assert.equal(computeScore([]), 100);
});

test("computeScore: penalizes by impact weight, capped at 10 nodes per rule", () => {
  const aggregated = [{ impact: "critical", nodeCount: 1 }];
  assert.equal(computeScore(aggregated), 90); // 100 - (10 * 1)

  const manyNodes = [{ impact: "critical", nodeCount: 999 }];
  assert.equal(computeScore(manyNodes), 0); // 100 - (10 * 10), floored at 0
});

test("computeScore: never goes below 0", () => {
  const aggregated = [
    { impact: "critical", nodeCount: 20 },
    { impact: "critical", nodeCount: 20 },
    { impact: "critical", nodeCount: 20 },
  ];
  assert.equal(computeScore(aggregated), 0);
});

test("computeScore: unknown impact strings fall back to weight 1", () => {
  assert.equal(computeScore([{ impact: "unknown-value", nodeCount: 1 }]), 99);
});

test("countPassedRules: counts passed rules not also violated anywhere", () => {
  const scans = [
    scan(
      "https://a.com/",
      "desktop",
      [violation("label", "critical", 1)],
      [{ id: "label" }, { id: "image-alt" }, { id: "region" }]
    ),
    scan("https://a.com/", "mobile", [], [{ id: "region" }]),
  ];
  // "label" is a violation somewhere -> excluded even though it also "passed" on this page.
  // "image-alt" and "region" only ever passed -> counted once each (Set dedupes).
  assert.equal(countPassedRules(scans), 2);
});

test("countPassedRules: zero scans yields zero", () => {
  assert.equal(countPassedRules([]), 0);
});
