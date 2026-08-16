import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-flash-latest";

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: { type: Type.STRING },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          rule: { type: Type.STRING },
          plainLanguage: { type: Type.STRING },
          realWorldImpact: { type: Type.STRING },
          fix: { type: Type.STRING },
          priority: { type: Type.STRING, enum: ["Critical", "Serious", "Warning"] },
          effort: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
        },
        required: ["rule", "plainLanguage", "realWorldImpact", "fix", "priority", "effort"],
      },
    },
  },
  required: ["executiveSummary", "issues"],
};

/**
 * Sends the raw axe-core violation list to Gemini and asks it to translate
 * each finding into a plain-language, prioritized fix item plus an
 * executive summary. Falls back to a template-only explanation (no LLM
 * call) if GEMINI_API_KEY isn't set, so the tool still runs end to end.
 */
export async function explainViolations(aggregated, { siteUrl, score }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      summary:
        "GEMINI_API_KEY not set — showing raw axe-core findings without AI-generated explanations. Set GEMINI_API_KEY to get plain-language impact analysis and prioritization.",
      issues: aggregated.map(fallbackIssue),
    };
  }

  const client = new GoogleGenAI({ apiKey });

  const violationsForPrompt = aggregated.map((v) => ({
    rule: v.id,
    impact: v.impact,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    occurrences: v.nodeCount,
    affectedPages: v.affectedPages,
    sampleHtml: v.sampleHtml?.slice(0, 300),
  }));

  const prompt = `You are an accessibility consultant writing a fix-it report for a small business owner who is not technical. You will be given raw axe-core WCAG violation data for ${siteUrl} (heuristic accessibility score: ${score}/100).

For EACH violation rule below, write:
- "plainLanguage": 1-2 sentences explaining the problem in plain English, no jargon.
- "realWorldImpact": 1-2 sentences on how this concretely affects a person with a disability (be specific: screen reader users, keyboard-only users, low-vision users, motor-impairment users, etc.)
- "fix": concrete, actionable fix instructions a developer could follow (reference the actual HTML/attribute involved).
- "priority": one of "Critical", "Serious", "Warning" based on severity and how many users it blocks.
- "effort": one of "Low", "Medium", "High" estimated developer effort to fix.

Also write an overall "executiveSummary": 2-3 sentences a business owner would understand, mentioning legal/reputational risk in general terms (do not fabricate specific lawsuit statistics).

Violation data:
${JSON.stringify(violationsForPrompt, null, 2)}`;

  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (err) {
    throw new Error(`Failed to parse LLM response as JSON: ${err.message}\n${response.text}`);
  }

  const byRule = new Map(parsed.issues.map((i) => [i.rule, i]));
  const issues = aggregated.map((v) => {
    const llm = byRule.get(v.id);
    return {
      ...fallbackIssue(v),
      ...(llm ?? {}),
    };
  });

  return { summary: parsed.executiveSummary, issues };
}

function fallbackIssue(v) {
  return {
    rule: v.id,
    impact: v.impact,
    nodeCount: v.nodeCount,
    affectedPages: v.affectedPages,
    helpUrl: v.helpUrl,
    sampleHtml: v.sampleHtml,
    plainLanguage: v.description,
    realWorldImpact: v.help,
    fix: `See guidance: ${v.helpUrl}`,
    priority: { critical: "Critical", serious: "Serious" }[v.impact] ?? "Warning",
    effort: "Medium",
  };
}
