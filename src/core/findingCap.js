"use strict";
// Collapse repeated identical findings so one noisy rule (e.g. 40 "img missing alt" or a workflow
// with 30 object literals) can't flood a small agent's context. Keeps the first `max` findings per
// key; the overflow is counted and reported as a single "…and N more of the same" summary line.
// Returns { shown, more: [{ key, count }] } where `more` lists each key that overflowed.
function capRepeats(findings, keyFn, max = 3) {
    const seen = new Map();     // key -> count kept
    const overflow = new Map(); // key -> count dropped
    const shown = [];
    for (const f of findings || []) {
        const k = keyFn(f);
        const n = seen.get(k) || 0;
        if (n < max) { seen.set(k, n + 1); shown.push(f); }
        else overflow.set(k, (overflow.get(k) || 0) + 1);
    }
    return { shown, more: [...overflow.entries()].map(([key, count]) => ({ key, count })) };
}

module.exports = { capRepeats };
