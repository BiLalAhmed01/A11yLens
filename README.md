# A11yLens

AI Accessibility and Performance Auditor for Small Business Websites.

Give it a URL. It crawls the site, runs automated WCAG accessibility and
performance checks on desktop and mobile, hands the raw violations to
Gemini, and outputs a prioritized, plain-language fix-it report as HTML
(and optionally PDF) — the kind of report a non-technical business owner
can actually read and act on.

## The problem this solves

Most small business websites fail basic accessibility checks — missing
alt text, low-contrast text, unlabeled form fields, keyboard traps — not
out of neglect, but because nobody on the team knows WCAG exists. Two
consequences follow:

1. **Excluded customers.** Roughly 1 in 4 adults in the US lives with a
   disability. A site that a screen reader can't parse, or that can't be
   operated without a mouse, silently turns those visitors away.
2. **Legal exposure.** Title III of the ADA has been applied to websites
   by U.S. courts for over a decade, and demand letters/lawsuits over
   inaccessible websites are increasingly common — disproportionately
   targeting small and mid-sized businesses that never budgeted for a
   professional accessibility audit (which typically costs thousands of
   dollars from a specialist firm).

A11yLens doesn't replace a certified manual audit (no automated tool can
— axe-core's own documentation estimates automated checks catch roughly
30-40% of WCAG issues). What it does is give a business owner or small
dev team a fast, free, prioritized starting point: what's broken, why it
matters to a real user, and what to fix first.

## How it works

```
URL
 │
 ▼
Playwright headless browser ──► crawls same-origin pages (BFS, capped)
 │
 ▼
axe-core injected into each page, run at desktop (1440×900) and
mobile (390×844) viewports ──► raw WCAG violations + Navigation/Resource
                                Timing performance data
 │
 ▼
Violations deduplicated by rule, ranked by impact severity
 │
 ▼
Gemini (gemini-flash-latest) ──► plain-language explanation, real-world impact,
                               concrete fix, priority, and effort estimate
                               per issue + an executive summary
 │
 ▼
Styled HTML report (and optional PDF via Playwright's print-to-PDF)
```

### Why Playwright

Real accessibility bugs live in the rendered DOM after JavaScript runs —
static HTML fetches miss client-rendered content, dynamically injected
ARIA attributes, and viewport-dependent layout issues (e.g. a hamburger
menu that's keyboard-inaccessible only on mobile). Playwright drives an
actual Chromium instance, so the audit sees what a real visitor's browser
sees, at both desktop and mobile viewport sizes. It's also used to
generate the PDF report (print-to-PDF against the rendered HTML report),
so there's no second PDF library dependency.

### Why axe-core

axe-core (from Deque Systems) is the free, open-source, industry-standard
accessibility rules engine — the same engine behind Chrome DevTools'
Lighthouse accessibility audit. It's run directly inside the page context
via `page.evaluate()`, tests against WCAG 2.0/2.1 A and AA success
criteria plus best-practice rules, and returns structured violation data
(rule id, severity/impact, affected DOM nodes, and a help URL) with zero
false-positive tolerance by design — axe only reports what it can prove.

### Why an LLM on top

axe-core's raw output is written for developers: rule IDs, CSS selectors,
WCAG success-criterion codes. A small business owner can't act on
`color-contrast: 4.2:1 ratio required 4.5:1`. The LLM step translates
each violation into plain language, explains who it actually affects and
how, gives a concrete fix, and prioritizes the whole list by severity and
effort — turning a compliance report into a to-do list.

## Setup

```bash
npm install          # also installs the Playwright Chromium browser
cp .env.example .env # add your GEMINI_API_KEY
```

Get a free API key at https://aistudio.google.com/apikey (no credit card
required). Without a key set, the tool still runs and produces a full
report — it just falls back to raw axe-core rule text instead of
AI-generated explanations.

## Usage

```bash
node src/index.js https://example.com
node src/index.js example.com --max-pages 8 --pdf
node src/index.js example.com --out ./my-reports
```

| Flag          | Default   | Description                                   |
| ------------- | --------- | ---------------------------------------------- |
| `--max-pages` | `5`       | Max same-origin pages to crawl and scan        |
| `--out`       | `reports` | Output directory                                |
| `--pdf`       | off       | Also render a PDF alongside the HTML report     |

Output: `reports/<hostname>-report.html` (and `.pdf` with `--pdf`).

## Testing

```bash
npm test
```

Runs the characterization tests in `test/` via Node's built-in test runner.
They cover the pure aggregation/scoring/report-rendering logic, the
crawler's BFS/dedup/origin rules (against a fake in-memory page, not a real
browser), and the CLI's argument validation -- no network or browser
required.

## What gets checked

- **Accessibility** (axe-core, WCAG 2.0/2.1 A + AA + best practices):
  missing alt text, insufficient color contrast, unlabeled form inputs,
  missing/invalid ARIA, keyboard-trap risks, heading structure, and more.
- **Performance**: page load timing, Largest Contentful Paint, and total
  transfer size, all captured per page via the browser's Navigation and
  Resource Timing APIs — no third-party performance API required.

Each scanned page is checked at both a desktop and a mobile viewport,
since layout- and touch-target-related issues frequently only appear at
one size.

## Project structure

```
src/
  crawler.js         same-origin BFS page discovery
  scanner.js         axe-core + performance data collection, aggregation, scoring
  llm.js             Gemini prompt/response handling for the plain-language report
  report.js          styled HTML report renderer
  index.js           CLI entry point orchestrating the pipeline
test/                characterization tests for the above (node --test)
public/              static marketing landing page + demo dashboard UI
  index.html         landing page
  dashboard.html     scan UI (renders mock data -- not wired to src/, see its header comment)
  assets/            shared styles.css, app.js (nav), dashboard.js (mock scan logic), logo/favicon
scripts/serve.mjs    zero-dependency static file server for public/ (npm run dev:ui)
```

## Limitations

- Automated scanning is a starting point, not a compliance guarantee —
  pair it with manual keyboard/screen-reader testing before claiming
  WCAG conformance.
- The crawler only follows same-origin `<a href>` links reachable without
  authentication; it won't discover pages behind logins or JS-only
  routing that doesn't update visible links.
- Point it at sites you trust enough to open in your own browser. Only
  same-origin pages are ever scanned or included in the report, but a
  target that redirects off-origin still causes one request to that
  destination before the crawler drops the page — the same thing that
  happens if you click the link yourself. That request comes from your
  machine, so avoid scanning untrusted sites from inside a network where
  a stray GET to an internal address would matter.
- The 0–100 score is a heuristic weighted by axe impact severity, not a
  certified metric from any standards body.
