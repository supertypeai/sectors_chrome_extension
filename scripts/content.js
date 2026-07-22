// content.js — Ticker Hover Detection & Tooltip

(function () {
  "use strict";

  // O(1) Lookups in Memory for whitelists
  let validIdxTickers = new Set(["GOTO"]); // Pre-fill with known defaults
  let validSgxTickers = new Set();

  // Load the whitelists from storage
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["validIdxTickers", "validSgxTickers"], (res) => {
      if (res.validIdxTickers) validIdxTickers = new Set(res.validIdxTickers);
      if (res.validSgxTickers) validSgxTickers = new Set(res.validSgxTickers);
    });
  }

  const FAST_TICKER_REGEX = /\b([A-Za-z0-9]{1,4}\.[sS][iI]|[A-Za-z]{4,5}\.(?:[jJ][kK]|[iI][jJ]|[iI][dD])|[A-Z0-9]{3,5}|GoTo)\b/g;

  let tooltip = null;
  let hideTimeout = null;
  let currentSymbol = null;
  let isMouseOverTooltip = false;
  let lastX = 0;
  let lastY = 0;
  let isContextInvalid = false;
  const CACHE_KEY = "sectors_ticker_cache";
  const CACHE_LIMIT = 10;

  let hasApiKey = false;
  let hoverDelay = 120;
  let prefEnabled = true;
  let prefTheme = "dark";

  chrome.storage.sync.get(["sectorsApiKey", "prefDelay", "prefEnabled", "prefTheme"], (res) => {
    hasApiKey = !!res.sectorsApiKey;
    if (res.prefDelay) hoverDelay = res.prefDelay;
    if (res.prefEnabled !== undefined) prefEnabled = res.prefEnabled;
    if (res.prefTheme) {
      prefTheme = res.prefTheme;
      if (tooltip) applyTheme(tooltip, prefTheme);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      if (changes.sectorsApiKey) hasApiKey = !!changes.sectorsApiKey.newValue;
      if (changes.prefDelay) hoverDelay = changes.prefDelay.newValue;
      if (changes.prefEnabled) prefEnabled = changes.prefEnabled.newValue;
      if (changes.prefTheme) {
        prefTheme = changes.prefTheme.newValue;
        if (tooltip) applyTheme(tooltip, prefTheme);
      }
    }
    if (area === "local") {
      if (changes.validIdxTickers) validIdxTickers = new Set(changes.validIdxTickers.newValue || []);
      if (changes.validSgxTickers) validSgxTickers = new Set(changes.validSgxTickers.newValue || []);
    }
  });

  function applyTheme(el, theme) {
    if (theme === "light") {
      el.classList.add("light");
    } else {
      el.classList.remove("light");
    }
  }

  function safeSendMessage(msg, cb) {
    if (!chrome.runtime?.id || isContextInvalid) return;
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message;
          if (errMsg.includes("context invalidated") || errMsg.includes("Extension context invalidated")) {
            isContextInvalid = true;
            return;
          }
          if (cb) cb({ error: errMsg });
          return;
        }
        if (cb) cb(res);
      });
    } catch (e) {
      isContextInvalid = true;
    }
  }

  // ── Build tooltip DOM ──────────────────────────────────────────────────────
  function createTooltip() {
    if (isContextInvalid || !chrome.runtime?.id) return null;
    const el = document.createElement("div");
    el.id = "sectors-tooltip";
    el.innerHTML = `
      <div class="st-header">
        <div class="st-brand">
          <img src="${chrome.runtime.getURL("icons/android-chrome-192x192.png")}" class="st-logo" alt="Sectors Logo" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;" />
          <span class="st-brand-name">Sectors</span>
        </div>
        <div class="st-ticker-badge" id="st-ticker-badge">—</div>
      </div>
      <div id="st-content">
        <div class="st-loading">
          <div class="st-spinner"></div>
          <span>Fetching data…</span>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    applyTheme(el, prefTheme);

    el.addEventListener("mouseenter", () => {
      isMouseOverTooltip = true;
      clearTimeout(hideTimeout);
    });
    el.addEventListener("mouseleave", () => {
      isMouseOverTooltip = false;
      scheduleHide();
    });
    return el;
  }

  function getTooltip() {
    if (!tooltip) tooltip = createTooltip();
    return tooltip;
  }

  // ── Show / Hide ────────────────────────────────────────────────────────────
  function showTooltip(x, y, symbol) {
    lastX = x;
    lastY = y;
    clearTimeout(hideTimeout);
    const tip = getTooltip();
    if (!tip) return;
    tip.querySelector("#st-ticker-badge").textContent = symbol;
    
    if (!hasApiKey) {
      tip.querySelector("#st-content").innerHTML = `
        <div class="st-error">
          <div class="st-error-icon"></div>
          <p>No API key set.</p>
          <button class="st-btn" id="st-open-options">Open Settings</button>
        </div>`;
      setTimeout(() => {
        document.getElementById("st-open-options")?.addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
        });
      }, 0);
    } else {
      tip.querySelector("#st-content").innerHTML = `
        <div class="st-loading">
          <div class="st-spinner"></div>
          <span>Fetching data…</span>
        </div>`;
    }
    positionTooltip(tip, x, y);
    tip.classList.add("st-visible");
  }

  function positionTooltip(tip, x, y) {
    tip.style.visibility = "hidden";
    tip.style.display = "block";
    tip.classList.add("st-visible");

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    let left = x + 12;
    let top = y + 12;

    if (left + tw > scrollX + vw - 20) left = x - tw - 12;
    if (top + th > scrollY + vh - 20) top = y - th - 12;
    if (left < scrollX + 10) left = scrollX + 10;
    if (top < scrollY + 10) top = scrollY + 10;

    tip.style.left = left + "px";
    tip.style.top = top + "px";
    tip.style.visibility = "visible";
  }

  function scheduleHide() {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (isMouseOverTooltip) return;
      if (tooltip) tooltip.classList.remove("st-visible");
      currentSymbol = null;
    }, 400);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatNum(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString();
  }

  function formatBig(n) {
    if (n == null) return "—";
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    return Number(n).toLocaleString();
  }

  function formatPct(n, dec) {
    if (n == null) return "—";
    return (n * 100).toFixed(dec ?? 1) + "%";
  }

  // Key-value row for collapsible details
  function kvRow(label, value) {
    return `<div class="st-kv-row"><span class="st-kv-label">${escHtml(label)}</span><span class="st-kv-value">${value}</span></div>`;
  }

  // Sub-header inside a details block
  function subHead(text) {
    return `<div class="st-sub-head">${escHtml(text)}</div>`;
  }

  // ── Section builders ─────────────────────────────────────────────────────────
  function buildOverview(overview, isSgx, currency) {
    let rows = "";
    if (overview.address) rows += kvRow("Address", overview.address.replace(/\r\n/g, ", "));
    if (overview.phone) rows += kvRow("Phone", overview.phone);
    if (overview.email) rows += kvRow("Email", overview.email);
    if (overview.website) rows += kvRow("Website", `<a href="${escHtml(overview.website)}" target="_blank">${escHtml(overview.website)}</a>`);
    if (overview.listing_date) rows += kvRow("Listed", overview.listing_date);
    if (overview.latest_close_date) rows += kvRow("Latest Date", overview.latest_close_date);
    if (overview.employee_num) rows += kvRow("Employees", formatNum(overview.employee_num));
    if (overview.employee_num_rank) rows += kvRow("Employee Rank", "#" + formatNum(overview.employee_num_rank));
    if (overview.market_cap_rank) rows += kvRow("MCap Rank", "#" + formatNum(overview.market_cap_rank));
    if (overview.esg_score != null) rows += kvRow("ESG Score", overview.esg_score.toFixed(1));
    if (overview.indices?.length) rows += kvRow("Indices", overview.indices.join(", "));
    if (overview.affiliates?.length) rows += kvRow("Affiliates", overview.affiliates.join(", "));
    if (overview.tags?.length) rows += kvRow("Tags", overview.tags.join(", "));
    if (isSgx) {
      if (overview.volume) rows += kvRow("Volume", formatNum(overview.volume));
      ["change_7d","change_1m","change_1y","change_3y","change_ytd"].forEach(k => {
        if (overview[k] != null) rows += kvRow(k.replace("change_","").toUpperCase() + " Change", formatPct(overview[k], 2));
      });
    }
    if (overview.all_time_price) {
      let priceRows = "";
      for (const [key, obj] of Object.entries(overview.all_time_price)) {
        if (obj && typeof obj === "object") {
          priceRows += kvRow(key.replace(/_/g, " ").toUpperCase(), `${currency} ${formatNum(Object.values(obj)[0])} (${Object.keys(obj)[0]})`);
        }
      }
      if (priceRows) { rows += subHead("Price Range"); rows += priceRows; }
    }
    return rows ? `<details><summary>Overview</summary><div class="st-detail-body">${rows}</div></details>` : "";
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
      if (valuation.intrinsic_value != null) rows += kvRow("Intrinsic Value", `${currency} ${formatNum(valuation.intrinsic_value)}`);
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
    return rows ? `<details><summary>Valuation</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildPeersComparison(r, currency) {
    if (!r.peers?.length) return "";
    let rows = "";
    r.peers.forEach(peerGroup => {
      const companies = peerGroup?.peers_data?.companies || [];
      companies.filter(c => !c.group?.includes("self")).forEach(c => {
        rows += kvRow(`${c.company_name} (${c.symbol})`, `P/E ${c.pe_ttm?.toFixed(1) || '—'} | P/B ${c.pb_mrq?.toFixed(1) || '—'} | MCap ${formatBig(c.market_cap)}`);
      });
    });
    return rows ? `<details><summary>Peers Comparison</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildFinancials(financials, isSgx, currency) {
    let rows = "";
    if (financials.eps != null) rows += kvRow("EPS (TTM)", currency + " " + formatNum(financials.eps));
    if (isSgx) {
      if (financials.gross_margin != null) rows += kvRow("Gross Margin", formatPct(financials.gross_margin));
      if (financials.operating_margin != null) rows += kvRow("Operating Margin", formatPct(financials.operating_margin));
      if (financials.net_profit_margin != null) rows += kvRow("Net Profit Margin", formatPct(financials.net_profit_margin));
      if (financials.one_year_eps_growth != null) rows += kvRow("1Y EPS Growth", formatPct(financials.one_year_eps_growth));
      if (financials.one_year_sales_growth != null) rows += kvRow("1Y Sales Growth", formatPct(financials.one_year_sales_growth));
      if (financials.quick_ratio != null) rows += kvRow("Quick Ratio", financials.quick_ratio.toFixed(2));
      if (financials.current_ratio != null) rows += kvRow("Current Ratio", financials.current_ratio.toFixed(2));
      if (financials.debt_to_equity != null) rows += kvRow("Debt/Equity", financials.debt_to_equity.toFixed(2));
    } else {
      if (financials.yoy_quarter_earnings_growth != null) rows += kvRow("YoY Q Earnings Growth", formatPct(financials.yoy_quarter_earnings_growth));
      if (financials.yoy_quarter_revenue_growth != null) rows += kvRow("YoY Q Revenue Growth", formatPct(financials.yoy_quarter_revenue_growth));
      const heps = financials.historical_eps;
      if (heps && Object.keys(heps).length) {
        rows += subHead("Historical EPS");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>EPS</th><th>Growth</th></tr></thead><tbody>`;
        Object.entries(heps).sort().forEach(([yr, v]) => {
          rows += `<tr><td>${yr}</td><td>${currency} ${formatNum(v.eps)}</td><td>${v.eps_growth != null ? formatPct(v.eps_growth) : "—"}</td></tr>`;
        });
        rows += `</tbody></table></div>`;
      }
      const hfs = financials.historical_financials;
      if (hfs?.length) {
        rows += subHead("Historical Financials");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Revenue</th><th>Earnings</th><th>EBITDA</th><th>Total Assets</th><th>Total Equity</th><th>Total Debt</th><th>Free CF</th><th>Operating CF</th></tr></thead><tbody>`;
        hfs.forEach(h => {
          rows += `<tr><td>${h.year ?? "—"}</td><td>${formatBig(h.revenue)}</td><td>${formatBig(h.earnings)}</td><td>${formatBig(h.ebitda)}</td><td>${formatBig(h.total_assets)}</td><td>${formatBig(h.total_equity)}</td><td>${formatBig(h.total_debt)}</td><td>${formatBig(h.free_cash_flow)}</td><td>${formatBig(h.operating_cash_flow)}</td></tr>`;
        });
        rows += `</tbody></table></div>`;
      }
      const hfr = financials.historical_financial_ratio;
      if (hfr?.length) {
        rows += subHead("Financial Ratios");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>ROA</th><th>ROE</th><th>Debt/Asset</th><th>Debt/Equity</th><th>Net Margin</th><th>Net Int. Margin</th><th>Cost/Income</th><th>Asset Turnover</th><th>CASA</th><th>L/D Ratio</th></tr></thead><tbody>`;
        hfr.forEach(h => {
          const p = h.profitability || {}, l = h.leverage || {}, li = h.liquidity || {}, ef = h.efficiency || {};
          rows += `<tr><td>${h.year ?? "—"}</td><td>${formatPct(p.roa)}</td><td>${formatPct(p.roe)}</td><td>${l.debt_to_asset_ratio?.toFixed(4) ?? "—"}</td><td>${l.debt_to_equity_ratio?.toFixed(2) ?? "—"}</td><td>${formatPct(p.net_profit_margin)}</td><td>${formatPct(p.net_interest_margin)}</td><td>${formatPct(p.cost_to_income_ratio)}</td><td>${ef.total_asset_turnover?.toFixed(3) ?? "—"}</td><td>${formatPct(li.casa_ratio)}</td><td>${formatPct(li.loan_to_deposit_ratio)}</td></tr>`;
        });
        rows += `</tbody></table></div>`;
      }
    }
    if (isSgx) {
      const hfs = financials.historical_financials;
      if (hfs && Object.keys(hfs).length) {
        rows += subHead("Historical Financials");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Revenue</th><th>Earnings</th><th>Total Assets</th><th>Total Equity</th><th>Total Liabilities</th><th>Op. CF</th><th>Free CF</th><th>CapEx</th></tr></thead><tbody>`;
        Object.entries(hfs).sort().forEach(([yr, h]) => {
          const cf = h.cash_flow_metrics || {}, bs = h.balance_sheet_metrics || {};
          rows += `<tr><td>${yr}</td><td>${formatBig(h.revenue)}</td><td>${formatBig(h.earnings)}</td><td>${formatBig(bs.total_asset)}</td><td>${formatBig(bs.total_equity)}</td><td>${formatBig(bs.total_liabilities)}</td><td>${formatBig(cf.operating_cash_flow)}</td><td>${formatBig(cf.free_cash_flow)}</td><td>${formatBig(cf.capital_expenditure)}</td></tr>`;
        });
        rows += `</tbody></table></div>`;
        // SGX deep-dive (year with most detailed data)
        const years = Object.keys(hfs).sort();
        const latestYear = years.reduce((best, yr) => {
          const h = hfs[yr];
          const score = Object.keys(h.income_stmt_metrics || {}).length
            + (h.income_stmt_metrics?.int_income_breakdown?.length || 0)
            + (h.income_stmt_metrics?.operating_expense_breakdown?.length || 0)
            + (h.industry_breakdown ? 10 : 0);
          return score > best.score ? { year: yr, score } : best;
        }, { year: years[years.length - 1], score: 0 }).year;
        const latest = hfs[latestYear];
        if (latest) {
          const inc = latest.income_stmt_metrics || {}, bs = latest.balance_sheet_metrics || {}, cf = latest.cash_flow_metrics || {}, eb = latest.employee_breakdown || {};
          const incKeys = [["interest_income","Interest Income"],["interest_expense","Interest Expense"],["net_interest_income","Net Interest Income"],["net_trading_income","Net Trading Income"],["net_fee_and_commission_income","Net Fee & Commission"],["other_non_interest_income","Other Non-Interest Income"],["operating_income","Operating Income"],["operating_expense","Operating Expense"],["non_operating_income_or_loss","Non-Op Income/Loss"],["pretax_income","Pretax Income"],["income_taxes","Income Taxes"],["minorities","Minorities"],["allowances_for_credit_and_other_losses","Allowances for Credit Losses"],["diluted_shares_outstanding","Diluted Shares"],["amortization_of_intangible_assets","Amortization"]];
          let incRows = "";
          incKeys.forEach(([k, label]) => { if (inc[k] != null) incRows += kvRow(label, formatBig(inc[k])); });
          if (inc.int_income_breakdown?.length) { incRows += subHead("Interest Income Breakdown"); inc.int_income_breakdown.forEach(b => { incRows += kvRow(`${b.category} (${b.class})`, formatBig(b.amount)); }); }
          if (inc.operating_expense_breakdown?.length) { incRows += subHead("Op. Expense Breakdown"); inc.operating_expense_breakdown.forEach(b => { incRows += kvRow(`${b.category} (${b.class})`, formatBig(b.amount)); }); }
          if (incRows) rows += subHead(`${latestYear} Income Statement`) + incRows;
          const bsKeys = [["total_asset","Total Assets"],["total_equity","Total Equity"],["total_liabilities","Total Liabilities"],["total_capital","Total Capital"],["gross_loan","Gross Loan"],["net_loan","Net Loan"],["total_deposit","Total Deposit"],["time_deposit","Time Deposit"],["current_account","Current Account"],["savings_account","Savings Account"],["earning_asset","Earning Asset"],["non_loan_asset","Non-Loan Asset"],["credit_rwa","Credit RWA"],["market_rwa","Market RWA"],["operational_rwa","Operational RWA"],["total_risk_weighted_asset","Total RWA"],["core_capital_tier1","Core Capital Tier 1"],["supplementary_capital_tier2","Supp. Capital Tier 2"],["allowance_for_loans","Allowance for Loans"],["non_interest_bearing_liabilities","Non-Interest Bearing Liab."],["other_interest_bearing_liabilities","Other Interest Bearing Liab."]];
          let bsRows = "";
          bsKeys.forEach(([k, label]) => { if (bs[k] != null) bsRows += kvRow(label, formatBig(bs[k])); });
          if (bsRows) rows += subHead(`${latestYear} Balance Sheet`) + bsRows;
          const cfKeys = [["operating_cash_flow","Operating CF"],["investing_cash_flow","Investing CF"],["financing_cash_flow","Financing CF"],["free_cash_flow","Free CF"],["net_cash_flow","Net CF"],["capital_expenditure","CapEx"]];
          let cfRows = "";
          cfKeys.forEach(([k, label]) => { if (cf[k] != null) cfRows += kvRow(label, formatBig(cf[k])); });
          if (cfRows) rows += subHead(`${latestYear} Cash Flow`) + cfRows;
          if (eb.total_employee) rows += kvRow("Employees", formatNum(eb.total_employee));
          const ind = latest.industry_breakdown;
          if (ind) {
            if (ind.customer_breakdown) { rows += subHead(`${latestYear} Customer Breakdown`); Object.entries(ind.customer_breakdown).forEach(([k, v]) => { rows += kvRow(k, formatBig(v)); }); }
            if (ind.loan_by_economic_sectors) { rows += subHead(`${latestYear} Loans by Economic Sector`); Object.entries(ind.loan_by_economic_sectors).forEach(([k, v]) => { rows += kvRow(k, formatBig(v)); }); }
            if (ind.non_loan_asset?.length) { rows += subHead(`${latestYear} Non-Loan Assets`); ind.non_loan_asset.forEach(b => { rows += kvRow(`${b.category} (${b.class})`, formatBig(b.amount)); }); }
          }
        }
      }
    }
    return rows ? `<details><summary>Financials</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildManagement(r) {
    if (r.isSgx || !r.management) return "";
    const execs = r.management.key_executives || [];
    const holdings = r.management.executives_shareholdings || [];
    let html = "";
    if (execs.length > 0) {
      const rows = execs.map(e => kvRow(e.position, e.name)).join("");
      html += `<details><summary>Key Executives (${execs.length})</summary><div class="st-detail-body">${rows}</div></details>`;
    }
    if (holdings.length > 0) {
      const rows = holdings.map(h => kvRow(h.name, `${formatNum(h.share_amount)} shares (${(h.share_percentage * 100).toFixed(3)}%)`)).join("");
      html += `<details><summary>Executive Shareholdings (${holdings.length})</summary><div class="st-detail-body">${rows}</div></details>`;
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
      rows += kvRow(`${f.estimate_year} EPS Est.`, currency + " " + formatNum(f.eps_estimate));
      rows += kvRow(`${f.estimate_year} Rev Est.`, formatBig(f.revenue_estimate));
    });
    forecasts.filter(f => f.financial_year && !f.estimate_year).forEach(f => {
      rows += kvRow(`${f.financial_year} Actual EPS`, currency + " " + formatNum(f.eps));
      rows += kvRow(`${f.financial_year} Total Revenue`, formatBig(f.total_revenue));
      rows += kvRow(`${f.financial_year} Total Assets`, formatBig(f.total_assets));
      rows += kvRow(`${f.financial_year} Total Equity`, formatBig(f.total_equity));
    });
    growth.filter(g => g.estimate_year).forEach(g => {
      rows += kvRow(`${g.estimate_year} EPS Growth`, formatPct(g.eps_growth));
      rows += kvRow(`${g.estimate_year} Rev Growth`, formatPct(g.revenue_growth));
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
    return rows ? `<details><summary>Forecasts & Analyst Ratings</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildDividend(dividend, isSgx, currency) {
    let rows = "";
    if (isSgx) {
      if (dividend.dividend_ttm != null) rows += kvRow("Dividend TTM", currency + " " + dividend.dividend_ttm.toFixed(2));
      if (dividend.forward_dividend != null) rows += kvRow("Forward Dividend", currency + " " + dividend.forward_dividend.toFixed(2));
      if (dividend.forward_dividend_yield != null) rows += kvRow("Forward Yield", formatPct(dividend.forward_dividend_yield));
      if (dividend.dividend_yield_5y_avg != null) rows += kvRow("5Y Avg Yield", formatPct(dividend.dividend_yield_5y_avg));
      if (dividend.dividend_growth_rate != null) rows += kvRow("Div Growth Rate", formatPct(dividend.dividend_growth_rate));
      if (dividend.payout_ratio != null) rows += kvRow("Payout Ratio", formatPct(dividend.payout_ratio));
    } else {
      if (dividend.dividend_ttm != null) rows += kvRow("Dividend TTM", currency + " " + formatNum(dividend.dividend_ttm));
      if (dividend.dividend_yield_avg?.avg_yield != null) rows += kvRow(`${dividend.dividend_yield_avg.period}Y Avg Yield`, formatPct(dividend.dividend_yield_avg.avg_yield));
      if (dividend.payout_ratio != null) rows += kvRow("Payout Ratio", formatPct(dividend.payout_ratio));
      if (dividend.cash_payout_ratio != null) rows += kvRow("Cash Payout Ratio", formatPct(dividend.cash_payout_ratio));
      if (dividend.last_ex_dividend_date) rows += kvRow("Last Ex-Div", dividend.last_ex_dividend_date);
    }
    const hd = dividend.historical_dividends;
    if (hd) {
      if (Array.isArray(hd) ? hd.length : Object.keys(hd).length) {
        rows += subHead("Dividend History");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Total</th><th>Yield</th><th>Payments</th></tr></thead><tbody>`;
        if (Array.isArray(hd)) {
          hd.slice(-10).forEach(d => {
            rows += `<tr><td>${d.year ?? "—"}</td><td>${d.total_dividend != null ? currency + " " + d.total_dividend.toFixed(2) : "—"}</td><td>${d.total_yield != null ? formatPct(d.total_yield) : "—"}</td><td>${d.breakdown?.length ?? 0}</td></tr>`;
          });
        } else {
          Object.entries(hd).slice(-10).forEach(([yr, d]) => {
            rows += `<tr><td>${yr}</td><td>${d.total_dividend != null ? currency + " " + d.total_dividend.toFixed(2) : "—"}</td><td>${d.total_yield != null ? formatPct(d.total_yield) : "—"}</td><td>${d.breakdown?.length ?? 0}</td></tr>`;
          });
        }
        rows += `</tbody></table></div>`;
      }
    }
    const ud = dividend.upcoming_dividends;
    if (ud?.length) {
      rows += subHead("Upcoming Dividends");
      ud.forEach(d => { rows += kvRow(d.date || "—", `${currency} ${formatNum(d.amount)} (${d.type || ""})`); });
    }
    return rows ? `<details><summary>${isSgx ? "Dividends" : "Dividend Detail"}</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildOwnership(r) {
    if (r.isSgx || !r.ownership) return "";
    let rows = "";
    if (r.ownership.whale_investors?.length) rows += kvRow("Whale Investors", r.ownership.whale_investors.join(", "));
    if (r.ownership.conglomerates_group?.length) rows += kvRow("Conglomerate Groups", r.ownership.conglomerates_group.join(", "));
    const shareholders = r.ownership.major_shareholders || [];
    if (shareholders.length > 0) {
      rows += subHead("Major Shareholders");
      shareholders.forEach(s => { rows += kvRow(s.name, `${(parseFloat(s.share_percentage) * 100).toFixed(2)}% (${formatBig(s.share_value)})`); });
    }
    const txns = r.ownership.top_transactions;
    if (txns?.top_buyers?.length) { rows += subHead("Top Buyers"); txns.top_buyers.forEach(b => { rows += kvRow(b.name, `+${formatBig(b.changeAmount)}`); }); }
    if (txns?.top_sellers?.length) { rows += subHead("Top Sellers"); txns.top_sellers.forEach(s => { rows += kvRow(s.name, formatBig(s.changeAmount)); }); }
    const instFlow = r.ownership.institutional_transaction_flow || [];
    if (instFlow.length > 0) {
      rows += subHead("Institutional Transaction Flow");
      instFlow.forEach(i => { rows += kvRow(i.date, `${i.net_transaction >= 0 ? '+' : ''}${formatBig(i.net_transaction)}`); });
    }
    return rows ? `<details><summary>Ownership & Transactions</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildScoring(r) {
    if (r.isSgx || !r.peers?.length) return "";
    const selfPeer = r.peers[0]?.peers_data?.companies?.find(c => c.group?.includes("self"));
    const ps = selfPeer?.point_summaries;
    if (!ps?.length) return "";
    const rows = ps.map(s => s.name ? kvRow(s.name.charAt(0).toUpperCase() + s.name.slice(1), `${s.point} / ${s.maxpoint}`) : "").join("");
    return rows ? `<details><summary>Scoring</summary><div class="st-detail-body">${rows}</div></details>` : "";
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
      if (rows) html += `<details><summary>Peer Group Context</summary><div class="st-detail-body">${rows}</div></details>`;
    }
    const selfPeer = pd?.companies?.find(c => c.group?.includes("self"));
    if (selfPeer) {
      let rows = "";
      if (selfPeer.int_income_breakdown?.length) { rows += subHead("Interest Income Breakdown"); selfPeer.int_income_breakdown.forEach(b => { rows += kvRow(`${b.category} (${b.class})`, formatBig(b.amount)); }); }
      if (selfPeer.operating_expense_breakdown?.length) { rows += subHead("Operating Expense Breakdown"); selfPeer.operating_expense_breakdown.forEach(b => { rows += kvRow(`${b.category} (${b.class})`, formatBig(b.amount)); }); }
      if (selfPeer.revenue_breakdown) { rows += subHead("Revenue Breakdown"); if (typeof selfPeer.revenue_breakdown === "object") Object.entries(selfPeer.revenue_breakdown).forEach(([k, v]) => { rows += kvRow(k, formatBig(v)); }); }
      if (rows) html += `<details><summary>Revenue & Expense Breakdown</summary><div class="st-detail-body">${rows}</div></details>`;
    }
    return html;
  }

  // ── Populate tooltip with data ─────────────────────────────────────────────
  function renderData(data) {
    const tip = getTooltip();
    const content = tip.querySelector("#st-content");

    if (data.error === "no_api_key") {
      content.innerHTML = `
        <div class="st-error">
          <div class="st-error-icon"></div>
          <p>No API key set.</p>
          <button class="st-btn" id="st-open-options">Open Settings</button>
        </div>`;
      document.getElementById("st-open-options")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
      });
      return;
    }

    if (data.error === "ticker_not_found") {
      content.innerHTML = `
        <div class="st-error">
          <div class="st-error-icon"></div>
          <p>Ticker not found.</p>
          <p style="font-size:12px; margin-top:4px;">${escHtml(data.symbol)} does not exist in our database.</p>
        </div>`;
      return;
    }

    if (data.error) {
      const isExhausted = data.error.includes("403") || data.error.toLowerCase().includes("exhausted");
      const isRateLimited = data.error.includes("429") || data.error.toLowerCase().includes("rate limit");
      if (isExhausted) {
        content.innerHTML = `<div class="st-error"><div class="st-error-icon"></div><p>API key exhausted.</p><a href="https://sectors.app/api" target="_blank" class="st-btn-link">Manage Key at sectors.app/api</a></div>`;
        return;
      }
      if (isRateLimited) {
        content.innerHTML = `<div class="st-error"><div class="st-error-icon"></div><p>Rate limit exceeded.</p><p style="font-size:12px; margin-top:4px;">Slow down or upgrade your key.</p></div>`;
        return;
      }
      content.innerHTML = `<div class="st-error"><div class="st-error-icon"></div><p>${escHtml(data.error)}</p></div>`;
      return;
    }

    const r = data.report;
    const filings = data.filings?.results || [];
    const isSgx = !!data.isSgx;
    const currency = isSgx ? "SGD" : "IDR";
    let html = "";

    // ════════════════════════════════════════════════════════════════════════
    // SUMMARY CARD
    // ════════════════════════════════════════════════════════════════════════
    if (r) {
      const overview = r.overview || {};
      const valuation = r.valuation || {};
      const dividend = r.dividend || {};
      const financials = r.financials || {};
      const exchange = isSgx ? "Singapore" : "Indonesia";

      // Price & change
      const price = overview.last_close_price || overview.close_price || overview.price || null;
      const dailyChange = isSgx ? (overview.change_1d || 0) : (overview.daily_close_change || 0);
      const changeStr = `${(dailyChange * 100).toFixed(2)}%`;
      const changeClass = dailyChange >= 0 ? "st-positive" : "st-negative";

      // P/E, P/B, Div Yield — pick best available
      let pe = "—", pb = "—", dy = "—";
      if (isSgx) {
        pe = valuation.pe; pb = valuation.pb;
        dy = dividend.forward_dividend_yield;
      } else {
        const selfPeer = r.peers?.[0]?.peers_data?.companies?.find(c => c.group?.includes("self"));
        pe = selfPeer?.pe_ttm || valuation.pe_ttm;
        pb = selfPeer?.pb_mrq || valuation.pb_mrq;
        dy = dividend.yield_ttm || dividend.dividend_yield_avg?.avg_yield;
      }

      html += `
        <div class="st-section st-ai-chat-card">
          <span class="st-ai-label">Quick summary</span>
          <p class="st-ai-text">
            <strong>${escHtml(r.company_name || r.name || overview.company_name || data.symbol)}</strong> is a <strong>${escHtml(overview.sector || overview.industry || '—')}</strong> company listed on ${exchange}.
            Currently trading at <strong>${currency} ${formatNum(price)}</strong> with a market cap of ${formatBig(overview.market_cap)}.
            It operates in the ${escHtml(overview.sub_sector || '—')} space.
          </p>
        </div>`;

      // ── Main card: name, sector, price, key metrics ──
      html += `
        <div class="st-section st-details">
          <div class="st-company-name-large">${escHtml(r.company_name || r.name || overview.company_name || data.symbol)}</div>
          <div class="st-meta-row">
            <span class="st-tag">${escHtml(overview.sector || "")}</span>
            <span class="st-tag">${escHtml(overview.sub_sector || "")}</span>
            ${overview.listing_board ? `<span class="st-tag">${escHtml(overview.listing_board)}</span>` : ""}
          </div>
          <div class="st-price-row-large">
            <span class="st-price-val">${price !== null ? currency + " " + formatNum(price) : "—"}</span>
            <span class="st-price-change ${changeClass}">${changeStr}</span>
          </div>
          <div class="st-metric-grid">
            <div class="st-metric"><span class="st-metric-k">MKT CAP</span><span class="st-metric-v">${overview.market_cap ? currency + ' ' + formatBig(overview.market_cap) : '—'}</span></div>
            <div class="st-metric"><span class="st-metric-k">P/E ${isSgx ? '' : '(TTM)'}</span><span class="st-metric-v">${pe != null ? Number(pe).toFixed(2) : "—"}</span></div>
            <div class="st-metric"><span class="st-metric-k">P/B ${isSgx ? '' : '(MRQ)'}</span><span class="st-metric-v">${pb != null ? Number(pb).toFixed(2) : "—"}</span></div>
            <div class="st-metric"><span class="st-metric-k">DIV YIELD</span><span class="st-metric-v">${dy != null ? (Number(dy) * 100).toFixed(2) + '%' : '—'}</span></div>
          </div>
        </div>`;

      // ══════════════════════════════════════════════════════════════════════
      // COLLAPSIBLE SECTIONS — ALL API DATA
      // ══════════════════════════════════════════════════════════════════════

      // ── Section order matches sectors.app ──
      const rForSections = { ...r, isSgx };
      if (isSgx) {
        // SGX: Overview, Ownership, Financials, Valuation, Dividends
        // (SGX API has no ownership data, so Ownership is skipped)
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
      html += `<div class="st-section st-details"><div class="st-company-name-large">${escHtml(data.symbol)}</div><p class="st-dim">Company report unavailable</p></div>`;
    }

    // ════════════════════════════════════════════════════════════════════════
    // INSIDER FILINGS
    // ════════════════════════════════════════════════════════════════════════
    {
      html += `<div class="st-section"><div class="st-section-title">RECENT INSIDER FILINGS</div>`;
      if (filings.length === 0) {
        html += `<p class="st-dim"><em>No recent filings</em></p>`;
      } else {
        filings.forEach((f) => {
          const txClass = f.transaction_type === "buy" ? "st-buy" : f.transaction_type === "sell" ? "st-sell" : "";
          const txIcon = f.transaction_type === "buy" ? "▲" : f.transaction_type === "sell" ? "▼" : "●";
          const val = f.transaction_value ? `${currency} ${formatBig(f.transaction_value)}` : "—";
          const date = f.timestamp ? f.timestamp.split("T")[0] : "—";

          let filingExtra = "";
          if (f.title) filingExtra += `<div style="margin-bottom:4px"><strong>${escHtml(f.title)}</strong></div>`;
          if (f.body) filingExtra += `<div style="margin-bottom:6px">${escHtml(f.body)}</div>`;
          if (f.holder_type) filingExtra += kvRow("Holder Type", f.holder_type);
          if (f.holding_before != null) filingExtra += kvRow("Holding Before", formatNum(f.holding_before));
          if (f.holding_after != null) filingExtra += kvRow("Holding After", formatNum(f.holding_after));
          if (f.share_percentage_before != null) filingExtra += kvRow("Before %", (f.share_percentage_before * 100).toFixed(4) + "%");
          if (f.share_percentage_after != null) filingExtra += kvRow("After %", (f.share_percentage_after * 100).toFixed(4) + "%");
          if (f.share_percentage_transaction != null) filingExtra += kvRow("% Transacted", (f.share_percentage_transaction * 100).toFixed(4) + "%");
          if (f.sector) filingExtra += kvRow("Sector", f.sector);
          if (f.sub_sector) filingExtra += kvRow("Sub-Sector", f.sub_sector);
          if (f.tags?.length) filingExtra += kvRow("Tags", f.tags.join(", "));
          if (f.source) filingExtra += kvRow("Source", `<a href="${escHtml(f.source)}" target="_blank">View Filing</a>`);
          if (f.price_transaction?.length) {
            filingExtra += subHead("Price Transaction Details");
            f.price_transaction.forEach(pt => {
              filingExtra += kvRow(`${pt.date ?? "—"}`, `${formatNum(pt.amount)} shares @ ${currency} ${formatNum(pt.price)}`);
            });
          }

          html += `
            <div class="st-filing">
              <div class="st-filing-top">
                <span class="st-tx-badge ${txClass}">${txIcon} ${(f.transaction_type || "").toUpperCase()}</span>
                <span class="st-filing-date">${date}</span>
              </div>
              <div class="st-filing-holder">${escHtml(f.holder_name || "—")}</div>
              <div class="st-filing-detail">
                <span>${formatNum(f.amount_transaction)} shares @ ${currency} ${formatNum(f.price)}</span>
                <span class="st-filing-val">${val}</span>
              </div>
              ${filingExtra ? `<details class="st-filing-expandable"><summary>Details</summary><div class="st-detail-body">${filingExtra}</div></details>` : ""}
            </div>`;
        });
      }
      html += `</div>`;
    }

    // ════════════════════════════════════════════════════════════════════════
    // AI CHAT
    // ════════════════════════════════════════════════════════════════════════
    {
      const sector = escHtml(r?.overview?.sector || 'same');
      const subSector = escHtml(r?.overview?.sub_sector || 'same sector');
      const mcap = r?.overview?.market_cap || 0;
      const exchangeLabel = isSgx ? "SGX" : "IDX";
      const suggestions = isSgx
        ? `<button class="st-suggest-btn" data-q="top 5 ${exchangeLabel} companies in the ${sector} sector by market cap">Sector Leaders</button>
           <button class="st-suggest-btn" data-q="${exchangeLabel} companies in the ${sector} sector with pe < 15">Value Peers (P/E < 15)</button>
           <button class="st-suggest-btn" data-q="top 5 ${exchangeLabel} companies by revenue[2024]">High Revenue Peers</button>
           <button class="st-suggest-btn" data-q="top ${exchangeLabel} companies by forward_dividend_yield">Top Div Payers</button>`
        : `<button class="st-suggest-btn" data-q="show me companies in the ${sector} sector with market_cap > ${mcap}">Sector Leaders</button>
           <button class="st-suggest-btn" data-q="show me companies in the ${sector} sector with pe_ttm < 15">Value Peers (P/E < 15)</button>
           <button class="st-suggest-btn" data-q="show me companies with revenue > 100000000000 in 2025 q2">High Revenue Peers</button>
           <button class="st-suggest-btn" data-q="list top dividend payers in the ${subSector}">Top Div Payers</button>`;

      html += `
        <div class="st-section st-chat-box">
          <div id="st-chat-output" class="st-chat-history"></div>
          <div class="st-suggestions" id="st-suggestions">${suggestions}</div>
          <div class="st-chat-input-wrap">
            <input type="text" id="st-ai-query" placeholder="Ask about competitors of ${data.symbol}..." />
            <button id="st-btn-ask" title="Send Query">➔</button>
          </div>
          <p class="st-chat-hint">Sectors ${exchangeLabel} Company Screener API — natural language search</p>
        </div>`;
    }

    // ── Footer ──
    const symbolSlug = data.symbol.split('.')[0].toLowerCase();
    const sectorsUrl = isSgx ? `https://sectors.app/sgx/${symbolSlug}` : `https://sectors.app/idx/${symbolSlug}`;
    const aiChatUrl = "https://sectors.app/chat";
    html += `
      <div class="st-footer">
        <a href="${sectorsUrl}" target="_blank" class="st-ext-link">open in sectors.app</a>
        <a href="${aiChatUrl}" target="_blank" class="st-ext-link st-chat-link">Sectors AI Chat</a>
      </div>`;

    content.innerHTML = html;
    positionTooltip(tip, lastX, lastY);

    // ── Chat listeners ──
    const input = document.getElementById("st-ai-query");
    const btn = document.getElementById("st-btn-ask");
    const output = document.getElementById("st-chat-output");

    const sendQuery = (qOverride) => {
      const q = qOverride || input.value.trim();
      if (!q) return;
      appendChatBubble(output, q, 'user');
      if (!qOverride) input.value = "";
      const thinking = appendChatBubble(output, "Thinking...", 'ai');

      safeSendMessage({ type: "FETCH_AI_RESULTS", query: q, isSgx: isSgx }, (res) => {
        if (!res) {
          thinking.textContent = "No response from extension. Try again.";
        } else if (res.error) {
          let msg = res.error;
          if (res.error.includes("403")) msg = "API key exhausted. Upgrade at sectors.app/api.";
          else if (res.error.includes("429")) msg = "Rate limit exceeded. Slow down or upgrade your key.";
          else if (res.error.includes("NON_TRANSLATABLE_QUERY") || res.error.includes("cannot be interpreted") || res.error.includes("not contain recognizable")) msg = "Query not recognized. Try using financial terms like sector, market_cap, pe_ttm, revenue, etc.";
          else if (res.error.includes("no_api_key")) msg = "No API key set. Add one in Settings.";
          thinking.textContent = msg;
        } else {
          let shownText = "";
          let moreEntries = [];
          const renderCompany = (c) => {
            const qv = c.query_values || {};
            let block = `**${c.company_name} (${c.symbol})**\n`;
            Object.entries(qv).forEach(([key, val]) => {
              if (key === "symbol") return;
              const label = key.replace(/_/g, " ");
              let displayVal;
              if (typeof val === "number") {
                displayVal = val >= 1e6 ? formatBig(val) : formatNum(val);
              } else {
                displayVal = val || "—";
              }
              block += `${label}: ${displayVal}\n`;
            });
            ["last_close_price", "market_cap", "pe_ttm", "pb_mrq", "revenue", "earnings"].forEach(key => {
              if (c[key] != null && !(key in qv)) {
                block += `${key.replace(/_/g, " ")}: ${typeof c[key] === "number" ? formatBig(c[key]) : c[key]}\n`;
              }
            });
            return block;
          };
          if (res.results && res.results.length > 0) {
            const all = res.results;
            shownText = `Found ${all.length} result${all.length === 1 ? "" : "s"}:\n\n`;
            all.slice(0, 10).forEach((c) => { shownText += renderCompany(c) + "\n"; });
            moreEntries = all.slice(10);
          } else {
            const where = res.llm_translation?.translated_params?.where;
            shownText = "No companies match your query.";
            if (where) shownText += `\n\nInterpreted as: ${where}`;
            shownText += "\n\nTry a different sector, lower the threshold, or broaden the criteria.";
          }
          const safe = shownText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          thinking.innerHTML = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
          output.scrollTop = output.scrollHeight;
          if (moreEntries.length > 0) {
            const moreText = moreEntries.map(renderCompany).join("\n");
            const safeMore = moreText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const formatted = safeMore.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
            const details = document.createElement("details");
            details.className = "st-ai-more";
            details.innerHTML = `<summary>Show ${moreEntries.length} more</summary><div class="st-ai-more-body">${formatted}</div>`;
            thinking.appendChild(details);
          }
          if (res.queries && res.queries.length > 0) {
            const qHeader = document.createElement("div");
            qHeader.className = "st-related-queries-wrap";
            qHeader.innerHTML = `<p class="st-related-label">Explore related topics:</p>`;
            const qList = document.createElement("div");
            qList.className = "st-related-list";
            res.queries.slice(0, 5).forEach(rq => {
              const qBtn = document.createElement("button");
              qBtn.className = "st-related-btn";
              qBtn.innerText = rq;
              qBtn.onclick = () => sendQuery(rq);
              qList.appendChild(qBtn);
            });
            thinking.appendChild(qHeader);
            thinking.appendChild(qList);
          }
        }
        output.scrollTop = output.scrollHeight;
      });
    };

    btn?.addEventListener("click", () => sendQuery());
    input?.addEventListener("keydown", (e) => { if (e.key === 'Enter') sendQuery(); });

    const suggestionContainer = document.getElementById("st-suggestions");
    suggestionContainer?.addEventListener("click", (e) => {
      const suggestBtn = e.target.closest(".st-suggest-btn");
      if (suggestBtn) {
        const q = suggestBtn.getAttribute("data-q");
        if (suggestionContainer) suggestionContainer.style.display = 'none';
        sendQuery(q);
      }
    });
  }

  function appendChatBubble(parent, text, type) {
    const bubble = document.createElement("div");
    bubble.className = `st-bubble st-bubble-${type}`;
    bubble.innerText = text;
    parent.appendChild(bubble);
    parent.scrollTop = parent.scrollHeight;
    return bubble;
  }

  // ── Ticker detection via text node walking ─────────────────────────────────
  function getTickerUnderCursor(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.id === "sectors-tooltip" || el.closest("#sectors-tooltip")) {
      return currentSymbol;
    }
    FAST_TICKER_REGEX.lastIndex = 0;
    if (!FAST_TICKER_REGEX.test(el.textContent)) return null;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      FAST_TICKER_REGEX.lastIndex = 0;
      let match;
      while ((match = FAST_TICKER_REGEX.exec(text)) !== null) {
        let rawSymbol = match[0];
        let upper = rawSymbol.toUpperCase();
        let hasSgxSuffix = upper.endsWith('.SI');
        let hasIdxSuffix = upper.match(/\.(JK|IJ|ID)$/);
        let cleanSymbol = upper.replace(/\.(SI|JK|IJ|ID)$/, "");
        let isValid = false;
        let finalSymbolToReturn = upper;

        if (hasSgxSuffix) {
          if (validSgxTickers.size === 0 || validSgxTickers.has(cleanSymbol)) isValid = true;
        } else if (hasIdxSuffix) {
          if (validIdxTickers.size === 0 || validIdxTickers.has(cleanSymbol)) isValid = true;
        } else {
          if (/\d/.test(cleanSymbol)) {
            if (validSgxTickers.size === 0 || validSgxTickers.has(cleanSymbol)) {
              isValid = true;
              finalSymbolToReturn = cleanSymbol + ".SI";
            }
          } else {
            if (cleanSymbol === "GOTO" || validIdxTickers.has(cleanSymbol)) {
              isValid = true;
            } else if (validSgxTickers.has(cleanSymbol)) {
              isValid = true;
              finalSymbolToReturn = cleanSymbol + ".SI";
            }
          }
        }
        if (!isValid) continue;
        try {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + rawSymbol.length);
          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
              return finalSymbolToReturn;
            }
          }
        } catch (err) {}
      }
    }
    return null;
  }

  // ── Main mousemove listener ────────────────────────────────────────────────
  let moveDebounce = null;
  document.addEventListener("mousemove", (e) => {
    const cx = e.clientX;
    const cy = e.clientY;
    const px = e.pageX;
    const py = e.pageY;
    clearTimeout(moveDebounce);
    moveDebounce = setTimeout(() => {
      if (!prefEnabled) return;
      const symbol = getTickerUnderCursor(cx, cy);
      if (!symbol) {
        if (currentSymbol) scheduleHide();
        return;
      }
      if (symbol === currentSymbol) return;
      currentSymbol = symbol;
      showTooltip(px, py, symbol);

      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        safeSendMessage({ type: "FETCH_TICKER_DATA", symbol }, (response) => {
          if (currentSymbol === symbol) renderData(response.error ? { error: response.error } : response);
        });
        return;
      }
      if (isContextInvalid || !chrome.runtime?.id) return;

      try {
        chrome.storage.local.get([CACHE_KEY], (result) => {
          if (chrome.runtime.lastError) { isContextInvalid = true; return; }
          const cache = result[CACHE_KEY] || {};
          if (cache[symbol] && (Date.now() - cache[symbol].timestamp < 3600000)) {
            renderData(cache[symbol].data);
            return;
          }
          safeSendMessage({ type: "FETCH_TICKER_DATA", symbol }, (response) => {
            if (currentSymbol !== symbol) return;
            if (response.error) { renderData({ error: response.error }); return; }
            const updatedData = response || { error: "No response from extension" };
            renderData(updatedData);
            const tickerList = Object.keys(cache).sort((a, b) => (cache[b].timestamp || 0) - (cache[a].timestamp || 0));
            if (tickerList.length >= CACHE_LIMIT) delete cache[tickerList[tickerList.length - 1]];
            cache[symbol] = { data: updatedData, timestamp: Date.now() };
            try { chrome.storage.local.set({ [CACHE_KEY]: cache }); } catch (e) { isContextInvalid = true; }
          });
        });
      } catch (e) { isContextInvalid = true; }
    }, hoverDelay);
  });

  document.addEventListener("mouseleave", scheduleHide);
})();
