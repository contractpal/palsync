"use strict";

const fs = require("fs");
const path = require("path");

const DIRS = ["fragments", "workflows"];
const WIN = 4;
const MAX_BYTES = 200 * 1024;
const MAX_LOCS = 50; // per window key — bounds pair explosion on boilerplate

function listFiles(workspaceDir) {
    const out = [];
    for (const d of DIRS) {
        let names;
        try { names = fs.readdirSync(path.join(workspaceDir, d), { recursive: true }); } catch (e) { continue; }
        for (const f of names) {
            const p = path.join(workspaceDir, d, f);
            try {
                const st = fs.statSync(p);
                if (st.isFile() && st.size <= MAX_BYTES && /\.(html|js)$/.test(p)) out.push(p);
            } catch (e) { /* unreadable: skip */ }
        }
    }
    return out.map(p => path.relative(workspaceDir, p).split(path.sep).join("/")).sort();
}

// Near-duplicate spans: runs of consecutive normalized lines shared by two locations.
// Advisory evidence for the review brief — never a lint rule.
function findDuplicateSpans(workspaceDir, { minLines = 6, cap = 5 } = {}) {
    const files = listFiles(workspaceDir).map(rel => ({
        rel,
        lines: fs.readFileSync(path.join(workspaceDir, rel), "utf8").split("\n")
            .map((l, i) => ({ n: i + 1, t: l.trim().replace(/\s+/g, " ").replace(/(["'])[^"']*\1/g, "$1$1") }))
            .filter(l => l.t.length >= 12 && !/^[{}()[\];,</>]*$/.test(l.t) && !/^\/\//.test(l.t))
    }));
    const windows = new Map();
    files.forEach((f, fi) => {
        for (let i = 0; i + WIN <= f.lines.length; i++) {
            const key = f.lines.slice(i, i + WIN).map(l => l.t).join("\n");
            if (!windows.has(key)) windows.set(key, []);
            windows.get(key).push([fi, i]);
        }
    });
    const pairs = new Set();
    for (const locs of windows.values()) {
        const use = locs.slice(0, MAX_LOCS);
        for (let x = 0; x < use.length; x++) {
            for (let y = x + 1; y < use.length; y++) {
                const [fa, i] = use[x], [fb, j] = use[y];
                if (fa === fb && j - i < WIN) continue;
                pairs.add(fa + ":" + i + ":" + fb + ":" + j);
            }
        }
    }
    const spans = [];
    for (const key of pairs) {
        const [fa, i, fb, j] = key.split(":").map(Number);
        if (pairs.has(fa + ":" + (i - 1) + ":" + fb + ":" + (j - 1))) continue; // not a run start
        let run = 1;
        while (pairs.has(fa + ":" + (i + run) + ":" + fb + ":" + (j + run))) run++;
        const lines = run + WIN - 1;
        if (lines < minLines || (fa === fb && j - i < lines)) continue;
        const loc = (f, s) => files[f].rel + ":" + files[f].lines[s].n + "-" + files[f].lines[s + lines - 1].n;
        spans.push({ lines, a: loc(fa, i), b: loc(fb, j) });
    }
    const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    spans.sort((x, y) => y.lines - x.lines || cmp(x.a, y.a) || cmp(x.b, y.b));
    return spans.slice(0, cap);
}

module.exports = { findDuplicateSpans };
