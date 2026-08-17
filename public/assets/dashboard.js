/**
 * Dashboard logic. Runs a real scan through POST /api/scan, served by
 * scripts/serve.mjs, which runs the actual crawler/axe-core/Gemini pipeline
 * in src/pipeline.js. This only works when the page is loaded through that
 * server (`npm run dev:ui`) -- opened as a bare file:// page, or deployed as
 * a static site with no backend (e.g. Vercel's free static hosting), the
 * fetch below has nothing to talk to and startScan() reports that clearly
 * instead of spinning forever.
 */
(function () {
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

  function normalizeUrl(input) {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
    return new URL(withScheme);
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
        ${issue.helpUrl ? `<a href="${esc(issue.helpUrl)}" target="_blank" rel="noopener noreferrer">WCAG reference &rarr;</a>` : ""}
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

    document.getElementById("perfLoad").textContent = `${data.perfSummary.avgLoadMs} ms`;
    document.getElementById("perfLcp").textContent = `${data.perfSummary.avgLcpMs} ms`;
    document.getElementById("perfTransfer").textContent = `${data.perfSummary.avgTransferKb} KB`;
    document.getElementById("perfPages").textContent = String(data.perfSummary.pagesScanned);

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
    urlInput.disabled = isLoading;
    scanBtn.classList.toggle("is-loading", isLoading);
    scanBtnLabel.textContent = isLoading ? "Scanning…" : "Scan Your Website";
    skeleton.classList.toggle("active", isLoading);
    scanStatus.hidden = !isLoading;
  }

  function showError(message) {
    setLoading(false);
    scanStatus.hidden = false;
    scanStatus.textContent = message;
    if (!results.classList.contains("active")) emptyState.hidden = false;
  }

  async function startScan(rawUrl) {
    let url;
    try {
      url = normalizeUrl(rawUrl);
    } catch {
      showError(`"${rawUrl}" doesn't look like a valid URL.`);
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      showError("Only http and https URLs can be scanned.");
      return;
    }

    emptyState.hidden = true;
    results.classList.remove("active");
    // Otherwise the previous scan's target/timestamp stays visible and
    // directly contradicts the URL just submitted, while the page is
    // visibly loading a different one.
    scanMeta.hidden = true;
    setLoading(true);

    // No incremental progress is streamed back from a single fetch, so this
    // cycles generic step labels purely to signal the page hasn't frozen --
    // it isn't tracking the real pipeline's actual stage.
    const steps = ["Discovering pages…", "Running accessibility checks…", "Checking performance…", "Generating plain-language report…"];
    let stepIndex = 0;
    scanStatus.textContent = steps[0];
    const stepTimer = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      scanStatus.textContent = steps[stepIndex];
    }, 4000);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.href }),
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        // A non-JSON body on a non-2xx response is what a static host with
        // no /api/scan backend actually returns (its own default 404/HTML
        // page, not our server) -- call that out specifically rather than
        // just saying "invalid JSON" and leaving the real cause a mystery.
        throw new Error(
          response.ok
            ? "The server sent back something that wasn't valid JSON."
            : `No scan server responded at /api/scan (HTTP ${response.status}). This dashboard needs to be running via "npm run dev:ui" locally, or deployed on a Node host that runs scripts/serve.mjs -- it won't work on a static-only deployment.`
        );
      }

      if (!response.ok) {
        throw new Error(payload.error || `Scan failed (HTTP ${response.status}).`);
      }

      clearInterval(stepTimer);
      renderResults(payload, url.hostname);
      setLoading(false);
      scanStatus.hidden = true;
      results.classList.add("active");
    } catch (err) {
      clearInterval(stepTimer);
      const isNetworkFailure = err instanceof TypeError;
      showError(
        isNetworkFailure
          ? "Couldn't reach the scan server. This dashboard needs to be running via \"npm run dev:ui\" locally -- it won't work as a static-only deployment."
          : err.message
      );
    }
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
