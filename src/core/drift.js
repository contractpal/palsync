"use strict";
// Drift comparison on the confirmed marker, PalInfoEx.lastModifiedDate (a sql-timestamp string
// like "2026-06-03 18:16:01.0"). The marker advances only on a real server save.
function parseTs(s) {
    if (s == null) return NaN;
    // "yyyy-MM-dd HH:mm:ss.S" -> parseable by replacing the space with T
    return Date.parse(String(s).replace(" ", "T"));
}

// True if the live server marker is strictly newer than the stored (last-pulled) marker.
function serverAdvanced(storedMarker, liveMarker) {
    const a = parseTs(storedMarker), b = parseTs(liveMarker);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false; // unknown -> don't false-positive
    return b > a;
}

// Record a new marker on the sync record, but never overwrite a known one with nothing. An absent
// marker is dropped by JSON.stringify, and serverAdvanced treats an unknown stored marker as "no
// drift" — so one unguarded assignment of undefined silently disables the push drift gate. Keeping
// the older marker errs the safe way: the next push sees the server as newer and asks for a pull.
// Returns true when the marker was updated.
function adoptMarker(record, marker) {
    if (marker == null || String(marker) === "") return false;
    record.lastModifiedDate = marker;
    return true;
}

module.exports = { parseTs, serverAdvanced, adoptMarker };
