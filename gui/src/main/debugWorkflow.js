"use strict";
// Backing logic for the per-pal Debug window — wraps palsync's already-verified-live
// src/core/debug.js. The server-side buffer is CONSUME-ONCE and SHARED with the PalBuilder IDE's
// own debug view (whoever reads first clears it for everyone), so this must only ever be called
// on an explicit user action (button click), never polled speculatively.
const { retrieveServerDebug } = require("palsync/src/core/debug");
const { sessionForFolder } = require("./palSession");
const { resolvePal } = require("./resolveCached");

async function fetchDebug(workspaceDir, chipSessionId) {
    const { session, record } = await sessionForFolder(workspaceDir, chipSessionId);
    // Reuses the cached resolve (see resolveCached.js) so a debug fetch — especially on
    // Auto-Refresh, every 5-15s — doesn't walk the whole account (GetProfileList/GetGroupList/
    // GetPalList) every single time just to find this one pal's current transient id.
    const resolved = await resolvePal(session, workspaceDir, record.palGuid);
    // echo:false — Chip's own main-process stderr isn't a place the user will ever look; the
    // renderer's Debug window is the actual surface for this, so skip the CLI's console echo.
    return retrieveServerDebug(session, record.palGuid, { palId: resolved && resolved.id, echo: false });
}

module.exports = { fetchDebug };
