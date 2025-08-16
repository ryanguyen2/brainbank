const API_BASE = "http://localhost:3000";

// Clear remembered popup id if user closes it
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { popupWindowId } = await chrome.storage.local.get("popupWindowId");
  if (popupWindowId === windowId) await chrome.storage.local.remove("popupWindowId");
});

function isInjectable(tab) {
  const url = tab?.url || "";
  if (
    url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("https://chromewebstore.google.com/") ||
    url.startsWith("https://chrome.google.com/webstore")
  ) return false;
  if (url.endsWith(".pdf") ||
      url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai")) return false;
  return true;
}

async function captureSelectionFrom(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection()?.toString() || "").trim(),
    });
    return res?.result || "";
  } catch {
    return "";
  }
}

// Native side panel if available; else reuse a single popup; last resort a tab
async function ensurePanel(tabId) {
  // always remember the *content* tab we’re opening from
  if (tabId) await chrome.storage.local.set({ lastContentTabId: tabId });

  if (chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
      await chrome.sidePanel.open({ tabId });
      return true;
    } catch (e) {
      console.warn("sidePanel.open failed, fallback to popup:", e);
    }
  }
  const { popupWindowId } = await chrome.storage.local.get("popupWindowId");
  if (popupWindowId) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true, drawAttention: true });
      return false;
    } catch {
      await chrome.storage.local.remove("popupWindowId"); // stale id
    }
  }
  try {
    const win = await chrome.windows.getCurrent();
    const fullW = win?.width ?? 1200, fullH = win?.height ?? 800;
    const fullL = win?.left ?? 0,    fullT = win?.top ?? 50;
    const width = Math.min(420, Math.floor(fullW * 0.33));
    const left  = fullL + fullW - width;
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL("sidepanel.html"),
      type: "popup", focused: true, width, height: fullH, left, top: fullT,
    });
    if (created?.id) await chrome.storage.local.set({ popupWindowId: created.id });
  } catch (e) {
    console.warn("popup failed, opening tab:", e);
    await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
  }
  return false;
}

// Toolbar button opens UI + captures selection preview
chrome.action?.onClicked?.addListener(async (tab) => {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const t = tab?.id ? tab : active;
  if (!t?.id) return;
  await ensurePanel(t.id);
  let selection = "";
  if (isInjectable(t)) selection = await captureSelectionFrom(t.id);
  const lastSummary = {
    selection, url: t.url || "", title: t.title || "",
    mode: null, summary: selection ? "(Choose a mode to process.)" : "", ts: Date.now(),
  };
  await chrome.storage.sync.set({ lastSummary });
});

// Install: single context menu + local->sync migration
chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch {}
  try {
    const syncData = await chrome.storage.sync.get(null);
    if (!syncData || Object.keys(syncData).length === 0) {
      const localData = await chrome.storage.local.get(null);
      if (localData && Object.keys(localData).length) await chrome.storage.sync.set(localData);
    }
  } catch (e) { console.warn("storage migration skipped:", e); }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "kq-open", title: "Open Knowledge Journal", contexts: ["all"],
    });
  });
});

// Right-click - open and capture selection preview from that tab
chrome.contextMenus.onClicked.addListener(async (_info, tab) => {
  if (!tab?.id) return;
  await ensurePanel(tab.id);
  let selection = "";
  if (isInjectable(tab)) selection = await captureSelectionFrom(tab.id);
  const lastSummary = {
    selection, url: tab.url || "", title: tab.title || "",
    mode: null, summary: selection ? "(Choose a mode to process.)" : "", ts: Date.now(),
  };
  await chrome.storage.sync.set({ lastSummary });
});

// Keyboard shortcut: open + remember content tab + grab selection
chrome.commands.onCommand.addListener(async (command) => {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab?.id) return;

  if (command === "open_side_panel" || command === "summarize_selection") {
    await ensurePanel(activeTab.id);
    if (isInjectable(activeTab)) {
      const selection = await captureSelectionFrom(activeTab.id);
      const lastSummary = {
        selection, url: activeTab.url || "", title: activeTab.title || "",
        mode: null, summary: selection ? "(Choose a mode to process.)" : "", ts: Date.now(),
      };
      await chrome.storage.sync.set({ lastSummary });
    }
  }
});

// Panel asks to run a preset
chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {
  if (msg?.type !== "runPresetFromPanel") return true;

  const all = await chrome.storage.sync.get(["lastSummary"]);
  let sel = all?.lastSummary?.selection || "";
  let url = all?.lastSummary?.url || "";
  let title = all?.lastSummary?.title || "Untitled";

  // If empty, capture from the last remembered content tab (not the popup)
  if (!sel) {
    const { lastContentTabId } = await chrome.storage.local.get("lastContentTabId");
    if (lastContentTabId) {
      try {
        const tab = await chrome.tabs.get(lastContentTabId);
        if (tab && isInjectable(tab)) {
          sel = await captureSelectionFrom(lastContentTabId);
          url = tab.url || url;
          title = tab.title || title;
          await chrome.storage.sync.set({
            lastSummary: { ...(all.lastSummary||{}), selection: sel, url, title, ts: Date.now() }
          });
        }
      } catch {}
    }
  }

  if (!sel) {
    sendResponse({ ok: false, error: "no_selection" });
    return true;
  }

  await chrome.storage.sync.set({ inflight: { mode: msg.mode, ts: Date.now(), title, url } });

  try {
    const res = await fetch(`${API_BASE}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sel, mode: msg.mode }),
    });
    if (!res.ok) {
      let err = `API error ${res.status}`;
      try { err = (await res.json()).message || err; } catch {}
      await chrome.storage.sync.remove("inflight");
      sendResponse({ ok: false, error: err });
      return true;
    }
    const data = await res.json();
    const updated = { ...(all.lastSummary||{}), selection: sel, url, title, summary: data.summary, mode: msg.mode, ts: Date.now() };
    await chrome.storage.sync.set({ lastSummary: updated });
    await chrome.storage.sync.remove("inflight");
    sendResponse({ ok: true });
  } catch (e) {
    console.error("preset fetch failed:", e);
    await chrome.storage.sync.remove("inflight");
    sendResponse({ ok: false, error: "network" });
  }
  return true;
});
