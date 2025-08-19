import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ALLOW_ORIGIN || "*" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_CHARS = parseInt(process.env.MAX_CHARS || "3000", 10);

//helpers
const trimInput = (s) => String(s || "").slice(0, MAX_CHARS);
const cleanOutput = (s) =>
  String(s || "")
    .replace(/^\s*(here(?:'|’)s|here is|summary:|explanation:|output:)\s*/i, "")
    .trim();

async function callOpenAI(input) {
  try {
    const r = await openai.responses.create({ model: MODEL, input });
    return r.output_text || "";
  } catch (err) {
    const status = err?.status || err?.code || 500;
    if (status === 429) throw { status, message: "OpenAI quota/limits reached. Check billing/limits." };
    if (status === 401) throw { status, message: "Invalid OpenAI API key. Check OPENAI_KEY." };
    throw { status: 500, message: err?.message || "OpenAI request failed." };
  }
}

//preset prompts
const PROMPTS = {
  skeptic: (text) => `Act as a skeptical reviewer. Output only the sections below.

What’s strong:
- 2–4 bullets

What’s weak:
- 2–4 bullets

Hidden assumptions:
- 2–4 bullets

What to verify:
- 3 checks a careful reader should do

Selection:
${trimInput(text)}`,

  teacher: (text) => `Explain the selection in simpler terms (not childish). Output only the sections below.

Core idea:
- 1–2 bullets

Key terms:
- 2–5 bullets with plain-language definitions

Simple example:
- 1 short example showing how it works

Gotchas:
- 1–3 common misunderstandings or caveats

Selection:
${trimInput(text)}`,

  eli5: (text) => `Explain like I'm 5. Use very simple words and short sentences. Output only the sections.

What it is:
- 2–3 bullets

How it works:
- 2–4 bullets

Little story:
- 2–4 sentences making it tangible

Selection:
${trimInput(text)}`,

  researcher: (text) => `Expand the topic so a motivated reader becomes an informed beginner-to-intermediate. Output only the sections.

Overview:
- 3–5 bullets capturing the big picture

Key concepts:
- 4–7 bullets with crisp definitions

Current debates / trade-offs:
- 3–5 bullets

Further reading:
- 4–6 items (types of sources or classic papers/books; no URLs required)

Practical takeaways:
- 3–5 bullets

Selection:
${trimInput(text)}`,

  rhetoric: (text) => `List rhetorical devices used, each with a short quoted example. Output only the sections.

Devices found:
- device — example quote
- device — example quote
(4–8 items)

Tone & framing:
- 2–4 bullets

Selection:
${trimInput(text)}`,

  tutor: (text) => `Produce Cornell-style notes. Output only the sections.

Notes:
- key points as bullets (7–12)

Cues / Questions:
- 5–8 questions that test understanding

Summary (2–3 sentences):
- a tight recap

Selection:
${trimInput(text)}`,

  interviewer: (text) => `Generate interview questions about the topic. Output only the sections.

Foundational:
- 3–5 questions

Applied:
- 3–5 questions

Deep-dive:
- 3–5 questions

Selection:
${trimInput(text)}`,
};

//routes

// Generic preset endpoint
app.post("/mode", async (req, res) => {
  const { text, mode } = req.body || {};
  if (!text || !mode) return res.status(400).json({ error: "Missing text or mode" });
  const builder = PROMPTS[mode];
  if (!builder) return res.status(400).json({ error: "Unknown mode" });
  try {
    const raw = await callOpenAI(builder(text));
    return res.json({ summary: cleanOutput(raw) });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "openai_error", message: e.message });
  }
});

// Keep exisiting endpoints(that are used by context menu)
app.post("/summarize", async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "No text provided" });
  const prompt = `Summarize the selection concisely using bullet points.
- Keep author terminology when it’s key; quote 1–2 important phrases if helpful.
- End with one line: "Why it matters: …"
- Output only the content. No intro line.

Selection:
${trimInput(text)}`;
  try {
    const raw = await callOpenAI(prompt);
    return res.json({ summary: cleanOutput(raw) });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "openai_error", message: e.message });
  }
});

app.post("/explain", async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "No text provided" });
  const prompt = PROMPTS.teacher(text);
  try {
    const raw = await callOpenAI(prompt);
    return res.json({ summary: cleanOutput(raw) });
  } catch (e) {
    return res.status(e.status || 500).json({ error: "openai_error", message: e.message });
  }
});

// ----
app.listen(3000, () => console.log("API running on http://localhost:3000"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
