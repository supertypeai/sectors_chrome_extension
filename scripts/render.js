// render.js — shared, DOM-free report renderers for the tooltip and popup.
(function () {
  "use strict";

  function escHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Only allow http(s) links; blocks javascript:/data: URLs from API fields.
  function safeHref(url) {
    try {
      const u = new URL(String(url), "https://sectors.app");
      return u.protocol === "https:" ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function isFiniteNumber(value) {
    if (value == null || typeof value === "boolean") return false;
    const normalized = typeof value === "string" ? value.trim() : value;
    return normalized !== "" && Number.isFinite(Number(normalized));
  }

  function formatNum(n) {
    if (!isFiniteNumber(n)) return "—";
    return Number(n).toLocaleString();
  }

  function formatBig(n) {
    if (!isFiniteNumber(n)) return "—";
    const value = Number(n);
    const abs = Math.abs(value);
    if (abs >= 1e12) return (value / 1e12).toFixed(2) + "T";
    if (abs >= 1e9) return (value / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (value / 1e6).toFixed(2) + "M";
    return value.toLocaleString();
  }

  function formatPct(n, dec) {
    if (!isFiniteNumber(n)) return "—";
    return (Number(n) * 100).toFixed(dec ?? 1) + "%";
  }

  // Key-value row for collapsible details
  function kvRowHtml(label, value) {
    return `<div class="st-kv-row"><span class="st-kv-label">${escHtml(label)}</span><span class="st-kv-value">${value}</span></div>`;
  }

  // Escape the value by default; use kvRowHtml only for trusted markup.
  function kvRow(label, value) {
    return kvRowHtml(label, escHtml(value));
  }

  // Sub-header inside a details block
  function subHead(text) {
    return `<div class="st-sub-head">${escHtml(text)}</div>`;
  }

  function titleCase(value) {
    return String(value ?? "")
      .replace(/_+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }

  function formatFilingPct(value) {
    return isFiniteNumber(value) ? `${Number(value).toFixed(2)}%` : null;
  }

  function filingHeadline(f, currency) {
    const amount = isFiniteNumber(f.amount_transaction) ? `${formatNum(f.amount_transaction)} shares` : "";
    const price = isFiniteNumber(f.price) ? `@ ${currency} ${formatNum(f.price)}` : "";
    return {
      detail: [amount, price].filter(Boolean).join(" "),
      value: isFiniteNumber(f.transaction_value) ? `${currency} ${formatBig(f.transaction_value)}` : "",
    };
  }

  function buildFilingExtra(f, currency) {
    let extra = "";
    if (f.holder_type) extra += kvRow("Holder Type", titleCase(f.holder_type));
    if (isFiniteNumber(f.holding_before)) extra += kvRow("Holding Before", formatNum(f.holding_before));
    if (isFiniteNumber(f.holding_after)) extra += kvRow("Holding After", formatNum(f.holding_after));
    const beforePct = formatFilingPct(f.share_percentage_before);
    if (beforePct) extra += kvRow("Before %", beforePct);
    const afterPct = formatFilingPct(f.share_percentage_after);
    if (afterPct) extra += kvRow("After %", afterPct);
    const txPct = formatFilingPct(f.share_percentage_transaction);
    if (txPct) extra += kvRow("% Transacted", txPct);
    if (f.sector) extra += kvRow("Sector", titleCase(f.sector));
    if (f.sub_sector) extra += kvRow("Sub-Sector", titleCase(f.sub_sector));
    if (Array.isArray(f.tags) && f.tags.length) {
      const tags = f.tags.map(t => titleCase(t)).filter(Boolean).join(", ");
      if (tags) extra += kvRow("Tags", tags);
    }
    if (f.source) {
      const href = safeHref(f.source);
      if (href) extra += kvRowHtml("Source", `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">View Filing</a>`);
    }
    if (f.price_transaction?.length) {
      let rows = "";
      [...f.price_transaction].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).forEach(pt => {
        const amountValue = isFiniteNumber(pt.amount_transacted) ? pt.amount_transacted : pt.amount;
        const amount = isFiniteNumber(amountValue) ? `${formatNum(amountValue)} shares` : "";
        const price = isFiniteNumber(pt.price) ? `@ ${currency} ${formatNum(pt.price)}` : "";
        const desc = [amount, price].filter(Boolean).join(" ");
        if (desc) rows += kvRow(pt.date || "—", desc);
      });
      if (rows) extra += subHead("Price Transaction Details") + rows;
    }
    return extra;
  }

  function breakdownRows(value, preferredKey = "class") {
    if (Array.isArray(value)) {
      return value.map(item => {
        if (!item || typeof item !== "object") return "";
        const label = item[preferredKey] || item.class || item.category || item.name || item.label || "";
        const amount = item.amount ?? item.value ?? item.revenue ?? item.total;
        return label && isFiniteNumber(amount) ? kvRow(titleCase(label), formatBig(amount)) : "";
      }).join("");
    }
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, entry]) => {
        const candidate = entry && typeof entry === "object"
          ? (isFiniteNumber(entry.amount) ? entry.amount : isFiniteNumber(entry.value) ? entry.value : isFiniteNumber(entry.total) ? entry.total : null)
          : entry;
        return isFiniteNumber(candidate) ? kvRow(titleCase(key), formatBig(candidate)) : "";
      }).join("");
    }
    return "";
  }

  function breakdownSection(title, value, preferredKey = "class") {
    const rows = breakdownRows(value, preferredKey);
    return rows ? subHead(title) + rows : "";
  }

  // ── Section builders ─────────────────────────────────────────────────────────
  function buildOverview(overview, isSgx, currency) {
    let rows = "";
    if (overview.address) rows += kvRow("Address", overview.address.replace(/\r\n/g, ", "));
    if (overview.phone) rows += kvRow("Phone", overview.phone);
    if (overview.email) rows += kvRow("Email", overview.email);
    if (overview.website) {
      const href = safeHref(overview.website);
      rows += href
        ? kvRowHtml("Website", `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${escHtml(overview.website)}</a>`)
        : kvRow("Website", overview.website);
    }
    if (overview.listing_date) rows += kvRow("Listed", overview.listing_date);
    if (overview.industry) rows += kvRow("Industry", overview.industry);
    if (overview.sub_industry) rows += kvRow("Sub-Industry", overview.sub_industry);
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
    return rows ? `<details class="st-collapsible"><summary>Overview</summary><div class="st-detail-body">${rows}</div></details>` : "";
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
    }
    const hv = [...(valuation.historical_valuation || [])].sort((a, b) => Number(b.year) - Number(a.year));
    if (hv.length) {
      rows += subHead("Historical Valuation");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>P/E</th><th>P/B</th><th>P/S</th><th>PCF</th><th>PEG</th><th>EV/EBITDA</th><th>EV/Rev</th><th>P/E Avg</th><th>P/B Avg</th><th>P/S Avg</th></tr></thead><tbody>`;
      hv.forEach(v => {
        rows += `<tr><td>${escHtml(String(v.year ?? "—"))}</td><td>${v.pe?.toFixed(1) ?? "—"}</td><td>${v.pb?.toFixed(2) ?? "—"}</td><td>${v.ps?.toFixed(2) ?? "—"}</td><td>${v.pcf?.toFixed(1) ?? "—"}</td><td>${v.peg?.toFixed(2) ?? "—"}</td><td>${v.enterprise_to_ebitda?.toFixed(2) ?? "—"}</td><td>${v.enterprise_to_revenue?.toFixed(2) ?? "—"}</td><td>${v.pe_peer_avg?.toFixed(1) ?? "—"}</td><td>${v.pb_peer_avg?.toFixed(2) ?? "—"}</td><td>${v.ps_peer_avg?.toFixed(2) ?? "—"}</td></tr>`;
      });
      rows += `</tbody></table></div>`;
    }
    return rows ? `<details class="st-collapsible"><summary>Valuation</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildPeersComparison(r) {
    if (!r.peers?.length) return "";
    const seen = new Set();
    const rows = [];
    r.peers.forEach(peerGroup => {
      const companies = peerGroup?.peers_data?.companies || [];
      companies.filter(c => !c.group?.includes("self")).forEach(c => {
        const symbol = c.symbol || c.company_name || "";
        if (!symbol || seen.has(symbol)) return;
        seen.add(symbol);
        const pe = isFiniteNumber(c.pe_ttm) ? Number(c.pe_ttm).toFixed(1) : "—";
        const pb = isFiniteNumber(c.pb_mrq) ? Number(c.pb_mrq).toFixed(1) : "—";
        rows.push(`<tr><td>${escHtml(c.company_name || "—")}<br><span class="st-symbol">${escHtml(symbol)}</span></td><td>${pe}</td><td>${pb}</td><td>${formatBig(c.market_cap)}</td></tr>`);
      });
    });
    if (!rows.length) return "";
    return `<details class="st-collapsible"><summary>Peers Comparison</summary><div class="st-detail-body"><div class="st-table-wrap st-peers-table"><table class="st-table"><thead><tr><th>Company</th><th>P/E</th><th>P/B</th><th>MCap</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div></details>`;
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
      if (financials.yoy_ttm_earnings_growth != null) rows += kvRow("YoY TTM Earnings Growth", formatPct(financials.yoy_ttm_earnings_growth));
      if (financials.yoy_ttm_revenue_growth != null) rows += kvRow("YoY TTM Revenue Growth", formatPct(financials.yoy_ttm_revenue_growth));
      const hfs = financials.historical_financials;
      if (hfs?.length) {
        rows += subHead("Historical Financials");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Revenue</th><th>Earnings</th><th>EBITDA</th><th>Total Assets</th><th>Total Equity</th><th>Total Debt</th><th>Free CF</th><th>Operating CF</th></tr></thead><tbody>`;
        [...hfs].sort((a, b) => Number(b.year) - Number(a.year)).forEach(h => {
          rows += `<tr><td>${escHtml(String(h.year ?? "—"))}</td><td>${formatBig(h.revenue)}</td><td>${formatBig(h.earnings)}</td><td>${formatBig(h.ebitda)}</td><td>${formatBig(h.total_assets)}</td><td>${formatBig(h.total_equity)}</td><td>${formatBig(h.total_debt)}</td><td>${formatBig(h.free_cash_flow)}</td><td>${formatBig(h.operating_cash_flow)}</td></tr>`;
        });
        rows += `</tbody></table></div>`;
      }
      const hfr = financials.historical_financial_ratio;
      if (hfr?.length) {
        rows += subHead("Financial Ratios");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>ROA</th><th>ROE</th><th>Debt/Asset</th><th>Debt/Equity</th><th>Net Margin</th><th>Net Int. Margin</th><th>Cost/Income</th><th>Asset Turnover</th><th>CASA</th><th>L/D Ratio</th></tr></thead><tbody>`;
        [...hfr].sort((a, b) => Number(b.year) - Number(a.year)).forEach(h => {
          const p = h.profitability || {}, l = h.leverage || {}, li = h.liquidity || {}, ef = h.efficiency || {};
          rows += `<tr><td>${escHtml(String(h.year ?? "—"))}</td><td>${formatPct(p.roa)}</td><td>${formatPct(p.roe)}</td><td>${l.debt_to_asset_ratio?.toFixed(4) ?? "—"}</td><td>${l.debt_to_equity_ratio?.toFixed(2) ?? "—"}</td><td>${formatPct(p.net_profit_margin)}</td><td>${formatPct(p.net_interest_margin)}</td><td>${formatPct(p.cost_to_income_ratio)}</td><td>${ef.total_asset_turnover?.toFixed(3) ?? "—"}</td><td>${formatPct(li.casa_ratio)}</td><td>${formatPct(li.loan_to_deposit_ratio)}</td></tr>`;
        });
        rows += `</tbody></table></div>`;
      }
    }
    const heps = financials.historical_eps;
    if (heps && Object.keys(heps).length) {
      rows += subHead("Historical EPS");
      rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>EPS</th><th>Growth</th></tr></thead><tbody>`;
      Object.entries(heps).sort((a, b) => Number(b[0]) - Number(a[0])).forEach(([yr, v]) => {
        rows += `<tr><td>${escHtml(yr)}</td><td>${currency} ${formatNum(v.eps)}</td><td>${v.eps_growth != null ? formatPct(v.eps_growth) : "—"}</td></tr>`;
      });
      rows += `</tbody></table></div>`;
    }
    if (isSgx) {
      const hfs = financials.historical_financials;
      if (hfs && Object.keys(hfs).length) {
        rows += subHead("Historical Financials");
        rows += `<div class="st-table-wrap"><table class="st-table"><thead><tr><th>Year</th><th>Revenue</th><th>Earnings</th><th>Total Assets</th><th>Total Equity</th><th>Total Liabilities</th><th>Total Debt</th><th>Op. CF</th><th>Free CF</th><th>CapEx</th></tr></thead><tbody>`;
        Object.entries(hfs).sort((a, b) => Number(b[0]) - Number(a[0])).forEach(([yr, h]) => {
          const cf = h.cash_flow_metrics || {}, bs = h.balance_sheet_metrics || {};
          rows += `<tr><td>${escHtml(yr)}</td><td>${formatBig(h.revenue)}</td><td>${formatBig(h.earnings)}</td><td>${formatBig(bs.total_asset)}</td><td>${formatBig(bs.total_equity)}</td><td>${formatBig(bs.total_liabilities)}</td><td>${formatBig(bs.total_debt)}</td><td>${formatBig(cf.operating_cash_flow)}</td><td>${formatBig(cf.free_cash_flow)}</td><td>${formatBig(cf.capital_expenditure)}</td></tr>`;
        });
        rows += `</tbody></table></div>`;
        // SGX deep-dive (year with most detailed data). Ascending here is only
        // for tie-breaking the latest year below; the table itself is descending.
        const years = Object.keys(hfs).sort();
        // Pick the most detailed year, preferring the latest on a tie: newer
        // years can carry fields older ones lack (e.g. total_common_shares).
        const latestYear = years.reduce((best, yr) => {
          const h = hfs[yr];
          const score = Object.keys(h.income_stmt_metrics || {}).length
            + (h.income_stmt_metrics?.int_income_breakdown?.length || 0)
            + (h.income_stmt_metrics?.operating_expense_breakdown?.length || 0)
            + (h.industry_breakdown ? 10 : 0);
          return score >= best.score ? { year: yr, score } : best;
        }, { year: years[0], score: -1 }).year;
        const latest = hfs[latestYear];
        if (latest) {
          const inc = latest.income_stmt_metrics || {}, bs = latest.balance_sheet_metrics || {}, cf = latest.cash_flow_metrics || {}, eb = latest.employee_breakdown || {};
          const incKeys = [["interest_income","Interest Income"],["interest_expense","Interest Expense"],["net_interest_income","Net Interest Income"],["net_trading_income","Net Trading Income"],["net_fee_and_commission_income","Net Fee & Commission"],["other_non_interest_income","Other Non-Interest Income"],["operating_income","Operating Income"],["operating_expense","Operating Expense"],["non_operating_income_or_loss","Non-Op Income/Loss"],["pretax_income","Pretax Income"],["income_taxes","Income Taxes"],["net_income_after_taxes","Net Income After Taxes"],["minorities","Minorities"],["allowances_for_credit_and_other_losses","Allowances for Credit Losses"],["diluted_shares_outstanding","Diluted Shares"],["amortization_of_intangible_assets","Amortization"],["depreciation","Depreciation"]];
          let incRows = "";
          incKeys.forEach(([k, label]) => { if (inc[k] != null) incRows += kvRow(label, formatBig(inc[k])); });
          if (inc.int_income_breakdown?.length) { incRows += breakdownSection("Interest Income Breakdown", inc.int_income_breakdown); }
          if (inc.operating_expense_breakdown?.length) { incRows += breakdownSection("Op. Expense Breakdown", inc.operating_expense_breakdown); }
          if (incRows) rows += subHead(`${latestYear} Income Statement`) + incRows;
          const bsKeys = [["total_asset","Total Assets"],["total_equity","Total Equity"],["total_liabilities","Total Liabilities"],["cash","Cash"],["short_term_investments","Short-Term Investments"],["total_debt","Total Debt"],["total_common_shares","Total Common Shares"],["total_capital","Total Capital"],["gross_loan","Gross Loan"],["net_loan","Net Loan"],["total_deposit","Total Deposit"],["time_deposit","Time Deposit"],["current_account","Current Account"],["savings_account","Savings Account"],["earning_asset","Earning Asset"],["non_loan_asset","Non-Loan Asset"],["credit_rwa","Credit RWA"],["market_rwa","Market RWA"],["operational_rwa","Operational RWA"],["total_risk_weighted_asset","Total RWA"],["core_capital_tier1","Core Capital Tier 1"],["supplementary_capital_tier2","Supp. Capital Tier 2"],["allowance_for_loans","Allowance for Loans"],["non_interest_bearing_liabilities","Non-Interest Bearing Liab."],["other_interest_bearing_liabilities","Other Interest Bearing Liab."]];
          let bsRows = "";
          bsKeys.forEach(([k, label]) => { if (bs[k] != null) bsRows += kvRow(label, formatBig(bs[k])); });
          if (bsRows) rows += subHead(`${latestYear} Balance Sheet`) + bsRows;
          const cfKeys = [["operating_cash_flow","Operating CF"],["investing_cash_flow","Investing CF"],["financing_cash_flow","Financing CF"],["free_cash_flow","Free CF"],["net_cash_flow","Net CF"],["capital_expenditure","CapEx"],["effect_of_exchange_rate_changes","FX Effect"]];
          let cfRows = "";
          cfKeys.forEach(([k, label]) => { if (cf[k] != null) cfRows += kvRow(label, formatBig(cf[k])); });
          if (cfRows) rows += subHead(`${latestYear} Cash Flow`) + cfRows;
          if (eb.total_employee) rows += kvRow("Employees", formatNum(eb.total_employee));
          const ind = latest.industry_breakdown;
          if (ind) {
            if (ind.customer_breakdown) { rows += breakdownSection(`${latestYear} Customer Breakdown`, ind.customer_breakdown); }
            if (ind.loan_by_economic_sectors) { rows += breakdownSection(`${latestYear} Loans by Economic Sector`, ind.loan_by_economic_sectors); }
            if (ind.non_loan_asset?.length) { rows += breakdownSection(`${latestYear} Non-Loan Assets`, ind.non_loan_asset); }
          }
        }
      }
      const sf = financials.self_financial_info;
      if (sf) {
        rows += subHead("Latest Snapshot");
        if (sf.financials_latest_date) rows += kvRow("Latest Date", String(sf.financials_latest_date).split("T")[0]);
        [["total_revenue","Revenue (TTM)"],["profit_and_loss","Earnings (TTM)"],["total_assets","Total Assets"],["total_equity","Total Equity"],["total_liabilities","Total Liabilities"],["market_cap","Market Cap"]].forEach(([k, label]) => {
          if (sf[k] != null) rows += kvRow(label, formatBig(sf[k]));
        });
        [["pe_ttm","P/E (TTM)"],["pb_mrq","P/B (MRQ)"],["ps_ttm","P/S (TTM)"],["dar_mrq","Debt/Assets (MRQ)"],["der_mrq","Debt/Equity (MRQ)"]].forEach(([k, label]) => {
          if (sf[k] != null) rows += kvRow(label, Number(sf[k]).toFixed(2));
        });
        [["roa_ttm","ROA (TTM)"],["roe_ttm","ROE (TTM)"],["yearly_mcap_chg","1Y Market Cap Change"]].forEach(([k, label]) => {
          if (sf[k] != null) rows += kvRow(label, formatPct(sf[k]));
        });
      }
    }
    return rows ? `<details class="st-collapsible"><summary>Financials</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildManagement(r) {
    if (!r.management) return "";
    let html = "";
    const sgxCurrent = r.management.management;
    const sgxFormer = r.management.former_management;
    if (Array.isArray(sgxCurrent) || Array.isArray(sgxFormer)) {
      const current = sgxCurrent || [];
      const former = sgxFormer || [];
      if (current.length > 0) {
        const rows = current.map(e => {
          const meta = [];
          if (e.age != null) meta.push(`age ${escHtml(String(e.age))}`);
          if (e.start_date) meta.push(`since ${escHtml(e.start_date.split("T")[0])}`);
          const suffix = meta.length ? ` <span class="st-mgmt-meta">(${meta.join(", ")})</span>` : "";
          return kvRowHtml(e.position || "—", `${escHtml(e.name || "—")}${suffix}`);
        }).join("");
        html += `<details class="st-collapsible"><summary>Key Executives (${current.length})</summary><div class="st-detail-body">${rows}</div></details>`;
      }
      if (former.length > 0) {
        const rows = former.map(e => {
          const until = e.end_date ? ` <span class="st-mgmt-meta">(until ${escHtml(e.end_date.split("T")[0])})</span>` : "";
          return kvRowHtml(e.position || "—", `${escHtml(e.name || "—")}${until}`);
        }).join("");
        html += `<details class="st-collapsible"><summary>Former Executives (${former.length})</summary><div class="st-detail-body">${rows}</div></details>`;
      }
      return html;
    }
    const execs = r.management.key_executives || [];
    const holdings = r.management.executives_shareholdings || [];
    if (execs.length > 0) {
      const rows = execs.map(e => kvRow(e.position, e.name)).join("");
      html += `<details class="st-collapsible"><summary>Key Executives (${execs.length})</summary><div class="st-detail-body">${rows}</div></details>`;
    }
    if (holdings.length > 0) {
      const rows = holdings.map(h => kvRow(h.name, `${formatNum(h.share_amount)} shares (${formatPct(h.share_percentage, 3)})`)).join("");
      html += `<details class="st-collapsible"><summary>Executive Shareholdings (${holdings.length})</summary><div class="st-detail-body">${rows}</div></details>`;
    }
    return html;
  }

  function buildFuture(r, currency) {
    if (r.isSgx || !r.future) return "";
    let rows = "";
    const forecasts = r.future.company_value_forecasts || [];
    const growth = r.future.company_growth_forecasts || [];
    const analysts = r.future.analyst_rating_breakdown;
    forecasts.filter(f => f.estimate_year).sort((a, b) => Number(b.estimate_year) - Number(a.estimate_year)).forEach(f => {
      rows += kvRow(`${f.estimate_year} EPS Est.`, currency + " " + formatNum(f.eps_estimate));
      rows += kvRow(`${f.estimate_year} Rev Est.`, formatBig(f.revenue_estimate));
    });
    forecasts.filter(f => f.financial_year && !f.estimate_year).sort((a, b) => Number(b.financial_year) - Number(a.financial_year)).forEach(f => {
      rows += kvRow(`${f.financial_year} Actual EPS`, currency + " " + formatNum(f.eps));
      rows += kvRow(`${f.financial_year} Total Revenue`, formatBig(f.total_revenue));
      rows += kvRow(`${f.financial_year} Total Assets`, formatBig(f.total_assets));
      rows += kvRow(`${f.financial_year} Total Equity`, formatBig(f.total_equity));
    });
    growth.filter(g => g.estimate_year).sort((a, b) => Number(b.estimate_year) - Number(a.estimate_year)).forEach(g => {
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
    return rows ? `<details class="st-collapsible"><summary>Forecasts & Analyst Ratings</summary><div class="st-detail-body">${rows}</div></details>` : "";
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
      if (dividend.yield_ttm != null) rows += kvRow("Yield TTM", formatPct(dividend.yield_ttm));
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
          [...hd].sort((a, b) => Number(b.year) - Number(a.year)).slice(0, 10).forEach(d => {
            rows += `<tr><td>${escHtml(String(d.year ?? "—"))}</td><td>${d.total_dividend != null ? currency + " " + d.total_dividend.toFixed(2) : "—"}</td><td>${d.total_yield != null ? formatPct(d.total_yield) : "—"}</td><td>${d.breakdown?.length ?? 0}</td></tr>`;
          });
        } else {
          Object.entries(hd).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 10).forEach(([yr, d]) => {
            rows += `<tr><td>${escHtml(yr)}</td><td>${d.total_dividend != null ? currency + " " + d.total_dividend.toFixed(2) : "—"}</td><td>${d.total_yield != null ? formatPct(d.total_yield) : "—"}</td><td>${d.breakdown?.length ?? 0}</td></tr>`;
          });
        }
        rows += `</tbody></table></div>`;
      }
    }
    const ud = dividend.upcoming_dividends;
    if (ud?.length) {
      rows += subHead("Upcoming Dividends");
      // Upcoming events read next-first; historical tables are latest-first.
      [...ud].sort((a, b) => String(a.ex_date || a.date || "").localeCompare(String(b.ex_date || b.date || ""))).forEach(d => {
        const date = d.ex_date || d.date || "—";
        const amount = d.dividend_amount ?? d.amount;
        const meta = d.payment_date ? `, paid ${escHtml(d.payment_date)}` : d.type ? ` (${escHtml(d.type)})` : "";
        rows += kvRow(date, amount != null ? `${currency} ${formatNum(amount)}${meta}` : "—");
      });
    }
    return rows ? `<details class="st-collapsible"><summary>${isSgx ? "Dividends" : "Dividend Detail"}</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildOwnership(r) {
    if (!r.ownership) return "";
    let rows = "";
    if (r.ownership.whale_investors?.length) rows += kvRow("Whale Investors", r.ownership.whale_investors.join(", "));
    if (r.ownership.conglomerates_group?.length) rows += kvRow("Conglomerate Groups", r.ownership.conglomerates_group.join(", "));
    // Canonical list: IDX and SGX both expose `major_shareholders`; SGX also
    // returns a plain `shareholders` array, which would duplicate these rows.
    const shareholders = r.ownership.major_shareholders || [];
    if (shareholders.length > 0) {
      rows += subHead("Major Shareholders");
      shareholders.forEach(s => {
        const rawPct = s.share_percentage == null ? NaN : parseFloat(s.share_percentage);
        const pct = isNaN(rawPct) ? "—" : `${(rawPct * 100).toFixed(2)}%`;
        const value = s.share_value != null ? ` (${formatBig(s.share_value)})` : "";
        rows += kvRow(s.name, `${pct}${value}`);
      });
    }
    // SGX also returns a full `shareholders` register. Show holders that are
    // not already in `major_shareholders` so no available row is dropped.
    const allShareholders = r.ownership.shareholders || [];
    const seen = new Set(shareholders.map(s => s.name));
    const extras = allShareholders.filter(s => !seen.has(s.name));
    if (extras.length > 0) {
      rows += subHead("Other Shareholders");
      extras.forEach(s => {
        const rawPct = s.share_percentage == null ? NaN : parseFloat(s.share_percentage);
        const pct = isNaN(rawPct) ? "—" : `${(rawPct * 100).toFixed(2)}%`;
        const amount = s.share_amount != null ? ` (${formatNum(s.share_amount)} shares)` : "";
        rows += kvRow(s.name, `${pct}${amount}`);
      });
    }
    const txns = r.ownership.top_transactions;
    if (txns?.top_buyers?.length) { rows += subHead("Top Buyers"); txns.top_buyers.forEach(b => { rows += kvRow(b.name, `+${formatBig(b.changeAmount)}`); }); }
    if (txns?.top_sellers?.length) { rows += subHead("Top Sellers"); txns.top_sellers.forEach(s => { rows += kvRow(s.name, formatBig(s.changeAmount)); }); }
    const instFlow = r.ownership.institutional_transaction_flow || [];
    if (instFlow.length > 0) {
      rows += subHead("Institutional Transaction Flow");
      [...instFlow].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).forEach(i => { rows += kvRow(i.date, `${i.net_transaction >= 0 ? '+' : ''}${formatBig(i.net_transaction)}`); });
    }
    return rows ? `<details class="st-collapsible"><summary>Ownership & Transactions</summary><div class="st-detail-body">${rows}</div></details>` : "";
  }

  function buildScoring(r) {
    if (r.isSgx || !r.peers?.length) return "";
    const selfPeer = r.peers[0]?.peers_data?.companies?.find(c => c.group?.includes("self"));
    const ps = selfPeer?.point_summaries;
    if (!ps?.length) return "";
    const rows = ps.map(s => s.name ? kvRow(s.name.charAt(0).toUpperCase() + s.name.slice(1), `${s.point} / ${s.maxpoint}`) : "").join("");
    return rows ? `<details class="st-collapsible"><summary>Scoring</summary><div class="st-detail-body">${rows}</div></details>` : "";
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
      if (rows) html += `<details class="st-collapsible"><summary>Peer Group Context</summary><div class="st-detail-body">${rows}</div></details>`;
    }
    const selfPeer = pd?.companies?.find(c => c.group?.includes("self"));
    if (selfPeer) {
      let rows = "";
      if (selfPeer.int_income_breakdown?.length) { rows += breakdownSection("Interest Income Breakdown", selfPeer.int_income_breakdown); }
      if (selfPeer.operating_expense_breakdown?.length) { rows += breakdownSection("Operating Expense Breakdown", selfPeer.operating_expense_breakdown); }
      if (selfPeer.revenue_breakdown) { rows += breakdownSection("Revenue Breakdown", selfPeer.revenue_breakdown, "category"); }
      if (rows) html += `<details class="st-collapsible"><summary>Revenue & Expense Breakdown</summary><div class="st-detail-body">${rows}</div></details>`;
    }
    return html;
  }

  // SGX serializes ownership as nested objects: interest_breakdown.before/after
  // .total = {amount, percentage}, and those percentages are fractions
  // (0.0813 = 8.13%). Flatten them to the scalar fields the renderers expect;
  // IDX payloads already use plain percentages. The generated title/body
  // summaries are dropped for both exchanges.
  function normaliseFilings(filingsPayload, isSgx) {
    if (!filingsPayload || !Array.isArray(filingsPayload.results)) return filingsPayload;
    const results = filingsPayload.results.map((f) => {
      if (!f) return f;
      const base = { ...f };
      delete base.title;
      delete base.body;
      if (!isSgx) return base;

      const breakdown = f.interest_breakdown || {};
      const before = breakdown.before?.total || {};
      const after = breakdown.after?.total || {};
      const beforeAmount = isFiniteNumber(before.amount) ? Number(before.amount) : null;
      const afterAmount = isFiniteNumber(after.amount) ? Number(after.amount) : null;
      const delta = beforeAmount != null && afterAmount != null ? afterAmount - beforeAmount : null;
      const txAmount = delta != null ? Math.abs(delta) : null;
      const txValue = isFiniteNumber(f.transaction_value) ? Number(f.transaction_value) : null;
      const pps = Array.isArray(f.price_per_share) && f.price_per_share.length
        ? Number(f.price_per_share[0]?.price)
        : null;
      const price = isFiniteNumber(f.price)
        ? Number(f.price)
        : txValue != null && txAmount != null && txAmount > 0
          ? txValue / txAmount
          : isFiniteNumber(pps) && pps > 0
            ? pps
            : null;
      const pctTx = f.share_percentage_transaction;
      const pctTxTotal = pctTx && typeof pctTx === "object" ? pctTx.total : pctTx;
      const date = f.timestamp ? String(f.timestamp).split("T")[0] : null;
      const priceTransactions = Array.isArray(f.price_per_share)
        ? f.price_per_share
            .map(p => ({ date, amount: p?.amount, price: p?.price }))
            .filter(p => isFiniteNumber(p.price) || isFiniteNumber(p.amount))
        : f.price_transaction;
      return {
        ...base,
        amount_transaction: isFiniteNumber(f.amount_transaction)
          ? f.amount_transaction
          : txAmount != null && txAmount > 0 ? txAmount : null,
        price,
        holding_before: isFiniteNumber(f.holding_before) ? f.holding_before : beforeAmount,
        holding_after: isFiniteNumber(f.holding_after) ? f.holding_after : afterAmount,
        share_percentage_before: isFiniteNumber(before.percentage) ? Number(before.percentage) * 100 : null,
        share_percentage_after: isFiniteNumber(after.percentage) ? Number(after.percentage) * 100 : null,
        share_percentage_transaction: isFiniteNumber(pctTxTotal) ? Number(pctTxTotal) * 100 : null,
        price_transaction: priceTransactions,
      };
    });
    return { ...filingsPayload, results };
  }

  globalThis.SectorsRender = {
    escHtml, safeHref, formatNum, formatBig, formatPct,
    kvRow, kvRowHtml, subHead, normaliseFilings,
    titleCase, filingHeadline, buildFilingExtra,
    buildOverview, buildValuation, buildPeersComparison, buildFinancials,
    buildManagement, buildFuture, buildDividend, buildOwnership,
    buildScoring, buildPeerGroup,
  };
})();
