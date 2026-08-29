"use strict";
// Ticket 04 — transient artifact exclusion via centralized workspace ignore management.
// Uses REAL temporary Git repositories (git init in a tmpdir) as the seam the spec requires.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const child_process = require("node:child_process");

const workspaceIgnore = require("../src/core/workspaceIgnore");
const { tmpWorkspace } = require("./helpers");

function git(cwd, args) {
    const res = child_process.spawnSync("git", args, { cwd, encoding: "utf8" });
    if (res.error) throw res.error;
    return res;
}

function gitAvailable() {
    const res = child_process.spawnSync("git", ["--version"], { encoding: "utf8" });
    return res.status === 0;
}

function lsFiles(cwd) {
    const res = git(cwd, ["ls-files", "--cached"]);
    if (res.status !== 0) return [];
    return res.stdout.split("\n").filter(Boolean).sort();
}

function checkIgnore(cwd, file) {
    // git check-ignore returns 0 if ignored, 1 if not, 128 if not in repo
    const res = child_process.spawnSync("git", ["check-ignore", file], { cwd, encoding: "utf8" });
    return res.status === 0;
}

function initRepo(dir) {
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@palsync.local"]);
    git(dir, ["config", "user.name", "palsync-test"]);
}

// ---------------------------------------------------------------------------
// idempotent merge with pre-existing user rules
// ---------------------------------------------------------------------------

test("workspaceIgnore: idempotent merge preserves user rules and adds all transient patterns", () => {
    const dir = tmpWorkspace({
        ".gitignore": "node_modules/\n*.log\n# keep this comment\n"
    });
    try {
        const first = workspaceIgnore.ensureGitignoreSync(dir);
        assert.equal(first.updated, true);
        const text1 = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
        // user rules still present
        assert.match(text1, /node_modules\//);
        assert.match(text1, /\*\.log/);
        assert.match(text1, /keep this comment/);
        // every transient pattern present
        for (const p of workspaceIgnore.TRANSIENT_IGNORE_PATTERNS) {
            assert.ok(text1.includes(p), "missing pattern " + p);
        }
        // idempotent second call — no duplication, no churn
        const before = text1;
        const second = workspaceIgnore.ensureGitignoreSync(dir);
        assert.equal(second.updated, false);
        const text2 = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
        assert.equal(text2, before);
        // no duplicate entries
        for (const p of workspaceIgnore.TRANSIENT_IGNORE_PATTERNS) {
            const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const count = (text2.match(new RegExp(escaped, "g")) || []).length;
            assert.equal(count, 1, "duplicate pattern " + p);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("workspaceIgnore: existing .agent-work-history entry does not duplicate", () => {
    const dir = tmpWorkspace({
        ".gitignore": ".agent-work-history/\nmy-custom-rule\n"
    });
    try {
        const res = workspaceIgnore.ensureGitignoreSync(dir);
        assert.equal(res.updated, true);
        const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
        // .agent-work-history/ should appear exactly once (already present)
        const count = (text.match(/\.agent-work-history\//g) || []).length;
        assert.equal(count, 1);
        assert.ok(text.includes("my-custom-rule"));
        // Every pattern is covered — a pre-existing unanchored spelling counts, so the anchored
        // form is not re-added on top of it.
        for (const p of workspaceIgnore.TRANSIENT_IGNORE_PATTERNS) {
            assert.ok(text.includes(p) || text.includes(p.replace(/^\//, "")), p);
        }
        // second call idempotent
        const second = workspaceIgnore.ensureGitignoreSync(dir);
        assert.equal(second.updated, false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// fresh workspace staging run proving transient artifacts do not enter commit
// ---------------------------------------------------------------------------

test("workspaceIgnore: git add -A excludes transient set while keeping source", () => {
    if (!gitAvailable()) {
        // spec requires warning path, but staging test needs Git — skip honestly
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-fresh-"));
    try {
        initRepo(dir);
        // Ensure ignore contract applied
        workspaceIgnore.ensureWorkspaceIgnoreSync(dir);

        // Create transient artifacts on disk
        fs.mkdirSync(path.join(dir, ".agent-work-history", "run-1"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".agent-work-history", "run-1", "metadata.json"), "{}\n");
        fs.mkdirSync(path.join(dir, ".palsync", "cache", "lint"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".palsync", "cache", "lint", "abc.json"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync.usage.json"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync", "session-cost.json"), "{}\n");
        fs.mkdirSync(path.join(dir, ".palsync", "session-cost.lock"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".palsync", "pi-usage.jsonl"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync", "tool-evidence.jsonl"), "{}\n");
        // Source and lifecycle files that MUST remain trackable
        fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
        fs.writeFileSync(path.join(dir, "pages", "index.html"), "<html></html>\n");
        fs.writeFileSync(path.join(dir, "pal.json"), "{}\n");
        fs.writeFileSync(path.join(dir, "EXECUTION.md"), "# exec\n");
        fs.writeFileSync(path.join(dir, "REVIEW.md"), "# review\n");
        fs.mkdirSync(path.join(dir, ".palsync", "baseline"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".palsync", "baseline", "snap.json"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync", "context-manifest.json"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync", "context-manifest.prev.json"), "{}\n");

        git(dir, ["add", "-A"]);
        const tracked = lsFiles(dir);

        // Transient set must be absent
        assert.ok(!tracked.some(f => f.startsWith(".agent-work-history/")), "agent-work-history should be ignored");
        assert.ok(!tracked.some(f => f.startsWith(".palsync/cache/")), "cache should be ignored");
        assert.ok(!tracked.includes(".palsync.usage.json"), ".palsync.usage.json should be ignored");
        assert.ok(!tracked.includes(".palsync/session-cost.json"), "session-cost.json should be ignored");
        assert.ok(!tracked.some(f => f.startsWith(".palsync/session-cost.lock")), "session-cost.lock should be ignored");
        assert.ok(!tracked.includes(".palsync/pi-usage.jsonl"), "pi-usage should be ignored");
        assert.ok(!tracked.includes(".palsync/tool-evidence.jsonl"), "tool-evidence should be ignored");

        // Source/lifecycle must be present
        assert.ok(tracked.includes("pages/index.html"));
        assert.ok(tracked.includes("pal.json"));
        assert.ok(tracked.includes("EXECUTION.md"));
        assert.ok(tracked.includes("REVIEW.md"));
        assert.ok(tracked.includes(".palsync/baseline/snap.json"));
        assert.ok(tracked.includes(".palsync/context-manifest.json"));
        assert.ok(tracked.includes(".palsync/context-manifest.prev.json"));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// tracked-file migration leaving content on disk and unrelated staged files untouched
// ---------------------------------------------------------------------------

test("workspaceIgnore: migration removes already-tracked transients from index only, disk preserved, unrelated staged untouched", () => {
    if (!gitAvailable()) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-migrate-"));
    try {
        initRepo(dir);

        // Create transient files and force-track them (simulating an existing workspace that
        // committed them before the ignore existed).
        fs.mkdirSync(path.join(dir, ".agent-work-history", "old"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".agent-work-history", "old", "notes.md"), "old\n");
        fs.mkdirSync(path.join(dir, ".palsync", "cache"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".palsync", "cache", "lint-stats.json"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync.usage.json"), "{\"totalCalls\":1}\n");
        fs.writeFileSync(path.join(dir, ".palsync", "tool-evidence.jsonl"), "{\"schema\":\"palsync/tool-evidence/1\"}\n");
        git(dir, ["add", "-f", ".agent-work-history/old/notes.md", ".palsync/cache/lint-stats.json", ".palsync.usage.json", ".palsync/tool-evidence.jsonl"]);
        git(dir, ["commit", "-m", "initial with transients", "-q"]);

        // Create unrelated staged work that must NOT be touched
        fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
        fs.writeFileSync(path.join(dir, "pages", "new.html"), "<p>new</p>\n");
        git(dir, ["add", "pages/new.html"]);

        // Create additional transient content on disk that is currently tracked
        // Ensure .gitignore and run migration
        const res = workspaceIgnore.ensureWorkspaceIgnoreSync(dir);
        // .gitignore should have been created
        assert.ok(fs.existsSync(path.join(dir, ".gitignore")));

        // Index should no longer contain transient paths
        const tracked = lsFiles(dir);
        assert.ok(!tracked.some(f => f.startsWith(".agent-work-history/")), "work-history should be untracked");
        assert.ok(!tracked.some(f => f.startsWith(".palsync/cache")), "cache should be untracked");
        assert.ok(!tracked.includes(".palsync.usage.json"), "usage should be untracked");
        assert.ok(!tracked.includes(".palsync/tool-evidence.jsonl"), "tool-evidence should be untracked");

        // Disk content still exists
        assert.ok(fs.existsSync(path.join(dir, ".agent-work-history", "old", "notes.md")));
        assert.ok(fs.existsSync(path.join(dir, ".palsync", "cache", "lint-stats.json")));
        assert.ok(fs.existsSync(path.join(dir, ".palsync.usage.json")));
        assert.ok(fs.existsSync(path.join(dir, ".palsync", "tool-evidence.jsonl")));

        // Unrelated staged file still staged (cached diff)
        const cached = git(dir, ["diff", "--cached", "--name-only"]);
        assert.ok(cached.stdout.includes("pages/new.html"), "unrelated staged file must remain staged");
        // Git status for transient files should show them as deleted in index but not deleted on disk
        // i.e. git status should NOT show them as untracked? They are ignored now, so `git status`
        // should not list them as untracked (they are ignored).
        const status = git(dir, ["status", "--porcelain"]);
        // Ignored files do not appear in status; staged transient deletions appear as "D "
        // but --ignore-unmatch + rm --cached leaves them as unstaged deletions? Actually
        // git rm --cached leaves them as untracked but ignored, so status shows nothing for them.
        // We just assert the unrelated file is still staged and no transient file appears as staged.
        assert.ok(!lsFiles(dir).includes(".palsync.usage.json"));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// retained baseline/context/EXECUTION/review files
// ---------------------------------------------------------------------------

test("workspaceIgnore: baseline, context manifests, EXECUTION.md, REVIEW.md remain trackable", () => {
    if (!gitAvailable()) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-retain-"));
    try {
        initRepo(dir);
        workspaceIgnore.ensureWorkspaceIgnoreSync(dir);

        fs.mkdirSync(path.join(dir, ".palsync", "baseline"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".palsync", "baseline", "pages_index.html"), "baseline\n");
        fs.writeFileSync(path.join(dir, ".palsync", "context-manifest.json"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync", "context-manifest.prev.json"), "{}\n");
        fs.writeFileSync(path.join(dir, "EXECUTION.md"), "# exec\n");
        fs.writeFileSync(path.join(dir, "REVIEW.md"), "# review\n");
        fs.writeFileSync(path.join(dir, ".palsync", "tool-evidence.jsonl"), "{}\n");
        fs.writeFileSync(path.join(dir, ".palsync.usage.json"), "{}\n");

        // Verify git check-ignore does NOT mark retained files as ignored,
        // but DOES mark transient files as ignored.
        assert.equal(checkIgnore(dir, ".palsync/baseline/pages_index.html"), false);
        assert.equal(checkIgnore(dir, ".palsync/context-manifest.json"), false);
        assert.equal(checkIgnore(dir, ".palsync/context-manifest.prev.json"), false);
        assert.equal(checkIgnore(dir, "EXECUTION.md"), false);
        assert.equal(checkIgnore(dir, "REVIEW.md"), false);
        assert.equal(checkIgnore(dir, ".palsync/tool-evidence.jsonl"), true);
        assert.equal(checkIgnore(dir, ".palsync.usage.json"), true);

        // git add should include retained, exclude transient
        git(dir, ["add", "-A"]);
        const tracked = lsFiles(dir);
        assert.ok(tracked.includes(".palsync/baseline/pages_index.html"));
        assert.ok(tracked.includes(".palsync/context-manifest.json"));
        assert.ok(tracked.includes(".palsync/context-manifest.prev.json"));
        assert.ok(tracked.includes("EXECUTION.md"));
        assert.ok(tracked.includes("REVIEW.md"));
        assert.ok(!tracked.includes(".palsync/tool-evidence.jsonl"));
        assert.ok(!tracked.includes(".palsync.usage.json"));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("workspaceIgnore: whole .palsync directory is NOT ignored", () => {
    if (!gitAvailable()) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-whole-"));
    try {
        initRepo(dir);
        workspaceIgnore.ensureWorkspaceIgnoreSync(dir);
        const gitignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
        // Must not contain a bare ".palsync/" or ".palsync" line that would ignore everything
        const lines = gitignore.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(l => !l.startsWith("#"));
        assert.ok(!lines.includes(".palsync/"), "must not ignore whole .palsync/");
        assert.ok(!lines.includes(".palsync"), "must not ignore whole .palsync");
        assert.ok(!lines.includes("/.palsync/"), "must not ignore whole /.palsync/");
        assert.ok(!lines.includes("/.palsync"), "must not ignore whole /.palsync");
        // But specific transient subpaths ARE ignored (root-anchored)
        assert.ok(lines.includes("/.palsync/cache/") || lines.includes(".palsync/cache/"));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// non-Git fallback warning path
// ---------------------------------------------------------------------------

test("workspaceIgnore: non-Git workspace emits warning and does not throw", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-nogit-"));
    try {
        const warnings = [];
        const origWarn = console.warn;
        console.warn = function (msg) { warnings.push(String(msg)); };
        try {
            const res = workspaceIgnore.ensureWorkspaceIgnoreSync(dir);
            // .gitignore should still be created
            assert.ok(fs.existsSync(path.join(dir, ".gitignore")));
            // should have emitted a warning about not being a Git workspace
            assert.ok(warnings.some(m => /not a Git workspace|Git not available/i.test(m)), "expected non-Git warning, got: " + warnings.join("; "));
            // should not throw and warning is returned
            assert.ok(res.warning);
        } finally {
            console.warn = origWarn;
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("workspaceIgnore: nested same-named transient file stays trackable (root anchoring)", () => {
    if (!gitAvailable()) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-nested-"));
    try {
        initRepo(dir);
        workspaceIgnore.ensureWorkspaceIgnoreSync(dir);
        // Nested copy of a transient name must NOT be ignored — patterns are root-anchored with leading /
        fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
        fs.writeFileSync(path.join(dir, "sub", ".palsync.usage.json"), "{}\n");
        fs.mkdirSync(path.join(dir, "sub", ".agent-work-history"), { recursive: true });
        fs.writeFileSync(path.join(dir, "sub", ".agent-work-history", "notes.md"), "hi\n");
        assert.equal(checkIgnore(dir, "sub/.palsync.usage.json"), false, "nested .palsync.usage.json must stay trackable");
        assert.equal(checkIgnore(dir, "sub/.agent-work-history/notes.md"), false, "nested .agent-work-history must stay trackable");
        // Root still ignored
        fs.writeFileSync(path.join(dir, ".palsync.usage.json"), "{}\n");
        fs.mkdirSync(path.join(dir, ".agent-work-history"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".agent-work-history", "root.md"), "hi\n");
        assert.equal(checkIgnore(dir, ".palsync.usage.json"), true, "root .palsync.usage.json must be ignored");
        assert.equal(checkIgnore(dir, ".agent-work-history/root.md"), true, "root .agent-work-history must be ignored");
        // Idempotency: existing unanchored spelling must be treated as equivalent (no duplicate)
        const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-compat-"));
        try {
            fs.writeFileSync(path.join(dir2, ".gitignore"), ".agent-work-history/\n.palsync.usage.json\n");
            workspaceIgnore.ensureGitignoreSync(dir2);
            // Should have added missing anchored patterns, but not duplicate unanchored ones
            const text2 = fs.readFileSync(path.join(dir2, ".gitignore"), "utf8");
            const countUnanchored = (text2.match(/\.agent-work-history\//g) || []).length;
            assert.equal(countUnanchored, 1, "must not duplicate existing unanchored entry");
            // Second call fully idempotent
            assert.equal(workspaceIgnore.ensureGitignoreSync(dir2).updated, false);
        } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("workspaceIgnore: migrate handles missing Git gracefully", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-ignore-nogit2-"));
    try {
        // ensureGitignore alone should not warn (just file management)
        const res = workspaceIgnore.ensureGitignoreSync(dir);
        assert.equal(res.updated, true);
        assert.ok(fs.existsSync(path.join(dir, ".gitignore")));
        // migrate should warn but not throw
        const warnings = [];
        const origWarn = console.warn;
        console.warn = function (msg) { warnings.push(String(msg)); };
        try {
            const mig = workspaceIgnore.migrateTrackedTransientsSync(dir);
            assert.equal(mig.migrated, false);
            assert.ok(warnings.length > 0);
        } finally {
            console.warn = origWarn;
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
