import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Brain, FileText, Sparkles, RotateCcw, Trash2, Plus, Play,
  AlertCircle, Upload, ListChecks,
} from "lucide-react";
import AppLayout from "../components/AppLayout.jsx";
import QuizTaker from "../components/QuizTaker.jsx";
import { getNotesApi } from "../api/notes.js";
import { getQuizzesApi, generateQuizApi, addQuizQuestionsApi, deleteQuizApi } from "../api/quizzes.js";

const SUMMARIZABLE = new Set([
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const SUMMARIZABLE_EXT = /\.(pdf|txt|pptx|docx)$/i;
const canQuiz = (n) => SUMMARIZABLE.has(n.mimetype) || SUMMARIZABLE_EXT.test(n.originalName || "");
const DEFAULT_CFG = { mcqCount: 50, moreMcq: 10 };

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Quizzes() {
  const [notes, setNotes]           = useState([]);
  const [byNote, setByNote]         = useState({}); // noteId -> quiz
  const [cfg, setCfg]               = useState({}); // noteId -> config
  const [loading, setLoading]       = useState(true);
  const [busyId, setBusyId]         = useState(null); // note generating
  const [busyMore, setBusyMore]     = useState(null); // noteId adding more
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [error, setError]           = useState("");
  const [noticeFor, setNoticeFor]   = useState({}); // noteId -> notice
  const [takingId, setTakingId]     = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ notes }, { quizzes }] = await Promise.all([getNotesApi(), getQuizzesApi()]);
      setNotes(notes.filter(canQuiz));
      const map = {};
      quizzes.forEach((q) => { map[q.noteId] = q; });
      setByNote(map);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const getCfg = (noteId) => cfg[noteId] || DEFAULT_CFG;
  function patchCfg(noteId, patch) {
    setCfg((p) => ({ ...p, [noteId]: { ...(p[noteId] || DEFAULT_CFG), ...patch } }));
  }

  async function handleGenerate(noteId, count) {
    setError("");
    setNoticeFor((p) => ({ ...p, [noteId]: "" }));
    setBusyId(noteId);
    try {
      const { quiz, notice } = await generateQuizApi(noteId, { types: ["mcq"], mcqCount: count });
      setByNote((p) => ({ ...p, [noteId]: quiz }));
      if (notice) setNoticeFor((p) => ({ ...p, [noteId]: notice }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddMore(noteId, count) {
    setError("");
    setBusyMore(noteId);
    try {
      const { quiz, added } = await addQuizQuestionsApi(noteId, "mcq", count);
      setByNote((p) => ({ ...p, [noteId]: quiz }));
      setNoticeFor((p) => ({ ...p, [noteId]: `Added ${added} question${added === 1 ? "" : "s"}.` }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyMore(null);
    }
  }

  async function handleDelete(quizId, noteId) {
    if (confirmDelId !== quizId) { setConfirmDelId(quizId); return; }
    try {
      await deleteQuizApi(quizId);
      setByNote((p) => { const n = { ...p }; delete n[noteId]; return n; });
      setNoticeFor((p) => ({ ...p, [noteId]: "" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirmDelId(null);
    }
  }

  // ── Quiz-taking mode takes over the whole page ──────────────────────────────
  if (takingId && byNote[takingId]) {
    return (
      <AppLayout title="Quiz">
        <QuizTaker quiz={byNote[takingId]} onExit={() => setTakingId(null)} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Quizzes">
      <div className="page-header">
        <h1>Quizzes</h1>
        <p>Generate multiple-choice quizzes from your notes, then test yourself.</p>
      </div>

      {error && (
        <div className="settings-alert settings-alert--error" style={{ marginBottom: 18 }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {loading ? (
        <div className="summary-list">
          {[0, 1].map((i) => <div key={i} className="summary-skeleton" />)}
        </div>
      ) : notes.length === 0 ? (
        <div className="summary-empty">
          <div className="summary-empty__icon"><Brain size={28} /></div>
          <h2>Nothing to quiz yet</h2>
          <p>Upload a PDF, slides, or document and it'll show up here, ready to turn into a quiz.</p>
          <Link to="/notes" className="summary-btn"><Upload size={15} /> Go to My Notes</Link>
        </div>
      ) : (
        <div className="summary-list">
          {notes.map((note) => {
            const quiz = byNote[note._id];
            const c = getCfg(note._id);
            const busy = busyId === note._id;
            const notice = noticeFor[note._id];

            return (
              <div className="summary-card" key={note._id}>
                <div className="summary-card__head">
                  <div className="summary-file">
                    <div className="summary-file__icon"><FileText size={18} /></div>
                    <div className="summary-file__meta">
                      <div className="summary-file__name">{note.originalName}</div>
                      <div className="summary-file__sub">
                        {formatBytes(note.size)}
                        {" · "}
                        {quiz
                          ? `${quiz.mcqs.length} question${quiz.mcqs.length === 1 ? "" : "s"} · ${timeAgo(quiz.updatedAt)}`
                          : "No quiz yet"}
                      </div>
                    </div>
                  </div>

                  {quiz && !busy && (
                    <div className="summary-card__action">
                      <button className="summary-btn" onClick={() => setTakingId(note._id)}>
                        <Play size={14} /> Take quiz
                      </button>
                    </div>
                  )}
                </div>

                {/* Generating spinner */}
                {busy && (
                  <div className="summary-loading">
                    <span className="summary-spin" /> Writing your questions… this can take up to a minute.
                  </div>
                )}

                {/* No quiz yet → configuration panel */}
                {!quiz && !busy && (
                  <div className="quiz-config">
                    <div className="quiz-type-row">
                      <span className="quiz-config__label">Number of questions</span>
                      <div className="quiz-count">
                        <input
                          type="number" min="1" max="100"
                          value={c.mcqCount}
                          onChange={(e) => patchCfg(note._id, { mcqCount: e.target.value })}
                        />
                      </div>
                    </div>
                    <button className="summary-btn" onClick={() => handleGenerate(note._id, c.mcqCount)}>
                      <Sparkles size={14} /> Generate quiz
                    </button>
                  </div>
                )}

                {notice && (
                  <div className="quiz-notice"><ListChecks size={14} /> {notice}</div>
                )}

                {/* Existing quiz → manage actions */}
                {quiz && !busy && (
                  <div className="quiz-manage">
                    <div className="quiz-addmore">
                      <span className="quiz-addmore__label">Add more:</span>
                      <div className="quiz-addmore__group">
                        <input
                          type="number" min="1" max="50"
                          value={c.moreMcq}
                          onChange={(e) => patchCfg(note._id, { moreMcq: e.target.value })}
                        />
                        <button
                          className="quiz-mini-btn"
                          disabled={busyMore === note._id}
                          onClick={() => handleAddMore(note._id, c.moreMcq)}
                        >
                          {busyMore === note._id ? <span className="summary-spin" /> : <Plus size={13} />} questions
                        </button>
                      </div>
                    </div>

                    <div className="quiz-manage__right">
                      <button
                        className="summary-action"
                        onClick={() => handleGenerate(note._id, quiz.mcqs.length || DEFAULT_CFG.mcqCount)}
                      >
                        <RotateCcw size={14} /> Regenerate
                      </button>
                      <button
                        className={`summary-action summary-action--danger${confirmDelId === quiz._id ? " summary-action--confirm" : ""}`}
                        onClick={() => handleDelete(quiz._id, note._id)}
                      >
                        <Trash2 size={14} /> {confirmDelId === quiz._id ? "Click to confirm" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
