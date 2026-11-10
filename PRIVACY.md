# Privacy Policy — Sectors Ticker Lens

Last updated: 2026-11-10

Sectors Ticker Lens is a Chrome extension that shows Sectors market data when
you hover a stock ticker on a web page. This policy describes exactly what the
extension stores and sends.

## What is stored

- **API key** — the key you paste in Settings. Stored in `chrome.storage.sync`
  so it follows your Chrome profile. Sent only to `api.sectors.app` as the
  `Authorization` header.
- **Preferences** — hover delay, enabled state, and theme. Stored in
  `chrome.storage.sync`.
- **Company cache** — up to 10 recent company responses, kept for 1 hour in
  `chrome.storage.local`.
- **Ticker whitelist** — the public `active_companies.json`, refreshed from the
  project's GitHub repository into `chrome.storage.local` on install/startup.
  The copy bundled with the extension is the offline fallback.

## What is sent

The extension sends only the following to `https://api.sectors.app`:

- the ticker symbol you hover (e.g. `BBCA`, `D05.SI`);
- the natural-language query you submit in the AI screener;
- your API key as the `Authorization` header;
- standard HTTP request metadata handled by the API (for example IP address).

The extension also fetches the public ticker whitelist from the project's GitHub
repository on install/startup. No personal data is included in that request.

It does not send page text, page URLs, browsing history, cookies, form data, or
any personal profile.

## What is not collected

- No browsing history.
- No page content or selected text.
- No cookies or authentication data from websites.
- No analytics, telemetry, advertising identifiers, or crash reporting.
- No third-party services other than `api.sectors.app` for company data and the
  project's GitHub repository for the public ticker whitelist. Fonts and sector
  icons ship inside the extension; there are no CDN or Google Fonts requests.

## Permissions

- `storage` — API key, preferences, company cache, and the local whitelist.
- `https://api.sectors.app/*` — company reports, filings, and AI screener.
- `https://raw.githubusercontent.com/supertypeai/sectors_chrome_extension/*` —
  only to refresh the public ticker whitelist.
- Content script on `http`/`https` pages — reads the hovered element's text to
  detect a ticker. The detected symbol is the only page-derived value sent.

## Your controls

- Clear the API key and cached data from Settings.
- Uninstalling the extension removes its `chrome.storage.local` data; Chrome
  sync storage is removed with the extension from your Chrome profile.

## Changes

If this policy changes, the update will be included in the extension release
and reflected here.

## Contact

For privacy questions, use the support contact listed on https://sectors.app.
