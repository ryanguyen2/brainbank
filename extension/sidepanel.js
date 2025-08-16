// ----- level thresholds (cumulative XP to reach level _) -----
const LEVEL_THRESHOLDS = [
  0, 20, 60, 140, 210, 350, 520, 720, 950, 1210, 1500, 1820, 2170, 2550, 2960, 3400, 3870, 4370, 4900, 5460
];

// Final modes
const MODES = [
  { id: "skeptic",    label: "Skeptic" },
  { id: "eli5",       label: "ELI5" },
  { id: "researcher", label: "Researcher" },
  { id: "rhetoric",   label: "Rhetoric" },
  { id: "tutor",      label: "Tutor" },
  { id: "interviewer",label: "Interviewer" },
];

const DEFAULT_THEME = {
  bg:"#0f172a", fg:"#ffffff", card:"#ffffff", cardFg:"#111827",
  // accent still used for progress/confetti (not editable in UI)
  accent:"#22c55e",
  font:"system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
};
const PRESETS = {
  Light: { bg:"#f4f6fb", fg:"#0f172a", card:"#ffffff", cardFg:"#111827", accent:"#2563eb", font: DEFAULT_THEME.font },
  Night: { bg:"#0f172a", fg:"#e5e7eb", card:"#0b1220", cardFg:"#e5e7eb", accent:"#22c55e", font: DEFAULT_THEME.font },
  Solar: { bg:"#002b36", fg:"#eee8d5", card:"#073642", cardFg:"#fdf6e3", accent:"#b58900", font: DEFAULT_THEME.font },
  Neon:  { bg:"#0b0b0f", fg:"#e5e5ff", card:"#12121a", cardFg:"#eaeaff", accent:"#7c3aed", font: DEFAULT_THEME.font },
};

const state = {
  route: "main",
  lastSummary: null,
  journal: [],
  selectedEntryId: null,
  xp: 0,
  streak: 0,
  lastActivityDate: null,
  inflight: null,
  // No preset preselected & we don't persist any chip selection
  theme: { ...DEFAULT_THEME },
  // UI timer for “still working…”
  inflightTimer: null,
};

const $ = (s) => document.querySelector(s);
const route = $("#route");

init();

function applyTheme(t) {
  const th = { ...DEFAULT_THEME, ...(t || {}) };
  document.documentElement.style.setProperty("--bg", th.bg);
  document.documentElement.style.setProperty("--fg", th.fg);
  document.documentElement.style.setProperty("--card", th.card);
  document.documentElement.style.setProperty("--card-fg", th.cardFg);
  document.documentElement.style.setProperty("--accent", th.accent);
  document.documentElement.style.setProperty("--font", th.font);
}

function init(){
  chrome.storage.sync.get(null, (d) => {
    state.journal = d.journal ?? [];
    state.xp = d.xp ?? 0;
    state.streak = d.streakCurrent ?? 0;
    state.lastActivityDate = d.lastActivityDate ?? null;
    state.lastSummary = d.lastSummary ?? null;
    state.inflight = d.inflight ?? null;
    state.theme = d.theme ?? DEFAULT_THEME;
    applyTheme(state.theme);
    renderFooter();
    go("main");
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.inflight) {
      state.inflight = changes.inflight.newValue || null;
      if (!state.inflight && state.inflightTimer) { clearTimeout(state.inflightTimer); state.inflightTimer = null; }
      if (state.route === "main") renderMain();
    }
    if (changes.lastSummary?.newValue) {
      state.lastSummary = changes.lastSummary.newValue;
      if (state.route !== "main") go("main"); else renderMain();
    }
    if (changes.journal || changes.xp || changes.streakCurrent) {
      state.journal = changes.journal?.newValue ?? state.journal;
      state.xp = changes.xp?.newValue ?? state.xp;
      state.streak = changes.streakCurrent?.newValue ?? state.streak;
      renderFooter();
    }
    if (changes.theme?.newValue) {
      state.theme = changes.theme.newValue;
      applyTheme(state.theme);
    }
  });

  $("#avatarBtn").addEventListener("click", () => go("main"));
  $("#openJournalBtn").addEventListener("click", () => go("journal"));
  $("#openSettingsBtn").addEventListener("click", () => go("settings"));
  $("#openHelpBtn").addEventListener("click", () => go("help"));
}

function go(r){
  state.route = r;
  if (r === "main") renderMain();
  if (r === "journal") renderJournal();
  if (r === "entry") renderEntry();
  if (r === "settings") renderSettings();
  if (r === "help") renderHelp();
}

function levelFromXP(xp) {
  let idx = 0;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) idx = i; else break;
  }
  const cur = LEVEL_THRESHOLDS[idx] ?? 0;
  const next = LEVEL_THRESHOLDS[idx + 1] ?? LEVEL_THRESHOLDS[idx];
  return { level: idx + 1, cur, next };
}

function renderFooter(){
  const { level, cur, next } = levelFromXP(state.xp);
  $("#levelText").textContent = `Level ${level}`;
  $("#streakText").textContent = `🔥 ${state.streak}-day streak`;
  const denom = Math.max(1, next - cur);
  const pct = Math.min(100, Math.floor(((state.xp - cur) / denom) * 100));
  $("#xpFill").style.width = pct + "%";
}

// No chip is “active” visually—chips never render with an active class
function modeChips(){
  return `
    <div class="chips">
      ${MODES.map(m => `<button class="chip" data-mode="${m.id}">${m.label}</button>`).join("")}
    </div>
  `;
}

function renderMain(){
  route.innerHTML = `
    <div class="card">
      ${modeChips()}

      <div class="row"><input id="titleInput" placeholder="Add a title for this entry"/></div>

      <div style="height:8px"></div>
      <div class="card" style="background:#f8fafc;">
        <div id="responseBox" style="min-height:160px;"></div>
      </div>
    </div>

    <!-- Save button moved here, where the tip used to be -->
    <div class="center-row"><button class="primary" id="saveBtn">Save</button></div>
  `;

  // Hook up Save
  $("#saveBtn").onclick = saveEntry;

  // Chip clicks: run immediately (no persistent highlight)
  route.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => runPreset(btn.getAttribute("data-mode")));
  });

  const box = $("#responseBox");
  const saveBtn = $("#saveBtn");

  if (state.inflight) {
    box.innerHTML = `
      <div class="row" style="gap:8px;align-items:center;">
        <div class="spinner" aria-label="Loading"></div>
        <div>Working on ${labelForMode(state.inflight.mode) || "your request"}…</div>
      </div>`;
    saveBtn.disabled = true;
  } else if (state.lastSummary?.summary) {
    box.innerHTML = formatSummaryToHTML(state.lastSummary.summary);
    saveBtn.disabled = false;
  } else {
    box.innerHTML = `<em>No output yet. Select text on the page, then choose a mode.</em>`;
    saveBtn.disabled = true;
  }
}


function loadingRow(text){
  return `
    <div class="row" style="gap:8px;align-items:center;">
      <div class="spinner" aria-label="Loading"></div>
      <div>${escapeHtml(text || "Loading…")}</div>
    </div>`;
}

function labelForMode(id){
  return MODES.find(m=>m.id===id)?.label || "Mode";
}

// always show Loading…, never flash “something went wrong” unless explicit error ---
async function runPreset(modeId){
  // Optimistic spinner: set inflight now so UI shows Loading…
  const meta = {
    mode: modeId,
    ts: Date.now(),
    title: state.lastSummary?.title || "",
    url: state.lastSummary?.url || ""
  };
  await chrome.storage.sync.set({ inflight: meta });

  // Safety: if callback never fires but background updates storage later, we’ll still update UI.
  // Add a gentle “Still working…” message after 12s if inflight persists.
  if (state.inflightTimer) { clearTimeout(state.inflightTimer); }
  state.inflightTimer = setTimeout(() => {
    if (!state.inflight) return;
    const box = $("#responseBox");
    if (box) box.innerHTML = loadingRow("Still working…");
  }, 12000);

  // Fire background request
  chrome.runtime.sendMessage({ type: "runPresetFromPanel", mode: modeId }, (resp) => {
    // If resp is undefined (e.g., channel timed out), do nothing—storage updates will refresh UI.
    if (!resp) return;

    // Only show an inline error when background explicitly reports one.
    if (resp.ok === false) {
      chrome.storage.sync.remove("inflight", () => {
        const box = $("#responseBox");
        if (!box) return;
        if (resp.error === "no_selection") {
          box.innerHTML = `<em>No selection detected. Highlight text on the page, then click a preset again.</em>`;
        } else {
          box.innerHTML = `<em>Error: ${escapeHtml(resp.error || "Request failed")}</em>`;
        }
      });
    }
  });
}

async function saveEntry(){
  if (!state.lastSummary?.summary) return;
  const title = $("#titleInput").value?.trim() || state.lastSummary.title || "Untitled";
  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title,
    url: state.lastSummary.url,
    selection: state.lastSummary.selection,
    summary: state.lastSummary.summary,
    mode: state.lastSummary.mode || "custom",
  };

  const before = levelFromXP(state.xp).level;

  state.journal.unshift(entry);
  dailyStreakAndXP();

  await chrome.storage.sync.set({
    journal: state.journal,
    xp: state.xp,
    streakCurrent: state.streak,
    lastActivityDate: state.lastActivityDate,
  });

  const after = levelFromXP(state.xp).level;
  if (after > before) levelBurstAnimation();

  renderFooter();
  go("journal");
}

function renderJournal(){
  const items = state.journal.map(e => `
    <div class="item" data-id="${e.id}">
      <div style="font-weight:600;">${escapeHtml(e.title)}</div>
      <div style="font-size:12px;color:#475569;">${new Date(e.createdAt).toLocaleString()}</div>
    </div>`).join("");

  route.innerHTML = `
    <div class="row"><button class="link" id="backMain">← Back</button></div>
    <div class="list">${items || '<div class="card">No entries yet.</div>'}</div>
  `;

  $("#backMain").onclick = () => go("main");
  route.querySelectorAll(".item").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedEntryId = el.getAttribute("data-id");
      go("entry");
    });
  });
}

function renderEntry(){
  const e = state.journal.find(j => j.id === state.selectedEntryId);
  if (!e) { go("journal"); return; }

  route.innerHTML = `
    <div class="row"><button class="link" id="backJour">← Back</button></div>
    <div class="card">
      <h3 style="margin:0">${escapeHtml(e.title)}</h3>
      <div style="font-size:12px;color:#475569;">${new Date(e.createdAt).toLocaleString()} · <a href="${e.url}" target="_blank">source</a></div>
      <div style="height:8px"></div>
      <div class="card" style="background:#f8fafc;">
        <div>${formatSummaryToHTML(e.summary)}</div>
      </div>
      <details style="margin-top:8px"><summary>Original selection</summary><blockquote>${escapeHtml(e.selection)}</blockquote></details>
    </div>
  `;
  $("#backJour").onclick = () => go("journal");
}

//Help route
function renderHelp(){
  const rows = [
    { id:"skeptic", label:"Skeptic", desc:"Find strengths, weaknesses, hidden assumptions, and what to verify." },
    { id:"eli5", label:"ELI5", desc:"Explain in very simple language with a tiny story." },
    { id:"researcher", label:"Researcher", desc:"Overview, key concepts, debates, further reading, practical takeaways." },
    { id:"rhetoric", label:"Rhetoric", desc:"Identify rhetorical devices with quoted examples and framing." },
    { id:"tutor", label:"Tutor (Cornell)", desc:"Notes, cues/questions, and a 2–3 sentence summary." },
    { id:"interviewer", label:"Interviewer", desc:"Foundational, applied, and deep-dive interview questions." },
  ];

  route.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:600;">What each mode does</div>
        <button class="link" id="backMain">← Back</button>
      </div>
      <div class="list" style="margin-top:8px;">
        ${rows.map(r=>`
          <div class="item">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div><strong>${r.label}</strong></div>
              <button class="primary" data-mode="${r.id}">Try</button>
            </div>
            <div style="font-size:13px;color:#475569;margin-top:6px;">${r.desc}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  $("#backMain").onclick = () => go("main");
  route.querySelectorAll("button.primary[data-mode]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      go("main");
      runPreset(btn.getAttribute("data-mode"));
    });
  });
}

//Settings (Theme Studio)
function renderSettings(){
  const t = state.theme || DEFAULT_THEME;
  route.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:600;">Theme Studio</div>
        <button class="link" id="backMain">← Back</button>
      </div>

      <div class="settings-grid" style="margin-top:8px;">
        <div><label>Background</label><input type="color" id="bgInput" value="${t.bg}"/></div>
        <div><label>Text</label><input type="color" id="fgInput" value="${t.fg}"/></div>
        <div><label>Card</label><input type="color" id="cardInput" value="${t.card}"/></div>
        <div><label>Card Text</label><input type="color" id="cardFgInput" value="${t.cardFg}"/></div>
        <div>
          <label>Font</label>
          <select id="fontSelect">
            <option ${t.font.includes("system-ui")?"selected":""} value="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif">System UI</option>
            <option ${t.font.includes("Georgia")?"selected":""} value="Georgia, 'Times New Roman', serif">Serif (Georgia)</option>
            <option ${t.font.includes("JetBrains")?"selected":""} value="'JetBrains Mono', Consolas, monospace">Monospace (JetBrains Mono)</option>
          </select>
        </div>
      </div>

      <div class="row" style="justify-content:flex-end;">
        <button class="primary" id="saveThemeBtn">Save Theme</button>
      </div>

      <div class="card" style="margin-top:12px;">
        <div style="font-weight:600;margin-bottom:6px;">Presets</div>
        <div class="preset-row">
          ${Object.keys(PRESETS).map(name => `<button class="preset" data-preset="${name}">${name}</button>`).join("")}
        </div>
      </div>
    </div>
  `;

  $("#backMain").onclick = () => go("main");
  $("#saveThemeBtn").onclick = async () => {
    const theme = {
      bg: $("#bgInput").value, fg: $("#fgInput").value,
      card: $("#cardInput").value, cardFg: $("#cardFgInput").value,
      accent: state.theme.accent, 
      font: $("#fontSelect").value,
    };
    state.theme = theme; applyTheme(theme);
    await chrome.storage.sync.set({ theme });
  };
  route.querySelectorAll(".preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      const p = PRESETS[btn.getAttribute("data-preset")];
      state.theme = p; applyTheme(p);
      await chrome.storage.sync.set({ theme: p });
    });
  });
}

// ----- Daily streak & XP (+10 once/day) -----
function dailyStreakAndXP(){
  const today = new Date().toISOString().slice(0,10);
  const last = state.lastActivityDate;
  if (last === today) return;

  if (!last) state.streak = 1;
  else {
    const diffDays = Math.floor((Date.parse(today) - Date.parse(last)) / 86400000);
    state.streak = (diffDays === 1) ? state.streak + 1 : 1;
  }
  state.lastActivityDate = today;
  state.xp = state.xp + 10;
}

//Level-up animation
function levelBurstAnimation(){
  const colors = [getVar("--accent"), "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#a855f7"];
  const container = document.createElement("div");
  container.className = "level-burst";
  for (let i=0;i<28;i++){
    const dot = document.createElement("div");
    dot.className = "dot";
    const angle = Math.random()*2*Math.PI;
    const r = 80 + Math.random()*80;
    const dx = Math.cos(angle)*r + "px";
    const dy = Math.sin(angle)*r + "px";
    dot.style.setProperty("--dx", dx);
    dot.style.setProperty("--dy", dy);
    dot.style.background = colors[i % colors.length];
    dot.style.left = (50 + (Math.random()*10-5)) + "%";
    dot.style.top  = (50 + (Math.random()*10-5)) + "%";
    container.appendChild(dot);
  }
  document.body.appendChild(container);
  setTimeout(()=>container.remove(), 800);
}

//formatting utils 
function getVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function escapeHtml(s){ return (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

function formatSummaryToHTML(text){
  // Bold section headers + real bullets
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { out.push("</ul>"); listOpen = false; } };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (/^[^•*\-].*:\s*$/.test(line)) { // header line ends with ":"
      closeList();
      out.push(`<div><strong>${escapeHtml(line)}</strong></div>`);
      continue;
    }
    const m = line.match(/^(?:[-*•]\s+)(.+)$/);
    if (m) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${escapeHtml(m[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return out.join("");
}
