const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|mp4|mp3|docx?|xlsx?|pptx?|css|js|mjs|json|xml|txt|woff2?|ttf|eot)$/i;

/**
 * Same-origin link crawler. Uses an existing Playwright page to discover
 * up to `maxPages` internal URLs starting from `startUrl` (breadth-first).
 */
export async function discoverPages(page, startUrl, maxPages = 5) {
  const origin = new URL(startUrl).origin;
  const seen = new Set();
  const queue = [normalize(startUrl)];
  const discovered = [];

  seen.add(queue[0]);

  while (queue.length && discovered.length < maxPages) {
    const url = queue.shift();

    try {
      // "load" rather than "networkidle": sites with analytics beacons or
      // polling never go idle, and a timeout here would drop a good page.
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    } catch {
      continue; // dead link / timeout — skip, don't crash the whole audit
    }

    // goto follows redirects, which can land off-origin (e.g. a link shortener
    // or an open redirect pointing at an internal host). Never scan what we
    // didn't agree to scan.
    const landed = page.url();
    if (new URL(landed).origin !== origin) continue;

    const landedKey = normalize(landed);
    if (landedKey !== url && seen.has(landedKey)) continue; // redirected onto a page we already have
    seen.add(landedKey);
    discovered.push(landed);

    if (discovered.length >= maxPages) break;

    let links;
    try {
      links = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
    } catch {
      continue; // page navigated away or was torn down mid-evaluation
    }

    for (const href of links) {
      let u;
      try {
        u = new URL(href, landed);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      if (SKIP_EXTENSIONS.test(u.pathname)) continue;
      const key = normalize(u.href);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(key);
    }
  }

  return discovered;
}

/** Canonical form for dedupe: no fragment, no trailing slash on subpaths. */
function normalize(url) {
  const u = new URL(url);
  u.hash = "";
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}
