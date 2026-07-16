"use strict";
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { writeIfChanged } = require("./atomicWrite");
const { serializeToolDefinitions } = require("../mcp/toolSchema");

const VERSION = require("../../package.json").version;
const MANIFEST = path.join(".palsync", "context-manifest.json");
const PREVIOUS = path.join(".palsync", "context-manifest.prev.json");
const emitLocks = new Map();

function sha256(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
}

function section(name, stabilityClass, order, content, source, extra = {}) {
    const bytes = Buffer.byteLength(content, "utf8");
    return Object.assign({
        name,
        class: stabilityClass,
        order,
        bytes,
        estimatedTokens: Math.ceil(bytes / 4),
        sha256: sha256(content),
        source
    }, extra);
}

function skillDescription(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return "";
    const line = match[1].split(/\r?\n/).find(value => value.startsWith("description:"));
    if (!line) return "";
    let value = line.slice("description:".length).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    return value;
}

async function buildManifest({ agent, palName, skills, parts, bundleRoot = path.join(__dirname, "..", "..", "bundled-context") }) {
    const { TOOLS } = require("../mcp/tools");
    const toolJson = JSON.stringify(serializeToolDefinitions(TOOLS));
    const skillCatalog = [];
    const bodies = [];
    for (const skill of skills) {
        const source = path.posix.join("bundled-context", "skills", skill.name, "SKILL.md");
        const body = await fsp.readFile(path.join(bundleRoot, "skills", skill.name, "SKILL.md"), "utf8");
        skillCatalog.push({ name: skill.name, description: skillDescription(body) });
        bodies.push({ name: skill.name, body, source });
    }
    const sections = [
        section("tool-definitions", "release-stable", 0, toolJson, "src/mcp/tools.js"),
        section("contract-doc", "release-stable", 1, parts.stamp + "\n" + parts.contract, "bundled-context/CLAUDE.md + generator stamp"),
        section("skill-catalog", "release-stable", 2, JSON.stringify(skillCatalog), "bundled-context/skills/*/SKILL.md#frontmatter"),
        section("sync-section", "workspace-stable", 3, parts.sync, "src/launcher/contextInject.js#syncSection")
    ];
    for (const item of bodies) {
        sections.push(section("skill-body:" + item.name, "on-demand", sections.length,
            item.body, item.source, { eager: false }));
    }
    return { version: 1, palsyncVersion: VERSION, agent, palName: palName || null, sections };
}

function readManifest(workspaceDir, previous = false) {
    const file = path.join(workspaceDir, previous ? PREVIOUS : MANIFEST);
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

function diffManifests(previous, current) {
    if (!previous || !current) return { changed: false, firstDivergentSection: null, reason: "previous manifest unavailable" };
    const count = Math.max(previous.sections.length, current.sections.length);
    let first = null;
    for (let i = 0; i < count; i++) {
        const before = previous.sections[i];
        const after = current.sections[i];
        if (!before || !after || before.name !== after.name || before.sha256 !== after.sha256) {
            first = after ? after.name : before.name;
            break;
        }
    }
    let reason = first ? "section bytes changed" : "no section changed";
    if (previous.palsyncVersion !== current.palsyncVersion) {
        reason = "palsync upgraded " + previous.palsyncVersion + "→" + current.palsyncVersion;
        if (!first) first = "generator-metadata";
    } else if (previous.agent !== current.agent) {
        reason = "agent changed " + previous.agent + "→" + current.agent;
        if (!first) first = "runtime-agent";
    } else if (previous.palName !== current.palName) {
        reason = "pal name changed";
        if (!first) first = "sync-section";
    }
    return { changed: first != null, firstDivergentSection: first, reason };
}

async function emitManifestUnlocked(workspaceDir, opts) {
    const manifest = await buildManifest(opts);
    const currentPath = path.join(workspaceDir, MANIFEST);
    const previousPath = path.join(workspaceDir, PREVIOUS);
    const content = JSON.stringify(manifest, null, 2) + "\n";
    let oldContent = null;
    try { oldContent = await fsp.readFile(currentPath, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    if (oldContent === content) return { manifest, changed: false, firstDivergentSection: null };
    let previous = null;
    if (oldContent != null) {
        try { previous = JSON.parse(oldContent); } catch (e) { /* replace malformed current without trusting it */ }
        await writeIfChanged(previousPath, oldContent);
    }
    await writeIfChanged(currentPath, content);
    const diff = diffManifests(previous, manifest);
    const result = Object.assign({ manifest }, diff, { changed: true });
    const summary = eagerSummary(manifest);
    require("./usage").recordContextGeneration(workspaceDir, {
        agent: manifest.agent,
        stablePrefixBytes: summary.stablePrefixBytes,
        dynamicTailBytes: summary.dynamicTailBytes,
        stablePrefixHash: summary.stablePrefixHash,
        changed: true,
        firstDivergentSection: diff.firstDivergentSection
    });
    return result;
}

function emitManifest(workspaceDir, opts) {
    const key = path.resolve(workspaceDir);
    const previous = emitLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => emitManifestUnlocked(workspaceDir, opts));
    emitLocks.set(key, current);
    return current.finally(() => { if (emitLocks.get(key) === current) emitLocks.delete(key); });
}

function eagerSummary(manifest) {
    const eager = manifest.sections.filter(item => item.eager !== false && item.class !== "on-demand");
    const release = eager.filter(item => item.class === "release-stable");
    const totalBytes = eager.reduce((sum, item) => sum + item.bytes, 0);
    const stablePrefixBytes = release.reduce((sum, item) => sum + item.bytes, 0);
    return {
        totalBytes,
        stablePrefixBytes,
        dynamicTailBytes: totalBytes - stablePrefixBytes,
        stablePercent: totalBytes ? (stablePrefixBytes / totalBytes) * 100 : 0,
        stablePrefixHash: sha256(release.map(item => item.sha256).join("\n"))
    };
}

function formatInspect(manifest) {
    if (!manifest) return "Context manifest unavailable — relaunch palsync to generate it.";
    const summary = eagerSummary(manifest);
    const largest = manifest.sections.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 5);
    const lines = [
        "palsync context manifest — " + manifest.agent,
        "Locally stable prefix: " + summary.stablePrefixBytes + " B / " + summary.totalBytes + " B eager (" + summary.stablePercent.toFixed(1) + "%)",
        "Estimated reusable prefix only; provider cache status unavailable.",
        "Dynamic tail: " + summary.dynamicTailBytes + " B",
        "Largest sections:"
    ];
    for (const item of largest) lines.push("  " + item.name + ": " + item.bytes + " B (" + item.class + ")");
    return lines.join("\n");
}

function formatDiff(previous, current) {
    if (!current) return "Context manifest unavailable — relaunch palsync to generate it.";
    const diff = diffManifests(previous, current);
    if (!previous) return "No previous changed context generation is available.";
    if (!diff.changed) return "No context sections changed.";
    return "First divergent section: " + diff.firstDivergentSection + "\nReason: " + diff.reason;
}

module.exports = {
    MANIFEST, PREVIOUS, buildManifest, emitManifest, readManifest, diffManifests,
    eagerSummary, formatInspect, formatDiff
};
