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

    const cleanSymbol = symbol.replace(/\.jk$/i, "").toUpperCase();

    const [reportRes, filingsRes] = await Promise.allSettled([
      fetchJson(`${API_BASE}/company/report/${cleanSymbol}/`, apiKey),
      fetchJson(`${API_BASE}/filings/?symbol=${cleanSymbol}&limit=5`, apiKey),
    ]);

    // Check if report failed due to non-existent ticker
    if (reportRes.status === "rejected" && reportRes.reason.message.toLowerCase().includes("does not exist")) {
      sendResponse({ error: "ticker_not_found", symbol: cleanSymbol });
      return;
    }

    const report =
      reportRes.status === "fulfilled" ? reportRes.value : null;
    const filings =
      filingsRes.status === "fulfilled" ? filingsRes.value : null;

    sendResponse({ report, filings, symbol: cleanSymbol });
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
