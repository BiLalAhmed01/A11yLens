import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { runAudit, AuditError } from "../src/pipeline.js";
import { parseSiteUrl, ValidationError } from "../src/validate.js";

const ROOT = path.resolve("public");
const PORT = process.env.PORT || 3000;
const MAX_BODY_BYTES = 10_000; // request body is just {url, maxPages} -- never legitimately large
const MAX_PAGES_CAP = 8; // local dev tool, but still cap runaway crawls from a stray request

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);

  if (req.method === "POST" && urlPath === "/api/scan") {
    handleScan(req, res);
    return;
  }

  serveStatic(urlPath, res);
});

function serveStatic(urlPath, res) {
  const filePath = path.join(ROOT, urlPath === "/" ? "/index.html" : urlPath);

  // Prevent escaping the public/ root via ../ traversal. A bare
  // startsWith(ROOT) would also wrongly allow a sibling directory whose
  // name happens to start with "public" (e.g. "public-private"); requiring
  // the path separator right after ROOT rules that out.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found: " + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleScan(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  let siteUrl;
  try {
    siteUrl = parseSiteUrl(String(body.url ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    throw err;
  }

  let maxPages = 5;
  if (body.maxPages !== undefined) {
    maxPages = Number(body.maxPages);
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      sendJson(res, 400, { error: "maxPages must be a positive integer" });
      return;
    }
    maxPages = Math.min(maxPages, MAX_PAGES_CAP);
  }

  try {
    console.log(`[scan] ${siteUrl} (max ${maxPages} pages)`);
    const result = await runAudit(siteUrl, {
      maxPages,
      onProgress: (msg) => console.log(`  ${msg}`),
      launchBrowser: () => chromium.launch(),
    });
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof AuditError) {
      sendJson(res, 422, { error: err.message });
      return;
    }
    // Unexpected failures (browser crash, Gemini/network issues that escaped
    // llm.js's own fallback, etc.) -- log the real error server-side, but
    // don't leak internals to the client.
    console.error("[scan] unexpected failure:", err);
    sendJson(res, 500, { error: "Scan failed unexpectedly. Check the server console for details." });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {});
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

server.listen(PORT, () => {
  console.log(`A11yLens UI running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log("  (GEMINI_API_KEY not set -- scans will use raw axe-core text, no AI explanations)");
  }
});
