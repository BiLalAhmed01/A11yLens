import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReportHtml } from "../src/report.js";

function baseArgs(overrides = {}) {
  return {
    siteUrl: "https://example.com/",
    score: 88,
    passedCount: 12,
    issues: [],
    summary: "All good.",
    perfSummary: { avgLoadMs: 500, avgLcpMs: 900, avgTransferKb: 300, pagesScanned: 2 },
    scannedAt: "2026-01-01 00:00 UTC",
    ...overrides,
  };
}

function issue(overrides = {}) {
  return {
    rule: "label",
    priority: "Critical",
    effort: "Low",
    plainLanguage: "Plain text.",
    realWorldImpact: "Impact text.",
    fix: "Fix text.",
    nodeCount: 1,
    affectedPages: ["https://example.com/ (desktop)"],
    helpUrl: "https://dequeuniversity.com/rules/axe/4.10/label",
    sampleHtml: "<input>",
    ...overrides,
  };
}

test("renderReportHtml: produces a full HTML document with score and summary", () => {
  const html = renderReportHtml(baseArgs());
  assert.match(html, /<!doctype html>/);
  assert.match(html, /88%/);
  assert.match(html, /All good\./);
  assert.match(html, /example\.com/);
});

test("renderReportHtml: escapes a script tag in siteUrl (title/heading context)", () => {
  const html = renderReportHtml(baseArgs({ siteUrl: '"><script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("renderReportHtml: escapes quotes in scraped sampleHtml so it cannot break out of the <pre> or surrounding attributes", () => {
  const html = renderReportHtml(
    baseArgs({ issues: [issue({ sampleHtml: `<img src=x onerror="alert(1)">` })] })
  );
  assert.doesNotMatch(html, /onerror="alert\(1\)"/);
  assert.match(html, /&quot;alert\(1\)&quot;/);
});

test("renderReportHtml: escapes quotes in LLM-authored prose fields", () => {
  const html = renderReportHtml(
    baseArgs({ issues: [issue({ plainLanguage: `"><img src=x onerror=alert(1)>` })] })
  );
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
});

test("renderReportHtml: drops a javascript: helpUrl instead of rendering it as a link", () => {
  const html = renderReportHtml(baseArgs({ issues: [issue({ helpUrl: "javascript:alert(1)" })] }));
  assert.doesNotMatch(html, /href="javascript:/);
});

test("renderReportHtml: keeps a normal https helpUrl as a link", () => {
  const html = renderReportHtml(baseArgs({ issues: [issue()] }));
  assert.match(html, /href="https:\/\/dequeuniversity\.com\/rules\/axe\/4\.10\/label"/);
});

test("renderReportHtml: renders an explicit empty state when there are no issues", () => {
  const html = renderReportHtml(baseArgs({ issues: [] }));
  assert.match(html, /No automated violations were detected/);
});

test("renderReportHtml: counts Critical+Serious as \"Issues\" and Warning separately", () => {
  const html = renderReportHtml(
    baseArgs({
      issues: [issue({ priority: "Critical" }), issue({ priority: "Serious" }), issue({ priority: "Warning" })],
    })
  );
  assert.match(html, /<div class="n">2<\/div><div class="l">Issues<\/div>/);
  assert.match(html, /<div class="n">1<\/div><div class="l">Warnings<\/div>/);
});
