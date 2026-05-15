// popup.js
const API_BASE = "https://api.sectors.app/v2";

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
    applyTheme("dark"); // Default to midnight
  }

  if (sectorsApiKey) {
    keyOkEl.classList.remove("hidden");
    keyStatusEl.classList.add("hidden");
  } else {
    keyStatusEl.classList.remove("hidden");
    keyOkEl.classList.add("hidden");

    // Check for first-time opening
    chrome.storage.local.get(["hasOpenedBefore"], ({ hasOpenedBefore }) => {
      if (!hasOpenedBefore) {
        chrome.storage.local.set({ hasOpenedBefore: true }, () => {
          chrome.runtime.openOptionsPage();
        });
      }
    });
  }
});

// Load preferences
chrome.storage.sync.get(["prefEnabled", "prefTheme", "prefDelay"], (res) => {
  if (res.prefEnabled !== undefined) {
    prefEnabled.checked = res.prefEnabled;
  }
  if (res.prefTheme) {
    const isDark = res.prefTheme === "dark";
    prefThemeToggle.checked = isDark;
    applyTheme(res.prefTheme);
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
tickerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

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
  const val = prefDelay.value;
  delayVal.textContent = `${val} ms`;
  updateSliderGradient(prefDelay);
});

prefDelay.addEventListener("change", () => {
  chrome.storage.sync.set({ prefDelay: parseInt(prefDelay.value, 10) });
});

function updateSliderGradient(el) {
  const min = el.min || 0;
  const max = el.max || 100;
  const val = el.value;
  const percentage = ((val - min) / (max - min)) * 100;
  el.style.backgroundSize = percentage + "% 100%";
}

async function doSearch() {
  const raw    = tickerInput.value.trim();
  const isSgx  = raw.toLowerCase().endsWith(".si");
  const symbol = raw.replace(/\.(jk|ij|id|si)$/i, "").toUpperCase();
  if (!symbol || symbol.length < 2) return;

  showLoading();

  chrome.storage.sync.get(["sectorsApiKey"], async ({ sectorsApiKey }) => {
    if (!sectorsApiKey) {
      showError(
        "",
        "No API key set",
        'Please add your API key in <a href="#" id="error-open-settings" class="error-link">Settings</a> to enable search.',
        true
      );
      document.getElementById("error-open-settings")?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
      return;
    }

    try {
      const reportUrl = isSgx
        ? `${API_BASE}/sgx/company/report/${symbol}/`
        : `${API_BASE}/company/report/${symbol}/`;

      // Filings are Indonesia-only
      const tasks = isSgx
        ? [fetchJson(reportUrl, sectorsApiKey)]
        : [fetchJson(reportUrl, sectorsApiKey), fetchJson(`${API_BASE}/filings/?symbol=${symbol}&limit=5`, sectorsApiKey)];

      const results = await Promise.allSettled(tasks);
      const reportRes = results[0];
      const filingsRes = isSgx ? null : results[1];

      // Check for ticker not found error
      if (reportRes.status === "rejected") {
        const msg = reportRes.reason.message.toLowerCase();
        if (msg.includes("does not exist") || msg.includes("not found")) {
          showError("", "Ticker Not Found", `${symbol} does not exist in our database.`);
          return;
        }
        throw new Error(reportRes.reason.message);
      }

      const report  = reportRes.value;
      const filings = filingsRes && filingsRes.status === "fulfilled" ? filingsRes.value : null;

      renderResult({ symbol, report, filings, isSgx });
    } catch (err) {
      if (err.message.includes("403")) {
        showError(
          "",
          "API Limit Reached",
          'Your API key is exhausted. Upgrade at <a href="https://sectors.app/api" target="_blank" class="error-link">sectors.app/api</a>',
          true
        );
      } else if (err.message.includes("429")) {
        showError(
          "",
          "Rate Limit Exceeded",
          "You are making too many requests. Please slow down or consider upgrading.",
          false
        );
      } else {
        showError("", "Request failed", err.message);
      }
    }
  });
}

// ── Render ────────────────────────────────────────────────────────────────
function renderResult({ symbol, report, filings, isSgx }) {
  resultArea.classList.remove("hidden");

  const r        = report;
  const overview = r?.overview   || {};
  const valuation= r?.valuation  || {};
  const filingRows = filings?.results || [];

  let html = "";

  // ── Company card ──
  if (r) {
    const currency = isSgx ? "SGD" : "IDR";
    const price  = overview.last_close_price != null
      ? `${currency} ${fmt(overview.last_close_price)}` : "—";
    const chg    = isSgx ? (overview.change_1d || 0) : (overview.daily_close_change || 0);
    const chgStr = chg != null ? `${(chg * 100).toFixed(2)}%` : null;
    const chgCls = chg >= 0 ? "positive" : "negative";
    const mcap   = overview.market_cap ? `${currency} ${fmtBig(overview.market_cap)}` : "—";

    html += `
      <div class="company-card">
        <div class="company-name">${esc(overview.company_name || symbol)}</div>
        <div class="tag-row">
          ${overview.sector     ? `<span class="tag">${esc(overview.sector)}</span>` : ""}
          ${overview.sub_sector ? `<span class="tag">${esc(overview.sub_sector)}</span>` : ""}
          ${overview.listing_board ? `<span class="tag">${esc(overview.listing_board)}</span>` : ""}
        </div>
        <div class="price-row">
          <span class="price-val">${price}</span>
          ${chgStr ? `<span class="price-change ${chgCls}">${chg >= 0 ? "+" : ""}${chgStr}</span>` : ""}
        </div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-label">Mkt Cap</span><span class="kv-value">${mcap}</span></div>
          <div class="kv"><span class="kv-label">P/E TTM</span><span class="kv-value">${valuation.pe_ttm != null ? valuation.pe_ttm.toFixed(2) : "—"}</span></div>
          <div class="kv"><span class="kv-label">P/B MRQ</span><span class="kv-value">${valuation.pb_mrq != null ? valuation.pb_mrq.toFixed(2) : "—"}</span></div>
          <div class="kv"><span class="kv-label">Div Yield</span><span class="kv-value">${overview.yield_ttm != null ? (overview.yield_ttm * 100).toFixed(2) + "%" : "—"}</span></div>
          <div class="kv"><span class="kv-label">ROE TTM</span><span class="kv-value">${valuation.roe_ttm != null ? (valuation.roe_ttm * 100).toFixed(2) + "%" : "—"}</span></div>
          <div class="kv"><span class="kv-label">Employees</span><span class="kv-value">${overview.employee_num != null ? fmt(overview.employee_num) : "—"}</span></div>
        </div>
      </div>`;
  } else {
    html += `
      <div class="company-card">
        <div class="company-name">${esc(symbol)}</div>
        <p class="no-filings" style="margin-top:6px">Company report not available for this ticker.</p>
      </div>`;
  }

  // ── Insider Filings (Indonesia only) ──
  const currency = isSgx ? "SGD" : "IDR";
  if (!isSgx) {
    html += `<div class="filings-section"><div class="filings-title">RECENT INSIDER FILINGS</div>`;
    if (filingRows.length === 0) {
      html += `<p class="no-filings"><em>No recent filings</em></p>`;
    } else {
      filingRows.forEach((f) => {
        const cls  = f.transaction_type === "buy" ? "tx-buy" : "tx-sell";
        const icon = f.transaction_type === "buy" ? "▲" : "▼";
        const date = f.timestamp ? f.timestamp.split("T")[0] : "—";
        const val  = f.transaction_value ? `${currency} ${fmtBig(f.transaction_value)}` : "—";
        html += `
          <div class="filing-card">
            <div class="filing-top">
              <span class="tx-badge ${cls}">${icon} ${(f.transaction_type || "").toUpperCase()}</span>
              <span class="filing-date">${date}</span>
            </div>
            <div class="filing-holder">${esc(f.holder_name || "—")}</div>
            <div class="filing-detail">
              <span>${fmt(f.amount_transaction)} shares @ ${currency} ${fmt(f.price)}</span>
              <span class="filing-val">${val}</span>
            </div>
          </div>`;
      });
    }
    html += `</div>`;
  }

  // ── Footer ──
  const sectorsUrl = isSgx
    ? `https://sectors.app/sgx/${symbol.toLowerCase()}`
    : `https://sectors.app/idx/${symbol.toLowerCase()}`;

  html += `
    <div class="result-footer">
      <a class="sectors-link"
         href="${sectorsUrl}"
         target="_blank">
        open in sectors.app
      </a>
    </div>`;

  resultContent.innerHTML = html;
}

// ── UI helpers ────────────────────────────────────────────────────────────
function showLoading() {
  resultArea.classList.remove("hidden");
  resultContent.innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <span>Fetching data…</span>
    </div>`;
}

function showError(icon, title, detail, isHtml = false) {
  resultArea.classList.remove("hidden");
  resultContent.innerHTML = `
    <div class="error-wrap">
      <div class="error-icon">${icon}</div>
      <div class="error-msg">
        <strong>${esc(title)}</strong><br/>
        ${isHtml ? detail : esc(detail)}
      </div>
    </div>`;
}

// ── Utils ─────────────────────────────────────────────────────────────────
async function fetchJson(url, apiKey) {
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      errorMsg = data.message || data.error || errorMsg;
    } catch (e) {
      // Fallback
    }

    if (res.status === 403) {
      throw new Error("403: API key exhausted");
    }
    if (res.status === 429) {
      throw new Error("429: Rate limit exceeded");
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}

function fmtBig(n) {
  if (n == null) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + "B";
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + "M";
  return Number(n).toLocaleString();
}
