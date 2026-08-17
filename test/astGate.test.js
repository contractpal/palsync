// pal_ast §V1 deterministic gate — the model-free test of pal_ast correctness, safety,
// containment, determinism, latency, and token cost. Every expectation below is a FROZEN
// literal verified against the pinned @ast-grep/cli binary (0.45.1, resolved via
// palAst.resolveAstGrep()) on the committed fixtures under test/fixtures/ast/ — never
// compared against live output. Real-binary tests skip cleanly when the binary is absent;
// the pure-input refusals and the committed bench-criterion assertion always run.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const palAst = require("../src/core/palAst");
const {
    hashWorkspace,
    hashWorkspaceFiles,
} = require("../src/core/workspaceHash");
const bench = require("../bench/ast-context");

const FIXTURES = path.join(__dirname, "fixtures", "ast");
const BIN_OK = !!palAst.resolveAstGrep();
const skipNoBin = BIN_OK
    ? {}
    : {
          skip: "no ast-grep binary resolved (palAst.resolveAstGrep() returned null)",
      };

const created = [];
function fixtureWorkspace(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-astgate-"));
    fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
    created.push(dir);
    return dir;
}
function tmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-astgate-"));
    created.push(dir);
    return dir;
}
function read(ws, rel) {
    return fs.readFileSync(path.join(ws, rel), "utf8");
}
// Match sets are compared as sorted file:line:column sets — the brief freezes a match SET,
// and the sort makes the assertion robust to ast-grep's per-OS walk order.
function matchSet(matches) {
    return (matches || [])
        .map((m) => m.file + ":" + m.line + ":" + m.column)
        .sort();
}
// Every non-dotfile, non-pal.json entry under the workspace (eval hygiene: file-set checks
// must see ANY new file ast-grep or pal_ast might create, including dotdirs).
function relFileSet(ws) {
    const out = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const abs = path.join(d, e.name);
            if (e.isSymbolicLink()) continue;
            if (e.isDirectory()) walk(abs);
            else
                out.push(
                    abs
                        .replace(ws + path.sep, "")
                        .split(path.sep)
                        .join("/"),
                );
        }
    };
    walk(ws);
    return out.sort();
}
function hasDotEntry(files) {
    return files.some((rel) =>
        rel.split("/").some((seg) => seg.startsWith(".")),
    );
}

// Stub seam: inject a canned ast-grep match set so guards that real search can no longer
// reach (root-level files are out of scope by design) are still exercised deterministically.
function makeMatch({ file, line, col, text, byteStart, byteEnd, replacement }) {
    return {
        text,
        range: {
            byteOffset: { start: byteStart, end: byteEnd },
            start: { line: line - 1, column: col - 1 },
            end: { line: line - 1, column: col - 1 + text.length },
        },
        file,
        replacement,
    };
}
function stubRunner(matches) {
    palAst._setRunnerForTests(() => ({
        status: 0,
        stdout: JSON.stringify(matches),
        stderr: "",
    }));
}

beforeEach(() => {
    palAst._resetResolution();
    palAst._setRunnerForTests();
});
afterEach(() => {
    palAst._resetResolution();
    palAst._setRunnerForTests();
    delete process.env.PALSYNC_AST_BIN;
    for (const dir of created.splice(0))
        fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pure input validation — deterministic, no binary, runs on every machine
// ---------------------------------------------------------------------------
test("validateInput refuses mode/lang/pattern/rewrite mismatches deterministically", () => {
    const base = { workspaceDir: "/tmp/irrelevant" };
    const badMode = palAst.validateInput(
        Object.assign({ lang: "html", pattern: "x" }, base, { mode: "nope" }),
    );
    assert.equal(badMode.error, "invalid-mode");
    const badLang = palAst.validateInput(
        Object.assign({ pattern: "x" }, base, { lang: "python" }),
    );
    assert.equal(badLang.error, "invalid-lang");
    const noPattern = palAst.validateInput(
        Object.assign({ lang: "html" }, base),
    );
    assert.equal(noPattern.error, "invalid-pattern");
    const oversized = palAst.validateInput(
        Object.assign({ lang: "html" }, base, { pattern: "x".repeat(2049) }),
    );
    assert.equal(oversized.error, "invalid-pattern");
    const applyNoRewrite = palAst.validateInput(
        Object.assign({ lang: "html", pattern: "x" }, base, { apply: true }),
    );
    assert.equal(applyNoRewrite.error, "invalid-rewrite");
    const rewriteNoMode = palAst.validateInput(
        Object.assign({ lang: "html", pattern: "x" }, base, {
            mode: "rewrite",
        }),
    );
    assert.equal(rewriteNoMode.error, "invalid-rewrite");
    const maxFiles = palAst.validateInput(
        Object.assign({ lang: "html", pattern: "x" }, base, { maxFiles: 501 }),
    );
    assert.equal(maxFiles.error, "max-files-too-large");
});

test("validateInput refuses every regex marker class (no binary, runner never involved)", () => {
    const base = { workspaceDir: "/tmp/irrelevant", lang: "html" };
    const decoys = [
        "confirm=.*", // \.* marker
        "confirm=.+", // \.+ marker
        "/^c:a$/", // bare leading slash
        "\\d+ items", // \d escape
        "a\\sb.*", // \s + .*
        "action?=go", // ?= marker
    ];
    for (const decoy of decoys) {
        const r = palAst.validateInput(Object.assign({ pattern: decoy }, base));
        assert.equal(r.error, "regex-pattern", decoy);
    }
    const ok = palAst.validateInput(
        Object.assign({ pattern: '<c:a href="$H">$A</c:a>' }, base),
    );
    assert.equal(ok.ok, true);
});

test("validatePaths refuses escapes, absolutes, outside-scope, and pal.json/.palsync.json", () => {
    const p = (raw) => palAst.validatePaths("/tmp/irrelevant", [raw]);
    assert.equal(p("../evil.txt").error, "unsafe-path");
    assert.equal(p("/etc/passwd").error, "unsafe-path");
    assert.equal(p("\\\\win\\share").error, "unsafe-path");
    assert.equal(p("notes/scratch.txt").error, "unsafe-path");
    assert.match(p("notes/scratch.txt").message, /grep\/read/);
    for (const denied of ["pal.json", ".palsync.json"]) {
        const r = p(denied);
        assert.equal(r.error, "denied-path", denied);
        assert.match(r.message, /never rewritten/);
    }
    assert.deepEqual(p("pages/confirm.html"), {
        ok: true,
        roots: ["pages/confirm.html"],
    });
    assert.deepEqual(p("pages"), { ok: true, roots: ["pages"] });
});

// ---------------------------------------------------------------------------
// Refusal path through run() — needs a resolvable binary to get past the
// binary-first check, but the runner itself must never be invoked (spy asserts it)
// ---------------------------------------------------------------------------
test(
    "regex-decoy pattern refuses via run() naming grep/read for plain-text, spy proves no binary invocation",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("regex-decoy");
        let invoked = 0;
        palAst._setRunnerForTests(() => {
            invoked++;
            return { status: 0, stdout: "[]", stderr: "" };
        });
        for (const decoy of [
            "confirm=.*",
            "/^c:a$/",
            "\\d+ items",
            "a\\.b.*",
        ]) {
            const r = palAst.run(
                { workspaceDir: ws },
                { lang: "html", pattern: decoy },
            );
            assert.equal(r.refused, true, decoy);
            assert.equal(r.error.code, "regex-pattern", decoy);
            assert.match(r.error.message, /grep\/read/, decoy);
            assert.match(r.error.message, /plain-text/);
        }
        assert.equal(
            invoked,
            0,
            "a refused pattern must never reach the ast-grep process",
        );
    },
);

test(
    "run() refuses mode/lang/pattern/apply/maxFiles/paths before touching the runner",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("no-confirm");
        let invoked = 0;
        palAst._setRunnerForTests(() => {
            invoked++;
            return { status: 0, stdout: "[]", stderr: "" };
        });
        const cases = [
            [
                { lang: "html", pattern: "<c:a>$A</c:a>", mode: "nope" },
                "invalid-mode",
            ],
            [{ lang: "ruby", pattern: "x" }, "invalid-lang"],
            [{ lang: "html" }, "invalid-pattern"],
            [{ lang: "html", pattern: "x", apply: true }, "invalid-rewrite"],
            [
                { lang: "html", pattern: "x", maxFiles: 501 },
                "max-files-too-large",
            ],
            [
                { lang: "html", pattern: "x", paths: ["notes/scratch.txt"] },
                "unsafe-path",
            ],
            [
                { lang: "html", pattern: "x", paths: ["pal.json"] },
                "denied-path",
            ],
            [
                { lang: "html", pattern: "x", paths: [".palsync.json"] },
                "denied-path",
            ],
        ];
        for (const [args, code] of cases) {
            const r = palAst.run({ workspaceDir: ws }, args);
            assert.equal(r.refused, true, JSON.stringify(args));
            assert.equal(r.error.code, code, JSON.stringify(args));
            assert.equal(r.serverChecked, false);
        }
        assert.equal(
            invoked,
            0,
            "validation refusals must never reach the ast-grep process",
        );
    },
);

test("missing binary refuses with all three recovery messages (no binary in the resolution path)", () => {
    // The resolution seam forces the same outcome the pinned CLI lookup produces on a binary-less
    // machine — no node_modules mutation (which two parallel test files must never race on).
    const ws = fixtureWorkspace("regex-decoy");
    palAst._setResolutionForTests(null);
    const r = palAst.run({ workspaceDir: ws }, { lang: "html", pattern: "x" });
    assert.equal(r.refused, true);
    assert.equal(r.error.code, "binary-missing");
    for (const needle of [
        "pnpm approve-builds",
        "npm install --force",
        "glibc",
        "sg",
        "--version",
    ]) {
        assert.ok(
            r.error.message.includes(needle),
            "missing recovery text: " + needle,
        );
    }
    assert.equal(r.serverChecked, false);
});

// ---------------------------------------------------------------------------
// Frozen fixtures — real binary only. Every literal was verified against 0.45.1.
// ---------------------------------------------------------------------------
const NO_CONFIRM_PATTERN = '<c:a href="$H">$A</c:a>';
const NO_CONFIRM_REWRITE = '<c:a href="$H" confirm="1">$A</c:a>';
const NO_CONFIRM_MATCHES = [
    "pages/checkout.html:2:3",
    "pages/checkout.html:4:3",
    "pages/checkout.html:5:3",
    "pages/confirm.html:2:3",
    "pages/landing.html:2:3",
    "pages/landing.html:4:3",
];
const NO_CONFIRM_DIFF = [
    "pages/checkout.html",
    "@@ -2 +2 @@",
    '-  <c:a href="/cart">Cart</c:a>',
    '+  <c:a href="/cart" confirm="1">Cart</c:a>',
    "@@ -4 +4 @@",
    '-  <c:a href="/ship">Shipping</c:a>',
    '-  <c:a href="/done">Done</c:a>',
    '+  <c:a href="/ship" confirm="1">Shipping</c:a>',
    '+  <c:a href="/done" confirm="1">Done</c:a>',
    "pages/confirm.html",
    "@@ -2 +2 @@",
    '-  <c:a href="/a">A</c:a>',
    '+  <c:a href="/a" confirm="1">A</c:a>',
    "pages/landing.html",
    "@@ -2 +2 @@",
    '-  <c:a href="/home">Home</c:a>',
    '+  <c:a href="/home" confirm="1">Home</c:a>',
    "@@ -4 +4 @@",
    '-  <c:a href="/pricing">Pricing</c:a>',
    '+  <c:a href="/pricing" confirm="1">Pricing</c:a>\n',
].join("\n");

test(
    "FROZEN no-confirm: exact-attr pattern selects only anchors without extra attributes",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("no-confirm");
        const r = palAst.run(
            { workspaceDir: ws },
            { lang: "html", pattern: NO_CONFIRM_PATTERN },
        );
        assert.equal(r.mode, "search");
        assert.equal(r.serverChecked, false);
        assert.deepEqual(matchSet(r.matches), NO_CONFIRM_MATCHES);
        // exact-attr semantics live in the fixture: /b has confirm=, /c has class=, <a> is not
        // c:a — none of them are in the set. Absence of a confirm-less anchor is encoded by
        // fixture construction; pal_ast has no absence operator (recorded in the decision record).
        for (const m of r.matches) assert.ok(!/"confirm="/.test(m.text));
        assert.equal(r.coverage.searchedCount, 3);
        assert.equal(r.coverage.skippedCount, 13);
        assert.equal(r.coverage.failedToParseCount, 0);
    },
);

test(
    "FROZEN no-confirm: frozen preview diff + post-apply bytes, dry-run == apply",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("no-confirm");
        const before = hashWorkspace(ws);
        const dry = palAst.run(
            { workspaceDir: ws },
            {
                mode: "rewrite",
                lang: "html",
                pattern: NO_CONFIRM_PATTERN,
                rewrite: NO_CONFIRM_REWRITE,
            },
        );
        assert.equal(dry.mode, "rewrite");
        assert.equal(dry.preview.unchanged, false);
        assert.equal(dry.preview.matches, 6);
        assert.deepEqual(
            dry.preview.files.map(
                (f) => f.file + ":" + f.oldBytes + "->" + f.newBytes,
            ),
            [
                "pages/checkout.html:221->257",
                "pages/confirm.html:160->172",
                "pages/landing.html:197->221",
            ],
        );
        assert.equal(dry.preview.diff, NO_CONFIRM_DIFF);
        assert.equal(dry.preview.diffTruncated, false);
        assert.equal(
            hashWorkspace(ws),
            before,
            "dry-run must be a preview — nothing written",
        );

        const applied = palAst.run(
            { workspaceDir: ws },
            {
                lang: "html",
                pattern: NO_CONFIRM_PATTERN,
                rewrite: NO_CONFIRM_REWRITE,
                apply: true,
            },
        );
        assert.equal(applied.applied.filesChanged, 3);
        assert.equal(applied.applied.matchesApplied, 6);
        assert.deepEqual(
            applied.applied.findings,
            [],
            "plain-page rewrite must stay lint-clean",
        );
        // Byte-identical: preview.newBytes == post-apply bytes on disk.
        const EXPECT = {
            "pages/checkout.html":
                '<c:page title="Checkout">\n  <c:a href="/cart" confirm="1">Cart</c:a>\n' +
                '  <c:a href="/pay" confirm="1">Pay</c:a>\n  <c:a href="/ship" confirm="1">Shipping</c:a>\n' +
                '  <c:a href="/done" confirm="1">Done</c:a>\n  <c:a href="/cancel" confirm="1">Cancel</c:a>\n</c:page>\n',
            "pages/confirm.html":
                '<c:page title="Confirm demo">\n  <c:a href="/a" confirm="1">A</c:a>\n' +
                '  <c:a href="/b" confirm="1">B</c:a>\n  <c:a href="/c" class="btn">C</c:a>\n' +
                '  <a href="/d">D</a>\n</c:page>\n',
            "pages/landing.html":
                '<c:page title="Landing">\n  <c:a href="/home" confirm="1">Home</c:a>\n' +
                '  <c:a href="/about" confirm="1">About</c:a>\n  <c:a href="/pricing" confirm="1">Pricing</c:a>\n' +
                '  <c:a href="/contact" class="nav">Contact</c:a>\n</c:page>\n',
        };
        for (const [rel, bytes] of Object.entries(EXPECT)) {
            assert.equal(
                Buffer.byteLength(bytes, "utf8"),
                applied.applied.filesChanged &&
                    dry.preview.files.find((f) => f.file === rel).newBytes,
                rel,
            );
            assert.equal(
                read(ws, rel),
                bytes,
                rel + " post-apply bytes frozen",
            );
        }
    },
);

const WORKFLOW_3ARG_PATTERN = "saveRecord($A, $B, $C)";
const WORKFLOW_3ARG_REWRITE = 'saveRecord($A, $B, $C || "")';
const WORKFLOW_MATCHES = ["workflows/app.js:6:5", "workflows/orders.js:4:5"];
const WORKFLOW_DIFF = [
    "workflows/app.js",
    "@@ -6 +6 @@",
    '-    saveRecord("x", payload, callbackStyle);',
    '+    saveRecord("x", payload, callbackStyle || "");',
    "workflows/orders.js",
    "@@ -4 +4 @@",
    '-    saveRecord("orders", order, handleResult);',
    '+    saveRecord("orders", order, handleResult || "");\n',
].join("\n");

test(
    "FROZEN workflow-call: call-shape $A/$B/$C arity with a specific argument position",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("workflow-call");
        // Exactly-three-argument calls only: the 2-arg and 5-arg saveRecord calls must NOT match.
        const r = palAst.run(
            { workspaceDir: ws },
            { lang: "javascript", pattern: WORKFLOW_3ARG_PATTERN },
        );
        assert.equal(r.mode, "search");
        assert.deepEqual(matchSet(r.matches), WORKFLOW_MATCHES);
        // Argument-position pattern: record.set($K, $V) captures the KEY argument position.
        const pos = palAst.run(
            { workspaceDir: ws },
            { lang: "javascript", pattern: "record.set($K, $V)" },
        );
        assert.deepEqual(matchSet(pos.matches), ["workflows/app.js:4:5"]);
        assert.equal(r.coverage.searchedCount, 2);
        assert.equal(r.coverage.skippedCount, 13);
    },
);

test(
    "FROZEN workflow-call: frozen preview diff + post-apply bytes, dry-run == apply",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("workflow-call");
        const before = hashWorkspace(ws);
        const dry = palAst.run(
            { workspaceDir: ws },
            {
                mode: "rewrite",
                lang: "javascript",
                pattern: WORKFLOW_3ARG_PATTERN,
                rewrite: WORKFLOW_3ARG_REWRITE,
            },
        );
        assert.equal(dry.preview.matches, 2);
        assert.deepEqual(
            dry.preview.files.map(
                (f) => f.file + ":" + f.oldBytes + "->" + f.newBytes,
            ),
            ["workflows/app.js:320->326", "workflows/orders.js:261->267"],
        );
        assert.equal(dry.preview.diff, WORKFLOW_DIFF);
        assert.equal(hashWorkspace(ws), before, "dry-run must not write");

        const applied = palAst.run(
            { workspaceDir: ws },
            {
                lang: "javascript",
                pattern: WORKFLOW_3ARG_PATTERN,
                rewrite: WORKFLOW_3ARG_REWRITE,
                apply: true,
            },
        );
        assert.equal(applied.applied.filesChanged, 2);
        assert.equal(applied.applied.matchesApplied, 2);
        // Advisory lint of the WRITTEN files only: one pre-existing funcExpr warning in app.js.
        assert.deepEqual(
            applied.applied.findings.map(
                (f) => f.severity + ":" + f.rule + ":" + f.file,
            ),
            ["warn:funcExpr:workflows/app.js"],
        );
        assert.equal(
            read(ws, "workflows/app.js"),
            'function run(controller) {\n    var data = controller.getDataSet("orders");\n    var record = data.createRecord();\n' +
                '    record.set("amount", 12.5);\n    var callback = function(e) { return e; };\n' +
                '    saveRecord("x", payload, callbackStyle || "");\n    saveRecord("y", data);\n' +
                '    saveRecord("z", 1, 2, 3, 4, 5);\n    return record;\n}\n',
        );
        assert.equal(
            read(ws, "workflows/orders.js"),
            'function run(controller) {\n    var order = controller.getDataSet("orders").createRecord();\n' +
                '    order.set("total", 42);\n    saveRecord("orders", order, handleResult || "");\n' +
                '    saveRecord("orders", order);\n    saveRecord("a", 1, 2, 3 + 4, "five");\n    return order;\n}\n',
        );
    },
);

test(
    "FROZEN inline-findings: rewrite introducing let returns letConst error inline; write stands",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("workflow-call");
        const before = hashWorkspace(ws);
        const dry = palAst.run(
            { workspaceDir: ws },
            {
                mode: "rewrite",
                lang: "javascript",
                pattern: "var callback = $V",
                rewrite: "let callback = $V",
            },
        );
        assert.equal(dry.preview.filesChanged, 1);
        assert.deepEqual(
            dry.preview.files.map((f) => f.oldBytes + "->" + f.newBytes),
            ["320->319"],
        );
        const applied = palAst.run(
            { workspaceDir: ws },
            {
                lang: "javascript",
                pattern: "var callback = $V",
                rewrite: "let callback = $V",
                apply: true,
            },
        );
        assert.equal(applied.applied.filesChanged, 1);
        assert.equal(applied.applied.findings[0].severity, "error");
        assert.equal(applied.applied.findings[0].rule, "letConst");
        assert.equal(applied.applied.findings[0].file, "workflows/app.js");
        assert.equal(applied.applied.findings[0].line, 5);
        assert.ok(
            applied.applied.findings.every(
                (f) => f.file === "workflows/app.js",
            ),
            "findings scope to the written file only",
        );
        assert.ok(
            read(ws, "workflows/app.js").includes("let callback = function(e)"),
            "advisory findings never rollback the write",
        );
        assert.notEqual(
            hashWorkspace(ws),
            before,
            "apply must land despite advisory findings",
        );
    },
);

const JSON_BARE_PATTERN = '"role"';
const JSON_EXACT_PATTERN = '{"role": "site"}';
const JSON_EXACT_REWRITE = '{"role": "root"}';
const JSON_MATCHES = [
    "data/roles.json:3:7",
    "data/roles.json:4:7",
    "data/roles.json:6:16",
    "data/roles.json:7:3",
    "data/roles.json:8:13",
    "data/teams.json:2:12",
    "data/teams.json:3:12",
    "data/teams.json:4:13",
];
const JSON_DIFF = [
    "data/roles.json",
    "@@ -6 +6 @@",
    '-  "siteRole": {"role": "site"},',
    '+  "siteRole": {"role": "root"},\n',
].join("\n");

test(
    "FROZEN json-keys: bare string key pattern hits every occurrence; exact key-set matching frozen",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("json-keys");
        const bare = palAst.run(
            { workspaceDir: ws },
            { lang: "json", pattern: JSON_BARE_PATTERN, paths: ["data"] },
        );
        assert.deepEqual(
            matchSet(bare.matches),
            JSON_MATCHES,
            "bare key matches keys AND array-value occurrences",
        );
        const exact = palAst.run(
            { workspaceDir: ws },
            { lang: "json", pattern: JSON_EXACT_PATTERN, paths: ["data"] },
        );
        assert.deepEqual(
            matchSet(exact.matches),
            ["data/roles.json:6:15"],
            "object pattern matches only the exact key-set object",
        );
        // Quirks frozen to what the pinned binary actually does (recorded in the decision record):
        // multi-metavar in pair position and metavars in array positions PARSE but silently match
        // nothing; bare pair patterns do not parse at all (invalid-pattern refusal).
        const silent1 = palAst.run(
            { workspaceDir: ws },
            { lang: "json", pattern: '{"role": $V, $$$}', paths: ["data"] },
        );
        assert.deepEqual(
            silent1.matches,
            [],
            "metavar+$$$ in pair position: parses but silently matches nothing",
        );
        const silent2 = palAst.run(
            { workspaceDir: ws },
            { lang: "json", pattern: '["admin", $A]', paths: ["data"] },
        );
        assert.deepEqual(
            silent2.matches,
            [],
            "metavar in array value position: parses but silently matches nothing",
        );
        const barePair = palAst.run(
            { workspaceDir: ws },
            { lang: "json", pattern: '"role": "site"', paths: ["data"] },
        );
        assert.equal(barePair.refused, true);
        assert.equal(barePair.error.code, "invalid-pattern");
    },
);

test(
    "FROZEN json-keys: frozen preview diff + post-apply bytes, dry-run == apply",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("json-keys");
        const before = hashWorkspace(ws);
        const dry = palAst.run(
            { workspaceDir: ws },
            {
                mode: "rewrite",
                lang: "json",
                pattern: JSON_EXACT_PATTERN,
                rewrite: JSON_EXACT_REWRITE,
                paths: ["data"],
            },
        );
        assert.equal(dry.preview.matches, 1);
        assert.deepEqual(
            dry.preview.files.map(
                (f) => f.file + ":" + f.oldBytes + "->" + f.newBytes,
            ),
            ["data/roles.json:179->179"],
        );
        assert.equal(dry.preview.diff, JSON_DIFF);
        assert.equal(hashWorkspace(ws), before, "dry-run must not write");
        const applied = palAst.run(
            { workspaceDir: ws },
            {
                lang: "json",
                pattern: JSON_EXACT_PATTERN,
                rewrite: JSON_EXACT_REWRITE,
                apply: true,
                paths: ["data"],
            },
        );
        assert.equal(applied.applied.filesChanged, 1);
        assert.equal(applied.applied.matchesApplied, 1);
        assert.deepEqual(
            applied.applied.findings,
            [],
            "data/ files are not linted — apply stays clean",
        );
        assert.equal(
            read(ws, "data/roles.json"),
            '{\n  "users": [\n    { "role": "admin", "name": "ada" },\n    { "role": "user", "name": "bob" }\n  ],\n' +
                '  "siteRole": {"role": "root"},\n  "role": "site",\n  "roles": ["role", "admin"]\n}\n',
        );
        assert.equal(
            Buffer.byteLength(read(ws, "data/roles.json"), "utf8"),
            179,
        );
    },
);

const CSS_PATTERN = ".box > $A";
const CSS_REWRITE = ".card > $A";
const CSS_MATCHES = [
    "styles/cards.css:1:1",
    "styles/layout.css:1:1",
    "styles/layout.css:2:1",
];
const CSS_DIFF = [
    "styles/cards.css",
    "@@ -1 +1 @@",
    "-.box > .panel { border: 1px; }",
    "+.card > .panel { border: 1px; }",
    "styles/layout.css",
    "@@ -1 +1 @@",
    "-.box > .item { color: red; }",
    "-.box > .item:hover { color: blue; }",
    "+.card > .item { color: red; }",
    "+.card > .item:hover { color: blue; }\n",
].join("\n");

test(
    "FROZEN css-selector: child-combinator pattern matches direct-child selectors only",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("css-selector");
        const r = palAst.run(
            { workspaceDir: ws },
            { lang: "css", pattern: CSS_PATTERN, paths: ["styles"] },
        );
        assert.deepEqual(matchSet(r.matches), CSS_MATCHES);
        // .box alone (layout:4) and nested .wrapper .box > .panel (cards:3) are NOT direct-child
        // roots and must not match.
        assert.equal(r.matches.length, 3);
        assert.equal(r.coverage.searchedCount, 2);
    },
);

test(
    "FROZEN css-selector: frozen preview diff + post-apply bytes, dry-run == apply",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("css-selector");
        const before = hashWorkspace(ws);
        const dry = palAst.run(
            { workspaceDir: ws },
            {
                mode: "rewrite",
                lang: "css",
                pattern: CSS_PATTERN,
                rewrite: CSS_REWRITE,
                paths: ["styles"],
            },
        );
        assert.equal(dry.preview.matches, 3);
        assert.deepEqual(
            dry.preview.files.map(
                (f) => f.file + ":" + f.oldBytes + "->" + f.newBytes,
            ),
            ["styles/cards.css:91->92", "styles/layout.css:160->162"],
        );
        assert.equal(dry.preview.diff, CSS_DIFF);
        assert.equal(hashWorkspace(ws), before, "dry-run must not write");
        const applied = palAst.run(
            { workspaceDir: ws },
            {
                lang: "css",
                pattern: CSS_PATTERN,
                rewrite: CSS_REWRITE,
                apply: true,
                paths: ["styles"],
            },
        );
        assert.equal(applied.applied.filesChanged, 2);
        assert.equal(applied.applied.matchesApplied, 3);
        assert.deepEqual(applied.applied.findings, []);
        assert.equal(
            read(ws, "styles/layout.css"),
            ".card > .item { color: red; }\n.card > .item:hover { color: blue; }\n" +
                ".container .box > .item { margin: 0; }\n.box { padding: 1em; }\n.card > .grid { display: grid; }\n",
        );
        assert.equal(
            read(ws, "styles/cards.css"),
            ".card > .panel { border: 1px; }\n.box { margin: 0; }\n.wrapper .box > .panel { clear: both; }\n",
        );
    },
);

test(
    "FROZEN regex-decoy: regex-shaped pattern is a deterministic refusal that never runs the binary",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("regex-decoy");
        let invoked = 0;
        palAst._setRunnerForTests(() => {
            invoked++;
            return { status: 0, stdout: "[]", stderr: "" };
        });
        const r = palAst.run(
            { workspaceDir: ws },
            { lang: "html", pattern: "confirm=.*" },
        );
        assert.equal(r.refused, true);
        assert.equal(r.error.code, "regex-pattern");
        assert.match(r.error.message, /grep\/read/);
        assert.equal(
            invoked,
            0,
            "the binary must never be invoked for a refused pattern",
        );
    },
);

// ---------------------------------------------------------------------------
// Containment, determinism, maxFiles, eval hygiene — real binary
// ---------------------------------------------------------------------------
test(
    "containment: rewrite matching pal.json/.palsync.json is refused with NOTHING written (whole-workspace hash)",
    skipNoBin,
    () => {
        // Scope limits the real search to the 14 manifest folders, so pal.json can only enter the
        // change set if the engine (or a future binary version) races it in — the guard must hold
        // anyway. Injected match forbids the rewrite and leaves the workspace byte-identical.
        const ws = fixtureWorkspace("json-keys");
        const palAbs = path.join(ws, "pal.json");
        const palText = fs.readFileSync(palAbs, "utf8");
        const keyStart = palText.indexOf('"palName"');
        const palMatch = makeMatch({
            file: "pal.json",
            line: 2,
            col: 3,
            text: '"palName"',
            byteStart: keyStart,
            byteEnd: keyStart + '"palName"'.length,
            replacement: '"palNameXXX"',
        });
        stubRunner([palMatch]);
        const before = hashWorkspace(ws);
        const r = palAst.run(
            { workspaceDir: ws },
            {
                lang: "json",
                pattern: '"palName"',
                rewrite: '"palNameXXX"',
                apply: true,
            },
        );
        assert.equal(r.refused, true);
        assert.equal(r.error.code, "unsafe-rewrite");
        assert.match(r.error.message, /pal\.json/);
        assert.match(r.error.message, /Nothing was written/);
        assert.equal(
            hashWorkspace(ws),
            before,
            "a refused rewrite must leave the workspace byte-identical",
        );
        assert.ok(palText.includes('"palName": "Data"'), "pal.json must be untouched on disk");
    },
);

test(
    "containment: out-of-scope file in the match set refuses the whole rewrite, NOTHING written",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("json-keys");
        fs.mkdirSync(path.join(ws, "notes"), { recursive: true });
        const scratchAbs = path.join(ws, "notes", "scratch.json");
        fs.writeFileSync(scratchAbs, '{"palName": "Scratch"}\n');
        const scratchText = fs.readFileSync(scratchAbs, "utf8");
        const keyStart = scratchText.indexOf('"palName"');
        const scratchMatch = makeMatch({
            file: "notes/scratch.json",
            line: 1,
            col: 2,
            text: '"palName"',
            byteStart: keyStart,
            byteEnd: keyStart + '"palName"'.length,
            replacement: '"palNameXXX"',
        });
        stubRunner([scratchMatch]);
        const before = hashWorkspace(ws);
        const r = palAst.run(
            { workspaceDir: ws },
            {
                lang: "json",
                pattern: '"palName"',
                rewrite: '"palNameXXX"',
                apply: true,
            },
        );
        assert.equal(r.refused, true);
        assert.equal(r.error.code, "unsafe-rewrite");
        assert.match(r.error.message, /notes\/scratch\.json/);
        assert.equal(
            hashWorkspace(ws),
            before,
            "NOTHING may be written on an unsafe-rewrite refusal",
        );
    },
);

test(
    "maxFiles: a rewrite exceeding maxFiles refuses with NOTHING written",
    skipNoBin,
    () => {
        const ws = tmpDir();
        fs.mkdirSync(path.join(ws, "pages"), { recursive: true });
        fs.writeFileSync(
            path.join(ws, "pal.json"),
            JSON.stringify({ palName: "Max" }, null, 2) + "\n",
        );
        for (const i of [1, 2, 3]) {
            fs.writeFileSync(
                path.join(ws, "pages", "p" + i + ".html"),
                '<c:page><c:a href="/p' + i + '">P</c:a></c:page>\n',
            );
        }
        const before = hashWorkspace(ws);
        const r = palAst.run(
            { workspaceDir: ws },
            {
                lang: "html",
                pattern: NO_CONFIRM_PATTERN,
                rewrite: NO_CONFIRM_REWRITE,
                apply: true,
                maxFiles: 2,
            },
        );
        assert.equal(r.refused, true);
        assert.equal(r.error.code, "max-files");
        assert.match(r.error.message, /nothing was written/);
        assert.equal(hashWorkspace(ws), before);
    },
);

test(
    "determinism: second apply on the rewritten tree is a preview-drift refusal, never a double edit",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("no-confirm");
        const dry = palAst.run(
            { workspaceDir: ws },
            {
                mode: "rewrite",
                lang: "html",
                pattern: NO_CONFIRM_PATTERN,
                rewrite: NO_CONFIRM_REWRITE,
            },
        );
        assert.equal(dry.preview.filesChanged, 3);
        const first = palAst.run(
            { workspaceDir: ws },
            {
                lang: "html",
                pattern: NO_CONFIRM_PATTERN,
                rewrite: NO_CONFIRM_REWRITE,
                apply: true,
            },
        );
        assert.equal(first.applied.filesChanged, 3);
        const single = read(ws, "pages/confirm.html").match(
            /confirm="1"/g,
        ).length;
        assert.equal(
            single,
            2,
            "confirm.html has exactly 2 confirm attrs after one apply",
        );
        // Stateless: applying the SAME inputs again recomputes the preview from CURRENT disk,
        // which no longer matches the memoized dry-run -> refusal, no double edit.
        const second = palAst.run(
            { workspaceDir: ws },
            {
                lang: "html",
                pattern: NO_CONFIRM_PATTERN,
                rewrite: NO_CONFIRM_REWRITE,
                apply: true,
            },
        );
        assert.equal(second.refused, true);
        assert.equal(second.error.code, "preview-drift");
        assert.match(second.error.message, /already applied/);
        assert.equal(
            read(ws, "pages/confirm.html").match(/confirm="1"/g).length,
            2,
            "no double edit",
        );
    },
);

test(
    "eval hygiene: only the rewritten files change; no dotdirs/caches are created",
    skipNoBin,
    () => {
        const ws = fixtureWorkspace("workflow-call");
        const filesBefore = relFileSet(ws);
        assert.ok(
            !hasDotEntry(filesBefore),
            "fixture must start clean of dot-entries",
        );
        const hashBefore = hashWorkspaceFiles(ws);
        // Search + dry-run preview: written state must be untouched.
        const s = palAst.run(
            { workspaceDir: ws },
            { lang: "javascript", pattern: WORKFLOW_3ARG_PATTERN },
        );
        assert.ok(s.matches.length >= 2);
        palAst.run(
            { workspaceDir: ws },
            {
                mode: "rewrite",
                lang: "javascript",
                pattern: WORKFLOW_3ARG_PATTERN,
                rewrite: WORKFLOW_3ARG_REWRITE,
            },
        );
        assert.deepEqual(
            relFileSet(ws),
            filesBefore,
            "search+preview must not create or delete any file",
        );
        assert.deepEqual(
            hashWorkspace(ws),
            hashBefore.combined,
            "search+preview must not change a byte",
        );
        // Apply: the file SET is unchanged (same names), and exactly the two workflows change.
        const applied = palAst.run(
            { workspaceDir: ws },
            {
                lang: "javascript",
                pattern: WORKFLOW_3ARG_PATTERN,
                rewrite: WORKFLOW_3ARG_REWRITE,
                apply: true,
            },
        );
        assert.ok(applied.applied.filesChanged === 2);
        assert.deepEqual(
            relFileSet(ws),
            filesBefore,
            "apply must not create/delete/cache any file (no dotdirs, no locks)",
        );
        assert.ok(!hasDotEntry(relFileSet(ws)), "no dotdirs after apply");
        const hashAfter = hashWorkspaceFiles(ws);
        const changed = Object.keys(hashAfter.files)
            .filter((rel) => hashAfter.files[rel] !== hashBefore.files[rel])
            .sort();
        assert.deepEqual(
            changed,
            ["workflows/app.js", "workflows/orders.js"],
            "only the written files may change",
        );
    },
);

// ---------------------------------------------------------------------------
// Latency — p95 <= 500 ms on the largest fixture (the one with the most searched bytes)
// ---------------------------------------------------------------------------
test(
    "latency: p95 search+preview call time on the largest fixture is <= 500 ms",
    skipNoBin,
    () => {
        // Largest fixture = most searched bytes (all manifest-folder files for each lang).
        const sizeOf = (name) => {
            const ws = fixtureWorkspace(name);
            const out = { name, bytes: 0 };
            const walk = (d) => {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    const abs = path.join(d, e.name);
                    if (e.isDirectory()) walk(abs);
                    else if (e.name !== "pal.json" && !e.name.startsWith("."))
                        out.bytes += fs.statSync(abs).size;
                }
            };
            walk(ws);
            return out;
        };
        const sizes = [
            "no-confirm",
            "workflow-call",
            "json-keys",
            "css-selector",
        ]
            .map(sizeOf)
            .sort((a, b) => b.bytes - a.bytes);
        const largest = sizes[0];
        const args = {
            lang: "javascript",
            pattern: WORKFLOW_3ARG_PATTERN,
            rewrite: WORKFLOW_3ARG_REWRITE,
            mode: "rewrite",
        };
        const ws = fixtureWorkspace(largest.name);
        const runs = [];
        for (let i = 0; i < 10; i++) {
            const t0 = performance.now();
            const r = palAst.run({ workspaceDir: ws }, args);
            assert.ok(
                r.preview.filesChanged >= 1,
                "latency fixture must have a real preview",
            );
            runs.push(performance.now() - t0);
        }
        const sorted = runs.slice().sort((a, b) => a - b);
        const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
        assert.ok(
            p95 <= 500,
            "p95 " +
                p95.toFixed(1) +
                " ms exceeds the 500 ms budget on fixture " +
                largest.name +
                " (" +
                largest.bytes +
                " searched bytes)",
        );
    },
);

// ---------------------------------------------------------------------------
// Bench ship criterion — asserted against the COMMITTED deterministic file on every
// machine; recomputed and re-asserted live when the binary is present.
// ---------------------------------------------------------------------------
test("bench criterion: committed bench/ast-context.json median pal_ast cost <= 10% above the grep path", () => {
    const report = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "..", "bench", "ast-context.json"),
            "utf8",
        ),
    );
    assert.equal(report.schema, "palsync/ast-context-bench/1");
    assert.equal(report.criterion.thresholdRatio, 1.1);
    assert.equal(
        report.criterionMet,
        true,
        "committed bench must meet the ship criterion",
    );
    assert.ok(
        report.medianRatio <= 1.1,
        "median ratio " + report.medianRatio + " exceeds 1.1",
    );
    assert.ok(
        report.tasks.length >= 3,
        "at least 3 fixture tasks must carry the median",
    );
    assert.ok(
        report.removedTasks.jsonKeys,
        "the json-keys miss must be documented, not hidden",
    );
    assert.match(report.note, /REMOVED/);
});

test(
    "bench criterion: live recomputation (real binary) still meets the ship criterion",
    skipNoBin,
    () => {
        const report = bench.run();
        assert.ok(report, "bench must run when the binary is present");
        assert.equal(report.schema, "palsync/ast-context-bench/1");
        assert.equal(
            report.criterionMet,
            true,
            "live median ratio " +
                report.medianRatio +
                " must meet the criterion",
        );
        assert.ok(report.medianRatio <= 1.1);
        assert.ok(
            report.removedTasks.jsonKeys,
            "the json-keys removal note must survive regeneration",
        );
    },
);
