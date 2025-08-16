// extension/sidepanel.js

const LEVEL_THRESHOLDS = [0,20,60,140,210,350,520,720,950,1210,1500,1820,2170,2550,2960,3400,3870,4370,4900,5460];

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
  accent:"#22c55e", footerBg:"#59B08F",
  font:"system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
};

const PRESETS = {
  Light: { bg:"#f4f6fb", fg:"#0f172a", card:"#ffffff", cardFg:"#111827", accent:"#2563eb", font: DEFAULT_THEME.font },
  Night: { bg:"#0f172a", fg:"#e5e7eb", card:"#0b1220", cardFg:"#e5e7eb", accent:"#22c55e", font: DEFAULT_THEME.font },
  Solar: { bg:"#002b36", fg:"#eee8d5", card:"#073642", cardFg:"#fdf6e3", accent:"#b58900", font: DEFAULT_THEME.font },
  Neon:  { bg:"#0b0b0f", fg:"#e5e5ff", card:"#12121a", cardFg:"#eaeaff", accent:"#7c3aed", font: DEFAULT_THEME.font },
};

const state = {
  route:"main", lastSummary:null, journal:[], selectedEntryId:null,
  xp:0, streak:0, lastActivityDate:null, inflight:null,
  theme:{...DEFAULT_THEME}, inflightTimer:null, selectedMode:null,
};

const $ = (s)=>document.querySelector(s);
const route = $("#route");

init();

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
    state.xp = d.xp ?? 0;
    state.streak = d.streakCurrent ?? 0;
    state.lastActivityDate = d.lastActivityDate ?? null;
    state.lastSummary = d.lastSummary ?? null;
    state.inflight = d.inflight ?? null;
    state.theme = { ...DEFAULT_THEME, ...(d.theme || {}) };
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
      state.theme = { ...DEFAULT_THEME, ...changes.theme.newValue };
      applyTheme(state.theme);
    }
  });

  $("#avatarBtn").addEventListener("click", () => go("main"));
  $("#openJournalBtn").addEventListener("click", () => go("journal"));
  $("#openSettingsBtn").addEventListener("click", () => go("settings"));
  $("#openHelpBtn").addEventListener("click", () => go("help"));
  $("#homeLogo").addEventListener("click", () => go("main"));
  $("#homeTitle").addEventListener("click", () => go("main"));
}

function go(r){ state.route = r; if (r==="main") renderMain(); if (r==="journal") renderJournal(); if (r==="entry") renderEntry(); if (r==="settings") renderSettings(); if (r==="help") renderHelp(); }

function levelFromXP(xp){
  let idx = 0;
  for (let i=0;i<LEVEL_THRESHOLDS.length;i++){ if (xp>=LEVEL_THRESHOLDS[i]) idx=i; else break; }
  const cur = LEVEL_THRESHOLDS[idx]??0, next = LEVEL_THRESHOLDS[idx+1]??LEVEL_THRESHOLDS[idx];
  return { level: idx+1, cur, next };
}

function renderFooter(){
  const { level, cur, next } = levelFromXP(state.xp);
  $("#levelText").textContent = `Level ${level}`;
  $("#streakText").textContent = `🔥 ${state.streak}-day streak`;
  const pct = Math.min(100, Math.floor(((state.xp - cur) / Math.max(1,next-cur)) * 100));
  $("#xpFill").style.width = pct + "%";
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
          ? `<em>no selection detected. highlight text, then click a preset again.</em>`
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
    title, url: state.lastSummary.url,
    selection: state.lastSummary.selection,
    summary: state.lastSummary.summary,
    mode: state.lastSummary.mode || state.selectedMode || "custom",
  };

  const before = levelFromXP(state.xp).level;

  state.journal.unshift(entry);
  dailyStreakAndXP();

  await chrome.storage.sync.set({
    journal: state.journal, xp: state.xp,
    streakCurrent: state.streak, lastActivityDate: state.lastActivityDate,
  });

  const after = levelFromXP(state.xp).level;
  if (after > before) levelBurstAnimation();

  renderFooter();
  go("journal");
}

async function deleteEntryById(id){
  const idx = state.journal.findIndex(e => e.id === id);
  if (idx === -1) return;
  state.journal.splice(idx, 1);
  await chrome.storage.sync.set({ journal: state.journal });
}

function backIcon(){ return `
  <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>`; }

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

function renderHelp(){
  const rows = [
    { id:"skeptic", label:"Skeptic", desc:"Pressure-tests the content: key claims, evidence quality, missing context, assumptions, red flags, what to verify, and a quick counter-argument to stress the idea." },
    { id:"eli5", label:"ELI5", desc:"Explains in plain language with a tiny story. Defines core terms in one line each and ends with a single-sentence recap you can repeat." },
    { id:"researcher", label:"Researcher", desc:"Mini-briefing: what it is, why it matters, how it works at a high level, competing viewpoints, historical context, open questions, and solid directions for further reading." },
    { id:"rhetoric", label:"Rhetoric", desc:"Identifies rhetorical devices (ethos/pathos/logos, framing, contrast, anaphora), quotes the exact phrasing, and explains the intended audience effect." },
    { id:"tutor", label:"Tutor (Cornell)", desc:"Outputs Cornell notes: concise notes, cue questions to self-test later, and a 2–3 sentence summary—emphasizing definitions, relationships, and cause→effect." },
    { id:"interviewer", label:"Interviewer", desc:"Generates a question bank: foundational comprehension, practical application, edge-case probing, plus one or two stretch questions for depth." },
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

function dailyStreakAndXP(){
  const today = new Date().toISOString().slice(0,10);
  const last = state.lastActivityDate;
  if (last === today) return;
  if (!last) state.streak = 1;
  else {
    const diffDays = Math.floor((Date.parse(today) - Date.parse(last)) / 86400000);
    state.streak = (diffDays === 1) ? state.streak + 1 : 1;
  }
  state.lastActivityDate = today; state.xp = state.xp + 10;
}

function levelBurstAnimation(){
  const colors = [getVar("--accent"), "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#a855f7"];
  const container = document.createElement("div"); container.className = "level-burst";
  for (let i=0;i<28;i++){
    const dot = document.createElement("div"); dot.className = "dot";
    const angle = Math.random()*2*Math.PI, r = 80 + Math.random()*80;
    dot.style.setProperty("--dx", Math.cos(angle)*r + "px");
    dot.style.setProperty("--dy", Math.sin(angle)*r + "px");
    dot.style.background = colors[i % colors.length];
    dot.style.left = (50 + (Math.random()*10-5)) + "%";
    dot.style.top  = (50 + (Math.random()*10-5)) + "%";
    container.appendChild(dot);
  }
  document.body.appendChild(container);
  setTimeout(()=>container.remove(), 800);
}

function getVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
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
