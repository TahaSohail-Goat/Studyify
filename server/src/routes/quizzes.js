import express from "express";
import { Note } from "../models/Note.js";
import { Quiz } from "../models/Quiz.js";
import { UPLOADS_DIR } from "../middleware/upload.js";
import { requireAuth } from "../middleware/auth.js";
import { chatComplete } from "../utils/aiProviders.js";
import { extractNoteText, isIndexable } from "../utils/extractText.js";

const router = express.Router();
router.use(requireAuth);

const QUIZ_MODEL = "llama-3.3-70b-versatile";
const MAX_CHARS = 12000;        // cap source text per request

const DEFAULT_MCQ = 50;
const DEFAULT_SAQ = 20;
const MAX_MCQ_GEN = 100;        // most we'll attempt in one generate
const MAX_SAQ_GEN = 60;
const MORE_MAX = 50;            // most a single "add more" can request
const TOTAL_MCQ_CAP = 300;      // hard ceiling for a stored quiz
const TOTAL_SAQ_CAP = 200;

const QUIZ_SYSTEM =
  "You are an expert exam author. You write accurate, unambiguous questions grounded " +
  "strictly in the material you are given. When asked for JSON you output only valid " +
  "JSON — no commentary, no explanations outside the JSON, and no markdown code fences.";

// ── Helpers ───────────────────────────────────────────────────────────────────
function toInt(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
const normalize = (q) => String(q).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Pull plain text out of a stored note (PDF / TXT / PPTX / DOCX).
function extractText(note) {
  return extractNoteText(note, UPLOADS_DIR);
}

// Tolerantly pull a JSON array out of a model reply (handles fences / stray prose).
function parseJsonArray(raw) {
  if (!raw) return [];
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.questions)) return v.questions;
  } catch {
    /* fall through to slice extraction */
  }

  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const v = JSON.parse(s.slice(start, end + 1));
      if (Array.isArray(v)) return v;
    } catch {
      /* fall through to object extraction */
    }
  }

  // Last resort: pull out every complete {...} object. This survives a truncated
  // or slightly malformed array (e.g. the model ran out of tokens mid-list).
  return extractJsonObjects(s);
}

// Scan a string and JSON-parse each balanced top-level {...} block, skipping any
// that don't parse. Recovers as many question objects as possible.
function extractJsonObjects(s) {
  const objs = [];
  let depth = 0, startIdx = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth === 0) startIdx = i; depth++; }
    else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        try { objs.push(JSON.parse(s.slice(startIdx, i + 1))); } catch { /* skip */ }
        startIdx = -1;
      }
    }
  }
  return objs;
}

// Work out the correct option index from whatever shape the model returned.
function resolveCorrectIndex(item, options) {
  const idxFields = [item.correctIndex, item.answerIndex, item.correct_index];
  for (const f of idxFields) if (Number.isInteger(f)) return f;

  const ans = item.answer ?? item.correct ?? item.correctAnswer ?? item.correct_option ?? item.correctOption;
  if (typeof ans === "number" && Number.isInteger(ans)) return ans;
  if (typeof ans === "string") {
    const a = ans.trim();
    if (/^\(?([A-Fa-f])\)?$/.test(a)) return a.replace(/[()]/g, "").toUpperCase().charCodeAt(0) - 65;
    const m = a.match(/^\(?([A-Fa-f])[).:\s]/);
    if (m) return m[1].toUpperCase().charCodeAt(0) - 65;

    const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const na = norm(a);
    if (na) {
      const exact = options.findIndex((o) => norm(o) === na);
      if (exact !== -1) return exact;
      const partial = options.findIndex((o) => {
        const no = norm(o);
        return no && (no.includes(na) || na.includes(no));
      });
      if (partial !== -1) return partial;
    }
  }
  return null;
}

function sanitizeMcq(item) {
  if (!item || typeof item.question !== "string") return null;
  let options = Array.isArray(item.options)
    ? item.options.map((o) => String(o).trim()).filter(Boolean)
    : [];
  if (options.length < 2) return null;
  options = options.slice(0, 6);
  const idx = resolveCorrectIndex(item, options);
  if (idx == null || idx < 0 || idx >= options.length) return null;
  return {
    question: item.question.trim(),
    options,
    correctIndex: idx,
    explanation: typeof item.explanation === "string" ? item.explanation.trim() : "",
  };
}

function sanitizeSaq(item) {
  if (!item || typeof item.question !== "string") return null;
  const answer =
    typeof item.answer === "string"
      ? item.answer.trim()
      : typeof item.modelAnswer === "string"
      ? item.modelAnswer.trim()
      : "";
  if (!answer) return null;
  return { question: item.question.trim(), answer };
}

function mcqPrompt(text, n, avoid) {
  return [
    `Create ${n} multiple-choice questions that test a student's understanding of the material below.`,
    "Rules:",
    "- Each question must have exactly 4 options and exactly one correct answer.",
    "- Base every question strictly on the material; do not ask about anything not present.",
    "- Make the wrong options plausible but clearly incorrect.",
    "- Cover different parts of the material and vary the difficulty.",
    avoid.length
      ? `- Do NOT repeat or paraphrase any of these already-used questions:\n${avoid.map((a) => `  • ${a}`).join("\n")}`
      : "",
    "",
    'Return ONLY a JSON object of the form {"questions": [ ... ]} — no prose, no markdown.',
    'Each element of "questions" must be exactly:',
    '{"question": string, "options": [string, string, string, string], "correctIndex": number, "explanation": string}',
    '"correctIndex" is the 0-based index into "options". "explanation" is one short sentence.',
    "",
    "Material:",
    "---",
    text,
  ]
    .filter(Boolean)
    .join("\n");
}

function saqPrompt(text, n, avoid) {
  return [
    `Create ${n} short-answer questions that test a student's understanding of the material below.`,
    "Rules:",
    "- Each question should be answerable in 1-3 sentences.",
    "- Base every question strictly on the material.",
    "- Provide a concise, correct model answer for each.",
    avoid.length
      ? `- Do NOT repeat or paraphrase any of these already-used questions:\n${avoid.map((a) => `  • ${a}`).join("\n")}`
      : "",
    "",
    'Return ONLY a JSON object of the form {"questions": [ ... ]} — no prose, no markdown.',
    'Each element of "questions" must be exactly:',
    '{"question": string, "answer": string}',
    "",
    "Material:",
    "---",
    text,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate `target` unique questions of a kind by calling the model in batches.
 * `existing` is an array of question strings to avoid duplicating.
 * On a mid-run AI error we keep and return whatever we already have.
 */
async function generateQuestions({ kind, text, target, existing = [], model }) {
  const out = [];
  const seen = new Set();
  const avoidList = [];
  for (const q of existing) {
    seen.add(normalize(q));
    avoidList.push(q);
  }

  // Smaller batches keep each JSON reply well within the token budget (truncated
  // JSON was the main cause of "0 questions").
  const batch = 10;
  const maxAttempts = Math.ceil(target / batch) + 3;
  let attempts = 0;

  while (out.length < target && attempts < maxAttempts) {
    attempts++;
    const need = Math.min(batch, target - out.length);
    const avoid = avoidList.slice(-50);
    const prompt = kind === "mcq" ? mcqPrompt(text, need, avoid) : saqPrompt(text, need, avoid);

    let raw;
    try {
      raw = await chatComplete(model, [{ role: "user", content: prompt }], {
        system: QUIZ_SYSTEM,
        temperature: 0.6,
        maxTokens: kind === "mcq" ? 4096 : 2600,
        responseFormat: { type: "json_object" }, // force valid JSON, never prose
      });
    } catch (err) {
      if (out.length) break; // partial success — keep what we have
      throw err; // nothing generated yet — surface the error
    }

    const items = parseJsonArray(raw);
    if (items.length === 0) {
      console.warn(`quiz ${kind}: unparseable reply (len ${raw.length}). Starts: ${raw.slice(0, 160)}`);
    }

    let added = 0;
    for (const item of items) {
      const q = kind === "mcq" ? sanitizeMcq(item) : sanitizeSaq(item);
      if (!q) continue;
      const norm = normalize(q.question);
      if (seen.has(norm)) continue;
      seen.add(norm);
      avoidList.push(q.question);
      out.push(q);
      added++;
      if (out.length >= target) break;
    }

    if (added === 0) break; // a whole batch produced nothing new — stop spinning
  }

  return out;
}

async function loadOwnedNote(req, res) {
  const note = await Note.findById(req.params.noteId);
  if (!note) {
    res.status(404).json({ message: "File not found." });
    return null;
  }
  if (note.userId.toString() !== req.userId) {
    res.status(403).json({ message: "Access denied." });
    return null;
  }
  if (!isIndexable(note.mimetype, note.originalName)) {
    res.status(400).json({ message: "Only PDF, PowerPoint, Word, and text files can be turned into a quiz." });
    return null;
  }
  return note;
}

async function getSourceText(note, res) {
  let text;
  try {
    text = await extractText(note);
  } catch (err) {
    res.status(400).json({ message: err.message });
    return null;
  }
  if (!text.trim()) {
    res.status(422).json({
      message: "No readable text found — this file may be scanned images rather than text.",
    });
    return null;
  }
  const truncated = text.length > MAX_CHARS;
  return { source: truncated ? text.slice(0, MAX_CHARS) : text, truncated };
}

// ── GET /api/quizzes ──────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const quizzes = await Quiz.find({ userId: req.userId }).sort({ updatedAt: -1 });
    res.json({ quizzes });
  } catch (err) {
    console.error("list quizzes error:", err.message);
    res.status(500).json({ message: "Could not load quizzes." });
  }
});

// ── POST /api/quizzes/:noteId/generate ────────────────────────────────────────
// body: { types: ["mcq","saq"], mcqCount, saqCount }
router.post("/:noteId/generate", async (req, res) => {
  try {
    const note = await loadOwnedNote(req, res);
    if (!note) return;

    const { types, mcqCount, saqCount } = req.body || {};
    const wantMcq = Array.isArray(types) && types.includes("mcq");
    const wantSaq = Array.isArray(types) && types.includes("saq");
    if (!wantMcq && !wantSaq)
      return res.status(400).json({ message: "Choose at least one question type (MCQ or short answer)." });

    const nMcq = wantMcq ? clamp(toInt(mcqCount, DEFAULT_MCQ), 1, MAX_MCQ_GEN) : 0;
    const nSaq = wantSaq ? clamp(toInt(saqCount, DEFAULT_SAQ), 1, MAX_SAQ_GEN) : 0;

    const src = await getSourceText(note, res);
    if (!src) return;
    console.log(`quiz generate: "${note.originalName}" → ${src.source.length} chars of text`);

    let mcqs = [];
    let saqs = [];
    try {
      if (wantMcq)
        mcqs = await generateQuestions({ kind: "mcq", text: src.source, target: nMcq, model: QUIZ_MODEL });
      if (wantSaq)
        saqs = await generateQuestions({ kind: "saq", text: src.source, target: nSaq, model: QUIZ_MODEL });
    } catch (err) {
      return res.status(502).json({ message: err.message || "The AI request failed." });
    }

    if (mcqs.length === 0 && saqs.length === 0)
      return res.status(502).json({
        message: "The AI couldn't produce questions from this material. Try a different or longer file.",
      });

    const quiz = await Quiz.findOneAndUpdate(
      { userId: req.userId, noteId: note._id },
      {
        userId: req.userId,
        noteId: note._id,
        noteName: note.originalName,
        mcqs,
        saqs,
        model: QUIZ_MODEL,
        truncated: src.truncated,
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    const short = [];
    if (wantMcq && mcqs.length < nMcq) short.push(`${mcqs.length} of ${nMcq} MCQs`);
    if (wantSaq && saqs.length < nSaq) short.push(`${saqs.length} of ${nSaq} short-answer questions`);
    const notice = short.length
      ? `Only ${short.join(" and ")} could be generated from this material. Use "Add more" or try a longer file.`
      : "";

    res.json({ quiz, notice });
  } catch (err) {
    console.error("generate quiz error:", err.message);
    res.status(500).json({ message: "Could not generate the quiz." });
  }
});

// ── POST /api/quizzes/:noteId/more ────────────────────────────────────────────
// body: { kind: "mcq" | "saq", count }
router.post("/:noteId/more", async (req, res) => {
  try {
    const note = await loadOwnedNote(req, res);
    if (!note) return;

    const { kind } = req.body || {};
    if (kind !== "mcq" && kind !== "saq")
      return res.status(400).json({ message: "Invalid question type." });
    const n = clamp(toInt(req.body?.count, kind === "mcq" ? 10 : 5), 1, MORE_MAX);

    const quiz = await Quiz.findOne({ userId: req.userId, noteId: note._id });
    if (!quiz) return res.status(404).json({ message: "Generate a quiz first." });

    const current = kind === "mcq" ? quiz.mcqs.length : quiz.saqs.length;
    const cap = kind === "mcq" ? TOTAL_MCQ_CAP : TOTAL_SAQ_CAP;
    if (current >= cap)
      return res.status(400).json({ message: `This quiz already has the maximum number of ${kind === "mcq" ? "MCQs" : "short-answer questions"}.` });
    const room = cap - current;
    const target = Math.min(n, room);

    const src = await getSourceText(note, res);
    if (!src) return;

    const existing = (kind === "mcq" ? quiz.mcqs : quiz.saqs).map((q) => q.question);

    let more;
    try {
      more = await generateQuestions({ kind, text: src.source, target, existing, model: QUIZ_MODEL });
    } catch (err) {
      return res.status(502).json({ message: err.message || "The AI request failed." });
    }

    if (more.length === 0)
      return res.status(502).json({
        message: "Couldn't generate more unique questions from this material.",
      });

    if (kind === "mcq") quiz.mcqs.push(...more);
    else quiz.saqs.push(...more);
    quiz.truncated = quiz.truncated || src.truncated;
    await quiz.save();

    res.json({ quiz, added: more.length });
  } catch (err) {
    console.error("add quiz questions error:", err.message);
    res.status(500).json({ message: "Could not add more questions." });
  }
});

// ── DELETE /api/quizzes/:id ───────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found." });
    if (quiz.userId.toString() !== req.userId)
      return res.status(403).json({ message: "Access denied." });

    await Quiz.deleteOne({ _id: quiz._id });
    res.json({ message: "Quiz deleted." });
  } catch (err) {
    console.error("delete quiz error:", err.message);
    res.status(500).json({ message: "Could not delete the quiz." });
  }
});

export default router;
