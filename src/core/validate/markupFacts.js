"use strict";
// Shared low-level markup scanning primitives, extracted verbatim from contracts.js (Slice 1A)
// so impact-context work (later slices) can reuse the exact same tag walk without re-deriving a
// scanner. Behavior is pinned by test/impactCharacterization.test.js — do not "clean up" or
// optimize these functions without re-running that characterization.
const { parseTag } = require("./markup");

// Line number for a char offset. Files here are small (pal apps), so a plain scan is fine —
// no need for markup.js's binary-search indexer (that file isn't exported from here anyway).
function lineAt(src, pos) {
    let line = 1;
    const end = Math.min(pos, src.length);
    for (let i = 0; i < end; i++) if (src[i] === "\n") line++;
    return line;
}

// Walk every <tag> in src (skipping comments, doctype/PI, close tags, and script/style raw
// bodies), calling cb(tag, pos) for each opening/self-closing tag. Reuses markup.js's parseTag
// (already handles EL '>' inside quoted attribute values) instead of re-deriving a tag scanner.
function scanTags(src, cb) {
    const n = src.length;
    let i = 0;
    while (i < n) {
        const lt = src.indexOf("<", i);
        if (lt === -1) break;
        if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e === -1 ? n : e + 3; continue; }
        if (src[lt + 1] === "!" || src[lt + 1] === "?") { const e = src.indexOf(">", lt + 2); i = e === -1 ? n : e + 1; continue; }
        if (src[lt + 1] === "/") { const e = src.indexOf(">", lt); i = e === -1 ? n : e + 1; continue; }
        const tag = parseTag(src, lt);
        if (!tag) { i = lt + 1; continue; }
        cb(tag, lt);
        i = tag.end;
        const lname = tag.name.toLowerCase();
        if ((lname === "script" || lname === "style") && !tag.selfClosed) {
            const close = new RegExp("</" + lname + "\\b", "i").exec(src.slice(i));
            i = close ? i + close.index + close[0].length : n;
        }
    }
}

function attr(tag, name) {
    const a = tag.attrs.find(a => a.name.toLowerCase() === name);
    return a ? a.value : null;
}
function hasAttr(tag, name) {
    return tag.attrs.some(a => a.name.toLowerCase() === name);
}

module.exports = { lineAt, scanTags, attr, hasAttr };
