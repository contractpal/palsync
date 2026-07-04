"use strict";
// One recursive file walk shared by workspaceHash and baseline: every FILE under dirAbs as
// { rel (POSIX "/" on every OS), abs }, readdir order, no filtering. Unreadable/missing dirs
// are skipped silently — callers walk folders that may not exist yet.
const fs = require("fs");
const path = require("path");

function walkTree(dirAbs, relBase, out = []) {
    let entries;
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return out; }
    for (const e of entries) {
        const abs = path.join(dirAbs, e.name);
        const rel = relBase ? relBase + "/" + e.name : e.name;
        if (e.isDirectory()) walkTree(abs, rel, out);
        else out.push({ rel, abs });
    }
    return out;
}

module.exports = { walkTree };
