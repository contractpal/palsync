"use strict";

const crypto = require("crypto");
const path = require("path");
const { scanTags, attr, lineAt } = require("./validate/markupFacts");
const { isUnsafeTarget } = require("./validate/snapshot");
const { analyzeMarkupRegistration } = require("./validate/palJson");

const MARKUP_EXTENSION = /\.(?:html?|xhtml)$/i;
const IMPACT_SCHEMA = "palsync/impact/1";
const ERROR_SCHEMA = "palsync/impact-error/1";
const MESSAGE_BUDGET = 4096;

const ERROR_MESSAGES = {
    "mixed-modes": "Pass target alone for local structural impact; do not combine it with section or query.",
    "invalid-target": "Use an exact POSIX workspace-relative pages/ or fragments/ markup path (1-512 UTF-8 bytes).",
    "target-not-found": "Target is not a safe readable local markup file; use its exact case-sensitive workspace path.",
    "unsafe-target": "Target crosses a skipped symlink or changed path; make the local path safe and retry.",
    "unreadable-target": "Target must be a readable regular UTF-8 markup file; fix the local file and retry.",
    "response-budget": "Impact result exceeds the 4096-byte response budget; shorten local paths or fragment names and retry.",
};

const CANDIDATE_REASONS = {
    "invalid-static-name": "Fragment name must be a non-empty extensionless literal.",
    "missing-static-target": "No local fragment file has this exact runtime identity.",
    "ambiguous-static-target": "Multiple local fragment files share this runtime identity.",
};

function cmpText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

function errorResult(code, target) {
    return {
        schema: ERROR_SCHEMA,
        target,
        error: { code, message: ERROR_MESSAGES[code] },
        serverChecked: false,
    };
}

function createImpactError(code, target) {
    const safeTarget = typeof target === "string" && !target.includes("\0") &&
        Buffer.byteLength(target, "utf8") <= 512 ? target : null;
    return errorResult(code, safeTarget);
}

function validateImpactTarget(target) {
    if (typeof target !== "string") return errorResult("invalid-target", null);
    const unsafeToEcho = target.includes("\0") || Buffer.byteLength(target, "utf8") > 512;
    if (unsafeToEcho) return errorResult("invalid-target", null);

    const segments = target.split("/");
    const valid = Buffer.byteLength(target, "utf8") >= 1 &&
        target === target.trim() &&
        !target.includes("\\") &&
        !path.posix.isAbsolute(target) &&
        !/^[A-Za-z]:/.test(target) &&
        !target.startsWith("//") &&
        path.posix.normalize(target) === target &&
        !target.endsWith("/") &&
        segments.every(segment => segment !== "" && segment !== "." && segment !== "..") &&
        (segments[0] === "pages" || segments[0] === "fragments") &&
        MARKUP_EXTENSION.test(target);

    return valid ? null : errorResult("invalid-target", target);
}

function stripMarkupExtension(rel) {
    return rel.replace(MARKUP_EXTENSION, "");
}

function sourceRecord(file, line, value) {
    return { file, line, field: "name", value };
}

function exactRecord(source, targetFile, identity) {
    return {
        class: "exactReference",
        kind: "static-fragment-reference",
        source,
        target: { file: targetFile, identity },
    };
}

function candidateRecord(kind, source, candidateIdentity) {
    return {
        class: "candidateMatch",
        kind,
        source,
        candidateIdentity,
        reason: CANDIDATE_REASONS[kind],
    };
}

function dynamicRecord(source) {
    return {
        class: "unresolvedDynamic",
        kind: "dynamic-fragment-reference",
        source,
        reason: "Fragment name is computed at runtime; no target was inferred.",
    };
}

function nullableText(a, b) {
    if (a === null) return b === null ? 0 : -1;
    if (b === null) return 1;
    return cmpText(a, b);
}

function compareRecords(a, b) {
    return cmpText(a.source.file, b.source.file) ||
        a.source.line - b.source.line ||
        cmpText(a.kind, b.kind) ||
        nullableText(a.source.value, b.source.value) ||
        cmpText(
            a.target ? a.target.file : a.candidateIdentity || "",
            b.target ? b.target.file : b.candidateIdentity || ""
        );
}

function isImpactRelevant(rel) {
    return rel === "pal.json" || rel === "pages" || rel.startsWith("pages/") ||
        rel === "fragments" || rel.startsWith("fragments/");
}

function analysisFingerprint(snapshot) {
    const hash = crypto.createHash("sha256");
    hash.update("palsync/impact-input/1\0");

    const markupPaths = snapshot.markup.map(file => file.rel).sort(cmpText);
    for (const rel of markupPaths) {
        hash.update(rel + "\0" + snapshot.contentHashByRel[rel] + "\0");
    }

    if (snapshot.contentHashByRel["pal.json"]) {
        hash.update("pal.json\0" + snapshot.contentHashByRel["pal.json"] + "\0");
    } else {
        hash.update("pal.json\0absent\0");
    }

    const skipped = snapshot.skippedInputs
        .filter(item => isImpactRelevant(item.rel))
        .slice()
        .sort((a, b) => cmpText(a.rel, b.rel) || cmpText(a.reason, b.reason));
    for (const item of skipped) hash.update(item.rel + "\0" + item.reason + "\0");

    return "sha256:" + hash.digest("hex");
}

function buildStructuralImpact(snapshot, record) {
    const identities = new Map();
    const markup = snapshot.markup.slice().sort((a, b) => cmpText(a.rel, b.rel));

    for (const file of markup) {
        const identity = stripMarkupExtension(file.rel);
        const files = identities.get(identity) || [];
        files.push(file.rel);
        identities.set(identity, files);
    }
    for (const files of identities.values()) files.sort(cmpText);

    const exact = [];
    const candidates = [];
    const dynamic = [];
    for (const file of markup) {
        scanTags(file.content, (tag, position) => {
            if (tag.name.toLowerCase() !== "c:fragment") return;
            const value = attr(tag, "name");
            const source = sourceRecord(file.rel, lineAt(file.content, position), value);
            if (value === null || value === "") {
                candidates.push(candidateRecord("invalid-static-name", source, "fragments/"));
                return;
            }
            if (value.includes("${")) {
                dynamic.push(dynamicRecord(source));
                return;
            }

            const normalizedValue = value.replace(/^\/+|\/+$/g, "");
            const identity = "fragments/" + normalizedValue;
            if (normalizedValue === "" || MARKUP_EXTENSION.test(normalizedValue)) {
                candidates.push(candidateRecord("invalid-static-name", source, identity));
                return;
            }

            const files = identities.get(identity) || [];
            if (files.length === 1) exact.push(exactRecord(source, files[0], identity));
            else if (files.length === 0) {
                candidates.push(candidateRecord("missing-static-target", source, identity));
            } else {
                candidates.push(candidateRecord("ambiguous-static-target", source, identity));
            }
        });
    }

    exact.sort(compareRecords);
    candidates.sort(compareRecords);
    dynamic.sort(compareRecords);

    return {
        snapshot,
        exact,
        candidates,
        dynamic,
        identities,
        analysisFingerprint: analysisFingerprint(snapshot),
        lastKnownServerModifiedDate: record && record.lastModifiedDate !== undefined
            ? record.lastModifiedDate
            : null,
    };
}

function resolveImpactTarget(analysis, target) {
    const validationError = validateImpactTarget(target);
    if (validationError) return validationError;

    const { snapshot } = analysis;
    const skipped = snapshot.skippedInputs || [];
    if (isUnsafeTarget(skipped, target)) return errorResult("unsafe-target", null);
    if (skipped.some(item => item.rel === target &&
        (item.reason === "notRegular" || item.reason === "invalidUtf8" || item.reason === "unreadable"))) {
        return errorResult("unreadable-target", target);
    }

    const targetMarkup = snapshot.markup.find(file => file.rel === target);
    if (!targetMarkup) return errorResult("target-not-found", target);

    const targetIdentity = target.startsWith("fragments/") ? stripMarkupExtension(target) : null;
    const directDependencies = analysis.exact.filter(fact => fact.source.file === target);
    const directDependents = analysis.exact.filter(fact => fact.target.file === target);
    const candidateMatches = analysis.candidates.filter(candidate =>
        candidate.source.file === target ||
        (candidate.kind === "ambiguous-static-target" && candidate.candidateIdentity === targetIdentity));
    const unresolvedDynamic = analysis.dynamic.filter(fact => fact.source.file === target);
    const possibleDynamicIncoming = analysis.dynamic.reduce(
        (count, fact) => count + (fact.source.file === target ? 0 : 1), 0);

    return {
        schema: IMPACT_SCHEMA,
        target,
        source: "localWorkspaceSnapshot",
        freshness: {
            analysisFingerprint: analysis.analysisFingerprint,
            targetHash: "sha256:" + snapshot.contentHashByRel[target],
            lastKnownServerModifiedDate: analysis.lastKnownServerModifiedDate,
            serverChecked: false,
        },
        coverage: {
            analyzed: [
                "local pal.json page/fragment registration rules listed in registration.checksApplied",
                "literal c:fragment references in pages/ and fragments/",
            ],
            notAnalyzed: [
                "emails",
                "workflow text/runtime fragment selection",
                "store settings",
                "server-only state",
                "transitive relationships",
            ],
            possibleDynamicIncoming,
            possibleDynamicIncomingMeaning: "Unattributed dynamic references elsewhere may or may not resolve to this target.",
        },
        directDependencies,
        directDependents,
        registration: analyzeMarkupRegistration(snapshot, target, analysis.identities),
        candidateMatches,
        unresolvedDynamic,
        omitted: {
            directDependencies: 0,
            directDependents: 0,
            candidateMatches: 0,
            unresolvedDynamic: 0,
        },
    };
}

function byteLength(value) {
    return Buffer.byteLength(value, "utf8");
}

function budgetImpact(impact) {
    const fullMessage = JSON.stringify(impact);
    if (byteLength(fullMessage) <= MESSAGE_BUDGET) return impact;

    const original = {
        directDependencies: impact.directDependencies,
        directDependents: impact.directDependents,
        candidateMatches: impact.candidateMatches,
        unresolvedDynamic: impact.unresolvedDynamic,
    };
    const budgeted = {
        ...impact,
        directDependencies: [],
        directDependents: [],
        candidateMatches: [],
        unresolvedDynamic: [],
        omitted: {
            directDependencies: original.directDependencies.length,
            directDependents: original.directDependents.length,
            candidateMatches: original.candidateMatches.length,
            unresolvedDynamic: original.unresolvedDynamic.length,
        },
    };

    if (byteLength(JSON.stringify(budgeted)) > MESSAGE_BUDGET) return null;

    function tryAdd(field, record) {
        budgeted[field].push(record);
        budgeted.omitted[field]--;
        if (byteLength(JSON.stringify(budgeted)) <= MESSAGE_BUDGET) return true;
        budgeted[field].pop();
        budgeted.omitted[field]++;
        return false;
    }

    if (original.directDependencies.length) tryAdd("directDependencies", original.directDependencies[0]);
    if (original.directDependents.length) tryAdd("directDependents", original.directDependents[0]);
    if (original.unresolvedDynamic.length) tryAdd("unresolvedDynamic", original.unresolvedDynamic[0]);

    const directMax = Math.max(original.directDependencies.length, original.directDependents.length);
    for (let i = 1; i < directMax; i++) {
        if (i < original.directDependencies.length) tryAdd("directDependencies", original.directDependencies[i]);
        if (i < original.directDependents.length) tryAdd("directDependents", original.directDependents[i]);
    }
    for (let i = 1; i < original.unresolvedDynamic.length; i++) {
        tryAdd("unresolvedDynamic", original.unresolvedDynamic[i]);
    }
    for (const candidate of original.candidateMatches) tryAdd("candidateMatches", candidate);

    return budgeted;
}

function formatImpactResult(result) {
    if (!result || result.schema === ERROR_SCHEMA) {
        const error = result || errorResult("response-budget", null);
        return { ran: false, error, message: JSON.stringify(error) };
    }

    const impact = budgetImpact(result);
    if (!impact) {
        const error = errorResult("response-budget", null);
        return { ran: false, error, message: JSON.stringify(error) };
    }
    return { ran: true, impact, message: JSON.stringify(impact) };
}

module.exports = {
    buildStructuralImpact,
    resolveImpactTarget,
    formatImpactResult,
    createImpactError,
    validateImpactTarget,
    cmpText,
};
