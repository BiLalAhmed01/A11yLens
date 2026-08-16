/**
 * Same-origin link crawler. Uses an existing Playwright page to discover
 * up to `maxPages` internal URLs starting from `startUrl` (BFS, depth-first
 * enough for small marketing sites).
 */
export async function discoverPages(page, startUrl, maxPages = 5) {
  const start = new URL(startUrl);
  const origin = start.origin;
  const visited = new Set();
  const queue = [start.href];
  const discovered = [];

  while (queue.length && discovered.length < maxPages) {
    const url = queue.shift();
    const normalized = normalize(url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      continue; // dead link / timeout — skip, don't crash the whole audit
    }

    discovered.push(page.url());

    if (discovered.length >= maxPages) break;

    const links = await page.$$eval("a[href]", (as) =>
      as.map((a) => a.getAttribute("href")).filter(Boolean)
    );

    for (const href of links) {
      let abs;
      try {
        abs = new URL(href, url).href;
      } catch {
        continue;
      }
      const u = new URL(abs);
      if (u.origin !== origin) continue;
      if (/\.(pdf|jpg|jpeg|png|svg|zip|docx?|xlsx?)$/i.test(u.pathname)) continue;
      u.hash = "";
      if (!visited.has(normalize(u.href)) && !queue.includes(u.href)) {
        queue.push(u.href);
      }
    }
  }

  return discovered;
}

function normalize(url) {
  const u = new URL(url);
  u.hash = "";
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}
