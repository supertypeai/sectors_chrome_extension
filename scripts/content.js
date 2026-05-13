// content.js — IDX Ticker Hover Detection & Tooltip

(function () {
  "use strict";

  // Updated regex:
  // 1. IDX tickers: 4 uppercase letters, optional suffix
  // 2. SGX tickers: 1-4 alphanumeric, mandatory .SI suffix
  // 3. Case-insensitive GoTo
  // SGX Enabled Regex (for future use):
  const TICKER_REGEX = /\b(?:([A-Z0-9]{1,4})\.(?:SI|si)|([A-Z]{4,5})(?:\.(?:JK|IJ|ID|jk|ij|id))?|(GoTo|goto|GOTO))\b/gi;

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
    // Temporarily show to measure
    tip.style.visibility = "hidden";
    tip.style.display = "block";
    tip.classList.add("st-visible");

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;

    // Position relative to viewport (clientX/Y)
    // but the coordinates passed are pageX/Y usually.
    // Let's assume x, y are page coordinates.
    
    let left = x + 12;
    let top = y + 12;

    // Check right edge
    if (left + tw > scrollX + vw - 20) {
      left = x - tw - 12;
    }
    // Check bottom edge
    if (top + th > scrollY + vh - 20) {
      top = y - th - 12;
    }

    // Sanity bounds
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
    }, 400); // slightly longer buffer
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
          <p style="font-size:12px; margin-top:4px;">${escHtml(data.symbol)} does not exist on ${data.isSgx ? 'SGX' : 'IDX'}.</p>
        </div>`;
      return;
    }

    if (data.error) {
      const isExhausted = data.error.includes("403") || data.error.toLowerCase().includes("exhausted");
      const isRateLimited = data.error.includes("429") || data.error.toLowerCase().includes("rate limit");
      
      if (isExhausted) {
        content.innerHTML = `
          <div class="st-error">
            <div class="st-error-icon"></div>
            <p>API key exhausted.</p>
            <a href="https://sectors.app/api" target="_blank" class="st-btn-link">Manage Key at sectors.app/api</a>
          </div>`;
        return;
      }
      if (isRateLimited) {
        content.innerHTML = `
          <div class="st-error">
            <div class="st-error-icon"></div>
            <p>Rate limit exceeded.</p>
            <p style="font-size:12px; margin-top:4px;">Slow down or upgrade your key.</p>
          </div>`;
        return;
      }
      content.innerHTML = `<div class="st-error"><div class="st-error-icon"></div><p>${escHtml(data.error)}</p></div>`;
      return;
    }

    const r = data.report;
    const filings = data.filings?.results || [];

    let html = "";

    // ── Summary Card ──
    if (r && r.overview) {
      const overview = r.overview;
      const exchange = data.isSgx ? "SGX" : "IDX";
      const currency = data.isSgx ? "SGD" : "IDR";
      // Try multiple possible price fields
      const price = overview.last_close_price || overview.close_price || overview.price || null;
      
      html += `
        <div class="st-section st-ai-chat-card">
          <span class="st-ai-label">Quick summary</span>
          <p class="st-ai-text">
            <strong>${escHtml(r.name || data.symbol)}</strong> is a <strong>${escHtml(overview.sector || overview.industry || '—')}</strong> company listed on ${exchange}. 
            Currently trading at <strong>${currency} ${formatNum(price)}</strong> with a market cap of ${formatBig(overview.market_cap)}.
            It operates in the ${escHtml(overview.sub_sector || '—')} space.
          </p>
        </div>`;
    }

    // ── Company Details ──
    if (r) {
      const overview = r.overview || {};
      const valuation = r.valuation || {};
      const dividend = r.dividend || {};
      
      let pe = "—", pb = "—", dy = "—";
      
      if (data.isSgx) {
        pe = valuation.pe || "—";
        pb = valuation.pb || "—";
        dy = dividend.forward_dividend_yield || dividend.dividend_ttm || "—";
      } else {
        const selfPeer = r.peers?.[0]?.peers_data?.companies?.find(c => c.group?.includes("self"));
        pe = selfPeer?.pe_ttm || valuation.pe_ttm || r.pe_ttm || overview.pe_ttm || valuation.pe || "—";
        pb = selfPeer?.pb_mrq || valuation.pb_mrq || r.pb_mrq || overview.pb_mrq || valuation.pb || "—";
        dy = r.dividend?.yield_ttm || overview.yield_ttm || r.yield_ttm || "—";
      }

      const currency = data.isSgx ? "SGD" : "IDR";
      const rawPrice = overview.last_close_price || overview.close_price || overview.price || null;
      const price = rawPrice !== null
        ? `${currency} ${formatNum(rawPrice)}`
        : "—";
        
      const dailyChange = data.isSgx ? (overview.change_1d || 0) : (overview.daily_close_change || 0);
      const changeStr = `${(dailyChange * 100).toFixed(2)}%`;
      const changeClass = dailyChange >= 0 ? "st-positive" : "st-negative";
      
      html += `
        <div class="st-section st-details">
          <div class="st-company-name-large">${escHtml(r.name || overview.company_name || data.symbol)}</div>
          <div class="st-meta-row">
            <span class="st-tag">${escHtml(overview.sector || "")}</span>
            <span class="st-tag">${escHtml(overview.sub_sector || "")}</span>
          </div>
          <div class="st-price-row-large">
            <span class="st-price-val">${price}</span>
            <span class="st-price-change ${changeClass}">${changeStr}</span>
          </div>
          <div class="st-metric-grid">
            <div class="st-metric">
              <span class="st-metric-k">MKT CAP</span>
              <span class="st-metric-v">${overview.market_cap ? currency + ' ' + formatBig(overview.market_cap) : '—'}</span>
            </div>
            <div class="st-metric">
              <span class="st-metric-k">P/E ${data.isSgx ? '' : '(TTM)'}</span>
              <span class="st-metric-v">${pe !== "—" ? Number(pe).toFixed(2) : "—"}</span>
            </div>
            <div class="st-metric">
              <span class="st-metric-k">P/B ${data.isSgx ? '' : '(MRQ)'}</span>
              <span class="st-metric-v">${pb !== "—" ? Number(pb).toFixed(2) : "—"}</span>
            </div>
            <div class="st-metric">
              <span class="st-metric-k">DIV YIELD</span>
              <span class="st-metric-v">${dy !== "—" ? (Number(dy) * 100).toFixed(2) + '%' : '—'}</span>
            </div>
          </div>
        </div>`;
    } else {
      html += `<div class="st-section st-details"><div class="st-company-name-large">${escHtml(data.symbol)}</div><p class="st-dim">Company report unavailable</p></div>`;
    }

    // ── Insider Filings (IDX only) ──
    const currency = data.isSgx ? "SGD" : "IDR";
    if (!data.isSgx) {
      html += `<div class="st-section"><div class="st-section-title">RECENT INSIDER FILINGS</div>`;
      if (filings.length === 0) {
        html += `<p class="st-dim"><em>No recent filings</em></p>`;
      } else {
        filings.forEach((f) => {
          const txClass = f.transaction_type === "buy" ? "st-buy" : "st-sell";
          const txIcon = f.transaction_type === "buy" ? "▲" : "▼";
          const val = f.transaction_value ? `${currency} ${formatBig(f.transaction_value)}` : "—";
          const date = f.timestamp ? f.timestamp.split("T")[0] : "—";
          html += `
            <div class="st-filing">
              <div class="st-filing-top">
                <span class="st-tx-badge ${txClass}">${txIcon} ${f.transaction_type?.toUpperCase()}</span>
                <span class="st-filing-date">${date}</span>
              </div>
              <div class="st-filing-holder">${escHtml(f.holder_name || "—")}</div>
              <div class="st-filing-detail">
                <span>${formatNum(f.amount_transaction)} shares @ ${currency} ${formatNum(f.price)}</span>
                <span class="st-filing-val">${val}</span>
              </div>
            </div>`;
        });
      }
      html += `</div>`;
    }

    // ── AI Chat Area (IDX Only) ──
    if (!data.isSgx) {
      html += `
        <div class="st-section st-chat-box">
          <div id="st-chat-output" class="st-chat-history"></div>
          <div class="st-suggestions" id="st-suggestions">
            <button class="st-suggest-btn" data-q="show me companies in the ${escHtml(r.overview?.sector || 'same')} sector with market_cap > ${r.overview?.market_cap || 0}">Sector Leaders</button>
            <button class="st-suggest-btn" data-q="show me companies in the ${escHtml(r.overview?.sector || 'same')} sector with pe_ttm < 15">Value Peers (P/E < 15)</button>
            <button class="st-suggest-btn" data-q="show me companies with revenue > 100000000000 in 2025 q2">High Revenue Peers</button>
            <button class="st-suggest-btn" data-q="list top dividend payers in the ${escHtml(r.overview?.sub_sector || 'same sector')}">Top Div Payers</button>
          </div>
          <div class="st-chat-input-wrap">
            <input type="text" id="st-ai-query" placeholder="Ask Screener about competitors of ${data.symbol}..." />
            <button id="st-btn-ask" title="Send Query">➔</button>
          </div>
          <p class="st-chat-hint">Sectors Company Screener API — natural language search</p>
        </div>`;
    }

    // ── Footer link ──
    const symbolSlug = data.symbol.split('.')[0].toLowerCase();
    const sectorsUrl = data.isSgx 
      ? `https://sectors.app/sgx/${symbolSlug}`
      : `https://sectors.app/idx/${symbolSlug}`;
    
    const aiChatUrl = data.isSgx
      ? `https://sectors.app/chat?symbol=${symbolSlug}&exchange=SGX`
      : `https://sectors.app/chat?symbol=${symbolSlug}`;

    html += `
      <div class="st-footer">
        <a href="${sectorsUrl}" target="_blank" class="st-ext-link">Open in sectors.app</a>
        <a href="${aiChatUrl}" target="_blank" class="st-ext-link st-chat-link">Sectors AI Chat</a>
      </div>`;

    content.innerHTML = html;
    
    // Re-position because height changed
    positionTooltip(tip, lastX, lastY);

    // Attach listeners
    const input = document.getElementById("st-ai-query");
    const btn = document.getElementById("st-btn-ask");
    const output = document.getElementById("st-chat-output");

    const sendQuery = (qOverride) => {
      const q = qOverride || input.value.trim();
      if (!q) return;
      
      // Append user bubble
      appendChatBubble(output, q, 'user');
      if (!qOverride) input.value = "";
      
      // Show thinking
      const thinking = appendChatBubble(output, "Thinking...", 'ai');
      
      safeSendMessage({ type: "FETCH_AI_RESULTS", query: q }, (res) => {
        if (res.error) {
          thinking.textContent = "Error: " + res.error;
        } else {
          let hasContent = false;
          let text = "";

          if (res.results && res.results.length > 0) {
            const companies = res.results.slice(0, 3);
            text = `I found ${res.results.length} results matching your query:\n\n`;
            
            companies.forEach(c => {
              const qv = c.query_values || {};
              let metrics = [];
              
              // Base metrics or fallback to query_values
              const price = c.last_close_price || qv.last_close_price;
              if (price) metrics.push(`Price: IDR ${formatNum(price)}`);
              
              const mcap = c.market_cap || qv.market_cap;
              if (mcap) metrics.push(`Mkt Cap: ${formatBig(mcap)}`);

              // Other specific query values
              Object.entries(qv).forEach(([key, val]) => {
                if (['symbol', 'last_close_price', 'market_cap'].includes(key)) return;
                const label = key.replace(/_/g, ' ').toUpperCase();
                metrics.push(`${label}: ${typeof val === 'number' ? formatNum(val) : val}`);
              });

              const metricsLine = metrics.length > 0 ? metrics.join(' | ') : 'No specific metrics found';
              text += `**${c.company_name} (${c.symbol})**\n${metricsLine}\n\n`;
            });
            
            if (res.results.length > 3) {
              text += `...and ${res.results.length - 3} more results.`;
            }
          } else {
            text = "Data is not available, please ask another question.";
          }

          thinking.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

          // Always handle includeQueries output if available
          if (res.queries && res.queries.length > 0) {
            const qHeader = document.createElement("div");
            qHeader.className = "st-related-queries-wrap";
            qHeader.innerHTML = `<p class="st-related-label">Explore related topics:</p>`;
            const qList = document.createElement("div");
            qList.className = "st-related-list";
            res.queries.slice(0, 3).forEach(rq => {
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
    input?.addEventListener("keydown", (e) => {
      if (e.key === 'Enter') sendQuery();
    });

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
  // Instead of wrapping nodes (risky), we do hover via mousemove on the document
  // and check if the hovered text node matches a ticker.

  function getTickerUnderCursor(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    
    // If hovering the tooltip itself, keep it alive
    if (el.id === "sectors-tooltip" || el.closest("#sectors-tooltip")) {
      return currentSymbol; 
    }

    // Optimization: If the element's text doesn't even look like it has a ticker, skip walking
    TICKER_REGEX.lastIndex = 0;
    if (!TICKER_REGEX.test(el.textContent)) {
      return null;
    }

    // Walk text nodes in the element
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      // Reset regex state
      TICKER_REGEX.lastIndex = 0;
      let match;
      while ((match = TICKER_REGEX.exec(text)) !== null) {
        try {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rects = range.getClientRects();
          
          for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            if (
              x >= rect.left &&
              x <= rect.right &&
              y >= rect.top &&
              y <= rect.bottom
            ) {
              // Return the full matched string so suffixes like .SI are preserved
              return match[0].toUpperCase();
            }
          }
        } catch (err) {
          // Range can fail if node is detached
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
        // Not over a ticker — schedule hide
        if (currentSymbol) scheduleHide();
        return;
      }
      if (symbol === currentSymbol) return; // same ticker, skip

      currentSymbol = symbol;
      showTooltip(px, py, symbol);

      // ── Cache Logic ──
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        // No storage available (e.g. local file or invalid context)
        safeSendMessage({ type: "FETCH_TICKER_DATA", symbol }, (response) => {
          if (currentSymbol === symbol) renderData(response.error ? { error: response.error } : response);
        });
        return;
      }
      if (isContextInvalid || !chrome.runtime?.id) return;
 
      try {
        chrome.storage.local.get([CACHE_KEY], (result) => {
          if (chrome.runtime.lastError) {
            isContextInvalid = true;
            return;
          }
          const cache = result[CACHE_KEY] || {};
          if (cache[symbol] && (Date.now() - cache[symbol].timestamp < 3600000)) { // 1 hour cache
            renderData(cache[symbol].data);
            return;
          }
 
          // Fetch fresh data
          safeSendMessage(
            { type: "FETCH_TICKER_DATA", symbol },
            (response) => {
              if (currentSymbol !== symbol) return; // user moved away
              if (response.error) {
                renderData({ error: response.error });
                return;
              }
              
              // Save to cache
              const updatedData = response || { error: "No response from extension" };
              renderData(updatedData);
              
              // Manage Cache Size (LRU-ish: newest first, trim to 10)
              const tickerList = Object.keys(cache).sort((a, b) => (cache[b].timestamp || 0) - (cache[a].timestamp || 0));
              if (tickerList.length >= CACHE_LIMIT) {
                delete cache[tickerList[tickerList.length - 1]];
              }
              cache[symbol] = { data: updatedData, timestamp: Date.now() };
              
              try {
                chrome.storage.local.set({ [CACHE_KEY]: cache });
              } catch (e) {
                isContextInvalid = true;
              }
            }
          );
        });
      } catch (e) {
        isContextInvalid = true;
      }
    }, hoverDelay);
  });

  document.addEventListener("mouseleave", scheduleHide);

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
})();
