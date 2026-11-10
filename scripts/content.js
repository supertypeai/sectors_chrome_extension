// content.js — Ticker Hover Detection & Tooltip

(function () {
  "use strict";

  const {
    escHtml, safeHref, formatNum, formatBig, formatPct,
    kvRow, kvRowHtml, subHead, normaliseFilings,
    titleCase, filingHeadline, buildFilingExtra,
    buildOverview, buildValuation, buildPeersComparison, buildFinancials,
    buildManagement, buildFuture, buildDividend, buildOwnership, buildScoring, buildPeerGroup,
  } = globalThis.SectorsRender;

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
  const CACHE_TTL_MS = 3600000;
  const DEFAULT_HOVER_DELAY = 120;
  const HIDE_DELAY_MS = 400;

  // Sector name (IDX + SGX taxonomies) → bundled SVG slug.
  const SECTOR_ICON_MAP = {
    "basic materials": "basic_materials",
    "consumer cyclicals": "consumer_cyclicals",
    "consumer non-cyclicals": "consumer_non_cyclicals",
    "consumer defensive": "consumer_non_cyclicals",
    "energy": "energy",
    "financials": "financials",
    "financial services": "financials",
    "healthcare": "healthcare",
    "industrials": "industrials",
    "infrastructures": "infrastructures",
    "infrastructure": "infrastructures",
    "utilities": "infrastructures",
    "properties & real estate": "properties_real_estate",
    "properties and real estate": "properties_real_estate",
    "reit": "properties_real_estate",
    "technology": "technology",
    "communication services": "technology",
    "transportation & logistic": "transportation_logistic",
    "transportation & logistics": "transportation_logistic",
    "other": "industrials",
  };

  let hasApiKey = false;
  let hoverDelay = DEFAULT_HOVER_DELAY;
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
          <img class="st-sector-icon" id="st-sector-icon" alt="" />
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

  function setSectorIcon(sector, tip) {
    const el = (tip || tooltip)?.querySelector("#st-sector-icon");
    if (!el) return;
    const key = String(sector || "").toLowerCase().trim().replace(/\s+/g, " ");
    const slug = SECTOR_ICON_MAP[key];
    if (!slug || typeof chrome === "undefined" || !chrome.runtime?.id) {
      el.removeAttribute("src");
      el.style.display = "none";
      el.alt = "";
      return;
    }
    el.src = chrome.runtime.getURL(`icons/sectors/${slug}.svg`);
    el.style.display = "block";
    el.alt = `${sector} sector`;
  }

  // ── Show / Hide ────────────────────────────────────────────────────────────
  function showTooltip(x, y, symbol) {
    lastX = x;
    lastY = y;
    clearTimeout(hideTimeout);
    const tip = getTooltip();
    if (!tip) return;
    tip.querySelector("#st-ticker-badge").textContent = symbol;
    setSectorIcon(null, tip);
    
    if (!hasApiKey) {
      tip.querySelector("#st-content").innerHTML = `
        <div class="st-error">
          <div class="st-error-icon"></div>
          <p>No API key set.</p>
          <button class="st-btn" id="st-open-options">Open Settings</button>
        </div>`;
      tip.querySelector("#st-open-options")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
      });
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
    const rect = tip.getBoundingClientRect();
    const tw = rect.width;
    const th = rect.height;

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
    }, HIDE_DELAY_MS);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
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
      content.querySelector("#st-open-options")?.addEventListener("click", () => {
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
        content.innerHTML = `<div class="st-error"><div class="st-error-icon"></div><p>API key exhausted.</p><a href="https://sectors.app/api" target="_blank" rel="noopener noreferrer" class="st-btn-link">Manage Key at sectors.app/api</a></div>`;
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
    const filings = normaliseFilings(data.filings, !!data.isSgx)?.results || [];
    const isSgx = !!data.isSgx;
    const currency = isSgx ? "SGD" : "IDR";
    let html = "";

    // ════════════════════════════════════════════════════════════════════════
    // SUMMARY CARD
    // ════════════════════════════════════════════════════════════════════════
    if (r) {
      const overview = r.overview || {};
      setSectorIcon(overview.sector, tip);
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
        // SGX: Overview, Financials, Valuation, Dividends, Management, Ownership
        html += buildOverview(overview, isSgx, currency);
        html += buildFinancials(financials, isSgx, currency);
        html += buildValuation(valuation, isSgx, currency);
        html += buildDividend(dividend, isSgx, currency);
        html += buildManagement(rForSections);
        html += buildOwnership(rForSections);
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
          const date = f.timestamp ? f.timestamp.split("T")[0] : "—";
          const headline = filingHeadline(f, currency);
          const filingExtra = buildFilingExtra(f, currency);

          html += `
            <div class="st-filing">
              <div class="st-filing-top">
                <span class="st-tx-badge ${txClass}">${escHtml(titleCase(f.transaction_type || "—"))}</span>
                <span class="st-filing-date">${escHtml(date)}</span>
              </div>
              <div class="st-filing-holder">${escHtml(f.holder_name || "—")}</div>
              ${headline.detail || headline.value ? `<div class="st-filing-detail">${headline.detail ? `<span>${headline.detail}</span>` : "<span></span>"}${headline.value ? `<span class="st-filing-val">${headline.value}</span>` : ""}</div>` : ""}
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
            <input type="text" id="st-ai-query" aria-label="Ask the Sectors AI screener" placeholder="Ask about competitors of ${escHtml(data.symbol)}..." />
            <button id="st-btn-ask" title="Send Query" aria-label="Send query"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h13M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
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
        <a href="${escHtml(sectorsUrl)}" target="_blank" rel="noopener noreferrer" class="st-ext-link">Open in sectors.app</a>
        <a href="${aiChatUrl}" target="_blank" rel="noopener noreferrer" class="st-ext-link st-chat-link">Sectors AI Chat</a>
      </div>`;

    content.innerHTML = html;
    positionTooltip(tip, lastX, lastY);

    // ── Chat listeners ──
    const input = content.querySelector("#st-ai-query");
    const btn = content.querySelector("#st-btn-ask");
    const output = content.querySelector("#st-chat-output");

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

    const suggestionContainer = content.querySelector("#st-suggestions");
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
  const TICKER_RECT_CACHE_MS = 250;
  let tickerRectCache = new WeakMap();

  // Layout changes move text; drop cached rects on scroll/resize.
  window.addEventListener("scroll", () => { tickerRectCache = new WeakMap(); }, { passive: true, capture: true });
  window.addEventListener("resize", () => { tickerRectCache = new WeakMap(); }, { passive: true });

  function collectTickerRects(el) {
    const matches = [];
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
          const rects = [];
          const list = range.getClientRects();
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            rects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
          }
          if (rects.length) matches.push({ symbol: finalSymbolToReturn, rects });
        } catch (err) {
          // Node detached or mutated during the text walk; skip this range.
        }
      }
    }
    return matches;
  }

  function tickerRectsFor(el) {
    const now = Date.now();
    const cached = tickerRectCache.get(el);
    if (cached && now - cached.ts < TICKER_RECT_CACHE_MS) return cached.matches;
    FAST_TICKER_REGEX.lastIndex = 0;
    const matches = FAST_TICKER_REGEX.test(el.textContent) ? collectTickerRects(el) : [];
    tickerRectCache.set(el, { ts: now, matches });
    return matches;
  }

  function getTickerUnderCursor(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.id === "sectors-tooltip" || el.closest("#sectors-tooltip")) {
      return currentSymbol;
    }
    const matches = tickerRectsFor(el);
    for (const m of matches) {
      for (const r of m.rects) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return m.symbol;
        }
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
          if (currentSymbol !== symbol) return;
          if (!response) { renderData({ error: "No response from extension" }); return; }
          renderData(response.error ? { error: response.error } : response);
        });
        return;
      }
      if (isContextInvalid || !chrome.runtime?.id) return;

      try {
        chrome.storage.local.get([CACHE_KEY], (result) => {
          if (chrome.runtime.lastError) { isContextInvalid = true; return; }
          const cache = result[CACHE_KEY] || {};
          if (cache[symbol] && (Date.now() - cache[symbol].timestamp < CACHE_TTL_MS)) {
            renderData(cache[symbol].data);
            return;
          }
          safeSendMessage({ type: "FETCH_TICKER_DATA", symbol }, (response) => {
            if (currentSymbol !== symbol) return;
            if (!response) { renderData({ error: "No response from extension" }); return; }
            if (response.error) { renderData({ error: response.error }); return; }
            const updatedData = response;
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
