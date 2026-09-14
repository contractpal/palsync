"use strict";
// Register palsync-mcp with Codex via a PROJECT-SCOPED .codex/config.toml, instead of the
// global-only `codex mcp add` (see registerCodex.js) — Codex has no CLI flag to write
// project-scoped config today (open upstream request, openai/codex#23487), but it CAN *read* a
// project-local .codex/config.toml for a project it trusts. So this hand-writes that file
// directly, the same way register.js hand-writes Claude's .mcp.json, and separately marks the
// workspace trusted in the GLOBAL ~/.codex/config.toml — Codex checks trust there BEFORE it will
// even look at the project-local file, so skipping that step would silently leave palsync's MCP
// tools never actually loaded despite the project file being correct.
//
// Real TOML parse+stringify (via @iarna/toml), not a hand-rolled merge: both files are files a
// human may also edit (their own Codex settings, other MCP servers, other trusted projects), and
// TOML's grammar (nested tables, arrays of tables, inline tables) is too easy to corrupt with a
// naive text merge — unlike the JSON writers elsewhere in this codebase, a broken write here
// wouldn't just drop palsync's own entry, it could corrupt the user's entire Codex config.
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const TOML = require("@iarna/toml");
const { writeIfChanged } = require("../core/atomicWrite");
const { MCP_BIN } = require("./register");

const SERVER_NAME = "palsync";

async function readToml(filePath) {
    try {
        return TOML.parse(await fs.readFile(filePath, "utf8"));
    } catch (e) {
        return {}; // missing or unparsable — start fresh rather than fail the whole registration
    }
}

// Project-local .codex/config.toml: merge in [mcp_servers.palsync], preserving every other table
// (the user's own model settings, other mcp_servers, etc.) untouched.
//
// Does NOT set approval_policy/sandbox_mode/default_tools_approval_mode defaults (tried
// 2026-09-14: approval_policy="never" + sandbox_mode="workspace-write", later also
// default_tools_approval_mode="approve" to work around the resulting MCP-tool-approval
// deadlock) — abandoned after confirming Codex CLI 0.154.0's Windows sandbox is itself broken:
// workspace-write silently downgrades to read-only regardless of config or an explicit
// `--sandbox` flag (only danger-full-access actually works, a known open upstream issue, not
// something palsync can fix). Given the only working alternative traded away real workspace
// scoping for functionality, David chose to revert entirely and accept Codex's own default
// approval-prompt friction instead (2026-09-14) rather than either broken option.
async function writeProjectConfig(workspaceDir, { nodePath, chipSessionId, toolProfile = "codex" } = {}) {
    const filePath = path.join(workspaceDir, ".codex", "config.toml");
    const existing = await readToml(filePath);
    const env = { PALSYNC_WORKSPACE: workspaceDir, PALSYNC_TOOL_PROFILE: toolProfile };
    if (chipSessionId) env.PALSYNC_CHIP_SESSION_ID = chipSessionId;
    const merged = Object.assign({}, existing, {
        mcp_servers: Object.assign({}, existing.mcp_servers, {
            [SERVER_NAME]: { command: nodePath, args: [MCP_BIN], env }
        })
    });
    const changed = await writeIfChanged(filePath, TOML.stringify(merged));
    return { filePath, config: merged, changed };
}

// Global ~/.codex/config.toml: mark this exact workspace path trusted, preserving every other
// project's trust entry and every other global setting. Codex matches trust by EXACT absolute
// path (no wildcards) — a symlinked or differently-cased path would silently not match, so this
// always resolves workspaceDir first.
// `globalConfigPath` defaults to the real ~/.codex/config.toml; tests override it so they never
// read or write a developer's actual home-directory Codex config.
async function ensureProjectTrusted(workspaceDir, globalConfigPath = path.join(os.homedir(), ".codex", "config.toml")) {
    const absDir = path.resolve(workspaceDir);
    const filePath = globalConfigPath;
    const existing = await readToml(filePath);
    const projects = Object.assign({}, existing.projects);
    if (projects[absDir] && projects[absDir].trust_level === "trusted") {
        return { filePath, config: existing, changed: false };
    }
    projects[absDir] = Object.assign({}, projects[absDir], { trust_level: "trusted" });
    const merged = Object.assign({}, existing, { projects });
    const changed = await writeIfChanged(filePath, TOML.stringify(merged));
    return { filePath, config: merged, changed };
}

// Merge extra env vars into the already-written [mcp_servers.palsync.env] table, preserving
// everything else in the file. Used by Chip's own self-heal patches (ELECTRON_RUN_AS_NODE, the
// Chip-Session-ID header) so the GUI never needs to parse/stringify TOML itself — it stays
// encapsulated here the same way the JSON writers hide their own file shape from callers.
async function patchEnv(filePath, envPatch) {
    const existing = await readToml(filePath);
    const entry = existing.mcp_servers && existing.mcp_servers[SERVER_NAME];
    if (!entry) return { changed: false };
    const nextEnv = Object.assign({}, entry.env, envPatch);
    if (JSON.stringify(nextEnv) === JSON.stringify(entry.env || {})) return { changed: false };
    entry.env = nextEnv;
    await writeIfChanged(filePath, TOML.stringify(existing));
    return { changed: true };
}

// Register (or refresh) the palsync MCP server with Codex for this one workspace, project-scoped
// — unlike registerCodex.js's `codex mcp add`, two pal tabs both using Codex no longer fight over
// one shared global entry. Never throws.
async function registerCodexProject(workspaceDir, { nodePath = process.execPath, chipSessionId, toolProfile = "codex", globalConfigPath } = {}) {
    const project = await writeProjectConfig(workspaceDir, { nodePath, chipSessionId, toolProfile });
    const trust = await ensureProjectTrusted(workspaceDir, globalConfigPath);
    return {
        ok: true,
        filePath: project.filePath, config: project.config, changed: project.changed,
        globalFilePath: trust.filePath, trustedProject: true, trustChanged: trust.changed
    };
}

module.exports = { registerCodexProject, writeProjectConfig, ensureProjectTrusted, patchEnv, SERVER_NAME };
