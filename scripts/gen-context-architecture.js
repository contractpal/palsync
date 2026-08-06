#!/usr/bin/env node
"use strict";
// Regenerates the measurement table in docs/context-architecture.md.
//
// The table used to be hand-maintained and had drifted: it cited 16,689 tool-definition bytes against
// a measurement basis nobody could reproduce (the real advertised schema is 19,354), stamped PalSync
// 0.27.0, with no generator and no test holding it to reality. Recomputing those numbers by hand would
// have fabricated them, so the fix is to derive every row from the same artifact the runtime actually
// emits: `.palsync/context-manifest.json`, produced by contextInject for a real workspace.
//
// One row per distinct (section, bytes, sha256) group, with the agents that share it joined by "/" --
// most sections are byte-identical across hosts, and collapsing them keeps the table readable while
// making a genuine per-host difference visible instead of averaged away.
//
// Deterministic for a given package: same tools, contract, and skills in, same bytes out. Run it and
// commit the diff; `--check` exits non-zero when the committed doc no longer matches the measurement.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DOC = path.join(__dirname, "..", "docs", "context-architecture.md");
const START = "<!-- palsync generated: context measurement table (scripts/gen-context-architecture.js) -->";
const END = "<!-- palsync generated: end -->";
const AGENTS = ["claude", "codex", "opencode", "pi"];
const LABELS = { claude: "Claude", codex: "Codex", opencode: "OpenCode", pi: "Pi" };

function commas(value) { return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

async function manifestFor(agent) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ctxdoc-"));
    try {
        await require("../src/launcher/contextInject").inject(workspace, { palName: "Demo", agent });
        const file = path.join(workspace, ".palsync", "context-manifest.json");
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
}

async function measure() {
    const manifests = {};
    for (const agent of AGENTS) manifests[agent] = await manifestFor(agent);

    const versions = new Set(AGENTS.map(agent => manifests[agent].palsyncVersion));
    if (versions.size !== 1) throw new Error("manifests disagree on palsyncVersion: " + [...versions]);

    // Section order is the manifest's own load order, taken from the first agent that has each section
    // so the table reads in the order a host actually consumes it.
    const order = [];
    for (const agent of AGENTS) {
        for (const section of manifests[agent].sections) {
            if (!order.includes(section.name)) order.push(section.name);
        }
    }

    const rows = [];
    for (const name of order) {
        const groups = new Map();
        for (const agent of AGENTS) {
            const section = manifests[agent].sections.find(item => item.name === name);
            if (!section) continue;
            const key = section.bytes + ":" + section.sha256;
            if (!groups.has(key)) groups.set(key, { section, agents: [] });
            groups.get(key).agents.push(agent);
        }
        for (const { section, agents } of groups.values()) {
            rows.push({
                runtime: agents.length === AGENTS.length ? "All" : agents.map(a => LABELS[a]).join("/"),
                section: section.name,
                source: section.source,
                bytes: section.bytes,
                estimatedTokens: section.estimatedTokens,
                loading: section.class,
            });
        }
    }
    return { palsyncVersion: [...versions][0], rows };
}

function renderTable({ palsyncVersion, rows }) {
    const lines = [
        START,
        "",
        "Measured on PalSync " + palsyncVersion + " from `.palsync/context-manifest.json`, the artifact",
        "`contextInject` emits for a real workspace. Token estimates are the manifest's own",
        "`estimatedTokens`. Regenerate with `node scripts/gen-context-architecture.js` — never hand-edit",
        "these numbers; a hand-edit is how this table came to claim 16,689 tool-definition bytes on a",
        "basis that could not be reproduced.",
        "",
        "| Runtime | Section | Source | Bytes | Est. tokens | Loading |",
        "|---|---|---|---:|---:|---|",
    ];
    for (const row of rows) {
        lines.push("| " + [
            row.runtime, "`" + row.section + "`", "`" + row.source + "`",
            commas(row.bytes), commas(row.estimatedTokens), row.loading,
        ].join(" | ") + " |");
    }
    lines.push("", END);
    return lines.join("\n");
}

async function main() {
    const table = renderTable(await measure());
    const current = fs.readFileSync(DOC, "utf8");
    const start = current.indexOf(START);
    const end = current.indexOf(END);
    if (start === -1 || end === -1 || end < start) {
        throw new Error("docs/context-architecture.md is missing the generated-table markers");
    }
    const next = current.slice(0, start) + table + current.slice(end + END.length);
    if (next === current) { process.stdout.write("unchanged  docs/context-architecture.md\n"); return; }
    if (process.argv.includes("--check")) {
        process.stderr.write("docs/context-architecture.md no longer matches the live measurement." +
            " Run: node scripts/gen-context-architecture.js\n");
        process.exit(1);
    }
    fs.writeFileSync(DOC, next, "utf8");
    process.stdout.write("wrote      docs/context-architecture.md\n");
}

if (require.main === module) {
    main().catch(e => {
        process.stderr.write("gen-context-architecture: " + (e && e.message ? e.message : e) + "\n");
        process.exit(1);
    });
}

module.exports = { measure, renderTable, START, END, DOC };
