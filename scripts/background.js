// background.js — Service Worker
// Handles Sectors API requests from the content script

const API_BASE = "https://api.sectors.app/v2";
const CLIENT_SOURCE_HEADERS = { "X-Client-Source": "CHROME" };

// URL to pull the active companies ticker list
const TICKERS_LIST_URL = "https://raw.githubusercontent.com/supertypeai/sectors_chrome_extension/main/active_companies.json";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
  syncTickers();
});

chrome.runtime.onStartup.addListener(() => {
  syncTickers();
});

// Setup a weekly alarm to refresh the ticker list (10080 minutes = 7 days)
chrome.alarms.create("syncTickersAlarm", { periodInMinutes: 10080 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "syncTickersAlarm") {
    syncTickers();
  }
});

async function syncTickers() {
  try {
    const res = await fetch(TICKERS_LIST_URL, { headers: CLIENT_SOURCE_HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    
    if (Array.isArray(data)) {
      const idx = [];
      const sgx = [];
      data.forEach(sym => {
        const upper = sym.toUpperCase();
        if (upper.endsWith(".JK")) {
          idx.push(upper.replace(".JK", ""));
        } else if (upper.endsWith(".SI")) {
          sgx.push(upper.replace(".SI", ""));
        }
      });
      chrome.storage.local.set({ 
        validIdxTickers: idx, 
        validSgxTickers: sgx 
      });
    }
  } catch (err) {
    console.warn("Failed to sync tickers:", err);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FETCH_TICKER_DATA") {
    handleTickerFetch(request.symbol, sendResponse);
    return true; // keep message channel open for async
  }
  if (request.type === "FETCH_AI_RESULTS") {
    handleAiSearch(request.query, sendResponse, !!request.isSgx);
    return true;
  }
  if (request.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return true;
  }
});

async function handleAiSearch(query, sendResponse, isSgx = false) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      sendResponse({ error: "no_api_key" });
      return;
    }

    // Route IDX → /v2/companies/, SGX → /v2/sgx/companies/ (natural-language company screener)
    const url = isSgx
      ? `${API_BASE}/sgx/companies/?q=${encodeURIComponent(query)}`
      : `${API_BASE}/companies/?q=${encodeURIComponent(query)}`;

    const data = await fetchJson(url, apiKey);
    sendResponse({ results: data.results || [], pagination: data.pagination, llm_translation: data.llm_translation });
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

    // Determine if it's Singapore or Indonesia stock
    const isSgx = symbol.toLowerCase().endsWith(".si"); 
    const cleanSymbol = symbol.replace(/\.(jk|ij|id|si)$/i, "").toUpperCase();

    const reportUrl = isSgx
      ? `${API_BASE}/sgx/company/report/${cleanSymbol}/`
      : `${API_BASE}/company/report/${cleanSymbol}/`;

    // Insider filings: IDX → /v2/filings/, SGX → /v2/sgx/filings/
    const filingsUrl = isSgx
      ? `${API_BASE}/sgx/filings/?symbol=${cleanSymbol}&limit=5`
      : `${API_BASE}/filings/?symbol=${cleanSymbol}&limit=5`;

    const tasks = [
      fetchJson(reportUrl, apiKey),
      filingsUrl ? fetchJson(filingsUrl, apiKey) : Promise.resolve(null)
    ];

    const results = await Promise.allSettled(tasks);
    const reportRes = results[0];
    const filingsRes = results[1];

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
    const filingsRaw = filingsRes.status === "fulfilled" ? filingsRes.value : null;

    // Normalise SGX filings (price_per_share → price) so downstream renderers
    // can use a single f.price field, matching the IDX contract.
    const filings = filingsRaw ? normaliseFilings(filingsRaw, isSgx) : null;

    sendResponse({ report, filings, symbol: cleanSymbol, isSgx });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// SGX filings expose the share price as `price_per_share`, while IDX uses `price`.
// Mirror SGX's price field into `price` so renderers can stay exchange-agnostic.
function normaliseFilings(filingsPayload, isSgx) {
  if (!isSgx || !filingsPayload || !Array.isArray(filingsPayload.results)) {
    return filingsPayload;
  }
  const normalised = filingsPayload.results.map((f) => {
    if (f && f.price == null && f.price_per_share != null) {
      return { ...f, price: f.price_per_share };
    }
    return f;
  });
  return { ...filingsPayload, results: normalised };
}

async function fetchJson(url, apiKey) {
  const res = await fetch(url, {
    headers: { Authorization: apiKey, ...CLIENT_SOURCE_HEADERS },
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
