# Chrome Web Store Submission Guide

This document contains the metadata and justifications required for the Sectors IDX Ticker Lens submission.

## 1. Store Description

### Summary (Short Description)
Hover over any IDX ticker to get real-time company data, insider filings, and news from Sectors.app.

### Detailed Description
Elevate your financial research with the Sectors IDX Ticker Lens. This extension seamlessly integrates with your browsing experience to provide instant, high-fidelity data for Indonesian (IDX) stocks.

**Key Features:**
- **Instant Hover Tooltips**: Hover over any 4-5 letter IDX ticker (e.g., BBCA, GOTO, TLKM) on any website to see a snapshot of its market cap, valuation, and price performance.
- **Insider Transaction Tracking**: Quickly view the latest insider buy/sell filings to gauge market sentiment.
- **Financial News**: Get the most recent headlines related to the company without leaving your current tab.
- **Deep-Dive Search**: Use the extension popup to search for any IDX company and get a comprehensive report.
- **Customizable Experience**: Adjust hover delays and enable/disable the lens to fit your workflow.

Powered by the premium Sectors.app V2 API, the Ticker Lens is the ultimate companion for investors, analysts, and traders focusing on the Indonesian market.

---

## 2. Permission Justifications

When submitting, provide these justifications for the requested permissions:

- **`storage`**: Used to securely save and synchronize your API key and user preferences (such as hover delay and toggle states) across all your Chrome-enabled devices.
- **`activeTab`**: Allows the extension to identify and process ticker symbols on the page you are currently viewing without requiring broad access to all tabs at all times.
- **Host Permission (`https://api.sectors.app/*`)**: Necessary to communicate with the Sectors API to fetch real-time financial data, filings, and news for the identified tickers.
- **Host Permission (`<all_urls>`)**: Required to enable ticker detection across any financial news or analysis website you visit. The extension only activates when a matching IDX ticker format is detected and does not collect or store your browsing history.

---

## 3. Privacy Policy (Draft)

**Sectors IDX Ticker Lens Privacy Policy**

**Effective Date:** May 6, 2026

**1. Data Collection**
The Sectors IDX Ticker Lens extension collects and stores only the minimum information necessary to function:
- **API Key**: The Sectors.app API key provided by the user.
- **User Preferences**: Settings such as hover delay and extension toggle states.

**2. Data Usage**
- The API key is used exclusively to authenticate requests to `api.sectors.app`.
- The extension identifies stock ticker symbols on webpages to provide relevant financial data.
- **We do not collect, store, or transmit your browsing history, personal identity, or sensitive information.**

**3. Data Storage**
- Your API key and preferences are stored locally in your browser using `chrome.storage.sync`. If you are logged into Chrome, this data is synchronized across your devices by Google.

**4. Data Sharing**
- Your API key and the ticker symbols you hover over are sent to the Sectors.app API (`api.sectors.app`) solely to retrieve financial data. No data is shared with third-party advertisers or analytics services.

**5. User Control**
- You can clear your API key and reset your preferences at any time through the extension settings page.

---

## 4. Technical Submission Checklist

- [ ] Zip the `browser_ext` folder (exclude `.git`, `node_modules`, or temp files).
- [ ] Upload the `.zip` to the Chrome Developer Dashboard.
- [ ] Provide the 440x280 "Small Tile" asset.
- [ ] Provide at least one 1280x800 screenshot.
- [ ] Link to this Privacy Policy (hosted on a public URL like GitHub Gist or your website).
