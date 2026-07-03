"use strict";
// palsync task / checkpoint core: EXECUTION.md is a markdown task table, and weak models corrupt
// table rows when they hand-edit. These functions do the edit deterministically — parse the table,
// change exactly one row's status (or append a checkpoint line), and rewrite. On any parse failure
// they change NOTHING and return a precise error, so a malformed table is never made worse.
//
// The parser tolerates the template's real shape: an optional |---| separator row, columns in any
// order (identified by header text, not position), and "—"/"-"/blank in depends.
const fs = require("fs");

const STATUSES = ["todo", "in_progress", "done", "blocked", "needs-frontier", "needs-human"];

function isSeparatorRow(t) { return /^\|[\s:|-]+\|?\s*$/.test(t); }
function splitCells(t) { return t.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim()); }

// Locate + parse the "## Tasks" table. Returns { ok, error } or { ok:true, headerIdx, cols, rows }.
// rows: [{ lineIndex, cells, id, status, depends: [ids] }]. lineIndex is into the file's line array.
function parseTasks(text) {
    const lines = text.split(/\r?\n/);
    let inTasks = false, headerIdx = -1, cols = null;
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^##\s+Tasks\b/i.test(t)) { inTasks = true; continue; }
        if (inTasks && /^##\s+/.test(t)) break; // next section ends the table
        if (!inTasks) continue;
        if (t.charAt(0) !== "|") continue;
        if (isSeparatorRow(t)) continue;
        const cells = splitCells(t);
        if (!cols) {
            // First |-row inside ## Tasks is the header — map column names to indices.
            const idx = (re) => cells.findIndex(c => re.test(c));
            cols = { id: idx(/^id$/i), task: idx(/task/i), status: idx(/status/i), depends: idx(/depend/i) };
            if (cols.id === -1 || cols.status === -1) return { ok: false, error: "Tasks table header has no 'id' and/or 'status' column (found: " + cells.join(" | ") + ")." };
            headerIdx = i;
            continue;
        }
        const id = cells[cols.id] || "";
        if (!id) continue; // skip a stray/blank row rather than treat it as a task
        const depRaw = cols.depends >= 0 ? (cells[cols.depends] || "") : "";
        const depends = /^[—\-\s]*$/.test(depRaw) ? [] : depRaw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        rows.push({ lineIndex: i, cells, id, status: cells[cols.status] || "", depends });
    }
    if (!inTasks) return { ok: false, error: "No \"## Tasks\" section found in EXECUTION.md." };
    if (!cols) return { ok: false, error: "The \"## Tasks\" section has no table (no header row)." };
    return { ok: true, lines, headerIdx, cols, rows };
}

// Replace the content of a single cell in a table line, preserving its surrounding whitespace and
// the rest of the row verbatim. contentIdx is 0-based among the row's content cells.
function replaceCell(line, contentIdx, newVal) {
    const parts = line.split("|"); // ["", " T1 ", " ... ", ""]
    const partIdx = contentIdx + 1;
    if (partIdx >= parts.length) return line;
    parts[partIdx] = parts[partIdx].replace(/^(\s*).*?(\s*)$/, (_, a, b) => a + newVal + b);
    return parts.join("|");
}

// list all tasks; if ready===true, return only the first todo whose depends are all done.
function listTasks(text, { ready = false } = {}) {
    const p = parseTasks(text);
    if (!p.ok) return p;
    if (!ready) return { ok: true, tasks: p.rows.map(r => ({ id: r.id, status: r.status, depends: r.depends, task: p.cols.task >= 0 ? r.cells[p.cols.task] : "" })) };
    const doneIds = new Set(p.rows.filter(r => r.status === "done").map(r => r.id));
    const next = p.rows.find(r => r.status === "todo" && r.depends.every(d => doneIds.has(d)));
    return { ok: true, ready: true, next: next ? { id: next.id, status: next.status, depends: next.depends, task: p.cols.task >= 0 ? next.cells[p.cols.task] : "" } : null };
}

// set exactly one task's status. Returns { ok, text } or { ok:false, error }.
function setStatus(text, id, status) {
    if (STATUSES.indexOf(status) === -1) return { ok: false, error: "Invalid status \"" + status + "\". Use one of: " + STATUSES.join(" | ") + "." };
    const p = parseTasks(text);
    if (!p.ok) return p;
    const row = p.rows.find(r => r.id.toLowerCase() === String(id).toLowerCase());
    if (!row) return { ok: false, error: "No task with id \"" + id + "\" in the Tasks table (ids: " + p.rows.map(r => r.id).join(", ") + ")." };
    if (row.status === status) return { ok: true, text, unchanged: true, from: row.status, id: row.id };
    const from = row.status;
    p.lines[row.lineIndex] = replaceCell(p.lines[row.lineIndex], p.cols.status, status);
    return { ok: true, text: p.lines.join("\n"), from, to: status, id: row.id };
}

// append a checkpoint line to the end of the "## Checkpoints" section. Returns { ok, text } or error.
function appendCheckpoint(text, line) {
    const clean = String(line || "").replace(/[\r\n]+/g, " ").trim();
    if (!clean) return { ok: false, error: "Checkpoint line is empty." };
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex(l => /^##\s+Checkpoints\b/i.test(l.trim()));
    if (start === -1) return { ok: false, error: "No \"## Checkpoints\" section found in EXECUTION.md." };
    // Find the end of the section (next "## " heading, or EOF), then insert before it.
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) { if (/^##\s+/.test(lines[i].trim())) { end = i; break; } }
    // Trim trailing blank lines inside the section so the append sits right after the last content.
    let insertAt = end;
    while (insertAt - 1 > start && lines[insertAt - 1].trim() === "") insertAt--;
    lines.splice(insertAt, 0, "- " + clean);
    return { ok: true, text: lines.join("\n") };
}

// --- thin file wrappers used by the CLI ---
function readExecution(file) { return fs.readFileSync(file, "utf8"); }
function writeExecution(file, text) { fs.writeFileSync(file, text, "utf8"); }

module.exports = { STATUSES, parseTasks, listTasks, setStatus, appendCheckpoint, replaceCell, readExecution, writeExecution };
