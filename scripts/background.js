// background.js — Service Worker
// Handles Sectors API requests from the content script
importScripts("api.js");

const { API_BASE, requestJson } = globalThis.SectorsApi;

const TICKERS_LIST_URL = "https://raw.githubusercontent.com/supertypeai/sectors_chrome_extension/main/active_companies.json";
const MAX_TICKERS = 20000;
const MAX_TICKER_PAYLOAD = 5_000_000;
const MAX_AI_QUERY = 500;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
  syncTickers();
});

chrome.runtime.onStartup.addListener(() => {
  syncTickers();
});

// Refresh the public whitelist on install/startup. The bundled copy is the
// offline fallback; no alarm or background timer is used.
async function syncTickers() {
  try {
    const res = await fetch(TICKERS_LIST_URL);
    if (res.ok) {
      const declaredSize = Number(res.headers.get("content-length") || 0);
      if (declaredSize > MAX_TICKER_PAYLOAD) {
        console.warn("Ticker sync skipped: payload too large", declaredSize);
      } else if (storeTickers(await res.json())) {
        return;
      }
    } else {
      console.warn("Ticker sync failed:", res.status);
    }
  } catch (err) {
    console.warn("Ticker sync failed:", err);
  }
  await loadBundledTickers();
}

async function loadBundledTickers() {
  try {
    const res = await fetch(chrome.runtime.getURL("active_companies.json"));
    if (!res.ok) {
      console.warn("Bundled ticker list load failed:", res.status);
      return;
    }
    storeTickers(await res.json());
  } catch (err) {
    console.warn("Bundled ticker list load failed:", err);
  }
}

function storeTickers(data) {
  if (!Array.isArray(data)) return false;
  const idx = [];
  const sgx = [];
  data.forEach(sym => {
    if (idx.length + sgx.length >= MAX_TICKERS) return;
    const upper = String(sym || "").toUpperCase().trim();
    // Only accept canonical whitelist entries.
    if (!/^[A-Z0-9]{1,10}\.(JK|SI)$/.test(upper)) return;
    if (upper.endsWith(".JK")) {
      idx.push(upper.slice(0, -3));
    } else {
      sgx.push(upper.slice(0, -3));
    }
  });
  // A corrupt/partial remote list must not replace the bundled fallback.
  if (idx.length + sgx.length < 10) return false;
  chrome.storage.local.set({
    validIdxTickers: idx,
    validSgxTickers: sgx
  });
  return true;
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
    return false;
  }
});

async function handleAiSearch(query, sendResponse, isSgx = false) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      sendResponse({ error: "no_api_key" });
      return;
    }

    // Cap the query so a pasted wall of text cannot build an absurd URL.
    const q = String(query || "").trim().slice(0, MAX_AI_QUERY);
    if (!q) {
      sendResponse({ error: "empty_query" });
      return;
    }

    // Route IDX → /v2/companies/, SGX → /v2/sgx/companies/ (natural-language company screener)
    const url = isSgx
      ? `${API_BASE}/sgx/companies/?q=${encodeURIComponent(q)}`
      : `${API_BASE}/companies/?q=${encodeURIComponent(q)}`;

    const data = await fetchJson(url, apiKey);
    sendResponse({ results: data?.results || [], pagination: data?.pagination, llm_translation: data?.llm_translation });
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

    // Validate before building any API path; messages come from our content
    // script, but keep the boundary strict anyway.
    const rawSymbol = String(symbol || "").trim();
    if (!/^[A-Za-z0-9]{1,10}(\.(jk|ij|id|si))?$/i.test(rawSymbol)) {
      sendResponse({ error: "invalid_symbol" });
      return;
    }
    const isSgx = /\.si$/i.test(rawSymbol);
    const cleanSymbol = rawSymbol.replace(/\.(jk|ij|id|si)$/i, "").toUpperCase();

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
    const filings = filingsRes.status === "fulfilled" ? filingsRes.value : null;

    // SGX filings are normalised in the shared render layer so the tooltip and
    // popup use the same `price` field.
    sendResponse({ report, filings, symbol: cleanSymbol, isSgx });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}


async function fetchJson(url, apiKey) {
  const { ok, status, data, text } = await requestJson(url, apiKey);
  if (ok) return data;

  const errorMsg = data?.message || data?.error || `HTTP ${status}${text ? ` — ${text.slice(0, 100)}` : ""}`;
  if (status === 403) {
    throw new Error(`403: API key exhausted. Upgrade at sectors.app/api`);
  }
  if (status === 429) {
    throw new Error(`429: Rate limit exceeded. Consider upgrading.`);
  }
  throw new Error(errorMsg);
}

function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["sectorsApiKey"], (result) => {
      resolve(result.sectorsApiKey || "");
    });
  });
}
