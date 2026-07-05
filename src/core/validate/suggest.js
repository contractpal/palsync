"use strict";
// Tiny edit-distance "did you mean" helper shared by lint rules that need to point an agent
// from an invented name at the real one (e.g. an unknown pal.json key).

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

// Finds the closest name in `candidates` to `name`, case-insensitively first (a case slip
// should always win over an unrelated same-distance match), then by edit distance. Returns
// null if nothing is within `maxDistance`.
function findSuggestion(name, candidates, maxDistance = 3) {
    const lower = name.toLowerCase();
    const caseInsensitiveHit = candidates.find(c => c.toLowerCase() === lower && c !== name);
    if (caseInsensitiveHit) return caseInsensitiveHit;

    let best = null, bestDist = Infinity;
    for (const c of candidates) {
        const d = levenshtein(lower, c.toLowerCase());
        if (d < bestDist) { bestDist = d; best = c; }
    }
    return bestDist <= maxDistance ? best : null;
}

module.exports = { levenshtein, findSuggestion };
