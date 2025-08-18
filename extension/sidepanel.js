// extension/sidepanel.js

// Modes
const MODES = [
  { id: "skeptic",    label: "Skeptic" },
  { id: "eli5",       label: "ELI5" },
  { id: "researcher", label: "Researcher" },
  { id: "rhetoric",   label: "Rhetoric" },
  { id: "tutor",      label: "Tutor" },
  { id: "interviewer",label: "Interviewer" },
];

const DEFAULT_THEME = {
  bg:"#f4f6fb", fg:"#0f172a", card:"#ffffff", cardFg:"#111827",
  accent:"#2563eb", footerBg:"#59B08F",
  font:"system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
};

const PRESETS = {
  Light: { bg:"#f4f6fb", fg:"#0f172a", card:"#ffffff", cardFg:"#111827", accent:"#2563eb", font: DEFAULT_THEME.font },
  Night: { bg:"#0f172a", fg:"#e5e7eb", card:"#0b1220", cardFg:"#e5e7eb", accent:"#22c55e", font: DEFAULT_THEME.font },
  Solar: { bg:"#002b36", fg:"#eee8d5", card:"#073642", cardFg:"#fdf6e3", accent:"#b58900", font: DEFAULT_THEME.font },
  Neon:  { bg:"#0b0b0f", fg:"#e5e5ff", card:"#12121a", cardFg:"#eaeaff", accent:"#7c3aed", font: DEFAULT_THEME.font },
};

let AVATARS = []; // loaded from avatars/manifest.json

const state = {
  route:"main",
  lastSummary:null,
  journal:[],
  selectedEntryId:null,

  streak:0,
  lastActivityDate:null,

  inflight:null,
  theme:{...DEFAULT_THEME},
  inflightTimer:null,
  selectedMode:null,

  username:"",
  selectedAvatarId:null,
};

const $ = (s)=>document.querySelector(s);
const route = $("#route");

//bootstrap
bootstrap();

async function bootstrap(){
  await loadAvatars();
  init();
}

async function loadAvatars(){
  try {
    const url = chrome.runtime.getURL("avatars/manifest.json");
    const res = await fetch(url);
    AVATARS = await res.json();
  } catch (e) {
    console.warn("Avatar manifest missing or invalid:", e);
    AVATARS = [];
  }
}

function applyTheme(t){
  const th = { ...DEFAULT_THEME, ...(t||{}) };
  document.documentElement.style.setProperty("--bg", th.bg);
  document.documentElement.style.setProperty("--fg", th.fg);
  document.documentElement.style.setProperty("--card", th.card);
  document.documentElement.style.setProperty("--card-fg", th.cardFg);
  document.documentElement.style.setProperty("--accent", th.accent);
  document.documentElement.style.setProperty("--footer-bg", th.footerBg || DEFAULT_THEME.footerBg);
  document.documentElement.style.setProperty("--font", th.font);
}

function init(){
  chrome.storage.sync.get(null, d => {
    state.journal = d.journal ?? [];
    state.streak = d.streakCurrent ?? 0;
    state.lastActivityDate = d.lastActivityDate ?? null;
    state.lastSummary = d.lastSummary ?? null;
    state.inflight = d.inflight ?? null;
    state.theme = { ...DEFAULT_THEME, ...(d.theme || {}) };
    state.username = d.username ?? "";
    state.selectedAvatarId = d.selectedAvatarId ?? null;

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
    if (changes.journal || changes.streakCurrent || changes.username || changes.selectedAvatarId) {
      state.journal = changes.journal?.newValue ?? state.journal;
      state.streak = changes.streakCurrent?.newValue ?? state.streak;
      state.username = changes.username?.newValue ?? state.username;
      state.selectedAvatarId = changes.selectedAvatarId?.newValue ?? state.selectedAvatarId;
      renderFooter();
    }
    if (changes.theme?.newValue) {
      state.theme = { ...DEFAULT_THEME, ...changes.theme.newValue };
      applyTheme(state.theme);
    }
  });

  $("#avatarBtn").addEventListener("click", () => go("avatars"));
  $("#openJournalBtn").addEventListener("click", () => go("journal"));
  $("#openSettingsBtn").addEventListener("click", () => go("settings"));
  $("#openHelpBtn").addEventListener("click", () => go("help"));
  $("#homeLogo").addEventListener("click", () => go("main"));
  $("#homeTitle").addEventListener("click", () => go("main"));

  // Clicking the username also opens avatar/username editor
  const nameEl = document.getElementById("usernameText");
  if (nameEl) nameEl.addEventListener("click", () => go("avatars"));
}

function go(r){
  state.route = r;
  if (r==="main") renderMain();
  if (r==="journal") renderJournal();
  if (r==="entry") renderEntry();
  if (r==="settings") renderSettings();
  if (r==="help") renderHelp();
  if (r==="avatars") renderAvatars();
}

function renderFooter(){
  // username + streak
  const name = state.username?.trim();
  const nameEl = $("#usernameText");
  // placeholder text
  const isPlaceholder = !name;
  nameEl.textContent = name || "edit profile";
  // underline only when placeholder is shown
  nameEl.classList.toggle("clickable", isPlaceholder);

  $("#streakText").textContent = `🔥 ${state.streak}-day streak`;

  // avatar image on the button (default picture png when none selected)
  const btn = document.querySelector("#avatarBtn");
  const avatar = AVATARS.find(a => a.id === state.selectedAvatarId);
  const url = avatar
    ? chrome.runtime.getURL(avatar.src)
    : chrome.runtime.getURL("avatars/default.png");

  btn.style.backgroundImage = `url("${url}")`;
  btn.style.backgroundSize = "cover";
  btn.style.backgroundPosition = "center";
  btn.textContent = "";
  btn.style.border = "none";
}

function modeChips(){
  return `
    <div class="chips">
      ${MODES.map(m => `<button class="chip ${m.id===state.selectedMode?'active':''}" data-mode="${m.id}">${m.label}</button>`).join("")}
    </div>
  `;
}

function renderMain(){
  route.innerHTML = `
    <div class="card">
      ${modeChips()}
      <div class="row"><input id="titleInput" placeholder="add a title for this entry…"/></div>
      <div style="height:8px"></div>
      <div class="card" style="background:#f8fafc;">
        <div id="responseBox" style="min-height:160px;"></div>
      </div>
    </div>
    <div class="center-row"><button class="primary" id="saveBtn">Save</button></div>
  `;

  $("#saveBtn").onclick = saveEntry;

  route.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedMode = btn.getAttribute("data-mode");
      renderMain();
      runPreset(state.selectedMode);
    });
  });

  const box = $("#responseBox");
  const saveBtn = $("#saveBtn");
  const hasRealSummary = state.lastSummary?.summary && !/^\(Choose a mode to process\.\)$/.test(state.lastSummary.summary);

  if (state.inflight) {
    box.innerHTML = loadingRow(`working on ${labelForMode(state.inflight.mode).toLowerCase()}…`);
    saveBtn.disabled = true;
  } else if (hasRealSummary) {
    box.innerHTML = formatSummaryToHTML(state.lastSummary.summary);
    saveBtn.disabled = false;
  } else {
    box.innerHTML = `<em>no output yet. select text on the page, then choose a mode…</em>`;
    saveBtn.disabled = true;
  }
}

function loadingRow(text){
  return `
    <div class="row" style="gap:8px;align-items:center;">
      <div class="spinner" aria-label="Loading"></div>
      <div>${escapeHtml(text || "loading…")}</div>
    </div>`;
}

function labelForMode(id){ return MODES.find(m=>m.id===id)?.label || "Mode"; }

async function runPreset(modeId){
  const meta = { mode: modeId, ts: Date.now(), title: state.lastSummary?.title || "", url: state.lastSummary?.url || "" };
  await chrome.storage.sync.set({ inflight: meta });

  if (state.inflightTimer) clearTimeout(state.inflightTimer);
  state.inflightTimer = setTimeout(() => {
    if (!state.inflight) return;
    const box = $("#responseBox");
    if (box) box.innerHTML = loadingRow("still working…");
  }, 12000);

  chrome.runtime.sendMessage({ type:"runPresetFromPanel", mode: modeId }, (resp) => {
    if (!resp) return;
    if (resp.ok === false) {
      chrome.storage.sync.remove("inflight", () => {
        const box = $("#responseBox");
        if (!box) return;
        box.innerHTML = resp.error==="no_selection"
          ? `<em>no selection detected. highlight text on the page, then click a preset again.</em>`
          : `<em>error: ${escapeHtml(resp.error || "request failed")}</em>`;
      });
    }
  });
}

async function saveEntry(){
  if (!state.lastSummary?.summary || /^\(Choose a mode to process\.\)$/.test(state.lastSummary.summary)) return;
  const title = $("#titleInput").value?.trim() || state.lastSummary.title || "Untitled";
  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title,
    url: state.lastSummary.url,
    selection: state.lastSummary.selection,
    summary: state.lastSummary.summary,
    mode: state.lastSummary.mode || state.selectedMode || "custom",
  };

  state.journal.unshift(entry);
  bumpStreakIfNewDay();

  await chrome.storage.sync.set({
    journal: state.journal,
    streakCurrent: state.streak,
    lastActivityDate: state.lastActivityDate,
  });

  renderFooter();
  go("journal");
}

function bumpStreakIfNewDay(){
  const today = new Date().toISOString().slice(0,10);
  const last = state.lastActivityDate;
  if (last === today) return;

  if (!last) state.streak = 1;
  else {
    const diffDays = Math.floor((Date.parse(today) - Date.parse(last)) / 86400000);
    state.streak = (diffDays === 1) ? state.streak + 1 : 1;
  }
  state.lastActivityDate = today;
}

// Journal
function backIcon(){ return `
  <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>`; }

async function deleteEntryById(id){
  const idx = state.journal.findIndex(e => e.id === id);
  if (idx === -1) return;
  state.journal.splice(idx, 1);
  await chrome.storage.sync.set({ journal: state.journal });
}

function renderJournal(){
  const items = state.journal.map(e => `
    <div class="item" data-id="${e.id}">
      <div class="row" style="justify-content:space-between; align-items:flex-start; margin-top:0;">
        <div>
          <div style="font-weight:600;">${escapeHtml(e.title)}</div>
          <div style="font-size:12px;color:#475569;">${new Date(e.createdAt).toLocaleString()}</div>
        </div>
        <button class="danger" data-del="${e.id}" title="Delete">Delete</button>
      </div>
    </div>`).join("");

  route.innerHTML = `
    <div class="row">
      <button class="icon-btn" id="backMain" title="Back" aria-label="Back">${backIcon()}</button>
    </div>
    <div class="list">${items || '<div class="card">No entries yet.</div>'}</div>
  `;

  $("#backMain").onclick = () => go("main");

  route.querySelectorAll(".item").forEach(el => {
    el.addEventListener("click", () => { state.selectedEntryId = el.getAttribute("data-id"); go("entry"); });
  });
  route.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation(); await deleteEntryById(btn.getAttribute("data-del")); renderJournal();
    });
  });
}

function renderEntry(){
  const e = state.journal.find(j => j.id === state.selectedEntryId);
  if (!e) { go("journal"); return; }

  route.innerHTML = `
    <div class="row" style="justify-content:space-between;">
      <button class="icon-btn" id="backJour" title="Back" aria-label="Back">${backIcon()}</button>
      <button class="danger" id="deleteEntryBtn">Delete</button>
    </div>
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
  $("#deleteEntryBtn").onclick = async () => { await deleteEntryById(e.id); go("journal"); };
}

// Help
function renderHelp(){
  const rows = [
    { id:"skeptic", label:"Skeptic", desc:"Critiques the text! Touches on key claims, evidence quality, missing context, assumptions, red flags, what to verify, and adds a quick counter-argument to stress the idea." },
    { id:"eli5", label:"ELI5", desc:"Explains in plain language like you are 5 years-old with a tiny story. Defines core terms in one line each and ends with a single-sentence recap you can repeat." },
    { id:"researcher", label:"Researcher", desc:"Mini-briefing: what it is, why it matters, how it works at a high level, competing viewpoints, historical context, open questions, and solid directions for further reading." },
    { id:"rhetoric", label:"Rhetoric", desc:"Identifies rhetorical devices (ethos/pathos/logos, framing, contrast, repetition), quotes the exact phrasing, and explains the intended audience effect." },
    { id:"tutor", label:"Tutor", desc:"Outputs Cornell notes: concise bullets, cue questions for self-testing, and a 2–3 sentence summary." },
    { id:"interviewer", label:"Interviewer", desc:"Generates a question bank to help you for your next interview: comprehension, application, edge cases, and stretch questions for depth." },
  ];

  route.innerHTML = `
    <div class="row"><button class="icon-btn" id="backMain" title="Back" aria-label="Back">${backIcon()}</button></div>
    <div class="list" style="margin-top:8px;">
      ${rows.map(r=>`
        <div class="item">
          <div><strong>${r.label}</strong></div>
          <div style="font-size:13px;color:#475569;margin-top:6px;">${r.desc}</div>
        </div>
      `).join("")}
    </div>
  `;
  $("#backMain").onclick = () => go("main");
}

// Settings (Theme Studio)
function renderSettings(){
  const t = state.theme || DEFAULT_THEME;
  route.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:600;">Theme Studio</div>
        <button class="icon-btn" id="backMain" title="Back" aria-label="Back">${backIcon()}</button>
      </div>

      <div class="settings-grid" style="margin-top:8px;">
        <div><label>Background</label><input type="color" id="bgInput" value="${t.bg}"/></div>
        <div><label>Text</label><input type="color" id="fgInput" value="${t.fg}"/></div>
        <div><label>Card</label><input type="color" id="cardInput" value="${t.card}"/></div>
        <div><label>Card Text</label><input type="color" id="cardFgInput" value="${t.cardFg}"/></div>
        <div><label>Footer bar</label><input type="color" id="footerBgInput" value="${t.footerBg || '#59B08F'}"/></div>
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
      bg: $("#bgInput").value,
      fg: $("#fgInput").value,
      card: $("#cardInput").value,
      cardFg: $("#cardFgInput").value,
      accent: state.theme.accent,
      footerBg: $("#footerBgInput").value,
      font: $("#fontSelect").value,
    };
    state.theme = theme; applyTheme(theme);
    await chrome.storage.sync.set({ theme });
  };

  route.querySelectorAll(".preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = btn.getAttribute("data-preset");
      const base = PRESETS[name] || {};
      const p = { ...base };
      if (!p.footerBg) p.footerBg = state.theme.footerBg || DEFAULT_THEME.footerBg;
      state.theme = { ...DEFAULT_THEME, ...p };
      applyTheme(state.theme);
      await chrome.storage.sync.set({ theme: state.theme });
    });
  });
}

// Avatars
function renderAvatars(){
  const current = state.selectedAvatarId;

  const grid = AVATARS.map(a => {
    const url = chrome.runtime.getURL(a.src);
    const sel = a.id === current ? "selected" : "";
    return `
      <div class="avatar-tile ${sel}" data-id="${a.id}" title="${a.label}">
        <img src="${url}" alt="${a.label}"/>
      </div>`;
  }).join("");

  route.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:600;">Choose your avatar</div>
        <button class="icon-btn" id="backMain" title="Back" aria-label="Back">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
      </div>

      <div class="username-row">
        <label style="min-width:80px;">Username</label>
        <input id="usernameInput" placeholder="enter a display name…" value="${state.username || ""}"/>
      </div>

      <div class="avatar-grid">${grid}</div>

      <div class="row" style="justify-content:flex-end; margin-top:12px;">
        <button class="primary" id="saveAvatarBtn" style="background:var(--footer-bg)">Save</button>
      </div>
    </div>
  `;

  $("#backMain").onclick = () => go("main");

  // Select avatar
  route.querySelectorAll(".avatar-tile").forEach(tile => {
    tile.addEventListener("click", () => {
      route.querySelectorAll(".avatar-tile").forEach(t => t.classList.remove("selected"));
      tile.classList.add("selected");
      state.selectedAvatarId = tile.getAttribute("data-id");
    });
  });

  // Save username + avatar
  $("#saveAvatarBtn").onclick = async () => {
    const username = $("#usernameInput").value.trim();
    state.username = username;
    await chrome.storage.sync.set({
      username,
      selectedAvatarId: state.selectedAvatarId
    });
    renderFooter();
    go("main");
  };
}

//utils
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function formatSummaryToHTML(text){
  const lines = String(text||"").split(/\r?\n/), out=[]; let listOpen=false;
  const closeList=()=>{ if(listOpen){ out.push("</ul>"); listOpen=false; } };
  for (let raw of lines){
    const line = raw.trim(); if(!line){ closeList(); continue; }
    if (/^[^•*\-].*:\s*$/.test(line)) { closeList(); out.push(`<div><strong>${escapeHtml(line)}</strong></div>`); continue; }
    const m = line.match(/^(?:[-*•]\s+)(.+)$/);
    if (m) { if(!listOpen){ out.push("<ul>"); listOpen=true; } out.push(`<li>${escapeHtml(m[1])}</li>`); continue; }
    closeList(); out.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList(); return out.join("");
}
