"use strict";

const { writeContentAddressedArtifact } = require("./workHistory");

const SEVERITY = { error: 0, warn: 1, warning: 1, info: 2, note: 2 };

function severity(value) {
    const text = String(value || "info").toLowerCase();
    return text === "warning" ? "warn" : text;
}

function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }

function location(finding) {
    return {
        file: finding.file || null,
        line: Number.isFinite(finding.line) ? finding.line : null
    };
}

function normalizeFinding(finding) {
    const message = String(finding.message || finding.reason || "Diagnostic");
    const fixMatch = message.match(/(?:^|\s)Fix:\s*(.+)$/i);
    return {
        severity: severity(finding.severity),
        code: String(finding.code || finding.rule || finding.group || "diagnostic"),
        file: finding.file || null,
        line: Number.isFinite(finding.line) ? finding.line : null,
        message,
        fix: finding.fix || (fixMatch ? fixMatch[1] : null)
    };
}

function compare(a, b) {
    return (SEVERITY[a.severity] ?? 9) - (SEVERITY[b.severity] ?? 9) ||
        String(a.file || "").localeCompare(String(b.file || "")) ||
        (a.line || 0) - (b.line || 0) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message);
}

function collapseFindings(findings) {
    const groups = new Map();
    for (const raw of findings || []) {
        const item = normalizeFinding(raw);
        const key = item.severity + "\0" + item.code + "\0" + item.message;
        let group = groups.get(key);
        if (!group) {
            group = Object.assign({}, item, { occurrences: 0, locations: [] });
            groups.set(key, group);
        }
        group.occurrences++;
        group.locations.push(location(item));
    }
    return Array.from(groups.values()).sort(compare);
}

function buildEnvelope(source, options = {}) {
    const rawFindings = source.findings || source.diagnostics || [];
    const all = collapseFindings(rawFindings);
    const detail = options.detail || "normal";
    const perGroup = detail === "full" ? Infinity : detail === "summary" ? 1 : 3;
    const diagnostics = all.map(item => Object.assign({}, item, { locations: item.locations.slice(0, perGroup) }));
    const requested = Number.isFinite(options.maxDiagnostics) ? Math.max(options.maxDiagnostics, diagnostics.length) : Infinity;
    let retained = diagnostics.reduce((sum, item) => sum + item.locations.length, 0);
    for (let i = diagnostics.length - 1; retained > requested && i >= 0; i--) {
        while (diagnostics[i].locations.length > 1 && retained > requested) {
            diagnostics[i].locations.pop();
            retained--;
        }
    }
    const envelope = {
        ok: source.ok !== undefined ? !!source.ok : all.every(item => item.severity !== "error"),
        filesChecked: source.filesChecked ?? null,
        cacheHits: source.cacheHits ?? null,
        cacheMisses: source.cacheMisses ?? null,
        diagnosticCount: source.diagnosticCount ?? rawFindings.filter(item => severity(item.severity) !== "info" && severity(item.severity) !== "note").length,
        infoCount: source.infoCount ?? rawFindings.filter(item => severity(item.severity) === "info" || severity(item.severity) === "note").length,
        uniqueRootCauses: diagnostics.length,
        diagnostics,
        detailsRef: source.detailsRef || null
    };
    if (options.includePassing && Array.isArray(source.passing)) envelope.passing = source.passing;
    if (options.includeDebug && source.debug != null) envelope.debug = source.debug;
    // Verdict fields that the fixed shape above cannot express. pal_regression needs them: `ok:false`
    // with zero diagnostics is ambiguous between "failed, cause unlisted" and "STALE baseline, no
    // verdict possible", and a weak model reads "REGRESSION FAIL" far more reliably than `ok:false`.
    // Merged before the byte-budget loop so they are accounted for, and never allowed to overwrite a
    // standard field -- the envelope contract stays the same for every tool that uses it.
    if (isObject(options.extraFields)) {
        for (const [key, value] of Object.entries(options.extraFields)) {
            if (!(key in envelope)) envelope[key] = value;
        }
    }
    const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(0, options.maxBytes) : Infinity;
    while (Buffer.byteLength(JSON.stringify(envelope)) > maxBytes) {
        const candidate = diagnostics.slice().reverse().find(item => item.locations.length > 1);
        if (!candidate) break; // unique diagnostics are never dropped
        candidate.locations.pop();
    }
    return envelope;
}

function serializeEnvelope(workspaceDir, tool, source, options = {}) {
    // One canonical serialization feeds both the content-addressed artifact and usage
    // accounting. The envelope may use a smaller projection, but the artifact retains the
    // complete tool result for line-addressed follow-up inspection.
    const serializedSource = JSON.stringify(source, null, 2) + "\n";
    const detailsRef = writeContentAddressedArtifact(workspaceDir, tool, serializedSource);
    const envelopeSource = options.envelopeSource || source;
    const envelope = buildEnvelope(Object.assign({}, envelopeSource, { detailsRef }), options);
    const trailer = "Full result: " + (detailsRef || "unavailable (artifact write failed)");
    return {
        envelope,
        message: JSON.stringify(envelope) + "\n" + trailer,
        detailsRef,
        rawBytes: Buffer.byteLength(serializedSource)
    };
}

module.exports = { buildEnvelope, collapseFindings, serializeEnvelope };
