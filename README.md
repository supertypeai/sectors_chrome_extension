# Sectors IDX Ticker Lens

A premium Chrome extension that surfaces real-time Indonesian stock market data and insider trading filings when you hover over any IDX ticker symbol on a webpage.

## ✨ Features

- **Instant Hover Tooltip**: Hover over any 4-letter IDX ticker (e.g., `BBCA`, `TLKM`, `GOTO`) to see a premium glassmorphic popup.
- **Real-time Data**: Fetches company overview, price change, market cap, P/E ratio, and dividend yield from the Sectors Financial API.
- **Insider Filings**: Shows the 5 most recent insider buy/sell transactions for the company.
- **Quick Search**: Use the extension popup to quickly look up any ticker manually.
- **Settings Page**: Securely manage your API key and customize hover behavior.

## 🚀 How to Try This

### 1. Load the Extension in Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the folder where you created this project: `C:\Users\gladbert\Desktop\Supertype\browser_ext`.

### 2. Configure your API Key
1. Click the **Sectors IDX Ticker Lens** icon in your Chrome toolbar.
2. If you haven't set a key, click **Add Key** or the gear icon ⚙️.
3. Paste your Sectors API key into the settings field and click **Save API Key**.
   - *If you don't have a key, get one at [sectors.app/auth](https://sectors.app/auth).*

### 3. Test it out
1. Open the included test page: [test_page.html](file:///c:/Users/gladbert/Desktop/Supertype/browser_ext/test_page.html).
2. Hover over any highlighted ticker symbol like `BBCA` or `TLKM`.
3. You should see a data-rich tooltip appear instantly.

## 🛠 Tech Stack
- **Manifest V3**: Using modern Chrome Extension standards.
- **Vanilla JS/CSS**: Fast, lightweight, and custom-styled with a dark "Sectors" brand aesthetic.
- **Sectors API v2**: Leverages `company/report` and `filings` endpoints.

## 📂 Project Structure
- `manifest.json`: Extension configuration.
- `content.js` & `tooltip.css`: Logic and styling for the on-page hover detection.
- `background.js`: Service worker for handling API requests.
- `popup.html/css/js`: Toolbar popup interface.
- `options.html/css/js`: Settings and configuration page.
- `icons/`: Generated branding assets.
- `test_page.html`: A local sandbox to verify functionality.
