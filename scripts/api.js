// api.js — shared Sectors API constants and low-level request helper.
(function () {
  "use strict";

  const API_BASE = "https://api.sectors.app/v2";
  const CLIENT_SOURCE_HEADERS = { "X-Client-Source": "CHROME" };

  async function requestJson(url, apiKey) {
    const res = await fetch(url, {
      headers: { Authorization: apiKey, ...CLIENT_SOURCE_HEADERS },
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        // Non-JSON error body: keep the raw text for the caller.
      }
    }
    return { ok: res.ok, status: res.status, data, text };
  }

  globalThis.SectorsApi = { API_BASE, CLIENT_SOURCE_HEADERS, requestJson };
})();
