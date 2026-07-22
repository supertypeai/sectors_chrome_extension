// popup.js
const API_BASE = "https://api.sectors.app/v2";
const CLIENT_SOURCE_HEADERS = { "X-Client-Source": "CHROME" };

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
  if (!symbol || symbol.length < 2) return;

  showLoading();

  chrome.storage.sync.get(["sectorsApiKey"], async ({ sectorsApiKey }) => {
    if (!sectorsApiKey) {
      showError("No API key set", 'Please add your API key in <a href="#" id="error-open-settings" class="error-link">Settings</a> to enable search.', true);
      document.getElementById("error-open-settings")?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
      return;
    }

    try {
      const reportUrl = isSgx ? `${API_BASE}/sgx/company/report/${symbol}/` : `${API_BASE}/company/report/${symbol}/`;
      const filingsUrl = isSgx ? `${API_BASE}/sgx/filings/?symbol=${symbol}&limit=5` : `${API_BASE}/filings/?symbol=${symbol}&limit=5`;

      const tasks = [fetchJson(reportUrl, sectorsApiKey), fetchJson(filingsUrl, sectorsApiKey)];
      const results = await Promise.allSettled(tasks);
      const reportRes = results[0];
      const filingsRes = results[1];

      if (reportRes.status === "rejected") {
        const msg = reportRes.reason.message.toLowerCase();
        if (msg.includes("does not exist") || msg.includes("not found")) {
          showError("Ticker Not Found", `${symbol} does not exist in our database.`);
          return;
        }
        throw new Error(reportRes.reason.message);
      }

      const report = reportRes.value;
      const filingsRaw = filingsRes?.status === "fulfilled" ? filingsRes.value : null;
      const filings = filingsRaw ? normaliseFilings(filingsRaw, isSgx) : null;

      renderResult({ symbol, report, filings, isSgx });
    } catch (err) {
      if (err.message.includes("403")) {
        showError("API Limit Reached", 'Your API key is exhausted. Upgrade at <a href="https://sectors.app/api" target="_blank" class="error-link">sectors.app/api</a>', true);
      } else if (err.message.includes("429")) {
        showError("Rate Limit Exceeded", "You are making too many requests. Please slow down or consider upgrading.");
      } else {
        showError("Request failed", err.message);
      }
    }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString();
}
function fmtBig(n) {
  if (n == null) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + "B";
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + "M";
  return Number(n).toLocaleString();
}
function fmtPct(n, dec) {
  if (n == null) return "—";
  return (n * 100).toFixed(dec ?? 1) + "%";
}
function kvRow(label, value) {
  return `<div class="st-kv-row"><span class="st-kv-label">${esc(label)}</span><span class="st-kv-value">${value}</span></div>`;
}
function subHead(text) {
  return `<div class="st-sub-head">${esc(text)}</div>`;
}

// SGX filings normalise
function normaliseFilings(filingsPayload, isSgx) {
  if (!isSgx || !filingsPayload || !Array.isArray(filingsPayload.results)) return filingsPayload;
  const results = filingsPayload.results.map((f) => {
    if (f && f.price == null && f.price_per_share != null) return { ...f, price: f.price_per_share };
    return f;
  });
  return { ...filingsPayload, results };
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION BUILDERS
// ══════════════════════════════════════════════════════════════════════════
function buildOverview(overview, isSgx, currency) {
  let rows = "";
  if (overview.address) rows += kvRow("Address", overview.address.replace(/\r\n/g, ", "));
  if (overview.phone) rows += kvRow("Phone", overview.phone);
  if (overview.email) rows += kvRow("Email", overview.email);
  if (overview.website) rows += kvRow("Website", `<a href="${esc(overview.website)}" target="_blank">${esc(overview.website)}</a>`);
  if (overview.listing_date) rows += kvRow("Listed", overview.listing_date);
  if (overview.latest_close_date) rows += kvRow("Latest Date", overview.latest_close_date);
  if (overview.employee_num) rows += kvRow("Employees", fmt(overview.employee_num));
  if (overview.employee_num_rank) rows += kvRow("Employee Rank", "#" + fmt(overview.employee_num_rank));
  if (overview.market_cap_rank) rows += kvRow("MCap Rank", "#" + fmt(overview.market_cap_rank));
  if (overview.esg_score != null) rows += kvRow("ESG Score", overview.esg_score.toFixed(1));
  if (overview.indices?.length) rows += kvRow("Indices", overview.indices.join(", "));
  if (overview.affiliates?.length) rows += kvRow("Affiliates", overview.affiliates.join(", "));
  if (overview.tags?.length) rows += kvRow("Tags", overview.tags.join(", "));
  if (isSgx) {
    if (overview.volume) rows += kvRow("Volume", fmt(overview.volume));
    ["change_7d","change_1m","change_1y","change_3y","change_ytd"].forEach(k => {
      if (overview[k] != null) rows += kvRow(k.replace("change_","").toUpperCase() + " Change", fmtPct(overview[k], 2));
    });
  }
  if (overview.all_time_price) {
    let priceRows = "";
    for (const [key, obj] of Object.entries(overview.all_time_price)) {
      if (obj && typeof obj === "object") {
        priceRows += kvRow(key.replace(/_/g, " ").toUpperCase(), `${currency} ${fmt(Object.values(obj)[0])} (${Object.keys(obj)[0]})`);
      }
    }
    if (priceRows) { rows += subHead("Price Range"); rows += priceRows; }
  }
  return rows ? `<details class="collapsible"><summary>Overview</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildValuation(valuation, isSgx, currency) {
  let rows = "";
  if (isSgx) {
    if (valuation.pe != null) rows += kvRow("P/E", valuation.pe.toFixed(2));
    if (valuation.pb != null) rows += kvRow("P/B", valuation.pb.toFixed(2));
    if (valuation.beta != null) rows += kvRow("Beta", valuation.beta.toFixed(2));
    if (valuation.ps != null) rows += kvRow("P/S", valuation.ps.toFixed(2));
    if (valuation.pcf != null) rows += kvRow("P/CF", valuation.pcf.toFixed(2));
  } else {
    if (valuation.forward_pe != null) rows += kvRow("Forward P/E", valuation.forward_pe.toFixed(2));
    if (valuation.intrinsic_value != null) rows += kvRow("Intrinsic Value", `${currency} ${fmt(valuation.intrinsic_value)}`);
    const hv = valuation.historical_valuation;
    if (hv?.length) {
      rows += subHead("Historical Valuation");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>P/E</th><th>P/B</th><th>P/S</th><th>PCF</th><th>PEG</th><th>EV/EBITDA</th><th>EV/Rev</th><th>P/E Avg</th><th>P/B Avg</th><th>P/S Avg</th></tr></thead><tbody>`;
      hv.forEach(v => {
        rows += `<tr><td>${v.year ?? "—"}</td><td>${v.pe?.toFixed(1) ?? "—"}</td><td>${v.pb?.toFixed(2) ?? "—"}</td><td>${v.ps?.toFixed(2) ?? "—"}</td><td>${v.pcf?.toFixed(1) ?? "—"}</td><td>${v.peg?.toFixed(2) ?? "—"}</td><td>${v.enterprise_to_ebitda?.toFixed(2) ?? "—"}</td><td>${v.enterprise_to_revenue?.toFixed(2) ?? "—"}</td><td>${v.pe_peer_avg?.toFixed(1) ?? "—"}</td><td>${v.pb_peer_avg?.toFixed(2) ?? "—"}</td><td>${v.ps_peer_avg?.toFixed(2) ?? "—"}</td></tr>`;
      });
      rows += `</tbody></table></div>`;
    }
  }
  return rows ? `<details class="collapsible"><summary>Valuation</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildPeersComparison(r, currency) {
  if (!r.peers?.length) return "";
  let rows = "";
  r.peers.forEach(peerGroup => {
    const companies = peerGroup?.peers_data?.companies || [];
    companies.filter(c => !c.group?.includes("self")).forEach(c => {
      rows += kvRow(`${c.company_name} (${c.symbol})`, `P/E ${c.pe_ttm?.toFixed(1) || '—'} | P/B ${c.pb_mrq?.toFixed(1) || '—'} | MCap ${fmtBig(c.market_cap)}`);
    });
  });
  return rows ? `<details class="collapsible"><summary>Peers Comparison</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildFinancials(financials, isSgx, currency) {
  let rows = "";
  if (financials.eps != null) rows += kvRow("EPS (TTM)", `${currency} ${fmt(financials.eps)}`);
  if (isSgx) {
    if (financials.gross_margin != null) rows += kvRow("Gross Margin", fmtPct(financials.gross_margin));
    if (financials.operating_margin != null) rows += kvRow("Operating Margin", fmtPct(financials.operating_margin));
    if (financials.net_profit_margin != null) rows += kvRow("Net Profit Margin", fmtPct(financials.net_profit_margin));
    if (financials.one_year_eps_growth != null) rows += kvRow("1Y EPS Growth", fmtPct(financials.one_year_eps_growth));
    if (financials.one_year_sales_growth != null) rows += kvRow("1Y Sales Growth", fmtPct(financials.one_year_sales_growth));
    if (financials.quick_ratio != null) rows += kvRow("Quick Ratio", financials.quick_ratio.toFixed(2));
    if (financials.current_ratio != null) rows += kvRow("Current Ratio", financials.current_ratio.toFixed(2));
    if (financials.debt_to_equity != null) rows += kvRow("Debt/Equity", financials.debt_to_equity.toFixed(2));
  } else {
    if (financials.yoy_quarter_earnings_growth != null) rows += kvRow("YoY Q Earnings Growth", fmtPct(financials.yoy_quarter_earnings_growth));
    if (financials.yoy_quarter_revenue_growth != null) rows += kvRow("YoY Q Revenue Growth", fmtPct(financials.yoy_quarter_revenue_growth));
    const heps = financials.historical_eps;
    if (heps && Object.keys(heps).length) {
      rows += subHead("Historical EPS");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>EPS</th><th>Growth</th></tr></thead><tbody>`;
      Object.entries(heps).sort().forEach(([yr, v]) => {
        rows += `<tr><td>${yr}</td><td>${currency} ${fmt(v.eps)}</td><td>${v.eps_growth != null ? fmtPct(v.eps_growth) : "—"}</td></tr>`;
      });
      rows += `</tbody></table></div>`;
    }
    const hfs = financials.historical_financials;
    if (hfs?.length) {
      rows += subHead("Historical Financials");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Revenue</th><th>Earnings</th><th>EBITDA</th><th>Total Assets</th><th>Total Equity</th><th>Total Debt</th><th>Free CF</th><th>Op. CF</th></tr></thead><tbody>`;
      hfs.forEach(h => {
        rows += `<tr><td>${h.year ?? "—"}</td><td>${fmtBig(h.revenue)}</td><td>${fmtBig(h.earnings)}</td><td>${fmtBig(h.ebitda)}</td><td>${fmtBig(h.total_assets)}</td><td>${fmtBig(h.total_equity)}</td><td>${fmtBig(h.total_debt)}</td><td>${fmtBig(h.free_cash_flow)}</td><td>${fmtBig(h.operating_cash_flow)}</td></tr>`;
      });
      rows += `</tbody></table></div>`;
    }
    const hfr = financials.historical_financial_ratio;
    if (hfr?.length) {
      rows += subHead("Financial Ratios");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>ROA</th><th>ROE</th><th>Debt/Asset</th><th>Debt/Equity</th><th>Net Margin</th><th>Net Int. Margin</th><th>Cost/Income</th><th>Asset Turnover</th><th>CASA</th><th>L/D Ratio</th></tr></thead><tbody>`;
      hfr.forEach(h => {
        const p = h.profitability || {}, l = h.leverage || {}, li = h.liquidity || {}, ef = h.efficiency || {};
        rows += `<tr><td>${h.year ?? "—"}</td><td>${fmtPct(p.roa)}</td><td>${fmtPct(p.roe)}</td><td>${l.debt_to_asset_ratio?.toFixed(4) ?? "—"}</td><td>${l.debt_to_equity_ratio?.toFixed(2) ?? "—"}</td><td>${fmtPct(p.net_profit_margin)}</td><td>${fmtPct(p.net_interest_margin)}</td><td>${fmtPct(p.cost_to_income_ratio)}</td><td>${ef.total_asset_turnover?.toFixed(3) ?? "—"}</td><td>${fmtPct(li.casa_ratio)}</td><td>${fmtPct(li.loan_to_deposit_ratio)}</td></tr>`;
      });
      rows += `</tbody></table></div>`;
    }
  }
  if (isSgx) {
    const hfs = financials.historical_financials;
    if (hfs && Object.keys(hfs).length) {
      rows += subHead("Historical Financials");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Revenue</th><th>Earnings</th><th>Total Assets</th><th>Total Equity</th><th>Total Liab.</th><th>Op. CF</th><th>Free CF</th><th>CapEx</th></tr></thead><tbody>`;
      Object.entries(hfs).sort().forEach(([yr, h]) => {
        const cf = h.cash_flow_metrics || {}, bs = h.balance_sheet_metrics || {};
        rows += `<tr><td>${yr}</td><td>${fmtBig(h.revenue)}</td><td>${fmtBig(h.earnings)}</td><td>${fmtBig(bs.total_asset)}</td><td>${fmtBig(bs.total_equity)}</td><td>${fmtBig(bs.total_liabilities)}</td><td>${fmtBig(cf.operating_cash_flow)}</td><td>${fmtBig(cf.free_cash_flow)}</td><td>${fmtBig(cf.capital_expenditure)}</td></tr>`;
      });
      rows += `</tbody></table></div>`;
    }
  }
  return rows ? `<details class="collapsible"><summary>Financials</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildManagement(r) {
  if (r.isSgx || !r.management) return "";
  const execs = r.management.key_executives || [];
  const holdings = r.management.executives_shareholdings || [];
  let html = "";
  if (execs.length > 0) {
    const rows = execs.map(e => kvRow(e.position, e.name)).join("");
    html += `<details class="collapsible"><summary>Key Executives (${execs.length})</summary><div class="detail-body">${rows}</div></details>`;
  }
  if (holdings.length > 0) {
    const rows = holdings.map(h => kvRow(h.name, `${fmt(h.share_amount)} shares (${(h.share_percentage * 100).toFixed(3)}%)`)).join("");
    html += `<details class="collapsible"><summary>Executive Shareholdings (${holdings.length})</summary><div class="detail-body">${rows}</div></details>`;
  }
  return html;
}

function buildFuture(r, currency) {
  if (r.isSgx || !r.future) return "";
  let rows = "";
  const forecasts = r.future.company_value_forecasts || [];
  const growth = r.future.company_growth_forecasts || [];
  const analysts = r.future.analyst_rating_breakdown;
  forecasts.filter(f => f.estimate_year).forEach(f => {
    rows += kvRow(`${f.estimate_year} EPS Est.`, `${currency} ${fmt(f.eps_estimate)}`);
    rows += kvRow(`${f.estimate_year} Rev Est.`, fmtBig(f.revenue_estimate));
  });
  forecasts.filter(f => f.financial_year && !f.estimate_year).forEach(f => {
    rows += kvRow(`${f.financial_year} Actual EPS`, `${currency} ${fmt(f.eps)}`);
    rows += kvRow(`${f.financial_year} Total Revenue`, fmtBig(f.total_revenue));
    rows += kvRow(`${f.financial_year} Total Assets`, fmtBig(f.total_assets));
    rows += kvRow(`${f.financial_year} Total Equity`, fmtBig(f.total_equity));
  });
  growth.filter(g => g.estimate_year).forEach(g => {
    rows += kvRow(`${g.estimate_year} EPS Growth`, fmtPct(g.eps_growth));
    rows += kvRow(`${g.estimate_year} Rev Growth`, fmtPct(g.revenue_growth));
  });
  if (analysts) {
    rows += subHead("Analyst Ratings");
    rows += kvRow("Total Analysts", analysts.n_analyst);
    rows += kvRow("Strong Buy", analysts.strong_buy);
    rows += kvRow("Buy", analysts.buy);
    rows += kvRow("Hold", analysts.hold);
    rows += kvRow("Sell", analysts.sell);
    rows += kvRow("Strong Sell", analysts.strong_sell);
    if (analysts.updated_on) rows += kvRow("Updated", analysts.updated_on.split("T")[0]);
  }
  return rows ? `<details class="collapsible"><summary>Forecasts & Analyst Ratings</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildDividend(dividend, isSgx, currency) {
  let rows = "";
  if (isSgx) {
    if (dividend.dividend_ttm != null) rows += kvRow("Dividend TTM", `${currency} ${dividend.dividend_ttm.toFixed(2)}`);
    if (dividend.forward_dividend != null) rows += kvRow("Forward Dividend", `${currency} ${dividend.forward_dividend.toFixed(2)}`);
    if (dividend.forward_dividend_yield != null) rows += kvRow("Forward Yield", fmtPct(dividend.forward_dividend_yield));
    if (dividend.dividend_yield_5y_avg != null) rows += kvRow("5Y Avg Yield", fmtPct(dividend.dividend_yield_5y_avg));
    if (dividend.dividend_growth_rate != null) rows += kvRow("Div Growth Rate", fmtPct(dividend.dividend_growth_rate));
    if (dividend.payout_ratio != null) rows += kvRow("Payout Ratio", fmtPct(dividend.payout_ratio));
  } else {
    if (dividend.dividend_ttm != null) rows += kvRow("Dividend TTM", `${currency} ${fmt(dividend.dividend_ttm)}`);
    if (dividend.dividend_yield_avg?.avg_yield != null) rows += kvRow(`${dividend.dividend_yield_avg.period}Y Avg Yield`, fmtPct(dividend.dividend_yield_avg.avg_yield));
    if (dividend.payout_ratio != null) rows += kvRow("Payout Ratio", fmtPct(dividend.payout_ratio));
    if (dividend.cash_payout_ratio != null) rows += kvRow("Cash Payout Ratio", fmtPct(dividend.cash_payout_ratio));
    if (dividend.last_ex_dividend_date) rows += kvRow("Last Ex-Div", dividend.last_ex_dividend_date);
  }
  const hd = dividend.historical_dividends;
  if (hd) {
    if (Array.isArray(hd) ? hd.length : Object.keys(hd).length) {
      rows += subHead("Dividend History");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Total</th><th>Yield</th><th>Payments</th></tr></thead><tbody>`;
      if (Array.isArray(hd)) {
        hd.slice(-10).forEach(d => {
          rows += `<tr><td>${d.year ?? "—"}</td><td>${d.total_dividend != null ? `${currency} ${d.total_dividend.toFixed(2)}` : "—"}</td><td>${d.total_yield != null ? fmtPct(d.total_yield) : "—"}</td><td>${d.breakdown?.length ?? 0}</td></tr>`;
        });
      } else {
        Object.entries(hd).slice(-10).forEach(([yr, d]) => {
          rows += `<tr><td>${yr}</td><td>${d.total_dividend != null ? `${currency} ${d.total_dividend.toFixed(2)}` : "—"}</td><td>${d.total_yield != null ? fmtPct(d.total_yield) : "—"}</td><td>${d.breakdown?.length ?? 0}</td></tr>`;
        });
      }
      rows += `</tbody></table></div>`;
    }
  }
  const ud = dividend.upcoming_dividends;
  if (ud?.length) {
    rows += subHead("Upcoming Dividends");
    ud.forEach(d => { rows += kvRow(d.date || "—", `${currency} ${fmt(d.amount)} (${d.type || ""})`); });
  }
  return rows ? `<details class="collapsible"><summary>${isSgx ? "Dividends" : "Dividend Detail"}</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildOwnership(r) {
  if (r.isSgx || !r.ownership) return "";
  let rows = "";
  if (r.ownership.whale_investors?.length) rows += kvRow("Whale Investors", r.ownership.whale_investors.join(", "));
  if (r.ownership.conglomerates_group?.length) rows += kvRow("Conglomerate Groups", r.ownership.conglomerates_group.join(", "));
  const shareholders = r.ownership.major_shareholders || [];
  if (shareholders.length > 0) {
    rows += subHead("Major Shareholders");
    shareholders.forEach(s => { rows += kvRow(s.name, `${(parseFloat(s.share_percentage) * 100).toFixed(2)}% (${fmtBig(s.share_value)})`); });
  }
  const txns = r.ownership.top_transactions;
  if (txns?.top_buyers?.length) { rows += subHead("Top Buyers"); txns.top_buyers.forEach(b => { rows += kvRow(b.name, `+${fmtBig(b.changeAmount)}`); }); }
  if (txns?.top_sellers?.length) { rows += subHead("Top Sellers"); txns.top_sellers.forEach(s => { rows += kvRow(s.name, fmtBig(s.changeAmount)); }); }
  const instFlow = r.ownership.institutional_transaction_flow || [];
  if (instFlow.length > 0) {
    rows += subHead("Institutional Transaction Flow");
    instFlow.forEach(i => { rows += kvRow(i.date, `${i.net_transaction >= 0 ? '+' : ''}${fmtBig(i.net_transaction)}`); });
  }
  return rows ? `<details class="collapsible"><summary>Ownership & Transactions</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildScoring(r) {
  if (r.isSgx || !r.peers?.length) return "";
  const selfPeer = r.peers[0]?.peers_data?.companies?.find(c => c.group?.includes("self"));
  const ps = selfPeer?.point_summaries;
  if (!ps?.length) return "";
  const rows = ps.map(s => s.name ? kvRow(s.name.charAt(0).toUpperCase() + s.name.slice(1), `${s.point} / ${s.maxpoint}`) : "").join("");
  return rows ? `<details class="collapsible"><summary>Scoring</summary><div class="detail-body">${rows}</div></details>` : "";
}

function buildPeerGroup(r) {
  if (r.isSgx || !r.peers?.length) return "";
  const pd = r.peers[0]?.peers_data;
  const gn = pd?.group_name;
  let html = "";
  if (gn) {
    let rows = "";
    if (gn.sector) rows += kvRow("Sector", gn.sector);
    if (gn.industry) rows += kvRow("Industry", gn.industry);
    if (gn.sub_sector) rows += kvRow("Sub-Sector", gn.sub_sector);
    if (gn.sub_industry) rows += kvRow("Sub-Industry", gn.sub_industry);
    if (rows) html += `<details class="collapsible"><summary>Peer Group Context</summary><div class="detail-body">${rows}</div></details>`;
  }
  const selfPeer = pd?.companies?.find(c => c.group?.includes("self"));
  if (selfPeer) {
    let rows = "";
    if (selfPeer.int_income_breakdown?.length) { rows += subHead("Interest Income Breakdown"); selfPeer.int_income_breakdown.forEach(b => { rows += kvRow(`${b.category} (${b.class})`, fmtBig(b.amount)); }); }
    if (selfPeer.operating_expense_breakdown?.length) { rows += subHead("Operating Expense Breakdown"); selfPeer.operating_expense_breakdown.forEach(b => { rows += kvRow(`${b.category} (${b.class})`, fmtBig(b.amount)); }); }
    if (selfPeer.revenue_breakdown) { rows += subHead("Revenue Breakdown"); if (typeof selfPeer.revenue_breakdown === "object") Object.entries(selfPeer.revenue_breakdown).forEach(([k, v]) => { rows += kvRow(k, fmtBig(v)); }); }
    if (rows) html += `<details class="collapsible"><summary>Revenue & Expense Breakdown</summary><div class="detail-body">${rows}</div></details>`;
  }
  return html;
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
  const filingRows = filings?.results || [];
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
      html += buildPeersComparison(r, currency);
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
      const icon = f.transaction_type === "buy" ? "▲" : f.transaction_type === "sell" ? "▼" : "●";
      const date = f.timestamp ? f.timestamp.split("T")[0] : "—";
      const val  = f.transaction_value ? `${currency} ${fmtBig(f.transaction_value)}` : "—";

      let filingExtra = "";
      if (f.title) filingExtra += `<div style="margin-bottom:4px"><strong>${esc(f.title)}</strong></div>`;
      if (f.body) filingExtra += `<div style="margin-bottom:6px">${esc(f.body)}</div>`;
      if (f.holder_type) filingExtra += kvRow("Holder Type", f.holder_type);
      if (f.holding_before != null) filingExtra += kvRow("Holding Before", fmt(f.holding_before));
      if (f.holding_after != null) filingExtra += kvRow("Holding After", fmt(f.holding_after));
      if (f.share_percentage_before != null) filingExtra += kvRow("Before %", (f.share_percentage_before * 100).toFixed(4) + "%");
      if (f.share_percentage_after != null) filingExtra += kvRow("After %", (f.share_percentage_after * 100).toFixed(4) + "%");
      if (f.share_percentage_transaction != null) filingExtra += kvRow("% Transacted", (f.share_percentage_transaction * 100).toFixed(4) + "%");
      if (f.sector) filingExtra += kvRow("Sector", f.sector);
      if (f.sub_sector) filingExtra += kvRow("Sub-Sector", f.sub_sector);
      if (f.tags?.length) filingExtra += kvRow("Tags", f.tags.join(", "));
      if (f.source) filingExtra += kvRow("Source", `<a href="${esc(f.source)}" target="_blank">View Filing</a>`);
      if (f.price_transaction?.length) {
        filingExtra += subHead("Price Transaction Details");
        f.price_transaction.forEach(pt => {
          filingExtra += kvRow(`${pt.date ?? "—"}`, `${fmt(pt.amount)} shares @ ${currency} ${fmt(pt.price)}`);
        });
      }

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
          ${filingExtra ? `<details class="filing-expandable"><summary>Details</summary><div class="detail-body">${filingExtra}</div></details>` : ""}
        </div>`;
    });
  }
  html += `</div>`;

  // ── Footer ──
  const sectorsUrl = isSgx ? `https://sectors.app/sgx/${symbol.toLowerCase()}` : `https://sectors.app/idx/${symbol.toLowerCase()}`;
  html += `<div class="result-footer"><a class="sectors-link" href="${sectorsUrl}" target="_blank">open in sectors.app</a></div>`;

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

// ── API helpers ───────────────────────────────────────────────────────────
async function fetchJson(url, apiKey) {
  const res = await fetch(url, { headers: { Authorization: apiKey, ...CLIENT_SOURCE_HEADERS } });
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      errorMsg = data.message || data.error || errorMsg;
    } catch (e) {}
    if (res.status === 403) throw new Error("403: API key exhausted");
    if (res.status === 429) throw new Error("429: Rate limit exceeded");
    throw new Error(errorMsg);
  }
  return res.json();
}
