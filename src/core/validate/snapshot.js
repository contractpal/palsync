"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MARKUP_EXT = new Set([".html", ".htm", ".xhtml"]);

function walkFiles(absDir, relBase, out) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch (e) { if (e.code === "ENOENT") return; throw e; }
    for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const abs = path.join(absDir, entry.name);
        const rel = relBase ? relBase + "/" + entry.name : entry.name;
        if (entry.isDirectory()) walkFiles(abs, rel, out);
        else out.push({ abs, rel });
    }
}

function readUtf8(abs) {
    try { return fs.readFileSync(abs, "utf8"); } catch (e) { return null; }
}

function sha256(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
}

// One immutable view of every validator input. Consumers must not return to disk: doing so can
// both double validation cost and mix file versions when an editor writes during validation.
function buildSnapshot(workspaceDir) {
    const found = [];
    walkFiles(workspaceDir, "", found);
    found.sort((a, b) => a.rel.localeCompare(b.rel));

    const snapshot = {
        workspaceDir,
        markup: [],
        workflows: [],
        stylesheets: [],
        datasets: [],
        palJson: { raw: null, parsed: null },
        contentHashByRel: {},
        allFiles: found.map(file => file.rel),
    };
    const stylesheetIdentities = new Set();

    for (const file of found) {
        const ext = path.extname(file.rel).toLowerCase();
        const isMarkup = (file.rel.startsWith("pages/") || file.rel.startsWith("fragments/")) && MARKUP_EXT.has(ext);
        const isWorkflow = file.rel.startsWith("workflows/") && ext === ".js";
        const isStylesheet = /^(?:styles|Styles)\//.test(file.rel) && ext === ".css";
        const isDataset = file.rel.startsWith("datasets/") && ext === ".json";
        const isPalJson = file.rel === "pal.json";
        if (!isMarkup && !isWorkflow && !isStylesheet && !isDataset && !isPalJson) continue;

        const content = readUtf8(file.abs);
        if (content == null) continue;
        snapshot.contentHashByRel[file.rel] = sha256(content);
        if (isMarkup) snapshot.markup.push({ rel: file.rel, content });
        if (isWorkflow) snapshot.workflows.push({ rel: file.rel, content });
        if (isDataset) snapshot.datasets.push({ rel: file.rel, content });
        if (isPalJson) {
            snapshot.palJson.raw = content;
            try { snapshot.palJson.parsed = JSON.parse(content); } catch (e) { /* retained as null */ }
        }
        if (isStylesheet) {
            let identity = file.abs;
            try { const stat = fs.statSync(file.abs); identity = stat.dev + ":" + stat.ino; } catch (e) { /* lexical path */ }
            if (!stylesheetIdentities.has(identity)) {
                stylesheetIdentities.add(identity);
                snapshot.stylesheets.push({ rel: file.rel, content });
            }
        }
    }
    return snapshot;
}

// ---------------------------------------------------------------------------------------------
// buildImpactSnapshot — impact-safe one-walk snapshot (Slice 1A). Same fields as buildSnapshot
// plus `skippedInputs`, but the traversal can never follow a symlink or decode invalid UTF-8:
// every directory and file is verified through lstat/fstat device+inode identity, files are
// opened with O_NOFOLLOW (where supported) and read exactly once through the verified
// descriptor, and relevant text is decoded with a fatal UTF-8 decoder. A skipped directory
// whose reason is `symlink` or `identityChanged` logically covers every descendant path for
// later target-safety checks (see isUnsafeTarget). buildSnapshot above is deliberately NOT
// routed through this code — a global symlink skip would change current validator inputs.
// ---------------------------------------------------------------------------------------------

const NOFOLLOW_FLAGS = fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW !== undefined ? fs.constants.O_NOFOLLOW : 0);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function cmpText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

function emptySnapshot(workspaceDir) {
    return {
        workspaceDir,
        markup: [],
        workflows: [],
        stylesheets: [],
        datasets: [],
        palJson: { raw: null, parsed: null },
        contentHashByRel: {},
        allFiles: [],
        skippedInputs: [],
    };
}

function isPathInside(realPath, realRoot) {
    return realPath === realRoot || realPath.startsWith(realRoot + path.sep);
}

function openFailureReason(error) {
    return error && (error.code === "ELOOP" || error.code === "EMLINK")
        ? "symlink"
        : "unreadable";
}

function changedParent(fsOps, parents) {
    for (const parent of parents) {
        let stat;
        try { stat = fsOps.lstatSync(parent.abs); }
        catch (e) { return parent.rel; }
        if (stat.isSymbolicLink() || !stat.isDirectory() ||
            stat.dev !== parent.dev || stat.ino !== parent.ino) {
            return parent.rel;
        }
    }
    return null;
}

function changedParentResult(fsOps, file) {
    const prefix = changedParent(fsOps, file.parents);
    return prefix === null ? null : {
        reason: "identityChanged",
        unsafePrefix: prefix,
        includeInAllFiles: false,
    };
}

// Verify one file through a descriptor and, for validator inputs, read its bytes exactly once.
// Both the final path and every previously verified parent are rechecked around every operation:
// O_NOFOLLOW protects only the final component, so parent identity prevents ancestor-link races.
function inspectFile(fsOps, realRoot, file, shouldRead) {
    let parentChanged = changedParentResult(fsOps, file);
    if (parentChanged) return parentChanged;

    let pre;
    let preError = null;
    try { pre = fsOps.lstatSync(file.abs); }
    catch (e) { preError = e; }
    parentChanged = changedParentResult(fsOps, file);
    if (parentChanged) return parentChanged;
    if (preError) return { reason: "unreadable", includeInAllFiles: false };
    if (pre.isSymbolicLink()) return { reason: "symlink", includeInAllFiles: false };
    if (!pre.isFile()) return { reason: "notRegular", includeInAllFiles: false };

    let fd = null;
    try {
        try { fd = fsOps.openSync(file.abs, NOFOLLOW_FLAGS); }
        catch (e) {
            parentChanged = changedParentResult(fsOps, file);
            if (parentChanged) return parentChanged;
            const reason = openFailureReason(e);
            return { reason, includeInAllFiles: reason === "unreadable" };
        }

        let stat;
        let statError = null;
        try { stat = fsOps.fstatSync(fd); }
        catch (e) { statError = e; }
        parentChanged = changedParentResult(fsOps, file);
        if (parentChanged) return parentChanged;
        if (statError) return { reason: "unreadable", includeInAllFiles: true };
        if (!stat.isFile()) return { reason: "notRegular", includeInAllFiles: false };

        let real;
        let post;
        let postError = null;
        try {
            real = fsOps.realpathSync(file.abs);
            post = fsOps.lstatSync(file.abs);
        } catch (e) { postError = e; }
        parentChanged = changedParentResult(fsOps, file);
        if (parentChanged) return parentChanged;
        if (postError || !isPathInside(real, realRoot) || post.isSymbolicLink() || !post.isFile() ||
            post.dev !== pre.dev || post.ino !== pre.ino ||
            stat.dev !== pre.dev || stat.ino !== pre.ino) {
            return { reason: "identityChanged", includeInAllFiles: false };
        }
        if (!shouldRead) return { stat, includeInAllFiles: true };

        let buffer;
        let readError = null;
        try { buffer = fsOps.readFileSync(fd); }
        catch (e) { readError = e; }
        parentChanged = changedParentResult(fsOps, file);
        if (parentChanged) return parentChanged;
        if (readError) return { reason: "unreadable", includeInAllFiles: true };
        let text;
        try { text = UTF8_DECODER.decode(buffer); }
        catch (e) {
            return { reason: "invalidUtf8", includeInAllFiles: true };
        }
        return { buffer, text, stat, includeInAllFiles: true };
    } finally {
        if (fd !== null) { try { fsOps.closeSync(fd); } catch (e) { /* best effort */ } }
    }
}

function buildImpactSnapshot(workspaceDir, fsOps = fs) {
    const skipped = [];
    const found = [];
    const unsafePrefixes = [];

    function atOrBelow(rel, prefix) {
        return prefix === "" || rel === prefix || rel.startsWith(prefix + "/");
    }

    function unsafePrefixFor(rel) {
        return unsafePrefixes.find(prefix => atOrBelow(rel, prefix));
    }

    function recordSkip(rel, reason) {
        const isUnsafe = reason === "symlink" || reason === "identityChanged" || reason === "outsideRoot";
        const covering = unsafePrefixFor(rel);
        if (covering !== undefined && covering !== rel) return;
        if (isUnsafe && covering === undefined) {
            for (let i = unsafePrefixes.length - 1; i >= 0; i--) {
                if (atOrBelow(unsafePrefixes[i], rel)) unsafePrefixes.splice(i, 1);
            }
            unsafePrefixes.push(rel);
            for (let i = found.length - 1; i >= 0; i--) {
                if (atOrBelow(found[i].rel, rel)) found.splice(i, 1);
            }
            for (let i = skipped.length - 1; i >= 0; i--) {
                if (atOrBelow(skipped[i].rel, rel)) skipped.splice(i, 1);
            }
        }
        if (!skipped.some(item => item.rel === rel && item.reason === reason)) {
            skipped.push({ rel, reason });
        }
    }

    // Reject a symlink supplied as the workspace itself before canonicalizing it. The canonical
    // root is then used for traversal so benign symlinks in an OS temp-path ancestor do not make
    // every workspace unsafe.
    const suppliedPath = path.resolve(workspaceDir);
    let suppliedRoot;
    try { suppliedRoot = fsOps.lstatSync(suppliedPath); }
    catch (e) { if (e && e.code === "ENOENT") return emptySnapshot(workspaceDir); throw e; }
    if (suppliedRoot.isSymbolicLink()) {
        const snapshot = emptySnapshot(workspaceDir);
        snapshot.skippedInputs.push({ rel: "", reason: "symlink" });
        return snapshot;
    }
    if (!suppliedRoot.isDirectory()) {
        const snapshot = emptySnapshot(workspaceDir);
        snapshot.skippedInputs.push({ rel: "", reason: "identityChanged" });
        return snapshot;
    }

    let realRoot;
    let canonicalRoot;
    try {
        realRoot = fsOps.realpathSync(suppliedPath);
        canonicalRoot = fsOps.lstatSync(realRoot);
    } catch (e) {
        const snapshot = emptySnapshot(workspaceDir);
        snapshot.skippedInputs.push({ rel: "", reason: "identityChanged" });
        return snapshot;
    }
    if (canonicalRoot.isSymbolicLink() || !canonicalRoot.isDirectory() ||
        canonicalRoot.dev !== suppliedRoot.dev || canonicalRoot.ino !== suppliedRoot.ino) {
        const snapshot = emptySnapshot(workspaceDir);
        snapshot.skippedInputs.push({ rel: "", reason: "identityChanged" });
        return snapshot;
    }

    function walk(absDir, relBase, parents, expectedRoot) {
        function ancestorChanged() {
            const prefix = changedParent(fsOps, parents);
            if (prefix === null) return false;
            recordSkip(prefix, "identityChanged");
            return true;
        }

        if (unsafePrefixFor(relBase) !== undefined || ancestorChanged()) return;
        let pre;
        let preError = null;
        try { pre = fsOps.lstatSync(absDir); }
        catch (e) { preError = e; }
        if (ancestorChanged()) return;
        if (preError) {
            recordSkip(relBase, "identityChanged");
            return;
        }
        if (pre.isSymbolicLink()) {
            recordSkip(relBase, "symlink");
            return;
        }
        if (expectedRoot && (pre.dev !== expectedRoot.dev || pre.ino !== expectedRoot.ino)) {
            recordSkip(relBase, "identityChanged");
            return;
        }
        if (!pre.isDirectory()) {
            recordSkip(relBase, relBase ? "notRegular" : "identityChanged");
            return;
        }

        let realDir;
        let realError = null;
        try { realDir = fsOps.realpathSync(absDir); }
        catch (e) { realError = e; }
        if (ancestorChanged()) return;
        if (realError || !isPathInside(realDir, realRoot)) {
            recordSkip(relBase, "identityChanged");
            return;
        }

        let entries;
        let readError = null;
        try { entries = fsOps.readdirSync(absDir, { withFileTypes: true }); }
        catch (e) { readError = e; }
        if (ancestorChanged()) return;
        if (readError) {
            recordSkip(relBase,
                !relBase || readError.code === "ENOENT" ? "identityChanged" : "unreadable");
            return;
        }

        let post;
        let postError = null;
        try { post = fsOps.lstatSync(absDir); }
        catch (e) { postError = e; }
        if (ancestorChanged()) return;
        if (postError || post.isSymbolicLink() || !post.isDirectory() ||
            post.dev !== pre.dev || post.ino !== pre.ino) {
            recordSkip(relBase, "identityChanged");
            return;
        }
        const childParents = parents.concat({
            abs: absDir,
            rel: relBase,
            dev: post.dev,
            ino: post.ino,
        });
        for (const entry of entries) {
            if (unsafePrefixFor(relBase) !== undefined) break;
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const abs = path.join(absDir, entry.name);
            const rel = relBase ? relBase + "/" + entry.name : entry.name;
            let child;
            let childError = null;
            try { child = fsOps.lstatSync(abs); }
            catch (e) { childError = e; }
            const changed = changedParent(fsOps, childParents);
            if (changed !== null) {
                recordSkip(changed, "identityChanged");
                break;
            }
            if (childError) {
                recordSkip(rel, "unreadable");
            } else if (child.isSymbolicLink()) {
                recordSkip(rel, "symlink");
            } else if (child.isDirectory()) {
                walk(abs, rel, childParents, null);
            } else if (child.isFile()) {
                found.push({ rel, abs, parents: childParents });
            } else {
                recordSkip(rel, "notRegular");
            }
        }
    }

    walk(realRoot, "", [], canonicalRoot);

    const snapshot = emptySnapshot(workspaceDir);
    const stylesheetCandidates = [];

    found.sort((a, b) => cmpText(a.rel, b.rel));
    for (const file of found.slice()) {
        if (unsafePrefixFor(file.rel) !== undefined) continue;
        const ext = path.extname(file.rel).toLowerCase();
        const isMarkup = (file.rel.startsWith("pages/") || file.rel.startsWith("fragments/")) && MARKUP_EXT.has(ext);
        const isWorkflow = file.rel.startsWith("workflows/") && ext === ".js";
        const isStylesheet = /^(?:styles|Styles)\//.test(file.rel) && ext === ".css";
        const isDataset = file.rel.startsWith("datasets/") && ext === ".json";
        const isPalJson = file.rel === "pal.json";
        const isRelevant = isMarkup || isWorkflow || isStylesheet || isDataset || isPalJson;
        const result = inspectFile(fsOps, realRoot, file, isRelevant);
        if (result.includeInAllFiles) snapshot.allFiles.push(file.rel);
        if (result.reason) {
            recordSkip(result.unsafePrefix ?? file.rel, result.reason);
            continue;
        }
        if (!isRelevant) continue;

        snapshot.contentHashByRel[file.rel] = sha256(result.buffer);
        if (isMarkup) snapshot.markup.push({ rel: file.rel, content: result.text });
        if (isWorkflow) snapshot.workflows.push({ rel: file.rel, content: result.text });
        if (isDataset) snapshot.datasets.push({ rel: file.rel, content: result.text });
        if (isPalJson) {
            snapshot.palJson.raw = result.text;
            try { snapshot.palJson.parsed = JSON.parse(result.text); } catch (e) { /* retained as null */ }
        }
        if (isStylesheet) {
            stylesheetCandidates.push({
                rel: file.rel,
                content: result.text,
                identity: result.stat.dev + ":" + result.stat.ino,
            });
        }
    }

    const safe = rel => unsafePrefixFor(rel) === undefined;
    snapshot.allFiles = snapshot.allFiles.filter(safe);
    snapshot.markup = snapshot.markup.filter(file => safe(file.rel));
    snapshot.workflows = snapshot.workflows.filter(file => safe(file.rel));
    snapshot.datasets = snapshot.datasets.filter(file => safe(file.rel));
    for (const rel of Object.keys(snapshot.contentHashByRel)) {
        if (!safe(rel)) delete snapshot.contentHashByRel[rel];
    }
    if (!safe("pal.json")) snapshot.palJson = { raw: null, parsed: null };
    const stylesheetIdentities = new Set();
    snapshot.stylesheets = stylesheetCandidates.filter(file => {
        if (!safe(file.rel) || stylesheetIdentities.has(file.identity)) return false;
        stylesheetIdentities.add(file.identity);
        return true;
    }).map(({ rel, content }) => ({ rel, content }));

    snapshot.skippedInputs = skipped
        .sort((a, b) => cmpText(a.rel, b.rel) || cmpText(a.reason, b.reason))
        .filter((item, index, items) => index === 0 ||
            item.rel !== items[index - 1].rel || item.reason !== items[index - 1].reason);
    return snapshot;
}

// A skipped directory recorded as `symlink` or `identityChanged` covers every descendant path:
// later impact slices must classify any target at or below such a prefix as unsafe without
// re-walking the disk (a directory skipped that way may have been swapped for something
// attacker-controlled between checks).
function isUnsafeTarget(skippedInputs, rel) {
    return skippedInputs.some(s =>
        (s.reason === "symlink" || s.reason === "identityChanged" || s.reason === "outsideRoot") &&
        (s.rel === "" || rel === s.rel || rel.startsWith(s.rel + "/")));
}

module.exports = { buildSnapshot, walkFiles, readUtf8, buildImpactSnapshot, isUnsafeTarget };
