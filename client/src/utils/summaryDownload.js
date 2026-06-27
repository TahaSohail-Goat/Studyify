import { jsPDF } from "jspdf";

/* ── Shared helpers ──────────────────────────────────────────────────────── */

// Strip inline Markdown (bold/italic/code/links) down to plain readable text.
function stripInline(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")        // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")      // links → label
    .replace(/(\*\*|__)(.*?)\1/g, "$2")           // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")              // italic
    .replace(/`([^`]*)`/g, "$1")                  // inline code
    .trim();
}

// A safe-ish file name from the note's original name.
function baseFileName(name = "summary") {
  return name.replace(/\.[^.]+$/, "")             // drop extension
    .replace(/[^\w\d-]+/g, "_")                   // non-word → underscore
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "summary";
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Break the Markdown summary into { heading, lines[] } sections.
 * Any content before the first heading is collected under "Summary".
 */
function parseSections(markdown = "") {
  const sections = [];
  let current = { heading: "Summary", lines: [] };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = line.match(/^#{1,6}\s+(.*)$/);
    if (head) {
      if (current.lines.length) sections.push(current);
      current = { heading: stripInline(head[1]), lines: [] };
      continue;
    }
    // Normalise bullets; keep numbered lists as-is.
    let body = line.replace(/^\s*[-*+]\s+/, "• ");
    body = stripInline(body);
    current.lines.push(body);
  }
  if (current.lines.length) sections.push(current);

  // Drop leading/trailing blank lines inside each section.
  return sections
    .map((s) => ({ heading: s.heading, lines: trimBlankEnds(s.lines) }))
    .filter((s) => s.lines.length || s.heading);
}

function trimBlankEnds(lines) {
  let start = 0, end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── PDF ─────────────────────────────────────────────────────────────────── */

export function downloadSummaryPdf(summary) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needed) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const write = (text, { size = 11, style = "normal", color = [40, 30, 22], gap = 4, indent = 0 } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, maxW - indent);
    for (const ln of lines) {
      ensureSpace(size + gap);
      doc.text(ln, margin + indent, y);
      y += size + gap;
    }
  };

  // Title
  write(summary.noteName || "Summary", { size: 20, style: "bold", color: [28, 18, 8], gap: 8 });
  // Meta line
  const meta = [
    `Summary generated ${formatDate(summary.updatedAt || summary.createdAt)}`,
    summary.model ? `Model: ${summary.model}` : null,
    summary.truncated ? "Note: source was long; covers the first part" : null,
  ].filter(Boolean).join("  ·  ");
  write(meta, { size: 9, color: [140, 120, 100], gap: 10 });

  // Divider
  ensureSpace(16);
  doc.setDrawColor(201, 164, 122);
  doc.setLineWidth(1);
  doc.line(margin, y, pageW - margin, y);
  y += 16;

  // Body
  for (const section of parseSections(summary.content)) {
    if (section.heading && section.heading !== "Summary") {
      y += 6;
      write(section.heading, { size: 13, style: "bold", color: [28, 18, 8], gap: 6 });
    }
    for (const line of section.lines) {
      if (!line.trim()) { y += 5; continue; }
      const bullet = line.startsWith("• ");
      write(line, { size: 11, gap: 5, indent: bullet ? 14 : 0 });
    }
    y += 4;
  }

  // Footer page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(160, 145, 125);
    doc.text(`Studify  ·  ${p} / ${pages}`, pageW - margin, pageH - 24, { align: "right" });
  }

  doc.save(`${baseFileName(summary.noteName)}-summary.pdf`);
}

/* ── CSV ─────────────────────────────────────────────────────────────────── */

function csvCell(value) {
  const s = String(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export function downloadSummaryCsv(summary) {
  const rows = [
    ["Section", "Content"],
    ["File", summary.noteName || ""],
    ["Generated", formatDate(summary.updatedAt || summary.createdAt)],
    ["Model", summary.model || "—"],
  ];

  for (const section of parseSections(summary.content)) {
    const body = section.lines.join("\n").trim();
    if (body) rows.push([section.heading, body]);
  }

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${baseFileName(summary.noteName)}-summary.csv`);
}
