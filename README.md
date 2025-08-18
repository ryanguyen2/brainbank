# BrainBank — Your Knowledge Journal (Chrome Side-Panel)

A Chrome side-panel extension that lets you highlight text on any page and instantly transform it with **intelligence presets** (ELI5, Skeptic, Researcher, etc.). Save clean, formatted responses to a **personal journal** you can look back on, track your **streak**, and customize your look with **themes** and **avatars**—all in one stylish panel. Whether you want to expand more on a topic, critique the text, generate notes instantly, get interviewed on the topic, identify any literary devices, or have the information explained like you're 5, BrainBank is your GO-TO tool!

🔗 **Try it out** (dev): load the `extension/` folder via `chrome://extensions` and run the local API (see setup below).

---

## 🧰 Languages / Tools

**Extension (MV3):** JavaScript, HTML, CSS  
**Backend API:** Node.js (Express), OpenAI API  
**Storage:** `chrome.storage.sync` (journal, theme, streak, profile)  
**Assets:** PNG icons/avatars

---

## ✨ Key Features

- 🔍 **One-click capture** — Select text → choose a preset → get a clean, structured result
- 🧠 **Intelligence presets** — *Skeptic, ELI5, Researcher, Rhetoric, Tutor (Cornell), Interviewer*
- 💾 **Save to journal** — Title, source link, original selection, generated output
- 🔥 **Streaks** — Tracks consecutive daily usage
- 🧑‍🎨 **Theme Studio** — Color & font picker + built-in presets (Light, Night, Solar, Neon)
- 🖼️ **Avatars & profile** — Choose an avatar, set a username (footer shows both)
- ⚡ **Side panel UX** — Opens from toolbar or keyboard (default: **Alt+K**)

---

## 🧩 Technical Highlights

- **API Integration & Prompting**  
  - Backend exposes a clean `POST /mode` endpoint, where each mode corresponds to a structured prompt builder (skeptic, teacher, eli5, etc.).  
  - Uses the OpenAI **Responses API** with error handling for rate limits (`429`) and invalid keys (`401`).  

- **Manifest V3 + Side Panel**  
  - Built on Chrome Manifest V3 with a background **service worker** (`background.js`).  
  - Uses the modern `side_panel` API (Chrome 114+) for native panel integration.  
  - Falls back if side panel is unavailable (opens in a new tab).  
  - Commands (keyboard shortcuts) configured for quick open and summarize. (Alt + K)

- **Sync-First Architecture**  
  - All user data (journal entries, themes, streaks, profile) stored in `chrome.storage.sync`.  
  - This means the journal and settings follow the user across Chrome instances if sync is enabled.  
  - Extension handles async storage updates and re-renders dynamically without reloads.

- **Componentized Vanilla UI**  
  - The panel is structured around “routes”: **main, journal, entry, settings, avatars, help**.  
  - Each section is rendered by `sidepanel.js` with clean DOM building functions instead of heavy frameworks.  
  - **Reusable components**: chips, cards, and footer elements styled by CSS variables for easy theme switching.  
  - Journaling entries store metadata (title, source URL, selection, mode, generated output) in a consistent schema.
