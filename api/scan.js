import { runAudit, AuditError } from "../src/pipeline.js";
import { parseSiteUrl, ValidationError } from "../src/validate.js";
import chromiumBinary from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

/**
 * Vercel serverless equivalent of scripts/serve.mjs's POST /api/scan. Uses
 * playwright-core + a serverless-sized Chromium build (@sparticuz/chromium)
 * instead of the full "playwright" package, which is desktop-oriented and
 * doesn't fit a Lambda-style function's deployment size budget.
 *
 * Requires, as one-time setup only you can do (see README "Deploying the
 * dashboard on Vercel"):
 *   - GEMINI_API_KEY set as a Vercel project environment variable
 *   - The Vercel project's Root Directory reset to the repo root (not
 *     "public") so this file and src/ are actually included in the build
 *   - maxDuration raised in vercel.json, which needs a paid plan to exceed
 *     the Hobby tier's 10s default -- a real scan will not finish in 10s
 *
 * The playwright-core + @sparticuz/chromium combination is a known-fragile
 * pairing (version-matched to a specific Chromium build, verified working
 * versions pinned in package.json) -- this could not be fully tested
 * outside an actual Vercel deployment. If it fails, the Vercel function
 * logs are the place to look first.
 */
const MAX_PAGES_CAP = 3; // a full crawl easily exceeds even a generous serverless time budget

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = typeof req.body === "object" && req.body !== null ? req.body : {};

  let siteUrl;
  try {
    siteUrl = parseSiteUrl(String(body.url ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  let maxPages = 2; // lower default than the local server -- see MAX_PAGES_CAP above
  if (body.maxPages !== undefined) {
    maxPages = Number(body.maxPages);
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      res.status(400).json({ error: "maxPages must be a positive integer" });
      return;
    }
  }
  maxPages = Math.min(maxPages, MAX_PAGES_CAP);

  try {
    console.log(`[api/scan] ${siteUrl} (max ${maxPages} pages)`);
    const result = await runAudit(siteUrl, {
      maxPages,
      onProgress: (msg) => console.log(`  ${msg}`),
      launchBrowser: async () => {
        const executablePath = await chromiumBinary.executablePath();
        return playwright.launch({
          args: chromiumBinary.args,
          executablePath,
          headless: true,
        });
      },
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuditError) {
      res.status(422).json({ error: err.message });
      return;
    }
    // Unexpected failures here are the most likely place a Playwright/
    // Chromium version mismatch would surface -- logged for the Vercel
    // function logs, never leaked to the client.
    console.error("[api/scan] unexpected failure:", err);
    res.status(500).json({ error: "Scan failed unexpectedly. Check the Vercel function logs for details." });
  }
}
