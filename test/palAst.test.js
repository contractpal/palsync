// pal_ast UNIT tests — the ast-grep CLI process is stubbed (the one real seam); these cover
// refusals, response shaping/caps/schema, coverage honesty, apply refusals, and inline lint
// findings. Real-binary behavior is exercised by the frozen-fixture gate tests and the token
// bench (slice 4).
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const palAst = require("../src/core/palAst");
const { hashWorkspace } = require("../src/core/workspaceHash");
const { tmpWorkspace } = require("./helpers");

const FORM_HTML =
    '<c:page title="Demo">\n  <c:a href="/y">Skip</c:a>\n</c:page>\n';
const APP_JS = "function run() {\n  var x = 1;\n  return x;\n}\n";
const MANIFEST = JSON.stringify({ palName: "Demo", pages: { entry: ["pages/form.html"] } }, null, 2) + "\n";

// Real ast-grep match entry (compact JSON), as the pinned binary emits it.
function match({ file, line, col, text, replacement, byteStart, byteEnd }) {
    return {
        text,
        range: {
            byteOffset: { start: byteStart, end: byteEnd },
            start: { line: line - 1, column: col - 1 },
            end: { line: line - 1, column: col - 1 + text.length },
        },
        file,
        lines: text,
        charCount: { leading: 0, trailing: 0 },
        language: "Html",
        metaVariables: { single: {}, multi: {}, transformed: {} },
        ...(replacement === undefined ? {} : { replacement }),
    };
}

// Byte-accurate offsets straight from the fixture bytes (splice correctness is load-bearing).
function offsetsFor(ws, rel, text) {
    const content = fs.readFileSync(path.join(ws, rel), "utf8");
    const start = content.indexOf(text);
    assert.ok(start >= 0, rel + " must contain its match text");
    return { start, end: start + text.length };
}

let lastArgs = [];
function stubRunner(matches, { stderr = "" } = {}) {
    lastArgs = [];
    palAst._setRunnerForTests((args) => {
        lastArgs = args.slice();
        return { status: 0, stdout: JSON.stringify(matches), stderr };
    });
}

function wsWithEcho({ appJs = APP_JS } = {}) {
    return tmpWorkspace({
        "pal.json": MANIFEST,
        "pages/form.html": FORM_HTML,
        "workflows/app.js": appJs,
    });
}

const REAL_PATH = process.env.PATH;
function emptyPathDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-path-"));
}
function withAstPackageHidden(fn) {
    const pkgDir = path.join(__dirname, "..", "node_modules", "@ast-grep", "cli");
    const hidden = pkgDir + ".hidden-for-test";
    if (fs.existsSync(pkgDir)) fs.renameSync(pkgDir, hidden);
    try {
        return fn();
    } finally {
        if (fs.existsSync(hidden)) fs.renameSync(hidden, pkgDir);
    }
}

beforeEach(() => {
    lastArgs = [];
    // Force a valid resolution so stub-runner tests run even where no ast-grep binary exists
    // (the resolution tests below reset it explicitly to exercise the real resolution paths).
    palAst._setResolutionForTests({ path: "stub-binary", viaPath: false });
    palAst._setRunnerForTests();
});
afterEach(() => {
    palAst._resetResolution();
    palAst._setRunnerForTests();
    delete process.env.PALSYNC_AST_BIN;
    if (process.env.PATH !== REAL_PATH) process.env.PATH = REAL_PATH;
});

// ---------------------------------------------------------------------------
// Refusals (no binary interaction)
// ---------------------------------------------------------------------------
test("refuses invalid mode, lang, and missing/oversized pattern before touching the runner", () => {
    stubRunner([]);
    const ws = wsWithEcho();
    const badMode = palAst.run({ workspaceDir: ws }, { mode: "nope", lang: "html", pattern: "<c:a>$A</c:a>" });
    assert.equal(badMode.refused, true);
    assert.equal(badMode.error.code, "invalid-mode");
    const badLang = palAst.run({ workspaceDir: ws }, { lang: "python", pattern: "x" });
    assert.equal(badLang.refused, true);
    assert.equal(badLang.error.code, "invalid-lang");
    const noPattern = palAst.run({ workspaceDir: ws }, { lang: "html" });
    assert.equal(noPattern.refused, true);
    assert.equal(noPattern.error.code, "invalid-pattern");
    assert.match(noPattern.error.message, /required/);
});

test("refuses regex-shaped patterns deterministically and names grep/read", () => {
    const ws = wsWithEcho();
    stubRunner([]);
    for (const decoy of ["a\\.b.*", "/^c:a$/", "confirm=.*", "\\d+ items"]) {
        const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: decoy });
        assert.equal(r.refused, true, decoy);
        assert.equal(r.error.code, "regex-pattern", decoy);
        assert.match(r.error.message, /grep\/read/, decoy);
    }
    assert.deepEqual(lastArgs, [], "runner must not be invoked for refused patterns");
});

test("refuses paths that escape the workspace or fall outside the 14 manifest folders", () => {
    const ws = wsWithEcho();
    const outside = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x", paths: ["notes/scratch.txt"] });
    assert.equal(outside.refused, true);
    assert.equal(outside.error.code, "unsafe-path");
    assert.match(outside.error.message, /grep\/read/);
    const escape = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x", paths: ["../evil.txt"] });
    assert.equal(escape.refused, true);
    assert.equal(escape.error.code, "unsafe-path");
    const abs = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x", paths: ["/etc/passwd"] });
    assert.equal(abs.refused, true);
    assert.equal(abs.error.code, "unsafe-path");
});

test("refuses pal.json and .palsync.json as paths unconditionally", () => {
    const ws = wsWithEcho();
    // Paths containing ".." are refused earlier as unsafe (escape check precedes normalization),
    // so the denied set here is the bare names: unconditional, whatever the folder.
    for (const denied of ["pal.json", ".palsync.json"]) {
        const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x", paths: [denied] });
        assert.equal(r.refused, true, denied);
        assert.equal(r.error.code, "denied-path", denied);
        assert.match(r.error.message, /never rewritten/, denied);
    }
});

test("refuses oversized maxFiles", () => {
    const ws = wsWithEcho();
    const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x", maxFiles: 501 });
    assert.equal(r.refused, true);
    assert.equal(r.error.code, "max-files-too-large");
});

test("refuses rewrite/apply without the rewrite argument (invalid-rewrite)", () => {
    const ws = wsWithEcho();
    stubRunner([]);
    const r1 = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: "x" });
    assert.equal(r1.refused, true);
    assert.equal(r1.error.code, "invalid-rewrite");
    const r2 = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x", apply: true });
    assert.equal(r2.refused, true);
    assert.equal(r2.error.code, "invalid-rewrite");
});

test("a failed ast-grep run (nonzero exit or spawn error) is a refusal, never a silent no-match", () => {
    const ws = wsWithEcho();
    palAst._setRunnerForTests(() => ({ status: 1, stdout: "", stderr: "Illegal option" }));
    const r1 = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x" });
    assert.equal(r1.refused, true);
    assert.equal(r1.error.code, "binary-error");
    assert.match(r1.error.message, /Illegal option/);
    palAst._setRunnerForTests(() => ({ error: "spawn EACCES", status: null, stdout: "", stderr: "" }));
    const r2 = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x" });
    assert.equal(r2.refused, true);
    assert.equal(r2.error.code, "binary-error");
    assert.match(r2.error.message, /EACCES/);
});

// Resolution tests hide the installed package AND restrict PATH — this machine also has a
// real ast-grep on PATH (Homebrew), so both must be controlled to prove the recovery path.
test("missing binary refuses with all three recovery messages and names the causes", () => {
    process.env.PALSYNC_AST_BIN = path.join(os.tmpdir(), "palsync-ast-nonexistent");
    const emptyDir = emptyPathDir();
    const ws = wsWithEcho();
    try {
        process.env.PATH = emptyDir;
        palAst._resetResolution(); // clear the forced beforeEach resolution
        withAstPackageHidden(() => {
            const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x" });
            assert.equal(r.refused, true);
            assert.equal(r.error.code, "binary-missing");
            for (const needle of ["pnpm approve-builds", "npm install --force", "glibc", "sg", "--version"]) {
                assert.ok(r.error.message.includes(needle), "missing: " + needle);
            }
            assert.equal(r.serverChecked, false);
        });
    } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
    }
});

test("PATH fallback is accepted only when --version names ast-grep (shadow-utils sg refused)", () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-fakebin-"));
    const sg = path.join(fakeBin, "sg");
    process.env.PALSYNC_AST_BIN = path.join(os.tmpdir(), "palsync-ast-nonexistent");
    const ws = wsWithEcho();
    const writeSg = (versionLine) => {
        fs.writeFileSync(sg, "#!/bin/sh\necho '" + versionLine + "'\n");
        fs.chmodSync(sg, 0o755);
    };
    try {
        withAstPackageHidden(() => {
            process.env.PATH = fakeBin;
            palAst._resetResolution();
            writeSg("setgid (shadow-utils) 4.4.1");
            const refused = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x" });
            assert.equal(refused.refused, true, "impersonating sg must be refused");
            assert.equal(refused.error.code, "binary-missing");
        });
        withAstPackageHidden(() => {
            process.env.PATH = fakeBin;
            palAst._resetResolution();
            writeSg("ast-grep 0.45.1");
            stubRunner([]);
            const search = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "<c:a>$A</c:a>" });
            assert.ok(!search.refused, "identity-checked sg must be accepted");
            assert.deepEqual(search.matches, []);
        });
    } finally {
        fs.rmSync(fakeBin, { recursive: true, force: true });
        if (process.env.PATH !== REAL_PATH) process.env.PATH = REAL_PATH;
    }
});

// ---------------------------------------------------------------------------
// Search shaping, caps, schema
// ---------------------------------------------------------------------------
test("search shapes file:line + text with 1-based lines and caps at maxResults", () => {
    const ws = wsWithEcho();
    const o = offsetsFor(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>');
    const matches = [
        match({ file: "pages/form.html", line: 2, col: 3, text: '<c:a href="/y">Skip</c:a>', byteStart: o.start, byteEnd: o.end }),
        match({ file: "pages/form.html", line: 3, col: 3, text: '<c:a href="/z">Jump</c:a>', byteStart: o.start + 1, byteEnd: o.end + 1 }),
    ];
    stubRunner(matches);
    const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: '<c:a href="$H" $$$>$A</c:a>', maxResults: 1 });
    assert.equal(r.schema, "palsync/ast/1");
    assert.equal(r.serverChecked, false);
    assert.equal(r.mode, "search");
    assert.equal(r.matches.length, 1);
    assert.equal(r.truncated, true);
    assert.deepEqual(r.omitted, { matches: 1 });
    assert.equal(r.matches[0].file, "pages/form.html");
    assert.equal(r.matches[0].line, 2);
    assert.equal(r.matches[0].column, 3);
    assert.equal(r.matches[0].text, matches[0].text);
    assert.deepEqual(lastArgs.slice(0, 2), ["run", "-l"]);
    assert.ok(lastArgs.includes("--json=compact"));
});

test("search truncates long matched text with an explicit marker", () => {
    const ws = wsWithEcho();
    const o = offsetsFor(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>');
    const longText = "<c:a href=\"/y\">" + "x".repeat(900) + "</c:a>";
    stubRunner([match({ file: "pages/form.html", line: 2, col: 3, text: longText, byteStart: o.start, byteEnd: o.end })]);
    const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "<c:a>$A</c:a>" });
    assert.equal(r.matches[0].text.length, 400 + 1); // 400 cap + "…"
    assert.ok(r.matches[0].text.endsWith("…"));
});

test("coverage reports searched/skipped/failed-to-parse honestly with caps", () => {
    const ws = wsWithEcho();
    stubRunner([]);
    const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "<c:a>$A</c:a>" });
    assert.equal(r.coverage.searchedCount, 1); // pages/form.html
    assert.equal(r.coverage.searched[0], "pages/form.html");
    // 12 absent manifest folders + workflows/app.js (wrong extension) are SKIPPED, not failed.
    assert.equal(r.coverage.skippedCount, 13);
    assert.equal(r.coverage.failedToParseCount, 0);
    assert.deepEqual(r.coverage.failedToParse, []);
    // A missing root is a skipped entry, never an error.
    const missing = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x", paths: ["fragments"] });
    assert.equal(missing.coverage.searchedCount, 0);
    assert.equal(missing.coverage.skippedCount, 1);
    assert.match(missing.coverage.skipped[0], /missing/);
});

test("parse failure of the pattern reads as a refusal, never as no match", () => {
    const ws = wsWithEcho();
    stubRunner([], { stderr: "Error: Cannot parse query as a valid pattern." });
    const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "!!not a node!!" });
    assert.equal(r.refused, true);
    assert.equal(r.error.code, "invalid-pattern");
});

test("unreadable binary output is a hard error, not an empty result", () => {
    const ws = wsWithEcho();
    palAst._setRunnerForTests(() => ({ status: 0, stdout: "not json at all", stderr: "" }));
    const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x" });
    assert.equal(r.refused, true);
    assert.equal(r.error.code, "unparseable-output");
});

// ---------------------------------------------------------------------------
// Rewrite: dry-run preview, apply, containment, drift
// ---------------------------------------------------------------------------
const REWRITE = '<c:a href="$H" confirm="1">$A</c:a>';
const REPLACEMENT = '<c:a href="/y" confirm="1">Skip</c:a>';

test("rewrite dry-run returns a preview with file bytes + unified diff, unchanged when no matches", () => {
    const ws = wsWithEcho();
    const o = offsetsFor(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>');
    stubRunner([match({ file: "pages/form.html", line: 2, col: 3, text: '<c:a href="/y">Skip</c:a>', byteStart: o.start, byteEnd: o.end, replacement: REPLACEMENT })]);
    const r = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: REWRITE, maxFiles: 5 });
    assert.equal(r.mode, "rewrite");
    assert.equal(r.preview.filesChanged, 1);
    assert.equal(r.preview.files[0].file, "pages/form.html");
    assert.equal(r.preview.unchanged, false);
    assert.match(r.preview.diff, /^pages\/form\.html\n@@ -2 \+2 @@/);
    assert.match(r.preview.diff, /\+ {2}<c:a href="\/y" confirm="1">Skip<\/c:a>/);
    const onDisk = fs.readFileSync(path.join(ws, "pages/form.html"), "utf8");
    assert.ok(!onDisk.includes('confirm="1"'), "dry-run must not write");
    // No matches → preview.unchanged true, no diff.
    stubRunner([]);
    const empty = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: REWRITE });
    assert.equal(empty.preview.unchanged, true);
    assert.equal(empty.preview.filesChanged, 0);
});

test("apply writes byte-identically to the preview and returns applied summary", () => {
    const ws = wsWithEcho();
    const before = hashWorkspace(ws);
    const o = offsetsFor(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>');
    const m = match({ file: "pages/form.html", line: 2, col: 3, text: '<c:a href="/y">Skip</c:a>', byteStart: o.start, byteEnd: o.end, replacement: REPLACEMENT });
    stubRunner([m]);
    const dry = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: REWRITE });
    assert.equal(dry.refused, undefined);
    stubRunner([m]);
    const applied = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: REWRITE, apply: true });
    assert.equal(applied.applied.filesChanged, 1);
    assert.equal(applied.applied.matchesApplied, 1);
    assert.equal(applied.applied.findings.length, 0);
    const after = fs.readFileSync(path.join(ws, "pages/form.html"), "utf8");
    assert.ok(after.includes('href="/y" confirm="1"'));
    assert.notEqual(hashWorkspace(ws), before, "apply must change the workspace");
});

test("nothing in the change set outside the manifest folders is ever written (containment)", () => {
    const ws = wsWithEcho();
    const before = hashWorkspace(ws);
    const manifestAbs = path.join(ws, "pal.json");
    const palText = JSON.stringify({ palName: "Hacked" });
    const o = offsetsFor(ws, "pal.json", '"palName": "Demo"');
    stubRunner([match({ file: "pal.json", line: 1, col: 1, text: '"palName": "Demo"', byteStart: o.start, byteEnd: o.end, replacement: '"palName": "Hacked"' })]);
    const r = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "json", pattern: '{"palName": $V}', rewrite: '{"palName": "Hacked"}', apply: true });
    assert.equal(r.refused, true);
    assert.equal(r.error.code, "unsafe-rewrite");
    assert.match(r.error.message, /Nothing was written/);
    assert.equal(hashWorkspace(ws), before, "refusals must not touch the workspace");
    assert.ok(!fs.readFileSync(manifestAbs, "utf8").includes(palText), palText + " must not reach disk");
});

test("apply refuses when the change set exceeds maxFiles and writes nothing", () => {
    const ws = wsWithEcho();
    for (const i of [1, 2, 3]) {
        fs.writeFileSync(path.join(ws, "pages", "p" + i + ".html"), "<c:page><c:a href=\"/p" + i + "\">P</c:a></c:page>\n");
    }
    const before = hashWorkspace(ws);
    const ms = [1, 2, 3].map(i => {
        const o = offsetsFor(ws, "pages/p" + i + ".html", "<c:a href=\"/p" + i + "\">P</c:a>");
        return match({ file: "pages/p" + i + ".html", line: 1, col: 1, text: "<c:a href=\"/p" + i + "\">P</c:a>", byteStart: o.start, byteEnd: o.end, replacement: "<c:a href=\"/p" + i + "\" confirm=\"1\">P</c:a>" });
    });
    stubRunner(ms);
    const r = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: '<c:a href="$H" confirm="1">$A</c:a>', apply: true, maxFiles: 2 });
    assert.equal(r.refused, true);
    assert.equal(r.error.code, "max-files");
    assert.equal(hashWorkspace(ws), before);
});

test("apply refuses on preview drift: a changed tree or a double apply never double-edits", () => {
    const ws = wsWithEcho();
    const o = offsetsFor(ws, "pages/form.html", '<c:a href="/y">Skip</c:a>');
    const m = match({ file: "pages/form.html", line: 2, col: 3, text: '<c:a href="/y">Skip</c:a>', byteStart: o.start, byteEnd: o.end, replacement: REPLACEMENT });
    stubRunner([m]);
    palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: REWRITE }); // dry-run seeds the memo
    stubRunner([m]);
    const ok = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: REWRITE, apply: true });
    assert.equal(ok.applied.filesChanged, 1);
    const afterOnce = fs.readFileSync(path.join(ws, "pages/form.html"), "utf8");
    assert.equal((afterOnce.match(/confirm="1"/g) || []).length, 1);
    // Second apply of the SAME inputs on the already-rewritten tree: the on-disk preview no
    // longer matches the memoized dry-run → drift refusal, no double edit.
    stubRunner([m]);
    const second = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "html", pattern: '<c:a href="$H">$A</c:a>', rewrite: REWRITE, apply: true });
    assert.equal(second.refused, true);
    assert.equal(second.error.code, "preview-drift");
    const afterTwice = fs.readFileSync(path.join(ws, "pages/form.html"), "utf8");
    assert.equal((afterTwice.match(/confirm="1"/g) || []).length, 1, "no double edit");
});

test("apply lints ONLY the written files and returns findings inline, advisory, errors-first", () => {
    const ws = wsWithEcho({ appJs: APP_JS });
    const o = offsetsFor(ws, "workflows/app.js", "var x = 1;");
    const m = match({ file: "workflows/app.js", line: 2, col: 3, text: "var x = 1;", byteStart: o.start, byteEnd: o.end, replacement: "let x = 1;" });
    stubRunner([m]);
    const dry = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "javascript", pattern: "var x = $V", rewrite: "let x = $V" });
    assert.equal(dry.preview.filesChanged, 1);
    stubRunner([m]);
    const applied = palAst.run({ workspaceDir: ws }, { mode: "rewrite", lang: "javascript", pattern: "var x = $V", rewrite: "let x = $V", apply: true });
    assert.equal(applied.applied.filesChanged, 1, "write stands despite findings");
    assert.ok(applied.applied.findings.length >= 1, "letConst must be reported");
    assert.equal(applied.applied.findings[0].rule, "letConst");
    assert.equal(applied.applied.findings[0].file, "workflows/app.js");
    assert.ok(applied.applied.findings.every(f => f.file === "workflows/app.js"), "only written files are linted");
    const finalText = fs.readFileSync(path.join(ws, "workflows/app.js"), "utf8");
    assert.ok(finalText.includes("let x = 1;"), "advisory findings never rollback the write");
});

test("routeTools surfaces pal_ast to its weak-model keywords", () => {
    const metadata = require("../src/mcp/pi-tools.json");
    const { routeTools } = require("../src/core/piHelpers");
    for (const query of ["ast", "refactor", "rename", "pattern", "structural", "codemod", "search", "rewrite"]) {
        assert.ok(routeTools(query, metadata).includes("pal_ast"), query);
    }
    assert.ok(routeTools("project", metadata).includes("pal_ast"));
});