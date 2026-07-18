"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MARKUP_EXT = new Set([".html", ".htm", ".xhtml"]);

function walkFiles(absDir, relBase, out) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch (e) { if (e.code === "ENOENT") return; throw e; }
    for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const abs = path.join(absDir, entry.name);
        const rel = relBase ? relBase + "/" + entry.name : entry.name;
        if (entry.isDirectory()) walkFiles(abs, rel, out);
        else out.push({ abs, rel });
    }
}

function readUtf8(abs) {
    try { return fs.readFileSync(abs, "utf8"); } catch (e) { return null; }
}

function sha256(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
}

// One immutable view of every validator input. Consumers must not return to disk: doing so can
// both double validation cost and mix file versions when an editor writes during validation.
function buildSnapshot(workspaceDir) {
    const found = [];
    walkFiles(workspaceDir, "", found);
    found.sort((a, b) => a.rel.localeCompare(b.rel));

    const snapshot = {
        workspaceDir,
        markup: [],
        workflows: [],
        stylesheets: [],
        datasets: [],
        palJson: { raw: null, parsed: null },
        contentHashByRel: {},
        allFiles: found.map(file => file.rel),
    };
    const stylesheetIdentities = new Set();

    for (const file of found) {
        const ext = path.extname(file.rel).toLowerCase();
        const isMarkup = (file.rel.startsWith("pages/") || file.rel.startsWith("fragments/")) && MARKUP_EXT.has(ext);
        const isWorkflow = file.rel.startsWith("workflows/") && ext === ".js";
        const isStylesheet = /^(?:styles|Styles)\//.test(file.rel) && ext === ".css";
        const isDataset = file.rel.startsWith("datasets/") && ext === ".json";
        const isPalJson = file.rel === "pal.json";
        if (!isMarkup && !isWorkflow && !isStylesheet && !isDataset && !isPalJson) continue;

        const content = readUtf8(file.abs);
        if (content == null) continue;
        snapshot.contentHashByRel[file.rel] = sha256(content);
        if (isMarkup) snapshot.markup.push({ rel: file.rel, content });
        if (isWorkflow) snapshot.workflows.push({ rel: file.rel, content });
        if (isDataset) snapshot.datasets.push({ rel: file.rel, content });
        if (isPalJson) {
            snapshot.palJson.raw = content;
            try { snapshot.palJson.parsed = JSON.parse(content); } catch (e) { /* retained as null */ }
        }
        if (isStylesheet) {
            let identity = file.abs;
            try { const stat = fs.statSync(file.abs); identity = stat.dev + ":" + stat.ino; } catch (e) { /* lexical path */ }
            if (!stylesheetIdentities.has(identity)) {
                stylesheetIdentities.add(identity);
                snapshot.stylesheets.push({ rel: file.rel, content });
            }
        }
    }
    return snapshot;
}

module.exports = { buildSnapshot, walkFiles, readUtf8 };
