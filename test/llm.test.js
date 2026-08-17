import { test } from "node:test";
import assert from "node:assert/strict";
import { explainViolations } from "../src/llm.js";

function aggregatedIssue(overrides = {}) {
  return {
    id: "label",
    impact: "critical",
    description: "Form elements must have labels",
    help: "Ensure every form element has a label",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.10/label",
    nodeCount: 2,
    affectedPages: ["https://a.com/ (desktop)"],
    sampleHtml: "<input>",
    ...overrides,
  };
}

test("explainViolations: no violations short-circuits without calling the network", async () => {
  const result = await explainViolations([], { siteUrl: "https://a.com/", score: 100 });
  assert.deepEqual(result.issues, []);
  assert.match(result.summary, /No automated accessibility violations were detected/);
});

test("explainViolations: missing API key falls back to raw axe-core text, preserving rule data", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = await explainViolations([aggregatedIssue()], { siteUrl: "https://a.com/", score: 80 });
    assert.match(result.summary, /GEMINI_API_KEY not set/);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].rule, "label");
    assert.equal(result.issues[0].priority, "Critical", "critical impact maps to Critical priority");
    assert.equal(result.issues[0].plainLanguage, "Form elements must have labels");
    assert.equal(result.issues[0].fix, "See guidance: https://dequeuniversity.com/rules/axe/4.10/label");
  } finally {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  }
});

test("explainViolations: fallback priority mapping matches axe impact (serious -> Serious, moderate/minor -> Warning)", async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = await explainViolations(
      [aggregatedIssue({ id: "r1", impact: "serious" }), aggregatedIssue({ id: "r2", impact: "moderate" })],
      { siteUrl: "https://a.com/", score: 80 }
    );
    assert.equal(result.issues[0].priority, "Serious");
    assert.equal(result.issues[1].priority, "Warning");
  } finally {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  }
});
