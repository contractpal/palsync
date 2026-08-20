"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TOOL_GUIDELINES = {
    pal_impact: "Use pal_impact before editing an existing file under pages/ or fragments/ to inspect dependents and registration.",
    pal_ast: "Use pal_ast for syntax-aware code-shape searches and rewrites; use grep/read only for exact text."
};
const GUIDELINE_ORDER = ["pal_impact", "pal_ast"];

function promptGuidelinesFor(toolName) {
    const line = TOOL_GUIDELINES[toolName];
    return line ? [line] : [];
}

function activationGuidance(names) {
    if (!Array.isArray(names) || names.length === 0) return [];
    const present = new Set(names);
    const out = [];
    for (const name of GUIDELINE_ORDER) {
        if (present.has(name)) out.push(TOOL_GUIDELINES[name]);
    }
    return out;
}

const CORE_TOOLS = ["pal_validate", "pal_spec_lint", "pal_context"];

function tokens(value) {
    return String(value || "").toLowerCase().match(/[a-z0-9_]+/g) || [];
}

function routeItems(query, metadata) {
    const wanted = new Set(tokens(query));
    const selected = [];
    for (const item of metadata) {
        const words = new Set([item.name || item.id, ...(item.groups || []), ...(item.keywords || [])].flatMap(tokens));
        if ([...wanted].some(word => words.has(word))) selected.push(item.name || item.id);
    }
    return selected;
}

function routeTools(query, metadata) { return routeItems(query, metadata); }

function eagerToolNames(metadata) {
    const available = new Set(metadata.map(tool => tool.name));
    return CORE_TOOLS.filter(name => available.has(name));
}

function activateAdditively(active, additions) {
    return [...new Set([...(active || []), ...(additions || [])])];
}

function hasPiMcpCollision(activeTools) {
    return (activeTools || []).some(name => /^mcp_palsync_(?:pal_|)/.test(name));
}

function imageTokens(b64) {
    try {
        const buf = Buffer.from(String(b64).slice(0, 65536), "base64");
        let width = 0, height = 0;
        if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
            width = buf.readUInt32BE(16); height = buf.readUInt32BE(20);
        } else if (buf.length > 10 && buf.readUInt16BE(0) === 0xffd8) {
            let offset = 2;
            while (offset + 9 < buf.length) {
                if (buf[offset] !== 0xff) { offset++; continue; }
                const marker = buf[offset + 1];
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                    height = buf.readUInt16BE(offset + 5); width = buf.readUInt16BE(offset + 7); break;
                }
                offset += 2 + buf.readUInt16BE(offset + 2);
            }
        }
        if (width && height) return Math.ceil((width * height) / 750);
    } catch (e) { /* default below */ }
    return 1365;
}

function contentStats(content) {
    if (!Array.isArray(content)) return { bytes: 0, tokens: 0 };
    let bytes = 0, tokens = 0;
    for (const block of content) {
        if (block && block.text) {
            const size = Buffer.byteLength(block.text, "utf8");
            bytes += size; tokens += Math.ceil(size / 4);
        }
        if (block && block.data) { bytes += block.data.length; tokens += imageTokens(block.data); }
    }
    return { bytes, tokens };
}

function piUsageEntry(event, model) {
    const stats = contentStats(event && event.content);
    return {
        schema: "palsync/pi-usage/1",
        tool: event && event.toolName || null,
        bytes: stats.bytes,
        tokenEstimate: stats.tokens,
        provider: model && model.provider || null,
        model: model && model.id || null,
        cost: null,
        currency: null,
        isError: event ? !!event.isError : null
    };
}

function appendPiUsage(workspaceDir, event, model) {
    if (!workspaceDir || !event || !/^pal_/.test(event.toolName || "") || !isPalsyncWorkspace(workspaceDir)) return null;
    try {
        const file = path.join(workspaceDir, ".palsync", "pi-usage.jsonl");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(piUsageEntry(event, model)) + "\n", "utf8");
        return file;
    } catch (e) { return null; }
}

function isPalsyncWorkspace(workspaceDir) {
    return !!workspaceDir && [".palsync.json", "EXECUTION.md"].some(file => fs.existsSync(path.join(workspaceDir, file)));
}

// Pi's built-in editors are lowercase and name their path field `path`; Claude's are capitalised and
// use `file_path`. The hook CORES speak the Claude shape (they were written against that event first),
// so translate here rather than teaching every core two dialects. Returns null when there is nothing
// for a hook to look at -- wrong tool, no path, or not a PalSync workspace.
//
// Pi has no MultiEdit/NotebookEdit, and `bash` is deliberately absent for the same reason the Claude
// guard omits it: deciding which shell invocations write means guessing.
const PI_WRITE_TOOLS = { edit: "Edit", write: "Write" };

function piWriteEvent(workspaceDir, event) {
    if (!workspaceDir || !event) return null;
    const toolName = PI_WRITE_TOOLS[String(event.toolName || "").toLowerCase()];
    if (!toolName) return null;
    const input = event.input && typeof event.input === "object" ? event.input : {};
    const target = typeof input.path === "string" ? input.path : null;
    if (!target || !isPalsyncWorkspace(workspaceDir)) return null;
    return { cwd: workspaceDir, tool_name: toolName, tool_input: { file_path: target } };
}

// A ToolResultEventResult that ADDS a text block and changes nothing else. `isError` and `details`
// are echoed back deliberately: post-write feedback must never turn a successful edit into a failure,
// and Pi treats an omitted field as "no opinion" rather than "unchanged", so being explicit is safer.
function piAppendContent(event, text) {
    if (!event || !text) return null;
    const content = Array.isArray(event.content) ? event.content : [];
    return {
        content: [...content, { type: "text", text }],
        details: event.details,
        isError: !!event.isError,
    };
}

function completionFingerprint(workspaceDir, gate) {
    const hash = crypto.createHash("sha256").update(String(gate && gate.code || "UNKNOWN"));
    for (const file of [".palsync.json", "EXECUTION.md", "REVIEW.md", ".palsync/tool-evidence.jsonl"]) {
        try { hash.update("\0" + file + "\0").update(fs.readFileSync(path.join(workspaceDir, file))); }
        catch (e) { hash.update("\0" + file + ":missing"); }
    }
    return hash.digest("hex");
}

function completionFollowUp(gate, fingerprint, previousFingerprint) {
    if (!gate || gate.allow !== false || fingerprint === previousFingerprint) return null;
    return { fingerprint, message: "PalSync completion correction required: " + gate.message };
}

module.exports = { CORE_TOOLS, routeItems, routeTools, eagerToolNames, activateAdditively, hasPiMcpCollision,
    imageTokens, contentStats, piUsageEntry, appendPiUsage, isPalsyncWorkspace,
    completionFingerprint, completionFollowUp, piWriteEvent, piAppendContent, PI_WRITE_TOOLS,
    promptGuidelinesFor, activationGuidance };
