import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverPages } from "../src/crawler.js";

/**
 * Minimal fake of the Playwright Page surface discoverPages actually calls:
 * goto, url, waitForLoadState, $$eval. Good enough to characterize the
 * crawler's BFS/dedup/origin logic without launching a real browser.
 */
function makeFakePage(siteGraph, { redirects = {}, deadPages = new Set() } = {}) {
  let currentUrl = null;
  return {
    async goto(url) {
      if (deadPages.has(url)) throw new Error("simulated navigation failure");
      currentUrl = redirects[url] ?? url;
    },
    url() {
      return currentUrl;
    },
    async waitForLoadState() {
      // no-op; discoverPages already .catch()es this call
    },
    async $$eval(_selector, _fn) {
      return siteGraph[currentUrl] ?? [];
    },
  };
}

test("discoverPages: follows same-origin links breadth-first up to maxPages", async () => {
  const graph = {
    "https://a.com/": ["https://a.com/page2", "https://a.com/page3"],
    "https://a.com/page2": ["https://a.com/page3"],
    "https://a.com/page3": [],
  };
  const page = makeFakePage(graph);
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2", "https://a.com/page3"]);
});

test("discoverPages: stops at maxPages", async () => {
  const graph = {
    "https://a.com/": ["https://a.com/page2", "https://a.com/page3"],
    "https://a.com/page2": [],
    "https://a.com/page3": [],
  };
  const page = makeFakePage(graph);
  const result = await discoverPages(page, "https://a.com/", 2);
  assert.equal(result.length, 2);
});

test("discoverPages: drops external-origin links", async () => {
  const graph = {
    "https://a.com/": ["https://external.com/evil", "https://a.com/page2"],
    "https://a.com/page2": [],
  };
  const page = makeFakePage(graph);
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2"]);
});

test("discoverPages: drops mailto/tel links (opaque origin)", async () => {
  const graph = {
    "https://a.com/": ["mailto:foo@bar.com", "tel:+15551234567", "https://a.com/page2"],
    "https://a.com/page2": [],
  };
  const page = makeFakePage(graph);
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2"]);
});

test("discoverPages: skips binary file extensions", async () => {
  const graph = {
    "https://a.com/": ["https://a.com/brochure.pdf", "https://a.com/photo.jpg", "https://a.com/page2"],
    "https://a.com/page2": [],
  };
  const page = makeFakePage(graph);
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2"]);
});

test("discoverPages: skips non-page same-origin assets linked directly (stylesheet, script, data, font)", async () => {
  const graph = {
    "https://a.com/": [
      "https://a.com/style.css",
      "https://a.com/app.js",
      "https://a.com/data.json",
      "https://a.com/sitemap.xml",
      "https://a.com/notes.txt",
      "https://a.com/font.woff2",
      "https://a.com/page2",
    ],
    "https://a.com/page2": [],
  };
  const page = makeFakePage(graph);
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2"]);
});

test("discoverPages: dedupes trailing-slash variants of the same path", async () => {
  const graph = {
    "https://a.com/": ["https://a.com/page2/", "https://a.com/page2"],
    "https://a.com/page2": [],
  };
  const page = makeFakePage(graph);
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2"]);
});

test("discoverPages: drops a page whose redirect lands off-origin", async () => {
  const graph = {
    "https://a.com/": ["https://a.com/go", "https://a.com/page2"],
    "https://a.com/page2": [],
  };
  const page = makeFakePage(graph, { redirects: { "https://a.com/go": "https://evil.com/phish" } });
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2"]);
});

test("discoverPages: a page that fails to load is skipped, not fatal", async () => {
  const graph = {
    "https://a.com/": ["https://a.com/broken", "https://a.com/page2"],
    "https://a.com/broken": [],
    "https://a.com/page2": [],
  };
  const page = makeFakePage(graph, { deadPages: new Set(["https://a.com/broken"]) });
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, ["https://a.com/", "https://a.com/page2"]);
});

test("discoverPages: if the start URL itself fails, returns an empty list", async () => {
  const page = makeFakePage({}, { deadPages: new Set(["https://a.com/"]) });
  const result = await discoverPages(page, "https://a.com/", 5);
  assert.deepEqual(result, []);
});
