# Sectors Ticker Lens (v1.1.0)

A high-performance Chrome extension that surfaces real-time financial data, valuation metrics, insider trading filings, and natural language AI screening when you hover over stock symbols on any webpage. Fully optimized for both Indonesian (IDX) and Singaporean (SGX) financial markets.

---

## Key Features

### 1. High-Performance Smart Hover Lens (Glassmorphic Tooltip)
*   **Dual-Exchange Coverage**: Seamless support for both **Indonesia Stock Exchange (IDX)** and **Singapore Exchange (SGX)** symbols (e.g. `BBCA`, `TLKM.JK`, `D05`, `U11.SI`).
*   **Instant Market Insights**: Displays clean, beautiful, high-fidelity real-time stock prices, 1-day closing percentage trends (color-coded for positive/negative movement), and a modern grid of core financial metrics:
    *   **Market Capitalization** (in native currency: IDR or SGD)
    *   **Price-to-Earnings Ratio** (P/E TTM)
    *   **Price-to-Book Ratio** (P/B MRQ)
    *   **Dividend Yield** (TTM)
*   **Company Overview**: Generates a natural-sounding, concise AI quick summary of the company's business model, industry sector, and market context on load.

### 2. Intelligent Gatekeeper Logic (Performance First)
*   **O(1) Memory Lookups**: The extension loads pre-compiled, optimized whitelists (`validIdxTickers` and `validSgxTickers`) into local memory `Set` structures.
*   **Zero-Lag DOM Walking**: Uses an advanced regex check to identify candidate strings, and immediately verifies them against the whitelist in **O(1)** time *before* performing expensive DOM layout calculations (`document.createRange()`, `getClientRects()`) or making API requests. This eliminates browser lag on text-heavy pages and prevents false-positive API spam.
*   **LRU Caching Layer**: Implements a client-side Least Recently Used (LRU) cache in local storage (up to 10 ticker records, valid for 1 hour) to make subsequent hovers completely instantaneous and reduce server load.

### 3. Integrated Natural Language AI Chat (IDX Only)
*   **In-Tooltip AI Screener**: Ask natural language questions about competitors, sectors, or rankings directly from the tooltip. Powered by the **Sectors Natural Language Company Screener API** (`/v2/companies/`).
*   **Quick Prompt Chips**: Instant-click suggestion buttons tailored to the current company context:
    *   *Sector Leaders* (returns industry peers with high market caps)
    *   *Value Peers* (filters same-sector companies with P/E < 15)
    *   *High Revenue Peers* (compares companies by revenue size)
    *   *Top Div Payers* (lists top dividend-yielding companies in the sector)
*   **Explore Related Topics**: Dynamically suggests clickable follow-up queries based on search results for deeper, guided interactive screening.

### 4. Insider Transaction Filings (IDX Only)
*   **Direct Visibility**: Access the 5 most recent insider filings instantly, displaying transaction types (BUY/SELL badge), transaction date, the insider holder's name, share amount, purchase price, and total transaction value.

### 5. Automated Whitelist Maintenance Pipeline
*   **GitHub Actions Workflow**: A scheduled workflow (`.github/workflows/update_company_list.yml`) runs every 2 weeks or on manual trigger to execute a Python compiler (`github_workflow/update_active_company_list.py`).
*   **Supabase Database Sync**: The Python script queries live Supabase tables (`idx_active_company_profile` and `sgx_company_report`), normalizes suffixes (`.JK` and `.SI`), sorts alphabetically, and compiles the result into a minified, ultra-efficient `active_companies.json` file.
*   **Background Synchronizer**: The extension background worker (`scripts/background.js`) runs a weekly Chrome Alarm (`syncTickersAlarm`) to pull the latest minified whitelist directly from the GitHub repository, keeping the local gatekeeper whitelists perfectly updated.

### 6. Universal Personalization & Styling Control
*   **Midnight Dark vs. Sectors Light Mode**: Fully-integrated light and dark themes spanning across the hover tooltip, settings panel, and toolbar popup. Auto-applied using high-performance CSS custom variables (`styles/vars.css`) and a theme pre-checker (`scripts/theme-check.js`) to prevent styling flash on load.
*   **Customisable Hover Delay**: Adjust the debounce interval (from 50ms to 600ms) to fine-tune hover responsiveness to your browsing style.
*   **Interactive Settings Onboarding**: An interactive 3-step walk-through tour guides new users through setting up their API key, verifying the connection, and unlocking the hover lens on the very first install.

---

## Project Structure

The project has been modularized and restructured into a highly readable, clean schema:

```
├── .github/workflows/
│   └── update_company_list.yml       # Bi-weekly GitHub Actions pipeline for whitelist compilation
├── github_workflow/
│   ├── github_workflow_requirements.txt
│   └── update_active_company_list.py # Python script querying Supabase and generating minified JSON
├── icons/                            # Professional PNG assets for branding
├── options/                          # Settings Dashboard
│   ├── options.html                  # Dashboard HTML with API setup and preferences
│   ├── options.css                   # Custom styles for Options page
│   └── options.js                    # Logic for connection testing, preferences, and onboarding tour
├── popup/                            # Toolbar Quick Action
│   ├── popup.html                    # Manually search tickers and toggle settings on the fly
│   ├── popup.css                     # Popup styling
│   └── popup.js                      # Companion settings synchronization & lookup logic
├── scripts/
│   ├── background.js                 # Service worker orchestrating secure API calls and weekly whitelist sync
│   ├── content.js                    # Injected script handling gatekeeper whitelists and hover tooltips
│   └── theme-check.js                # Theme pre-loading utility to prevent visual flash
├── styles/
│   ├── vars.css                      # Centralized HSL design tokens & dark/light theme properties
│   └── tooltip.css                   # Premium CSS, glassmorphic layout, and micro-animations
├── active_companies.json             # Pre-compiled, sorted minified whitelist of active companies
├── manifest.json                     # Extension manifest configuration & permissions
└── README.md                         # Project documentation
```

---

## Getting Started

### 1. Load the Extension locally
1.  Open Google Chrome and navigate to `chrome://extensions/`.
2.  Enable **Developer mode** via the toggle switch in the top-right corner.
3.  Click **Load unpacked** in the top-left and select the `browser_ext` folder of this project.

### 2. Follow the First-Run Tour
1.  On installation, the extension will automatically open the Settings tab and launch the interactive onboarding guide.
2.  **API Key setup**: Head to [Sectors API Dashboard](https://sectors.app/api) to generate a free token.
3.  **Connection Test**: Enter any ticker (e.g. `BBCA` or `GOTO`) inside the "Test Connection" card and click **Test** to ensure proper setup.
4.  Click **Save API Key** to secure it in Chrome Sync storage.

### 3. Surf the Web with Ticker Lens
Hover over any stock symbol on a news site, blog, or financial forum (e.g. `TLKM`, `D05`) to watch the glassmorphic card slide in with rich data.

---

## Privacy & Permissions

Built with Manifest V3 to ensure the highest standards of safety, privacy, and performance:
*   **`storage`**: Used exclusively to secure and sync your API key and preferences across your Chrome profile.
*   **`activeTab`**: Grants standard permission to inject the hover tooltip onto your current tab safely.
*   **`alarms`**: Establishes a weekly background alarm to sync the latest active company whitelist without background performance overhead.
*   **Host Permissions (`https://api.sectors.app/*`, `https://raw.githubusercontent.com/*`)**: Allows secure, sandboxed network requests to Sectors API endpoints and updates the local ticker whitelists.
*   **Zero History Collection**: No browsing history, personal data, or cookies are ever tracked, logged, or sent to external services.
