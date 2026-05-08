// background.js — Service Worker
// Handles Sectors API requests from the content script

const API_BASE = "https://api.sectors.app/v2";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FETCH_TICKER_DATA") {
    handleTickerFetch(request.symbol, sendResponse);
    return true; // keep message channel open for async
  }
  if (request.type === "FETCH_AI_RESULTS") {
    handleAiSearch(request.query, sendResponse);
    return true;
  }
  if (request.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return true;
  }
});

async function handleAiSearch(query, sendResponse) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      sendResponse({ error: "no_api_key" });
      return;
    }

    const data = await fetchJson(`${API_BASE}/companies/?q=${encodeURIComponent(query)}`, apiKey);
    sendResponse({ results: data.results || [] });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleTickerFetch(symbol, sendResponse) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      sendResponse({ error: "no_api_key" });
      return;
    }

    // Determine if it's SGX or IDX
    // const isSgx = symbol.toLowerCase().endsWith(".si"); 
    const isSgx = false; // SGX disabled for now
    const cleanSymbol = symbol.replace(/\.(jk|ij|id|si)$/i, "").toUpperCase();

    /* 
    const reportUrl = isSgx
      ? `${API_BASE}/sgx/company/report/${cleanSymbol}/`
      : `${API_BASE}/company/report/${cleanSymbol}/`;
    */
    const reportUrl = `${API_BASE}/company/report/${cleanSymbol}/`;

    const tasks = [fetchJson(reportUrl, apiKey)];
    
    // Skip filings for SGX
    if (!isSgx) {
      tasks.push(fetchJson(`${API_BASE}/filings/?symbol=${cleanSymbol}&limit=5`, apiKey));
    }

    const results = await Promise.allSettled(tasks);
    const reportRes = results[0];
    const filingsRes = !isSgx ? results[1] : { status: "fulfilled", value: { results: [] } };

    // Check if report failed
    if (reportRes.status === "rejected") {
      const msg = reportRes.reason.message.toLowerCase();
      if (msg.includes("does not exist") || msg.includes("not found")) {
        sendResponse({ error: "ticker_not_found", symbol: cleanSymbol, isSgx });
        return;
      }
      throw new Error(reportRes.reason.message);
    }

    const report = reportRes.value;
    const filings = filingsRes.status === "fulfilled" ? filingsRes.value : null;

    sendResponse({ report, filings, symbol: cleanSymbol, isSgx });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function fetchJson(url, apiKey) {
  const res = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      errorMsg = data.message || data.error || errorMsg;
    } catch (e) {
      // Fallback to simple message if JSON parsing fails
    }

    if (res.status === 403) {
      throw new Error(`403: API key exhausted. Upgrade at sectors.app/api`);
    }
    if (res.status === 429) {
      throw new Error(`429: Rate limit exceeded. Consider upgrading.`);
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["sectorsApiKey"], (result) => {
      resolve(result.sectorsApiKey || "");
    });
  });
}
