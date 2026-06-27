import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText, Sparkles, RotateCcw, Copy, Check, Trash2,
  AlertCircle, Upload, ScrollText, Download, ChevronDown, FileSpreadsheet,
} from "lucide-react";
import AppLayout from "../components/AppLayout.jsx";
import { getNotesApi } from "../api/notes.js";
import { getSummariesApi, generateSummaryApi, deleteSummaryApi } from "../api/summaries.js";

const SUMMARIZABLE = new Set(["application/pdf", "text/plain"]);

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

export default function Summaries() {
  const [notes, setNotes]                 = useState([]);
  const [byNote, setByNote]               = useState({}); // noteId -> summary
  const [loading, setLoading]             = useState(true);
  const [busyId, setBusyId]               = useState(null);
  const [error, setError]                 = useState("");
  const [copiedId, setCopiedId]           = useState(null);
  const [confirmDelId, setConfirmDelId]   = useState(null);
  const [menuId, setMenuId]               = useState(null); // summaryId whose download menu is open
  const menuRef = useRef(null);

  // Close the download menu on outside click or Escape.
  useEffect(() => {
    if (!menuId) return;
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuId(null);
    }
    function onKey(e) {
      if (e.key === "Escape") setMenuId(null);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ notes }, { summaries }] = await Promise.all([getNotesApi(), getSummariesApi()]);
      setNotes(notes.filter((n) => SUMMARIZABLE.has(n.mimetype)));
      const map = {};
      summaries.forEach((s) => { map[s.noteId] = s; });
      setByNote(map);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSummarize(noteId) {
    setError("");
    setBusyId(noteId);
    try {
      const { summary } = await generateSummaryApi(noteId);
      setByNote((prev) => ({ ...prev, [noteId]: summary }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(summaryId, noteId) {
    if (confirmDelId !== summaryId) {
      setConfirmDelId(summaryId);
      return;
    }
    try {
      await deleteSummaryApi(summaryId);
      setByNote((prev) => {
        const next = { ...prev };
        delete next[noteId];
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirmDelId(null);
    }
  }

  // Lazy-load the (jsPDF-backed) download util only when the user actually downloads.
  async function handleDownload(kind, summary, note) {
    setMenuId(null);
    try {
      const util = await import("../utils/summaryDownload.js");
      const data = { ...summary, noteName: summary.noteName || note.originalName };
      if (kind === "pdf") util.downloadSummaryPdf(data);
      else util.downloadSummaryCsv(data);
    } catch {
      setError("Couldn't prepare the download. Please try again.");
    }
  }

  async function handleCopy(text, id) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <AppLayout title="Summaries">
      <div className="page-header">
        <h1>Summaries</h1>
        <p>Generate AI summaries of your uploaded PDFs and text files.</p>
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
          <div className="summary-empty__icon"><ScrollText size={28} /></div>
          <h2>Nothing to summarize yet</h2>
          <p>Upload a PDF or text file and it'll show up here, ready to summarize.</p>
          <Link to="/notes" className="summary-btn">
            <Upload size={15} /> Go to My Notes
          </Link>
        </div>
      ) : (
        <div className="summary-list">
          {notes.map((note) => {
            const summary = byNote[note._id];
            const busy = busyId === note._id;
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
                        {summary ? `Summarized ${timeAgo(summary.updatedAt)}` : "Not summarized yet"}
                      </div>
                    </div>
                  </div>

                  <div className="summary-card__action">
                    {busy ? (
                      <button className="summary-btn" disabled>
                        <span className="summary-spin" /> Summarizing…
                      </button>
                    ) : summary ? (
                      <button
                        className="summary-btn summary-btn--ghost"
                        onClick={() => handleSummarize(note._id)}
                      >
                        <RotateCcw size={14} /> Regenerate
                      </button>
                    ) : (
                      <button className="summary-btn" onClick={() => handleSummarize(note._id)}>
                        <Sparkles size={14} /> Summarize
                      </button>
                    )}
                  </div>
                </div>

                {busy && !summary && (
                  <div className="summary-loading">
                    <span className="summary-spin" /> Reading your file and summarizing…
                  </div>
                )}

                {summary && (
                  <div className="summary-body">
                    <div className="chat-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary.content}</ReactMarkdown>
                    </div>
                    {summary.truncated && (
                      <p className="summary-truncated">
                        Note: this file was long, so the summary covers its first part.
                      </p>
                    )}
                    <div className="summary-actions">
                      <button
                        className="summary-action"
                        onClick={() => handleCopy(summary.content, summary._id)}
                      >
                        {copiedId === summary._id ? <Check size={14} /> : <Copy size={14} />}
                        {copiedId === summary._id ? "Copied" : "Copy"}
                      </button>

                      <div
                        className="summary-dl"
                        ref={menuId === summary._id ? menuRef : null}
                      >
                        <button
                          className="summary-action"
                          onClick={() => setMenuId(menuId === summary._id ? null : summary._id)}
                          aria-haspopup="menu"
                          aria-expanded={menuId === summary._id}
                        >
                          <Download size={14} /> Download
                          <ChevronDown size={13} style={{ opacity: 0.7 }} />
                        </button>
                        {menuId === summary._id && (
                          <div className="summary-dl-menu" role="menu">
                            <button
                              className="summary-dl-item"
                              role="menuitem"
                              onClick={() => handleDownload("pdf", summary, note)}
                            >
                              <FileText size={15} /> Download as PDF
                            </button>
                            <button
                              className="summary-dl-item"
                              role="menuitem"
                              onClick={() => handleDownload("csv", summary, note)}
                            >
                              <FileSpreadsheet size={15} /> Download as CSV
                            </button>
                          </div>
                        )}
                      </div>

                      <button
                        className={`summary-action summary-action--danger${confirmDelId === summary._id ? " summary-action--confirm" : ""}`}
                        onClick={() => handleDelete(summary._id, note._id)}
                      >
                        <Trash2 size={14} /> {confirmDelId === summary._id ? "Click to confirm" : "Delete"}
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
