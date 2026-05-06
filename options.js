// options.js — Settings page logic

const API_BASE = "https://api.sectors.app/v2";

// ── Sidebar navigation ────────────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const target = item.dataset.section;

    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));

    item.classList.add("active");
    document.getElementById(`sec-${target}`)?.classList.add("active");
  });
});

// ── Load saved values ─────────────────────────────────────────────────────
chrome.storage.sync.get(
  ["sectorsApiKey", "prefEnabled", "prefDelay", "hasCompletedTour"],
  ({ sectorsApiKey, prefEnabled, prefDelay, hasCompletedTour }) => {
    if (sectorsApiKey) {
      document.getElementById("api-key-input").value = sectorsApiKey;
    }

    const enabledCheckbox = document.getElementById("pref-enabled");
    if (prefEnabled !== undefined) enabledCheckbox.checked = prefEnabled;

    const delaySlider = document.getElementById("pref-delay");
    const delayVal    = document.getElementById("delay-val");
    if (prefDelay !== undefined) {
      delaySlider.value  = prefDelay;
      delayVal.textContent = `${prefDelay} ms`;
    }

    // Pre-populate test ticker
    document.getElementById("test-ticker").value = "BBCA";

    // Auto-start tour for new users
    if (!hasCompletedTour) {
      setTimeout(startTour, 500);
    }
  }
);

// ── Toggle visibility ─────────────────────────────────────────────────────
const apiKeyInput   = document.getElementById("api-key-input");
const btnToggleVis  = document.getElementById("btn-toggle-vis");
let   isVisible     = false;

btnToggleVis.addEventListener("click", () => {
  isVisible = !isVisible;
  apiKeyInput.type = isVisible ? "text" : "password";
  btnToggleVis.textContent = isVisible ? "Hide" : "Show";
});

// ── Save API Key ──────────────────────────────────────────────────────────
document.getElementById("btn-save").addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showSaveMsg("save-msg", "Key cannot be empty.", false);
    return;
  }
  chrome.storage.sync.set({ sectorsApiKey: key }, () => {
    showSaveMsg("save-msg", "API key saved!", true);
  });
});

// ── Clear API Key ─────────────────────────────────────────────────────────
document.getElementById("btn-clear").addEventListener("click", () => {
  chrome.storage.sync.remove("sectorsApiKey", () => {
    apiKeyInput.value = "";
    showSaveMsg("save-msg", "Key cleared.", true);
  });
});

// ── Test Connection ───────────────────────────────────────────────────────
document.getElementById("btn-test").addEventListener("click", async () => {
  const testTicker = document.getElementById("test-ticker").value.trim().toUpperCase().replace(/\.JK$/i, "");
  const resultEl   = document.getElementById("test-result");
  const key        = apiKeyInput.value.trim();

  if (!key) {
    showTestResult("Please enter an API key first.", false);
    return;
  }
  if (!testTicker || testTicker.length < 2) {
    showTestResult("Please enter a valid IDX ticker.", false);
    return;
  }

  showTestResult("Testing connection...", null);

  try {
    const res = await fetch(`${API_BASE}/filings/?symbol=${testTicker}&limit=1`, {
      headers: { Authorization: key },
    });

    if (res.ok) {
      const data = await res.json();
      const count = data?.pagination?.total_count ?? "?";
      
      // Auto-save the key if it works
      chrome.storage.sync.set({ sectorsApiKey: key }, () => {
        showTestResult(
          `Connected! Found ${count} filing(s) for ${testTicker}. API key saved successfully.`,
          true
        );
        showSaveMsg("save-msg", "API key saved!", true);
      });
    } else if (res.status === 403) {
      showTestResult(`API key exhausted (HTTP 403). Please upgrade at sectors.app/api`, false);
    } else if (res.status === 401) {
      showTestResult(`Unauthorised (HTTP 401). Check that your API key is correct.`, false);
    } else {
      showTestResult(`HTTP ${res.status} — ${(await res.text()).slice(0, 100)}`, false);
    }
  } catch (err) {
    showTestResult(`Network error: ${err.message}`, false);
  }
});

function showTestResult(msg, ok) {
  const el = document.getElementById("test-result");
  el.classList.remove("hidden", "test-ok", "test-error");
  if (ok === true)  el.classList.add("test-ok");
  if (ok === false) el.classList.add("test-error");
  el.textContent = msg;
}

// ── Preferences ───────────────────────────────────────────────────────────
const delaySlider = document.getElementById("pref-delay");
const delayVal    = document.getElementById("delay-val");

delaySlider.addEventListener("input", () => {
  delayVal.textContent = `${delaySlider.value} ms`;
});

document.getElementById("btn-save-prefs").addEventListener("click", () => {
  const prefs = {
    prefEnabled: document.getElementById("pref-enabled").checked,
    prefDelay:   parseInt(delaySlider.value, 10),
  };
  chrome.storage.sync.set(prefs, () => {
    showSaveMsg("prefs-msg", "Preferences saved!", true);
  });
});

// ── Helper ────────────────────────────────────────────────────────────────
function showSaveMsg(id, msg, ok) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className   = `save-msg ${ok ? "save-ok" : "save-error"}`;
  setTimeout(() => { el.className = "save-msg hidden"; }, 3000);
}

// ── Onboarding Tour Logic ──────────────────────────────────────────────────
const tourSteps = [
  {
    target: 'a[href="https://sectors.app/api"]',
    title: "Get your API Key",
    text: "First, grab your free API key from <strong>Sectors.app/api</strong>. It only takes a minute to sign up!"
  },
  {
    target: "#api-key-input",
    title: "Paste your Key",
    text: "Once you have your key, <strong>paste it here</strong>. It's stored securely and synced across your devices."
  },
  {
    target: "#btn-test",
    title: "Test & Done!",
    text: "Enter a ticker like 'BBCA' and click <strong>Test</strong>. We'll automatically save it if it works. You're ready to hover!"
  }
];

let currentTourStep = 0;

function startTour() {
  currentTourStep = 0;
  document.getElementById("tour-overlay").style.display = "block";
  document.getElementById("tour-highlight").classList.remove("hidden");
  document.getElementById("tour-tooltip").classList.remove("hidden");
  showStep(0);
}

function showStep(stepIdx) {
  const step = tourSteps[stepIdx];
  const targetEl = document.querySelector(step.target);
  if (!targetEl) {
    endTour();
    return;
  }

  // Ensure target is in view
  targetEl.scrollIntoView({ behavior: "smooth", block: "center" });

  // Wait for scroll
  setTimeout(() => {
    const rect = targetEl.getBoundingClientRect();
    const highlight = document.getElementById("tour-highlight");
    const tooltip = document.getElementById("tour-tooltip");

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Position highlight with some padding
    highlight.style.top = (rect.top + scrollY - 12) + "px";
    highlight.style.left = (rect.left + scrollX - 12) + "px";
    highlight.style.width = (rect.width + 24) + "px";
    highlight.style.height = (rect.height + 24) + "px";

    // Update tooltip content
    document.getElementById("tour-title").textContent = step.title;
    document.getElementById("tour-text").innerHTML = step.text;

    // Position tooltip relative to highlight
    const tooltipTop = rect.bottom + scrollY + 28;
    const tooltipLeft = rect.left + scrollX;
    
    tooltip.style.top = tooltipTop + "px";
    tooltip.style.left = Math.max(20, Math.min(tooltipLeft, window.innerWidth - 300)) + "px";

    document.getElementById("btn-tour-next").textContent = stepIdx === tourSteps.length - 1 ? "Finish" : "Next Step";
  }, 400);
}

function endTour() {
  document.getElementById("tour-overlay").style.display = "none";
  document.getElementById("tour-highlight").classList.add("hidden");
  document.getElementById("tour-tooltip").classList.add("hidden");
  chrome.storage.sync.set({ hasCompletedTour: true });
}

document.getElementById("btn-tour-next").addEventListener("click", () => {
  currentTourStep++;
  if (currentTourStep < tourSteps.length) {
    showStep(currentTourStep);
  } else {
    endTour();
  }
});

document.getElementById("btn-tour-skip").addEventListener("click", endTour);

// Handle window resize during tour
window.addEventListener("resize", () => {
  const tooltip = document.getElementById("tour-tooltip");
  if (!tooltip.classList.contains("hidden")) {
    showStep(currentTourStep);
  }
});
