/**
 * Dashboard demo logic. This UI is not yet wired to the live crawler/axe-core/
 * Gemini pipeline in src/ — it renders deterministic mock data seeded from the
 * scanned hostname so the same URL always produces the same-looking report.
 * Swapping in real results means replacing `runMockScan()` with a fetch to a
 * backend that runs src/index.js's pipeline and returns its JSON.
 */
(function () {
  const ISSUE_POOL = [
    {
      rule: "color-contrast",
      priority: "Critical",
      effort: "Low",
      plainLanguage: "Some text doesn't have enough contrast against its background to be read comfortably.",
      realWorldImpact: "Low-vision and colorblind users, and anyone in bright sunlight, may not be able to read this text at all.",
      fix: "Increase the contrast ratio to at least 4.5:1 for normal text (3:1 for large text). Darken the text or lighten the background.",
    },
    {
      rule: "label",
      priority: "Critical",
      effort: "Low",
      plainLanguage: "Some form fields don't have a label a screen reader can announce.",
      realWorldImpact: "Screen reader users hear only \"edit text\" with no idea what to type, and often abandon the form.",
      fix: "Add a <label for=\"id\"> tied to each input's id, or an aria-label if a visible label isn't appropriate.",
    },
    {
      rule: "image-alt",
      priority: "Serious",
      effort: "Low",
      plainLanguage: "Some images are missing alternative text.",
      realWorldImpact: "Screen reader users hear the filename or nothing at all, losing any information the image conveyed.",
      fix: "Add a concise alt attribute describing the image's purpose, or alt=\"\" if it's purely decorative.",
    },
    {
      rule: "landmark-one-main",
      priority: "Warning",
      effort: "Low",
      plainLanguage: "The page doesn't have a designated main content area.",
      realWorldImpact: "Screen reader users can't jump straight to the primary content and must tab through every element first.",
      fix: "Wrap the primary content in a <main> element or add role=\"main\" to its container.",
    },
    {
      rule: "keyboard-trap",
      priority: "Critical",
      effort: "Medium",
      plainLanguage: "A widget on the page can be tabbed into but not tabbed back out of.",
      realWorldImpact: "Keyboard-only users get stuck and may be unable to reach the rest of the page without reloading.",
      fix: "Ensure every interactive widget's focus trap (if any) has a documented, working exit — typically Escape or Tab cycling back out.",
    },
    {
      rule: "heading-order",
      priority: "Warning",
      effort: "Medium",
      plainLanguage: "Heading levels skip, e.g. jumping from an <h2> straight to an <h4>.",
      realWorldImpact: "Screen reader users navigate by heading level; skipped levels make the page's structure confusing.",
      fix: "Adjust heading tags so levels increase by one at a time, reflecting the true content hierarchy.",
    },
    {
      rule: "link-name",
      priority: "Serious",
      effort: "Low",
      plainLanguage: "Some links have no discernible text, such as an icon-only link with no accessible name.",
      realWorldImpact: "Screen reader users hear \"link\" with no destination information, and can't tell where it goes.",
      fix: "Add visible text, an aria-label, or an sr-only span describing the link's destination.",
    },
    {
      rule: "region",
      priority: "Warning",
      effort: "Medium",
      plainLanguage: "Some visible content isn't contained within a landmark region like header, nav, main, or footer.",
      realWorldImpact: "Screen reader users navigating by region may skip over or lose context for this content.",
      fix: "Wrap top-level content sections in appropriate landmark elements.",
    },
  ];

  const form = document.getElementById("scanForm");
  const urlInput = document.getElementById("urlInput");
  const scanBtn = document.getElementById("scanBtn");
  const scanBtnLabel = document.getElementById("scanBtnLabel");
  const scanStatus = document.getElementById("scanStatus");
  const scanMeta = document.getElementById("scanMeta");
  const scanTarget = document.getElementById("scanTarget");
  const scanTimestamp = document.getElementById("scanTimestamp");
  const skeleton = document.getElementById("skeleton");
  const emptyState = document.getElementById("emptyState");
  const results = document.getElementById("results");
  const issueList = document.getElementById("issueList");
  const filteredEmpty = document.getElementById("filteredEmpty");

  let currentIssues = [];
  let activeFilter = "All";

  // Deterministic pseudo-random so the same hostname always renders the same report.
  function seededRandom(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    return function () {
      h = (Math.imul(h, 1664525) + 1013904223) | 0;
      return ((h >>> 0) % 1000) / 1000;
    };
  }

  function normalizeUrl(input) {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
    return new URL(withScheme);
  }

  function runMockScan(hostname) {
    const rand = seededRandom(hostname);
    const count = 3 + Math.floor(rand() * (ISSUE_POOL.length - 3));
    const shuffled = [...ISSUE_POOL].sort(() => rand() - 0.5).slice(0, count);
    const issues = shuffled.map((issue, i) => ({
      ...issue,
      nodeCount: 1 + Math.floor(rand() * 6),
      affectedPages: [`https://${hostname}/ (desktop)`, `https://${hostname}/ (mobile)`].slice(0, i % 2 === 0 ? 2 : 1),
      helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${issue.rule}`,
    }));

    const critical = issues.filter((i) => i.priority === "Critical").length;
    const serious = issues.filter((i) => i.priority === "Serious").length;
    const warnings = issues.filter((i) => i.priority === "Warning").length;
    const penalty = critical * 10 + serious * 6 + warnings * 2;
    const score = Math.max(35, Math.min(98, 100 - penalty));
    const passedCount = 20 + Math.floor(rand() * 25);

    return {
      score,
      passedCount,
      issues,
      summary: `This site scores ${score} out of 100 in heuristic accessibility. ${
        critical > 0
          ? `${critical} critical issue${critical === 1 ? "" : "s"} would block some visitors entirely and should be fixed first.`
          : "No critical blockers were found, but the issues below still affect real users."
      } Addressing these reduces legal exposure and makes the site usable for a wider range of customers.`,
      perf: {
        avgLoadMs: 400 + Math.floor(rand() * 2200),
        avgLcpMs: 800 + Math.floor(rand() * 2400),
        avgTransferKb: 200 + Math.floor(rand() * 1800),
        pagesScanned: 1 + Math.floor(rand() * 5),
      },
    };
  }

  function scoreLabel(score) {
    if (score >= 90) return "Excellent";
    if (score >= 75) return "Good";
    if (score >= 50) return "Needs Work";
    return "Critical";
  }

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function issueCardHtml(issue) {
    return `
    <article class="card issue-card" data-priority="${esc(issue.priority)}">
      <header class="issue-header">
        <span class="badge badge-${issue.priority === "Critical" ? "critical" : "warning"}">${esc(issue.priority)}</span>
        <span class="badge badge-neutral">Effort: ${esc(issue.effort)}</span>
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
      <footer class="issue-footer">
        <span>Pages: ${esc(issue.affectedPages.join(", "))} · ${issue.nodeCount} occurrence${issue.nodeCount === 1 ? "" : "s"}</span>
        <a href="${esc(issue.helpUrl)}" target="_blank" rel="noopener noreferrer">WCAG reference &rarr;</a>
      </footer>
    </article>`;
  }

  function renderIssues() {
    const visible = activeFilter === "All" ? currentIssues : currentIssues.filter((i) => i.priority === activeFilter);
    issueList.innerHTML = visible.map(issueCardHtml).join("\n");
    filteredEmpty.hidden = visible.length > 0;
  }

  function renderResults(data, hostname) {
    document.getElementById("scoreNum").textContent = `${data.score}%`;
    document.getElementById("scoreLabel").textContent = scoreLabel(data.score);

    const critical = data.issues.filter((i) => i.priority === "Critical").length;
    const serious = data.issues.filter((i) => i.priority === "Serious").length;
    const warnings = data.issues.filter((i) => i.priority === "Warning").length;

    document.getElementById("statIssues").textContent = String(critical + serious);
    document.getElementById("statWarnings").textContent = String(warnings);
    document.getElementById("statPassed").textContent = String(data.passedCount);
    document.getElementById("summaryText").textContent = data.summary;

    document.getElementById("perfLoad").textContent = `${data.perf.avgLoadMs} ms`;
    document.getElementById("perfLcp").textContent = `${data.perf.avgLcpMs} ms`;
    document.getElementById("perfTransfer").textContent = `${data.perf.avgTransferKb} KB`;
    document.getElementById("perfPages").textContent = String(data.perf.pagesScanned);

    currentIssues = data.issues;
    activeFilter = "All";
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.setAttribute("aria-pressed", String(tab.dataset.filter === "All"));
    });
    renderIssues();

    scanTarget.textContent = hostname;
    scanTimestamp.textContent = new Date().toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    scanMeta.hidden = false;
  }

  function setLoading(isLoading) {
    scanBtn.disabled = isLoading;
    scanBtnLabel.textContent = isLoading ? "Scanning…" : "Scan Your Website";
    skeleton.classList.toggle("active", isLoading);
    scanStatus.hidden = !isLoading;
  }

  function startScan(rawUrl) {
    let url;
    try {
      url = normalizeUrl(rawUrl);
    } catch {
      scanStatus.hidden = false;
      scanStatus.textContent = `"${rawUrl}" doesn't look like a valid URL.`;
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      scanStatus.hidden = false;
      scanStatus.textContent = "Only http and https URLs can be scanned.";
      return;
    }

    emptyState.hidden = true;
    results.classList.remove("active");
    setLoading(true);

    const steps = ["Discovering pages…", "Running accessibility checks (desktop)…", "Running accessibility checks (mobile)…", "Generating plain-language report…"];
    let stepIndex = 0;
    scanStatus.textContent = steps[0];
    const stepTimer = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      scanStatus.textContent = steps[stepIndex];
    }, 550);

    setTimeout(() => {
      clearInterval(stepTimer);
      const data = runMockScan(url.hostname);
      renderResults(data, url.hostname);
      setLoading(false);
      results.classList.add("active");
    }, 2200);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!urlInput.value.trim()) return;
    startScan(urlInput.value.trim());
  });

  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeFilter = tab.dataset.filter;
      document.querySelectorAll(".filter-tab").forEach((t) => t.setAttribute("aria-pressed", String(t === tab)));
      renderIssues();
    });
  });

  // If we arrived from the landing page's hero form (?url=example.com), prefill and auto-scan.
  const params = new URLSearchParams(window.location.search);
  const prefillUrl = params.get("url");
  if (prefillUrl) {
    urlInput.value = prefillUrl;
    startScan(prefillUrl);
  }
})();
