// popup.js

const {
  escHtml: esc, formatNum: fmt, formatBig: fmtBig, safeHref,
  kvRow, kvRowHtml, subHead, normaliseFilings,
  titleCase, filingHeadline, buildFilingExtra,
  buildOverview, buildValuation, buildPeersComparison, buildFinancials,
  buildManagement, buildFuture, buildDividend, buildOwnership, buildScoring, buildPeerGroup,
} = globalThis.SectorsRender;

// ── DOM refs ──────────────────────────────────────────────────────────────
const keyStatusEl   = document.getElementById("key-status");
const keyOkEl       = document.getElementById("key-ok");
const tickerInput   = document.getElementById("ticker-input");
const btnSearch     = document.getElementById("btn-search");
const btnSettings   = document.getElementById("btn-settings");
const btnSetKey     = document.getElementById("btn-set-key");
const resultArea    = document.getElementById("result-area");
const resultContent = document.getElementById("result-content");
const prefEnabled   = document.getElementById("pref-enabled");
const prefThemeToggle = document.getElementById("pref-theme-toggle");
const prefDelay     = document.getElementById("pref-delay");
const delayVal      = document.getElementById("delay-val");

// ── Init ──────────────────────────────────────────────────────────────────
chrome.storage.sync.get(["sectorsApiKey", "prefTheme"], ({ sectorsApiKey, prefTheme }) => {
  if (prefTheme) {
    applyTheme(prefTheme);
  } else {
    applyTheme("dark");
  }

  if (sectorsApiKey) {
    keyOkEl.classList.remove("hidden");
    keyStatusEl.classList.add("hidden");
  } else {
    keyStatusEl.classList.remove("hidden");
    keyOkEl.classList.add("hidden");
    chrome.storage.local.get(["hasOpenedBefore"], ({ hasOpenedBefore }) => {
      if (!hasOpenedBefore) {
        chrome.storage.local.set({ hasOpenedBefore: true }, () => {
          chrome.runtime.openOptionsPage();
        });
      }
    });
  }
});

chrome.storage.sync.get(["prefEnabled", "prefTheme", "prefDelay"], (res) => {
  if (res.prefEnabled !== undefined) prefEnabled.checked = res.prefEnabled;
  if (res.prefTheme) {
    prefThemeToggle.checked = res.prefTheme === "dark";
    applyTheme(res.prefTheme);
  } else {
    prefThemeToggle.checked = true; // Default to dark/midnight
  }
  if (res.prefDelay) {
    prefDelay.value = res.prefDelay;
    delayVal.textContent = `${res.prefDelay} ms`;
    updateSliderGradient(prefDelay);
  }
});

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
  localStorage.setItem("prefTheme", theme);
}

// ── Navigation ────────────────────────────────────────────────────────────
btnSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
btnSetKey.addEventListener("click",   () => chrome.runtime.openOptionsPage());

// ── Search ────────────────────────────────────────────────────────────────
btnSearch.addEventListener("click", doSearch);
tickerInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

// ── Personalization ───────────────────────────────────────────────────────
prefEnabled.addEventListener("change", () => {
  chrome.storage.sync.set({ prefEnabled: prefEnabled.checked });
});

prefThemeToggle.addEventListener("change", () => {
  const theme = prefThemeToggle.checked ? "dark" : "light";
  applyTheme(theme);
  chrome.storage.sync.set({ prefTheme: theme });
});

prefDelay.addEventListener("input", () => {
  delayVal.textContent = `${prefDelay.value} ms`;
  updateSliderGradient(prefDelay);
});

prefDelay.addEventListener("change", () => {
  chrome.storage.sync.set({ prefDelay: parseInt(prefDelay.value, 10) });
});

// React to changes from options/background/other tabs in real time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.prefEnabled) prefEnabled.checked = changes.prefEnabled.newValue;
  if (changes.prefDelay) {
    prefDelay.value = changes.prefDelay.newValue;
    delayVal.textContent = `${changes.prefDelay.newValue} ms`;
    updateSliderGradient(prefDelay);
  }
  if (changes.prefTheme) {
    prefThemeToggle.checked = changes.prefTheme.newValue === "dark";
    applyTheme(changes.prefTheme.newValue);
  }
});

function updateSliderGradient(el) {
  const min = el.min || 0;
  const max = el.max || 100;
  const val = el.value;
  el.style.backgroundSize = ((val - min) / (max - min)) * 100 + "% 100%";
}

async function doSearch() {
  const raw    = tickerInput.value.trim();
  const isSgx  = raw.toLowerCase().endsWith(".si");
  const symbol = raw.replace(/\.(jk|ij|id|si)$/i, "").toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) return;

  showLoading();

  // Reuse the background's API path, key handling, error mapping and filings
  // normalisation instead of repeating them here.
  chrome.runtime.sendMessage(
    { type: "FETCH_TICKER_DATA", symbol: isSgx ? `${symbol}.SI` : symbol },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        showError("Request Failed", chrome.runtime.lastError?.message || "No response from extension.");
        return;
      }
      if (response.error === "no_api_key") {
        showError("No API Key Set", 'Please add your API key in <a href="#" id="error-open-settings" class="error-link">Settings</a> to enable search.', true);
        document.getElementById("error-open-settings")?.addEventListener("click", (e) => {
          e.preventDefault();
          chrome.runtime.openOptionsPage();
        });
        return;
      }
      if (response.error === "ticker_not_found" || response.error === "invalid_symbol") {
        showError("Ticker Not Found", `${symbol} does not exist in our database.`);
        return;
      }
      if (response.error) {
        if (response.error.includes("403")) {
          showError("API Limit Reached", 'Your API key is exhausted. Upgrade at <a href="https://sectors.app/api" target="_blank" rel="noopener noreferrer" class="error-link">sectors.app/api</a>', true);
        } else if (response.error.includes("429")) {
          showError("Rate Limit Exceeded", "You are making too many requests. Please slow down or consider upgrading.");
        } else {
          showError("Request Failed", response.error);
        }
        return;
      }
      renderResult(response);
    }
  );
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════════════════
function renderResult({ symbol, report, filings, isSgx }) {
  resultArea.classList.remove("hidden");

  const r          = report;
  const overview   = r?.overview   || {};
  const valuation  = r?.valuation  || {};
  const dividend   = r?.dividend   || {};
  const financials = r?.financials || {};
  const filingRows = normaliseFilings(filings, isSgx)?.results || [];
  const currency   = isSgx ? "SGD" : "IDR";

  let html = "";

  if (r) {
    // ── Company card ──
    let pe = "—", pb = "—", dy = "—";
    if (isSgx) {
      pe = valuation.pe != null ? valuation.pe.toFixed(2) : "—";
      pb = valuation.pb != null ? valuation.pb.toFixed(2) : "—";
      dy = dividend.forward_dividend_yield != null ? (dividend.forward_dividend_yield * 100).toFixed(2) + "%" : "—";
    } else {
      const selfPeer = r.peers?.[0]?.peers_data?.companies?.find(c => c.group?.includes("self"));
      pe = selfPeer?.pe_ttm?.toFixed(2) || valuation.pe_ttm?.toFixed(2) || "—";
      pb = selfPeer?.pb_mrq?.toFixed(2) || valuation.pb_mrq?.toFixed(2) || "—";
      dy = dividend.yield_ttm != null ? (dividend.yield_ttm * 100).toFixed(2) + "%" : "—";
    }
    const price  = overview.last_close_price != null ? `${currency} ${fmt(overview.last_close_price)}` : "—";
    const chg    = isSgx ? (overview.change_1d || 0) : (overview.daily_close_change || 0);
    const chgStr = chg != null ? `${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(2)}%` : null;
    const chgCls = chg >= 0 ? "positive" : "negative";

    html += `
      <div class="company-card">
        <div class="company-name">${esc(r.company_name || r.name || overview.company_name || symbol)}</div>
        <div class="tag-row">
          ${overview.sector ? `<span class="tag">${esc(overview.sector)}</span>` : ""}
          ${overview.sub_sector ? `<span class="tag">${esc(overview.sub_sector)}</span>` : ""}
          ${overview.listing_board ? `<span class="tag">${esc(overview.listing_board)}</span>` : ""}
        </div>
        <div class="price-row">
          <span class="price-val">${price}</span>
          ${chgStr ? `<span class="price-change ${chgCls}">${chgStr}</span>` : ""}
        </div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-label">Mkt Cap</span><span class="kv-value">${overview.market_cap ? fmtBig(overview.market_cap) : "—"}</span></div>
          <div class="kv"><span class="kv-label">P/E ${isSgx ? '' : '(TTM)'}</span><span class="kv-value">${pe}</span></div>
          <div class="kv"><span class="kv-label">P/B ${isSgx ? '' : '(MRQ)'}</span><span class="kv-value">${pb}</span></div>
          <div class="kv"><span class="kv-label">Div Yield</span><span class="kv-value">${dy}</span></div>
          ${overview.employee_num != null ? `<div class="kv"><span class="kv-label">Employees</span><span class="kv-value">${fmt(overview.employee_num)}</span></div>` : ""}
        </div>
      </div>`;

    // ══════════════════════════════════════════════════════════════════════
    // ── Section order matches sectors.app ──
    const rForSections = { ...r, isSgx };
    if (isSgx) {
      // SGX: Overview, Ownership, Financials, Valuation, Dividends
      html += buildOverview(overview, isSgx, currency);
      html += buildOwnership(rForSections);
      html += buildFinancials(financials, isSgx, currency);
      html += buildValuation(valuation, isSgx, currency);
      html += buildDividend(dividend, isSgx, currency);
    } else {
      // IDX: Overview, Valuation, Peers, Financials, Management, Future, Dividend, Ownership
      html += buildOverview(overview, isSgx, currency);
      html += buildValuation(valuation, isSgx, currency);
      html += buildPeersComparison(r);
      html += buildFinancials(financials, isSgx, currency);
      html += buildManagement(rForSections);
      html += buildFuture(rForSections, currency);
      html += buildDividend(dividend, isSgx, currency);
      html += buildOwnership(rForSections);
      html += buildScoring(rForSections);
      html += buildPeerGroup(rForSections);
    }
  } else {
    html += `<div class="company-card"><div class="company-name">${esc(symbol)}</div><p class="no-filings">Company report unavailable.</p></div>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // INSIDER FILINGS
  // ════════════════════════════════════════════════════════════════════════
  html += `<div class="filings-section"><div class="filings-title">RECENT INSIDER FILINGS</div>`;
  if (filingRows.length === 0) {
    html += `<p class="no-filings"><em>No recent filings</em></p>`;
  } else {
    filingRows.forEach((f) => {
      const cls  = f.transaction_type === "buy" ? "tx-buy" : f.transaction_type === "sell" ? "tx-sell" : "";
      const date = f.timestamp ? f.timestamp.split("T")[0] : "—";
      const headline = filingHeadline(f, currency);
      const filingExtra = buildFilingExtra(f, currency);

      html += `
        <div class="filing-card">
          <div class="filing-top">
            <span class="tx-badge ${cls}">${esc(titleCase(f.transaction_type || "—"))}</span>
            <span class="filing-date">${esc(date)}</span>
          </div>
          <div class="filing-holder">${esc(f.holder_name || "—")}</div>
          ${headline.detail || headline.value ? `<div class="filing-detail">${headline.detail ? `<span>${headline.detail}</span>` : "<span></span>"}${headline.value ? `<span class="filing-val">${headline.value}</span>` : ""}</div>` : ""}
          ${filingExtra ? `<details class="filing-expandable"><summary>Details</summary><div class="detail-body">${filingExtra}</div></details>` : ""}
        </div>`;
    });
  }
  html += `</div>`;

  // ── Footer ──
  const sectorsUrl = isSgx ? `https://sectors.app/sgx/${symbol.toLowerCase()}` : `https://sectors.app/idx/${symbol.toLowerCase()}`;
  html += `<div class="result-footer"><a class="sectors-link" href="${esc(sectorsUrl)}" target="_blank" rel="noopener noreferrer">Open in sectors.app</a></div>`;

  resultContent.innerHTML = html;
}

// ── UI helpers ────────────────────────────────────────────────────────────
function showLoading() {
  resultArea.classList.remove("hidden");
  resultContent.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span>Fetching data…</span></div>`;
}

function showError(title, detail, isHtml = false) {
  resultArea.classList.remove("hidden");
  resultContent.innerHTML = `<div class="error-wrap"><div class="error-msg"><strong>${esc(title)}</strong><br/>${isHtml ? detail : esc(detail)}</div></div>`;
}
