const COLORS = {
  bg: "#07111F",
  surface: "#0D1B2A",
  primary: "#18D6B5",
  secondary: "#5EEAD4",
  text: "#F5F7FA",
  muted: "#94A3B8",
  border: "#203247",
  warning: "#F5B942",
  critical: "#FF6B6B",
  success: "#22C55E",
};

const PRIORITY_COLOR = new Map([
  ["Critical", COLORS.critical],
  ["Serious", COLORS.warning],
  ["Warning", COLORS.warning],
]);

function scoreLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs Work";
  return "Critical";
}

/**
 * Escapes for both text and quoted-attribute contexts. Everything rendered
 * here — page URLs, markup samples copied off the audited site, LLM prose —
 * is untrusted, so quotes must be escaped too or a sample containing
 * `" onload="` would break out of an attribute.
 */
function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links are emitted, so a bad value can't become `javascript:`. */
function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function issueCard(issue) {
  const color = PRIORITY_COLOR.get(issue.priority) ?? COLORS.warning;
  const helpHref = safeHref(issue.helpUrl);
  return `
  <article class="issue-card" style="border-left-color:${color}">
    <header class="issue-header">
      <span class="badge" style="background:${color}22;color:${color};border-color:${color}55">${esc(
    issue.priority
  )}</span>
      <span class="badge effort">Effort: ${esc(issue.effort)}</span>
      <code class="rule-id">${esc(issue.rule)}</code>
    </header>
    <p class="issue-plain">${esc(issue.plainLanguage)}</p>
    <div class="issue-grid">
      <div>
        <h4>Real-world impact</h4>
        <p>${esc(issue.realWorldImpact)}</p>
      </div>
      <div>
        <h4>Suggested fix</h4>
        <p>${esc(issue.fix)}</p>
      </div>
    </div>
    ${
      issue.sampleHtml
        ? `<details><summary>Affected markup (${issue.nodeCount} occurrence${
            issue.nodeCount === 1 ? "" : "s"
          })</summary><pre>${esc(issue.sampleHtml)}</pre></details>`
        : ""
    }
    <footer class="issue-footer">
      <span>Pages: ${esc(issue.affectedPages.slice(0, 4).join(", "))}${
        issue.affectedPages.length > 4 ? ` +${issue.affectedPages.length - 4} more` : ""
      }</span>
      ${helpHref ? `<a href="${esc(helpHref)}" target="_blank" rel="noopener noreferrer">WCAG reference &rarr;</a>` : ""}
    </footer>
  </article>`;
}

export function renderReportHtml({ siteUrl, score, passedCount, issues, summary, perfSummary, scannedAt }) {
  const critical = issues.filter((i) => i.priority === "Critical").length;
  const serious = issues.filter((i) => i.priority === "Serious").length;
  const warnings = issues.filter((i) => i.priority === "Warning").length;
  const issueCount = critical + serious;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>A11yLens Report — ${esc(siteUrl)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:${COLORS.bg}; --surface:${COLORS.surface}; --primary:${COLORS.primary};
    --secondary:${COLORS.secondary}; --text:${COLORS.text}; --muted:${COLORS.muted};
    --border:${COLORS.border}; --warning:${COLORS.warning}; --critical:${COLORS.critical};
    --success:${COLORS.success};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: 'Inter', system-ui, sans-serif; line-height: 1.5;
  }
  h1, h2, h3, h4 { font-family: 'Sora', 'Inter', sans-serif; margin: 0 0 8px; }
  a { color: var(--primary); }
  .wrap { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
  .nav { display:flex; align-items:center; gap:10px; margin-bottom: 40px; }
  .nav .logo-dot { width:12px; height:12px; border-radius:50%; background: var(--primary); box-shadow: 0 0 12px var(--primary); }
  .nav span { font-family:'Sora',sans-serif; font-weight:700; letter-spacing:0.5px; }
  .hero { background: linear-gradient(155deg, var(--surface), var(--bg)); border: 1px solid var(--border); border-radius: 16px; padding: 32px; margin-bottom: 32px; }
  .hero h1 { font-size: 28px; }
  .hero .url { color: var(--secondary); word-break: break-all; font-weight: 500; }
  .score-row { display:flex; align-items:center; gap:32px; margin-top: 24px; flex-wrap: wrap; }
  .score-circle { width:120px; height:120px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; background: var(--surface); border: 3px solid var(--primary); }
  .score-circle .num { font-family:'Sora',sans-serif; font-size:30px; font-weight:800; color: var(--primary); }
  .score-circle .label { font-size:11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
  .stat-grid { display:flex; gap:24px; flex-wrap: wrap; }
  .stat { min-width: 110px; }
  .stat .n { font-family:'Sora',sans-serif; font-size:26px; font-weight:700; }
  .stat .l { color: var(--muted); font-size: 13px; }
  .stat.critical .n { color: var(--critical); }
  .stat.warning .n { color: var(--warning); }
  .stat.success .n { color: var(--success); }
  .summary-box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; color: var(--text); }
  .summary-box h3 { color: var(--secondary); font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  .perf-row { display:flex; gap:24px; flex-wrap:wrap; margin-bottom: 32px; }
  .perf-card { flex: 1; min-width: 140px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .perf-card .n { font-family:'Sora',sans-serif; font-size: 22px; font-weight: 700; color: var(--primary); }
  .perf-card .l { color: var(--muted); font-size: 12px; }
  section.issues h2 { font-size: 20px; margin-bottom: 16px; }
  .issue-card { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--warning); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
  .issue-header { display:flex; align-items:center; gap:10px; margin-bottom: 10px; flex-wrap: wrap; }
  .badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; border: 1px solid; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.effort { background: var(--bg); color: var(--muted); border-color: var(--border); }
  .rule-id { margin-left: auto; color: var(--muted); font-size: 12px; }
  .issue-plain { font-size: 15px; margin-bottom: 12px; }
  .issue-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 10px; }
  .issue-grid h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--secondary); }
  .issue-grid p { font-size: 14px; color: var(--text); margin: 0; }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  pre { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 12px; color: var(--secondary); }
  .issue-footer { display:flex; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
  footer.report-footer { text-align:center; color: var(--muted); font-size: 12px; margin-top: 48px; }
  @media (max-width: 600px) {
    .issue-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="nav"><span class="logo-dot"></span><span>A11yLens</span></div>

    <div class="hero">
      <h1>Accessibility &amp; Performance Report</h1>
      <div class="url">${esc(siteUrl)}</div>
      <div class="score-row">
        <div class="score-circle">
          <div class="num">${score}%</div>
          <div class="label">${esc(scoreLabel(score))}</div>
        </div>
        <div class="stat-grid">
          <div class="stat critical"><div class="n">${issueCount}</div><div class="l">Issues</div></div>
          <div class="stat warning"><div class="n">${warnings}</div><div class="l">Warnings</div></div>
          <div class="stat success"><div class="n">${passedCount}</div><div class="l">Passed</div></div>
        </div>
      </div>
    </div>

    <div class="summary-box">
      <h3>Executive Summary</h3>
      <p>${esc(summary)}</p>
    </div>

    <div class="perf-row">
      <div class="perf-card"><div class="n">${perfSummary.avgLoadMs} ms</div><div class="l">Avg. page load</div></div>
      <div class="perf-card"><div class="n">${perfSummary.avgLcpMs} ms</div><div class="l">Avg. Largest Contentful Paint</div></div>
      <div class="perf-card"><div class="n">${perfSummary.avgTransferKb} KB</div><div class="l">Avg. transfer size</div></div>
      <div class="perf-card"><div class="n">${perfSummary.pagesScanned}</div><div class="l">Pages scanned</div></div>
    </div>

    <section class="issues">
      <h2>Prioritized Fix List</h2>
      ${
        issues.length
          ? issues.map(issueCard).join("\n")
          : `<p class="summary-box">No automated violations were detected on the pages scanned.</p>`
      }
    </section>

    <footer class="report-footer">
      Generated by A11yLens on ${esc(scannedAt)} — automated checks via axe-core catch an estimated ~30-40% of WCAG issues; manual review is still recommended for full compliance.
    </footer>
  </div>
</body>
</html>`;
}
