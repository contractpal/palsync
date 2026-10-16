"use strict";
// Per-pal "validation off" switch. The developer, not the agent, decides when the local push gate
// may be bypassed: PalBuilder always submits and lets the server validate, and Chip's gate would
// otherwise be a wall the developer cannot move (agents cannot pass skipValidation; see pal_push).
//
// The switch lives in ~/.palsync/config.json, keyed by the pal's server GUID — deliberately NOT in
// the workspace, so it survives the launcher rebuilding .palsync.json and is not something an agent
// stumbles on while editing pal files. The GUI (the slider in the title bar) writes it; pal_push
// reads it on every push, so flipping it takes effect without restarting the agent.
const config = require("../platform/config");

const KEY = "validationOffPals";

function table(read) {
    const t = read(KEY, {});
    return t && typeof t === "object" && !Array.isArray(t) ? t : {};
}

// Validation is ON unless this pal was explicitly switched off.
function isOff(palGuid, read = config.get) {
    return !!palGuid && table(read)[palGuid] === true;
}

// Returns true when the preference was saved. Switching back on removes the entry so the file
// does not accumulate a record for every pal ever touched.
function setOff(palGuid, off, read = config.get, write = config.set) {
    if (!palGuid) return false;
    const next = Object.assign({}, table(read));
    if (off) next[palGuid] = true; else delete next[palGuid];
    return write(KEY, next);
}

module.exports = { isOff, setOff, KEY };
