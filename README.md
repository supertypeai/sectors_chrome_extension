# Sectors IDX Ticker Lens

A premium, production-ready Chrome extension that surfaces real-time financial data and insider trading filings when you hover over stock symbols on any webpage. 

## Features

- **Interactive Onboarding**: A high-contrast, spotlight-driven 3-step walkthrough guides new users through API key setup and verification.
- **Instant Hover Tooltips**: Hover over any ticker (e.g., `BBCA`, `TLKM`, `GOTO`) to see a premium glassmorphic popup with valuation metrics and price charts.
- **Insider Filings**: Instant visibility into the 5 most recent insider transactions for any detected symbol.
- **Performance Focused**: Efficient DOM node walking and debounce logic ensure zero lag on complex sites.
- **Total Control**: Toggle hover detection on/off and adjust the hover delay (ms) via the settings dashboard.

## Getting Started

### 1. Load the Extension
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the project folder.

### 2. The First-Run Tour
Upon installation, the extension will automatically open the Settings page and launch an **interactive tour**:
1. **Get your Key**: Direct link to the Sectors.app API dashboard.
2. **Paste & Secure**: Input your key into the encrypted sync-storage field.
3. **Verify**: Test your connection immediately to unlock the lens.

### 3. Test it out
Open the included [test_page.html](test_page.html) or visit any financial news site. Hover over a ticker like `BBCA` or `TLKM` to see the lens in action.

## Tech Stack
- **Manifest V3**: Modern, secure Chrome Extension architecture.
- **Vanilla JS/CSS**: Zero-dependency, high-performance implementation.

## Project Structure
- `manifest.json`: Configuration and permission justifications.
- `content.js` & `tooltip.css`: High-performance ticker detection and premium UI injection.
- `background.js`: Service worker orchestrating secure API communication.
- `popup.html/css/js`: Quick-search toolbar interface.
- `options.html/css/js`: Settings dashboard with onboarding tour logic.
- `icons/`: Professional PNG branding assets (16px to 512px).

## Privacy & Permissions
- **`<all_urls>`**: Used only to detect ticker patterns. No browsing history is collected or stored.
- **`storage`**: Securely syncs your API key and preferences across your Chrome profile.
- **Privacy Policy**: A draft policy is included in `STORE_LISTING.md` for store submission.
