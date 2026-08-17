
// pal_ast — deterministic, offline, syntax-aware STRUCTURAL search and conservative rewrite over a
// pal workspace, backed by the pinned @ast-grep/cli binary (ast-grep, an AST tree-sitter engine).
//
// What it is NOT: a text search (use grep/read for exact text), a semantic graph (pal_impact is that),
// or a general-purpose editor. It matches code SHAPES — AST node patterns — and rewrites whole matched
// nodes. Pattern surface: exact strings + ast-grep metavariables ($A single node, $$$ zero+ nodes).
// No regex inside patterns, no absence matching: both are outside the single pattern/rewrite surface
// and refused-with-guidance up front rather than silently returning empty results.
//
// Write safety (apply:true) — non-negotiable:
//   - every searched path must resolve inside a manifest folder; pal.json and .palsync.json are denied
//     unconditionally (pal.json carries registration identity; the PreToolUse guard cannot see MCP writes),
//   - the change set (files ast-grep would rewrite) must stay within those same folders and within
//     maxFiles (default 25, explicit override),
//   - preview-drift refusal: apply re-runs the preview from CURRENT disk and refuses when the result
//     differs from the last dry-run/apply for the same inputs in this process — a tampered tree or a
//     second apply on an already-rewritten tree refuses instead of double-editing. The memo lives only
//     in this process — nothing is ever written to disk — so a FIRST apply of fresh inputs always
//     recomputes from disk (no prior dry-run to drift from),
//   - after writing, ONLY the written files are linted (lintContent), findings returned inline,
//     errors-first, capped, ADVISORY — never isError, never rollback.
//
// Delivery: @ast-grep/cli@0.45.1 ships platform binaries; resolution = pinned dependency first, then a
// PATH fallback accepted ONLY when `--version` names ast-grep (on Linux, `sg` is shadow-utils' setgid
// binary — presence alone proves nothing). Cached per process; a missing binary never breaks PalSync.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { IN_SCOPE, MANIFEST_FILE } = require("./workspaceHash");
const { lintContent, hasDesignSystem } = require("./validate");

const AST_SCHEMA = "palsync/ast/1";
const LANG_EXT = {
    html: [".html", ".htm", ".xhtml"],
    javascript: [".js"],
    css: [".css"],
    json: [".json"],
};
const LANGS = Object.keys(LANG_EXT);
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_FILES = 25;
const DEFAULT_MAX_MATCH_BYTES = 400; // per matched-text line, truncated with a marker
const COVERAGE_LIST_CAP = 25;
const FINDINGS_CAP = 30;

// A pattern that looks like a copy-pasted regex (or regex-dense text) is refused deterministically —
// ast-grep sometimes parses such text as a valid-but-meaningless pattern and silently returns [].
// Markers: a bare leading slash (a regex literal), regex groups/escapes, and `.*`/`.+` splats.
const REGEX_PATTERN_MARKERS = /^\s*\/[^/*]|\?[=(<]|\\[dDwWsSbB]|\.\*|\.\+/;

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------
let resolution;

function findOnPath(names) {
    const dirs = String(process.env.PATH || "").split(path.delimiter);
    for (const dir of dirs) {
        if (!dir) continue;
        for (const name of names) {
            const abs = path.join(dir, name);
            try {
                fs.accessSync(abs, fs.constants.X_OK);
                return abs;
            } catch (e) {
                /* keep looking */
            }
        }
    }
    return null;
}

function versionOf(bin) {
    try {
        const res = spawnSync(bin, ["--version"], {
            encoding: "utf8",
            timeout: 3000,
            windowsHide: true,
        });
        if (res.error) return "";
        return String(res.stdout || "") + String(res.stderr || "");
    } catch (e) {
        return "";
    }
}

// Identity check, not presence: on Linux `sg` is shadow-utils' setgid binary. Accept a fallback only
// when --version actually names ast-grep (and looks like a version), otherwise refuse with guidance.
function looksLikeAstGrep(out) {
    return /ast-grep/i.test(out) && /\d+\.\d+\.\d+/.test(out);
}

function resolveAstGrep() {
    if (resolution !== undefined) return resolution;
    const forced = process.env.PALSYNC_AST_BIN;
    const candidates = [];
    if (forced) {
        candidates.push(forced);
    } else {
        try {
            candidates.push(require.resolve("@ast-grep/cli/ast-grep"));
        } catch (e) {
            /* not installed */
        }
        try {
            candidates.push(require.resolve("@ast-grep/cli/sg"));
        } catch (e) {
            /* not installed */
        }
    }
    for (const bin of candidates) {
        if (!fs.existsSync(bin)) continue;
        const out = versionOf(bin);
        if (looksLikeAstGrep(out)) {
            resolution = { path: bin, viaPath: false };
            return resolution;
        }
    }
    const onPath = findOnPath(["ast-grep", "sg"]);
    if (onPath) {
        const out = versionOf(onPath);
        if (looksLikeAstGrep(out)) {
            resolution = { path: onPath, viaPath: true };
            return resolution;
        }
    }
    resolution = null; // refused with guidance below
    return resolution;
}

const _resetResolution = () => {
    resolution = undefined;
};

// Test seam: force a resolution (unit tests stub the spawn seam; the binary itself may be
// absent on CI). Mirrors how _setRunnerForTests bypasses the process boundary.
const _setResolutionForTests = (r) => {
    resolution = r;
};

// ---------------------------------------------------------------------------
// Command runner (stubbed in unit tests — this is the process boundary)
// ---------------------------------------------------------------------------
function defaultRunner(args, { cwd }) {
    const bin = resolveAstGrep();
    if (!bin) return { missing: true, stderr: "" };
    // args already begin with the ast-grep subcommand ("run") — see astArgs in run().
    const res = spawnSync(bin.path, args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15000,
        windowsHide: true,
    });
    return {
        status: res.status,
        stderr: String(res.stderr || ""),
        error: res.error ? String(res.error.message || res.error) : null,
        stdout: String(res.stdout || ""),
    };
}
let runner = defaultRunner;
const _setRunnerForTests = (fn) => {
    runner = fn || defaultRunner;
};

// ---------------------------------------------------------------------------
// Fixture/candidate enumeration (coverage honesty: searched / skipped / failedToParse)
// ---------------------------------------------------------------------------
// Deterministic, mirrored to ast-grep's own filtering: only the lang's lowercase extensions are
// searched; hidden entries and symlinks are skipped — never followed (workspaceHash invariant 8).
function collectCandidates(workspaceDir, lang, roots) {
    const exts = new Set(LANG_EXT[lang]);
    const out = { searched: [], skipped: [], failedToParse: [], errors: [] };
    const seen = new Set();
    const relOf = (abs) =>
        path.relative(workspaceDir, abs).split(path.sep).join("/");
    const considerFile = (rel, abs, name) => {
        if (seen.has(rel)) return;
        seen.add(rel);
        if (name.startsWith(".")) {
            out.skipped.push({ rel, reason: "hidden" });
            return;
        }
        if (!exts.has(path.extname(name))) {
            out.skipped.push({ rel, reason: "extension" });
            return;
        }
        out.searched.push({ rel, abs });
    };
    const visitDir = (absDir) => {
        let entries;
        try {
            entries = fs.readdirSync(absDir, { withFileTypes: true });
        } catch (e) {
            out.failedToParse.push({
                rel: relOf(absDir),
                reason: "unreadable directory",
            });
            return;
        }
        for (const entry of entries) {
            const abs = path.join(absDir, entry.name);
            const rel = relOf(abs);
            if (entry.isSymbolicLink()) {
                out.skipped.push({ rel, reason: "symlink" });
                continue;
            }
            if (entry.isDirectory()) {
                visitDir(abs);
                continue;
            }
            if (!entry.isFile()) {
                out.skipped.push({ rel, reason: "not a regular file" });
                continue;
            }
            considerFile(rel, abs, entry.name);
        }
    };
    for (const rootRaw of roots) {
        const root = path.resolve(workspaceDir, rootRaw);
        let st;
        try {
            st = fs.lstatSync(root);
        } catch (e) {
            out.skipped.push({ rel: relOf(root), reason: "missing" });
            continue;
        }
        if (st.isSymbolicLink()) {
            out.skipped.push({ rel: relOf(root), reason: "symlink" });
            continue;
        }
        if (st.isFile()) {
            considerFile(relOf(root), root, path.basename(root));
            continue;
        }
        visitDir(root);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Path validation and containment (write safety)
// ---------------------------------------------------------------------------
const DENY_FILES = new Set([MANIFEST_FILE, ".palsync.json"]);

// A path is searchable ONLY when it narrows within the manifest folders: workspace-relative, no
// escaping segments, inside one of the 14 IN_SCOPE folders, and never pal.json/.palsync.json.
function validatePaths(workspaceDir, rawPaths) {
    if (!Array.isArray(rawPaths) || rawPaths.length === 0)
        return { ok: true, roots: IN_SCOPE };
    const roots = [];
    for (const raw of rawPaths) {
        if (
            typeof raw !== "string" ||
            raw.trim() === "" ||
            Buffer.byteLength(raw, "utf8") > 512
        ) {
            return {
                ok: false,
                error: "invalid-path",
                message:
                    "Each path must be a workspace-relative path to a manifest folder or file (1-512 bytes).",
            };
        }
        const rel = raw.split("/").join("/");
        if (
            rel.includes("\\") ||
            rel.startsWith("/") ||
            /^[A-Za-z]:/.test(rel) ||
            rel.split("/").includes("..")
        ) {
            return {
                ok: false,
                error: "unsafe-path",
                message:
                    "Paths must be workspace-relative and cannot escape the workspace.",
            };
        }
        const norm = path.posix.normalize(rel);
        if (norm === "." || norm === ".." || norm.startsWith("../")) {
            return {
                ok: false,
                error: "unsafe-path",
                message:
                    "Paths must stay inside the workspace's manifest folders.",
            };
        }
        if (DENY_FILES.has(norm)) {
            return {
                ok: false,
                error: "denied-path",
                message: norm + " is never rewritten by pal_ast.",
            };
        }
        const top = norm.split("/")[0];
        if (!IN_SCOPE.includes(top)) {
            return {
                ok: false,
                error: "unsafe-path",
                message:
                    "pal_ast only touches the manifest folders (" +
                    IN_SCOPE.join(", ") +
                    "). '" +
                    top +
                    "' is outside scope — use grep/read or the data-set tools instead.",
            };
        }
        roots.push(norm);
    }
    return { ok: true, roots };
}

// ---------------------------------------------------------------------------
// Result shaping helpers
// ---------------------------------------------------------------------------
function cap(list, max, label) {
    const truncated = list.length > max;
    return {
        items: truncated ? list.slice(0, max) : list,
        truncated,
        omitted: truncated ? list.length - max : 0,
        label,
    };
}

function truncateText(text, max) {
    const s = String(text || "");
    if (s.length <= max) return s;
    return s.slice(0, max) + "…";
}

function coverageBlock(coverage) {
    const s = cap(
        coverage.searched.map((item) => item.rel),
        COVERAGE_LIST_CAP,
        "searched",
    );
    const k = cap(
        coverage.skipped.map((item) => item.rel + " (" + item.reason + ")"),
        COVERAGE_LIST_CAP,
        "skipped",
    );
    const f = cap(
        coverage.failedToParse.map((item) => item.rel),
        COVERAGE_LIST_CAP,
        "failed to parse",
    );
    return {
        searched: s.items,
        skipped: k.items,
        failedToParse: f.items,
        searchedCount: coverage.searched.length,
        skippedCount: coverage.skipped.length,
        failedToParseCount: coverage.failedToParse.length,
        truncated: {
            searched: s.truncated,
            skipped: k.truncated,
            failedToParse: f.truncated,
        },
        omitted: {
            searched: s.omitted,
            skipped: k.omitted,
            failedToParse: f.omitted,
        },
    };
}

// ---------------------------------------------------------------------------
// Preview-drift memo — in-process only, never written to disk (eval hygiene).
// Keyed by the full input tuple; set by every successful dry-run/apply.
// ---------------------------------------------------------------------------
const previewMemo = new Map();
const memoKey = (args) =>
    JSON.stringify([
        args.workspaceDir,
        args.pattern,
        args.rewrite || null,
        args.lang,
        args.paths || null,
    ]);

function hashPreview(diffText) {
    const crypto = require("node:crypto");
    return crypto
        .createHash("sha256")
        .update(diffText)
        .digest("hex")
        .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------
function parseAstMatches(stdout) {
    // A legit zero-match run ALWAYS prints "[]"; an EMPTY stdout means the run produced nothing
    // (failure), which must read as unreadable output / binary-error — never as "no match".
    if (typeof stdout !== "string" || stdout.trim() === "") return null;
    try {
        return JSON.parse(stdout);
    } catch (e) {
        return null;
    }
}

// One search/preview run. Returns { matches, entries } for search; for rewrite also computes the
// per-file change set { files: [{ rel, abs, oldBytes, newBytes }], diffText }.
function computeChangeSet(workspaceDir, matches) {
    const byFile = new Map();
    for (const m of matches || []) {
        const rel = String(m.file || "").split("/").join("/");
        if (!byFile.has(rel)) byFile.set(rel, []);
        byFile.get(rel).push(m);
    }
    const files = [];
    let diffText = "";
    for (const rel of [...byFile.keys()].sort()) {
        const abs = path.join(workspaceDir, rel);
        let bytes;
        try {
            bytes = fs.readFileSync(abs); // Buffer — edits splice on BYTE offsets
        } catch (e) {
            continue;
        }
        const edits = byFile
            .get(rel)
            .map((m) => {
                const off =
                    m.replacementOffsets && m.replacementOffsets.start != null
                        ? m.replacementOffsets
                        : m.range && m.range.byteOffset;
                if (off == null) return null;
                return {
                    start: off.start,
                    end: off.end,
                    text: String(m.replacement || ""),
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.start - a.start); // descending so in-place splicing never shifts earlier offsets
        let newBuf = bytes;
        let applied = 0;
        for (const edit of edits) {
            if (edit.start < 0 || edit.end > newBuf.length || edit.start > edit.end) continue;
            newBuf = Buffer.concat([
                newBuf.slice(0, edit.start),
                Buffer.from(edit.text, "utf8"),
                newBuf.slice(edit.end),
            ]);
            applied++;
        }
        if (applied === 0 || newBuf.equals(bytes)) continue;
        const newText = newBuf.toString("utf8");
        files.push({
            rel,
            abs,
            oldBytes: bytes.length,
            newBytes: newBuf.length,
            newBuf, // byte-exact rewritten content — the WRITE uses this, never a re-encoding
            oldText: bytes.toString("utf8"),
            newText,
        });
        diffText += diffFor(rel, bytes.toString("utf8"), newText);
    }
    return { files, diffText };
}

// Canonical minimal unified diff (no context lines) — deterministic, version-independent, and what
// the fixtures freeze. Format: `path`, then `@@ -line +line` per changed run, `-old`/`+new` pairs.
// Both sides drop a trailing "" that a final newline produces, so terminator-only differences are
// ignored by the diff (the change set still carries them as byte differences).
function diffFor(rel, oldText, newText) {
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    if (
        oldLines[oldLines.length - 1] === "" &&
        newLines[newLines.length - 1] === ""
    ) {
        oldLines.pop();
        newLines.pop();
    }
    let out = rel + "\n";
    let oldI = 0,
        newI = 0;
    while (oldI < oldLines.length || newI < newLines.length) {
        if (
            oldI < oldLines.length &&
            newI < newLines.length &&
            oldLines[oldI] === newLines[newI]
        ) {
            oldI++;
            newI++;
            continue;
        }
        const startOld = oldI,
            startNew = newI;
        while (
            (oldI < oldLines.length || newI < newLines.length) &&
            !(
                oldI < oldLines.length &&
                newI < newLines.length &&
                oldLines[oldI] === newLines[newI]
            )
        ) {
            if (oldI < oldLines.length) oldI++;
            if (newI < newLines.length) newI++;
        }
        out += "@@ -" + (startOld + 1) + " +" + (startNew + 1) + " @@\n";
        for (let k = startOld; k < oldI; k++) out += "-" + oldLines[k] + "\n";
        for (let k = startNew; k < newI; k++) out += "+" + newLines[k] + "\n";
    }
    return out;
}

// ---------------------------------------------------------------------------
// Input validation + refusals
// ---------------------------------------------------------------------------
function validateInput(args) {
    const mode = args.mode === undefined ? "search" : String(args.mode);
    if (mode !== "search" && mode !== "rewrite") {
        return {
            error: "invalid-mode",
            message: 'mode must be "search" or "rewrite".',
        };
    }
    if (!LANGS.includes(args.lang)) {
        return {
            error: "invalid-lang",
            message: "lang must be one of: " + LANGS.join(", ") + ".",
        };
    }
    if (
        typeof args.pattern !== "string" ||
        args.pattern.trim() === "" ||
        Buffer.byteLength(args.pattern, "utf8") > 2048
    ) {
        return {
            error: "invalid-pattern",
            message:
                "pattern is required: a complete AST node shape in the selected lang (1-2048 bytes).",
        };
    }
    if (REGEX_PATTERN_MARKERS.test(args.pattern)) {
        return {
            error: "regex-pattern",
            message:
                'The pattern looks like a regular expression. pal_ast matches AST node SHAPES, not text — regex and plain-text search are grep/read territory. Try a structural pattern (e.g. <c:a action="$A">...</c:a> or saveRecord($$$), or use grep/read for exact text.',
        };
    }
    const wantsApply = args.apply === true;
    if (wantsApply || mode === "rewrite") {
        if (
            typeof args.rewrite !== "string" ||
            Buffer.byteLength(args.rewrite, "utf8") > 4096
        ) {
            return {
                error: "invalid-rewrite",
                message:
                    "rewrite is required for mode:rewrite / apply:true: the full replacement for every matched node.",
            };
        }
    }
    const maxResults =
        Number.isInteger(args.maxResults) && args.maxResults > 0
            ? args.maxResults
            : DEFAULT_MAX_RESULTS;
    const maxFiles =
        Number.isInteger(args.maxFiles) && args.maxFiles > 0
            ? args.maxFiles
            : DEFAULT_MAX_FILES;
    if (maxFiles > 500) {
        return {
            error: "max-files-too-large",
            message:
                "maxFiles is capped at 500 — narrow paths or split the rewrite.",
        };
    }
    const pathsResult = validatePaths(args.workspaceDir, args.paths);
    if (!pathsResult.ok) return pathsResult;
    return {
        ok: true,
        mode,
        wantsApply,
        maxResults,
        maxFiles,
        roots: pathsResult.roots,
        effectiveMode: wantsApply ? "apply" : mode,
    };
}

function missingBinaryResult() {
    return {
        schema: AST_SCHEMA,
        mode: null,
        refused: true,
        error: {
            code: "binary-missing",
            message:
                "The ast-grep binary could not be resolved. pal_ast is offline but needs the pinned @ast-grep/cli dependency. Recovery by cause:" +
                "\n- pnpm: @ast-grep/cli's postinstall was blocked by pnpm's lifecycle policy — run `pnpm approve-builds` (or allow build scripts for @ast-grep/cli), then reinstall." +
                "\n- npm: optional dependencies were skipped (npm/cli#4828) — run `npm install --force @ast-grep/cli`." +
                "\n- Linux (glibc-only binary): musl/Alpine has no prebuilt binary — install Node + run on a glibc distro, or place an ast-grep binary on PATH named `ast-grep` or `sg` (verified via `--version`; plain shadow-utils `sg` is rejected).",
        },
        serverChecked: false,
    };
}

// ---------------------------------------------------------------------------
// Public entry — run(ctx, args) → result object (schema palsync/ast/1)
// ---------------------------------------------------------------------------
function run({ workspaceDir }, rawArgs = {}) {
    const args = Object.assign({}, rawArgs, { workspaceDir });

    // Binary first: every other refusal is moot (and honest) without it.
    const bin = resolveAstGrep();
    if (!bin) return missingBinaryResult();

    const validated = validateInput(args);
    if (validated.error)
        return Object.assign(
            {
                schema: AST_SCHEMA,
                mode: args.mode || "search",
                refused: true,
                error: { code: validated.error, message: validated.message },
            },
            { serverChecked: false },
        );

    const { mode, wantsApply, maxResults, maxFiles, roots, effectiveMode } =
        validated;
    const candidates = collectCandidates(workspaceDir, args.lang, roots);

    const astArgs = [
        "run",
        "-l",
        args.lang,
        "-p",
        args.pattern,
        "--json=compact",
        "--no-ignore=parent",
        "--no-ignore=vcs",
    ];
    if (mode === "rewrite" || wantsApply) astArgs.push("-r", args.rewrite);
    // Scope the scan to the validated roots (narrowed within the 14 manifest folders). Matching the
    // coverage block to what the engine actually searches keeps "searched" honest. Only roots that
    // EXIST are passed positionally: ast-grep exits 1 on a nonexistent path, and a missing folder is
    // already reported honestly in the coverage block as "skipped (missing)".
    for (const root of roots) {
        try {
            fs.lstatSync(path.resolve(workspaceDir, root));
            astArgs.push(root.split("/").join("/"));
        } catch (e) {
            /* missing — covered by the coverage report */
        }
    }
    const res = runner(astArgs, { cwd: workspaceDir });
    if (res.missing) return missingBinaryResult();
    if (res.error) {
        // The process could not be spawned at all (EACCES/ENOENT/timeout) — nothing to parse.
        return Object.assign(
            {
                schema: AST_SCHEMA,
                mode: effectiveMode,
                refused: true,
                error: {
                    code: "binary-error",
                    message:
                        "ast-grep could not be run (" +
                        res.error +
                        "). " +
                        (String(res.stderr || "").slice(0, 300) || "No error detail.") +
                        " This is unexpected — report it with the pattern and lang.",
                },
            },
            { serverChecked: false },
        );
    }

    const matches = parseAstMatches(res.stdout);

    // ast-grep's own refusal: a pattern it cannot parse at all. Checked before the exit-status gate
    // so an unparseable pattern is never misread as a binary failure.
    if (/Cannot parse query as a valid pattern/i.test(res.stderr || "")) {
        return Object.assign(
            {
                schema: AST_SCHEMA,
                mode,
                refused: true,
                error: {
                    code: "invalid-pattern",
                    message:
                        "The pattern is not a valid AST node in " +
                        args.lang +
                        ". For plain-text or regex search, use grep/read instead.",
                },
            },
            { serverChecked: false },
        );
    }

    // ast-grep itself exits 1 on a rewrite with zero matches when --json=compact is on, while
    // still emitting a valid JSON [] on stdout — a pinned-binary convention, not a failure. So a
    // nonzero exit is an error ONLY when the stdout did not parse as JSON.
    if (res.status != null && res.status !== 0 && matches === null) {
        return Object.assign(
            {
                schema: AST_SCHEMA,
                mode: effectiveMode,
                refused: true,
                error: {
                    code: "binary-error",
                    message:
                        "ast-grep failed (exit " +
                        res.status +
                        "). " +
                        (String(res.stderr || "").slice(0, 300) || "No error detail.") +
                        " This is unexpected — report it with the pattern and lang.",
                },
            },
            { serverChecked: false },
        );
    }

    if (matches === null) {
        return Object.assign(
            {
                schema: AST_SCHEMA,
                mode,
                refused: true,
                error: {
                    code: "unparseable-output",
                    message:
                        "ast-grep returned output pal_ast could not read. This is a bug — report it with the pattern and lang.",
                },
            },
            { serverChecked: false },
        );
    }

    const result = {
        schema: AST_SCHEMA,
        mode: effectiveMode,
        serverChecked: false,
    };
    result.coverage = coverageBlock(candidates);

    if (mode === "search" && !wantsApply) {
        const capped = cap(matches, maxResults, "matches");
        result.matches = capped.items.map((m) => ({
            file: String(m.file || "")
                .split("/")
                .join("/"),
            line: m.range && m.range.start ? m.range.start.line + 1 : null,
            column: m.range && m.range.start ? m.range.start.column + 1 : null,
            text: truncateText(m.text, DEFAULT_MAX_MATCH_BYTES),
        }));
        result.truncated = capped.truncated;
        result.omitted = { matches: capped.omitted };
        return result;
    }

    // rewrite (dry-run) or apply — compute the change set from current disk.
    const changeSet = computeChangeSet(workspaceDir, matches);
    result.truncated = false;
    result.omitted = { matches: 0 };

    if (wantsApply) {
        // Containment before anything is written.
        const banned = changeSet.files.filter(
            (f) =>
                DENY_FILES.has(f.rel) ||
                !IN_SCOPE.includes(f.rel.split("/")[0]),
        );
        if (banned.length) {
            return Object.assign(
                {
                    schema: AST_SCHEMA,
                    mode: effectiveMode,
                    refused: true,
                    error: {
                        code: "unsafe-rewrite",
                        message:
                            "The rewrite touches files pal_ast is not allowed to write: " +
                            banned.map((f) => f.rel).join(", ") +
                            ". Nothing was written.",
                    },
                },
                { serverChecked: false },
            );
        }
        if (changeSet.files.length > maxFiles) {
            return Object.assign(
                {
                    schema: AST_SCHEMA,
                    mode: effectiveMode,
                    refused: true,
                    error: {
                        code: "max-files",
                        message:
                            "This rewrite would change " +
                            changeSet.files.length +
                            " files (maxFiles " +
                            maxFiles +
                            "). Narrow paths or raise maxFiles explicitly — nothing was written.",
                    },
                },
                { serverChecked: false },
            );
        }
        // Stateless preview-drift refusal: the apply's preview must equal the last dry-run for the
        // same inputs, recomputed from CURRENT disk. A tampered tree or a second apply on an
        // already-rewritten tree produces a different preview → refuse, never double-edit.
        const key = memoKey(args);
        const previewHash = hashPreview(changeSet.diffText || "<no changes>");
        if (previewMemo.has(key) && previewMemo.get(key) !== previewHash) {
            return Object.assign(
                {
                    schema: AST_SCHEMA,
                    mode: effectiveMode,
                    refused: true,
                    error: {
                        code: "preview-drift",
                        message:
                            'The on-disk preview no longer matches the last dry-run for these inputs (the workspace changed, or the rewrite was already applied). Re-run mode:"rewrite" and verify the new diff before applying.',
                    },
                },
                { serverChecked: false },
            );
        }
        if (changeSet.files.length === 0) {
            // Nothing to change — applying is a no-op this run (the pattern matched nothing now).
            result.applied = {
                filesChanged: 0,
                matchesApplied: 0,
                alreadyApplied: true,
                findings: [],
            };
            return result;
        }

        // Write file by file from the computed change set — the WRITE is the raw Buffer the splice
        // produced (byte-identical to the preview by construction, including untouched bytes outside
        // matched regions), then lint ONLY the written files. A failing write stops the apply and
        // reports exactly which files landed — a partial apply is never silent.
        const written = [];
        let writeError = null;
        for (const f of changeSet.files) {
            try {
                fs.writeFileSync(f.abs, f.newBuf);
            } catch (e) {
                writeError = {
                    file: f.rel,
                    message: String((e && e.message) || e),
                    filesWritten: written.map((w) => w.rel),
                };
                break;
            }
            written.push({
                rel: f.rel,
                oldBytes: f.oldBytes,
                newBytes: f.newBytes,
            });
        }
        const designSystemPresent = hasDesignSystem(workspaceDir);
        const findings = [];
        for (const rel of changeSet.files.map((f) => f.rel)) {
            let content = "";
            try {
                content = fs.readFileSync(path.join(workspaceDir, rel), "utf8");
            } catch (e) {
                continue;
            }
            const linted =
                lintContent(rel, content, { designSystemPresent }) || [];
            const cappedFindings = cap(linted, FINDINGS_CAP, "findings");
            findings.push(
                ...cappedFindings.items.map((item) => ({
                    severity: item.severity || "info",
                    rule: item.rule || "unknown",
                    file: item.file || rel,
                    line: item.line || null,
                    message: item.message,
                })),
            );
            if (cappedFindings.truncated)
                result.omitted.findings =
                    (result.omitted.findings || 0) + cappedFindings.omitted;
        }
        const errorsFirst = findings.sort(
            (a, b) =>
                (a.severity === "error" ? 0 : 1) -
                    (b.severity === "error" ? 0 : 1) ||
                String(a.file).localeCompare(String(b.file)),
        );
        result.applied = {
            filesChanged: written.length,
            matchesApplied: matches.length,
            writeError,
            findings: errorsFirst,
        };
        // Record the applied preview so a repeat of the SAME inputs now refuses (no double edit).
        // On a partial apply (write failure) the memo is NOT set — the next apply re-evaluates from
        // current disk instead of refusing on a stale preview.
        if (!writeError) previewMemo.set(key, previewHash);
        return result;
    }

    // Dry-run preview.
    const preview = cap(
        changeSet.files.map((f) => ({
            file: f.rel,
            oldBytes: f.oldBytes,
            newBytes: f.newBytes,
        })),
        maxFiles,
        "files",
    );
    result.preview = {
        files: preview.items,
        filesChanged: changeSet.files.length,
        matches: matches.length,
        diff: truncateText(changeSet.diffText, 8192),
        diffTruncated: Buffer.byteLength(changeSet.diffText, "utf8") > 8192,
        unchanged: changeSet.files.length === 0,
    };
    result.truncated = preview.truncated;
    result.omitted = { files: preview.omitted };
    if (
        changeSet.files.length &&
        changeSet.files.length <= maxFiles &&
        matches.length
    ) {
        // Successfully computed preview = the "last dry-run" the apply will compare against.
        previewMemo.set(memoKey(args), hashPreview(changeSet.diffText));
    }
    if (changeSet.files.length > maxFiles) {
        result.refused = true;
        result.error = {
            code: "max-files",
            message:
                "This rewrite would change " +
                changeSet.files.length +
                " files, exceeding maxFiles " +
                maxFiles +
                ". Narrow paths or raise maxFiles explicitly.",
        };
        result.preview.unchanged = false;
    }
    return result;
}

// Envelope projection: matches/changes/findings as location-addressed diagnostics (severity info),
// so the envelope bytes are metered like every other tool and the artifact keeps the full result.
// A refusal is NEVER silent in the envelope: its full guidance rides as a single error diagnostic, so
// the model sees (e.g.) all three recovery messages without opening the artifact.
function envelopeProjection(result, args) {
    if (result.refused && result.error) {
        return {
            ok: false,
            filesChecked: null,
            findings: [
                {
                    severity: "error",
                    rule: "astRefused",
                    file: null,
                    line: null,
                    message: result.error.message,
                },
            ],
        };
    }
    const diagnostics = [];
    if (Array.isArray(result.matches)) {
        for (const m of result.matches)
            diagnostics.push({
                severity: "info",
                rule: "astMatch",
                file: m.file,
                line: m.line,
                message: m.text,
            });
    } else if (result.preview) {
        for (const f of result.preview.files)
            diagnostics.push({
                severity: "info",
                rule: "astChange",
                file: f.file,
                line: null,
                message:
                    f.file +
                    " — " +
                    f.oldBytes +
                    " -> " +
                    f.newBytes +
                    " bytes",
            });
    } else if (result.applied) {
        for (const f of result.applied.findings || [])
            diagnostics.push({
                severity: f.severity === "error" ? "error" : "warn",
                rule: f.rule,
                file: f.file,
                line: f.line,
                message: f.message,
            });
    }
    return {
        ok: true,
        filesChecked: result.coverage ? result.coverage.searchedCount : null,
        findings: diagnostics,
    };
}

module.exports = {
    run,
    resolveAstGrep,
    validatePaths,
    collectCandidates,
    computeChangeSet,
    diffFor,
    validateInput,
    missingBinaryResult,
    _resetResolution,
    _setResolutionForTests,
    _setRunnerForTests,
    LANG_EXT,
    LANGS,
    DEFAULT_MAX_RESULTS,
    DEFAULT_MAX_FILES,
    IN_SCOPE_AS_DEFAULT: IN_SCOPE,
};
