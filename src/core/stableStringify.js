"use strict";
// Canonical JSON: JSON.stringify-compatible but recursively sorts object keys by code-point
// so identical logical values serialize to identical bytes regardless of insertion order.
// Arrays keep order; primitives/null mirror JSON.stringify; undefined in objects is dropped,
// undefined in arrays becomes null, top-level undefined returns undefined.
function cmpKey(a, b) {
    // Code-point order, NOT localeCompare — locale/ICU dependent, wrong for determinism.
    return a < b ? -1 : a > b ? 1 : 0;
}

function isStripped(value) {
    return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function canonicalize(value, key, holder) {
    // Mirror JSON.stringify's toJSON hook before any structural handling.
    if (value && typeof value === "object" && typeof value.toJSON === "function") {
        return canonicalize(value.toJSON(key), key, holder);
    }
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const item = value[i];
            out[i] = isStripped(item) ? null : canonicalize(item, String(i), value);
        }
        return out;
    }
    if (value && typeof value === "object") {
        const out = {};
        const keys = Object.keys(value).sort(cmpKey);
        for (const k of keys) {
            const v = value[k];
            if (isStripped(v)) continue;
            out[k] = canonicalize(v, k, value);
        }
        return out;
    }
    return value;
}

function stableStringify(value, space = 0) {
    if (isStripped(value)) return undefined;
    return JSON.stringify(canonicalize(value, "", { "": value }), null, space);
}

module.exports = { stableStringify };
