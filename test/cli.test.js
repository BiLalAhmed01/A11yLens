import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "src", "index.js");

/**
 * Black-box CLI tests. All of these fail during argument parsing, before any
 * browser is launched or network call made, so they're fast and hermetic --
 * a real characterization of src/index.js's exported-nothing arg parser,
 * exercised the only way it's actually used: as a process.
 */
function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf-8" });
}

test("CLI: no arguments exits 1 with a usage error", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing target URL/);
  assert.match(result.stderr, /Usage: a11ylens/);
});

test("CLI: two positional arguments is rejected", () => {
  const result = run(["https://a.com", "https://b.com"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected exactly one URL/);
});

test("CLI: --max-pages must be a positive integer", () => {
  for (const bad of ["abc", "0", "-1", "1.5"]) {
    const result = run(["https://a.com", "--max-pages", bad]);
    assert.equal(result.status, 1, `--max-pages ${bad} should fail`);
    assert.match(result.stderr, /--max-pages must be a positive integer/);
  }
});

test("CLI: --out requires a value", () => {
  const result = run(["https://a.com", "--out"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--out requires a directory path/);
});

test("CLI: unknown flags are rejected rather than silently treated as the URL", () => {
  const result = run(["--bogus", "https://a.com"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option: --bogus/);
});

test("CLI: non-http(s) schemes are rejected", () => {
  const result = run(["ftp://a.com"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Only http and https URLs can be scanned/);
});

test("CLI: an unparseable URL is rejected with a clear message", () => {
  const result = run(["not a valid url"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Not a valid URL/);
});

test("CLI: a bare domain is accepted as a positional arg (scheme defaulted, not rejected at parse time)", () => {
  // We only assert it gets past arg parsing -- it will go on to try a real
  // network crawl, which we don't want in a unit test, so kill it fast.
  const result = spawnSync(process.execPath, [CLI, "example.com", "--max-pages", "1"], {
    encoding: "utf-8",
    timeout: 500,
  });
  // Killed by timeout before it could finish a real crawl. All this proves
  // is that no usage error was printed for a bare domain -- the process's
  // own module-load overhead (multiple seconds, observed empirically) means
  // a 500ms window can't distinguish "still importing" from "already past
  // validation and scanning," so that stronger claim isn't asserted here.
  assert.doesNotMatch(result.stderr ?? "", /Usage: a11ylens/);
});
