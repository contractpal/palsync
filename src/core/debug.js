"use strict";
// pal_debug core: retrieve the server-side c.debug(...) buffer for a pal — the same feed the
// PalBuilder IDE's debug view shows. Any workflow engine on a test pal writes to it whenever a
// workflow actually EXECUTES (a tunnel call, a rendered preview/fetch/screenshot, a browser run).
//
// Wire format (verified live against test-vm1, July 2026): Ping.do + { palId, retrieveDebug:
// "true" } headers → ComposerResult.serverData = base64 of the accumulated text (timestamped
// lines, engine-tagged, payloads pretty-printed as ASCII tables). Absent serverData = empty.
//
// SEMANTICS THAT SHAPE EVERY CALLER: the buffer is CONSUME-ONCE per Chip-Session-ID (reading
// clears only that session's own tier — the human's PalBuilder IDE view and any other Chip
// session working the same pal keep their own copies, untouched). So callers must call this only
// when THEY want it — never automatically off the back of some other action, and never polled
// speculatively (see src/mcp/tools.js's pal_debug, the sole retrieval path for an agent).
const { CloudPistonAPIManager } = require("../../lib/apiManager");
const { resolveServerPalByGuid } = require("./resolve");

// RULE: every retrieved debug buffer is ALSO echoed to the process console (stderr — stdout is
// the MCP protocol channel) whenever pal_debug is called. The read consumes THIS session's own
// tier, so this echo is what keeps the output from ever becoming invisible on the palsync side
// too. Guarded write — a dead stderr must never break the retrieve.
function echoToConsole(text) {
    try {
        process.stderr.write("[palsync-mcp] --- server debug (c.debug) ---\n" +
            text + (text.endsWith("\n") ? "" : "\n") +
            "[palsync-mcp] --- end server debug ---\n");
    } catch (e) { /* stderr gone */ }
}

// The XML parser hands scalar nodes back either as plain strings or as { _text } wrappers.
function nodeText(node) {
    if (node == null || node === "") return "";
    if (typeof node === "object" && node._text !== undefined) return String(node._text);
    return String(node);
}

// Retrieve + decode the debug buffer. `palId` (the transient encrypted id) is optional — pass a
// cached one to skip the account walk; on a FAILED retrieve with a cached id (stale id, not an
// empty buffer) it re-resolves from the guid once and retries. Non-empty output is ALWAYS echoed
// to the console (see echoToConsole); `echo:false` exists for unit tests only.
//   -> { retrieved, empty, text, palId (the id that worked — cache it), reason? }
async function retrieveServerDebug(session, palGuid, { palId, echo = true } = {}) {
    let id = palId;
    if (!id) {
        const resolved = await resolveServerPalByGuid(session, palGuid);
        if (!resolved) return { retrieved: false, reason: "pal not found on the server by guid " + palGuid };
        id = resolved.id;
    }
    let res = await CloudPistonAPIManager.retrieveDebug(session, id);
    if ((!res || res.success !== true) && palId) {
        // The cached id may be stale — re-resolve once and retry before reporting failure.
        const resolved = await resolveServerPalByGuid(session, palGuid);
        if (!resolved) return { retrieved: false, reason: "pal not found on the server by guid " + palGuid };
        id = resolved.id;
        res = await CloudPistonAPIManager.retrieveDebug(session, id);
    }
    if (!res || res.success !== true) {
        return { retrieved: false, reason: "the server did not return a debug result (Ping.do retrieveDebug)" };
    }
    const raw = nodeText(res.serverData);
    let text = "";
    if (raw.trim()) {
        try { text = Buffer.from(raw, "base64").toString("utf8"); }
        catch (e) { text = raw; /* not base64 after all — show what came down */ }
    }
    const empty = !text.trim();
    if (!empty && echo) echoToConsole(text);
    return { retrieved: true, empty, text, palId: id };
}

module.exports = { retrieveServerDebug };
