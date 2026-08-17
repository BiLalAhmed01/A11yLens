export class ValidationError extends Error {}

/**
 * Accepts "example.com" or a full URL; rejects anything that isn't http(s).
 * A scheme is only recognized when followed by "//", so "localhost:3000"
 * is treated as a host:port and not as a "localhost:" scheme. Shared by the
 * CLI (src/index.js) and the local dev server (scripts/serve.mjs) so a
 * scan request is validated identically from both entry points.
 */
export function parseSiteUrl(input) {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  let url;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    throw new ValidationError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError(`Only http and https URLs can be scanned (got ${url.protocol})`);
  }
  return url.href;
}
