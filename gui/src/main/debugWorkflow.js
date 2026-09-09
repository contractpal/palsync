"use strict";
// Backing logic for the per-pal Debug window — wraps palsync's already-verified-live
// src/core/debug.js. The server-side buffer is CONSUME-ONCE and SHARED with the PalBuilder IDE's
// own debug view (whoever reads first clears it for everyone), so this must only ever be called
// on an explicit user action (button click), never polled speculatively.
const { retrieveServerDebug } = require("palsync/src/core/debug");
const { sessionForFolder } = require("./palSession");
const { resolvePal } = require("./resolveCached");

// Deliberately NEVER passes a chipSessionId here (per David, 2026-09-10): opening this panel
// means a logged-in human is looking at the debug log directly, not the agent — the
// Chip-Session-ID header is reserved for the agent's own debug consumption (which still gets it,
// via the MCP session's PALSYNC_CHIP_SESSION_ID env var — see src/mcp/context.js — untouched by
// this file) so the server can tell the two apart and let the agent consume its own log
// independently of whatever the human happens to be looking at in the GUI.
async function fetchDebug(workspaceDir) {
    const { session, record } = await sessionForFolder(workspaceDir);
    // Reuses the cached resolve (see resolveCached.js) so a debug fetch — especially on
    // Auto-Refresh, every 5-15s — doesn't walk the whole account (GetProfileList/GetGroupList/
    // GetPalList) every single time just to find this one pal's current transient id.
    const resolved = await resolvePal(session, workspaceDir, record.palGuid);
    // echo:false — Chip's own main-process stderr isn't a place the user will ever look; the
    // renderer's Debug window is the actual surface for this, so skip the CLI's console echo.
    return retrieveServerDebug(session, record.palGuid, { palId: resolved && resolved.id, echo: false });
}

module.exports = { fetchDebug };
