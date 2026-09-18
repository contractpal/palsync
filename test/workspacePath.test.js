"use strict";
// Workspace path handling: whatever the user types becomes ONE exact absolute directory, and a
// remembered directory is only reused when .palsync.json still says it belongs to this pal on
// this cloud (src/launcher/workspacePath.js). path.win32/path.posix are injected so the Windows
// rules are covered from any platform.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    normalizeWorkspaceDir, inspectWorkspace, describeRefusal, sameCloud, shortenHome
} = require("../src/launcher/workspacePath");
const { defaultWorkspaceDir } = require("../src/launcher/workspace");

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-path-test-"));
}

test("the default workspace directory is unchanged", () => {
    assert.equal(
        defaultWorkspaceDir("Audithelm-V1"),
        path.join(os.homedir(), "PalBuilder", "Audithelm-V1")
    );
    assert.equal(defaultWorkspaceDir("Audithelm V1", "feature-x"),
        path.join(os.homedir(), "PalBuilder", "Audithelm-V1 (feature-x)"));
    assert.equal(defaultWorkspaceDir("Audithelm-V1", "", "/mnt/pals"), path.join("/mnt/pals", "Audithelm-V1"));
});

test("absolute, relative, ~, quoted, and spaced paths normalize to one exact directory", () => {
    const opts = { homedir: "/home/dev", cwd: "/work/repo" };
    assert.equal(normalizeWorkspaceDir("/home/dev/projects/Audithelm-V1", opts), "/home/dev/projects/Audithelm-V1");
    assert.equal(normalizeWorkspaceDir("projects/Audithelm-V1", opts), "/work/repo/projects/Audithelm-V1");
    assert.equal(normalizeWorkspaceDir("./pals/Audithelm-V1", opts), "/work/repo/pals/Audithelm-V1");
    assert.equal(normalizeWorkspaceDir("~/projects/Audithelm-V1", opts), "/home/dev/projects/Audithelm-V1");
    assert.equal(normalizeWorkspaceDir("~", opts), "/home/dev");
    // paths with spaces are never split or escaped — no shell is involved
    assert.equal(normalizeWorkspaceDir("/mnt/My Projects/Audithelm V1", opts), "/mnt/My Projects/Audithelm V1");
    // pasted values often carry quotes, and often trailing whitespace
    assert.equal(normalizeWorkspaceDir('  "/mnt/My Projects/Audithelm V1"  ', opts), "/mnt/My Projects/Audithelm V1");
    assert.equal(normalizeWorkspaceDir("'/mnt/My Projects/Audithelm V1'", opts), "/mnt/My Projects/Audithelm V1");
    // .. is resolved, not passed through literally
    assert.equal(normalizeWorkspaceDir("/home/dev/projects/../pals/X", opts), "/home/dev/pals/X");
    // nothing usable
    assert.equal(normalizeWorkspaceDir("", opts), null);
    assert.equal(normalizeWorkspaceDir("   ", opts), null);
    assert.equal(normalizeWorkspaceDir(undefined, opts), null);
    assert.equal(normalizeWorkspaceDir(42, opts), null);
    // ~user is NOT expanded (only ~ and ~/) — it must not silently point somewhere unexpected
    assert.equal(normalizeWorkspaceDir("~nobody/pals", opts), "/work/repo/~nobody/pals");
});

test("Windows paths and Windows ~ expansion work", () => {
    const win = { path: path.win32, homedir: "C:\\Users\\dev", cwd: "C:\\work" };
    assert.equal(normalizeWorkspaceDir("C:\\Projects\\Audithelm-V1", win), "C:\\Projects\\Audithelm-V1");
    assert.equal(normalizeWorkspaceDir("C:/Projects/My Pal", win), "C:\\Projects\\My Pal");
    assert.equal(normalizeWorkspaceDir("My Pals\\Audithelm-V1", win), "C:\\work\\My Pals\\Audithelm-V1");
    assert.equal(normalizeWorkspaceDir("~\\projects\\Audithelm-V1", win), "C:\\Users\\dev\\projects\\Audithelm-V1");
    assert.equal(normalizeWorkspaceDir("~/projects/Audithelm V1", win), "C:\\Users\\dev\\projects\\Audithelm V1");
});

test("sameCloud tolerates formatting but not a different deployment", () => {
    assert.equal(sameCloud("https://secure.cloudpiston.com", "https://secure.cloudpiston.com/"), true);
    assert.equal(sameCloud("HTTPS://Secure.CloudPiston.com", "https://secure.cloudpiston.com"), true);
    assert.equal(sameCloud("https://secure.cloudpiston.com", "https://secure.nimblewire.net"), false);
    assert.equal(sameCloud(null, "https://x"), true);   // missing data is never a refusal
});

test("shortenHome renders the home directory as ~", () => {
    assert.equal(shortenHome("/home/dev/projects/Audithelm-V1", "/home/dev"), "~/projects/Audithelm-V1");
    assert.equal(shortenHome("/home/dev", "/home/dev"), "~");
    assert.equal(shortenHome("/mnt/projects/X", "/home/dev"), "/mnt/projects/X");
    assert.equal(shortenHome("", "/home/dev"), "");
});

test("a missing directory, a file, and an empty directory", () => {
    const base = tmpDir();
    const missing = path.join(base, "nope");
    assert.equal(inspectWorkspace(missing, { palGuid: "G" }).reason, "missing");

    const file = path.join(base, "afile.txt");
    fs.writeFileSync(file, "hello");
    assert.equal(inspectWorkspace(file, { palGuid: "G" }).reason, "not-a-directory");

    const empty = path.join(base, "empty");
    fs.mkdirSync(empty);
    const check = inspectWorkspace(empty, { palGuid: "G", cloudUrl: "https://c" });
    assert.equal(check.ok, true);
    assert.equal(check.existing, false);

    assert.equal(inspectWorkspace(undefined, { palGuid: "G" }).reason, "missing");
    fs.rmSync(base, { recursive: true, force: true });
});

test("this pal's own workspace passes, and a moved-marker misread does not", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
        version: 1, cloudUrl: "https://secure.cloudpiston.com/", username: "dev@example.com",
        palGuid: "GUID-1", palName: "Audithelm-V1", workspaceDir: dir
    }));
    const ok = inspectWorkspace(dir, { palGuid: "GUID-1", cloudUrl: "https://secure.cloudpiston.com", username: "dev@example.com" });
    assert.equal(ok.ok, true);
    assert.equal(ok.existing, true);
    assert.equal(ok.sameAccount, true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("a different pal's workspace is refused, and its contents are left alone", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
        cloudUrl: "https://secure.cloudpiston.com", palGuid: "OTHER-GUID", palName: "MacroWeek"
    }));
    fs.writeFileSync(path.join(dir, "pal.json"), "{}");
    const check = inspectWorkspace(dir, { palGuid: "GUID-1", cloudUrl: "https://secure.cloudpiston.com" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "other-pal");
    assert.match(describeRefusal(check, { palName: "Audithelm-V1", dir }), /belongs to a different pal: "MacroWeek"/);
    assert.equal(fs.readFileSync(path.join(dir, "pal.json"), "utf8"), "{}");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("a workspace created on another cloud is refused", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
        cloudUrl: "https://secure.nimblewire.net", palGuid: "GUID-1", palName: "Audithelm-V1"
    }));
    const check = inspectWorkspace(dir, { palGuid: "GUID-1", cloudUrl: "https://secure.cloudpiston.com" });
    assert.equal(check.reason, "other-cloud");
    assert.match(describeRefusal(check, { palName: "Audithelm-V1", dir }), /nimblewire\.net/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("a non-empty directory with no PalSync identity is never adopted", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "some-other-project"));
    fs.writeFileSync(path.join(dir, "README.md"), "# not a pal\n");
    const check = inspectWorkspace(dir, { palGuid: "GUID-1" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "unrecognized-nonempty");
    assert.match(describeRefusal(check, { palName: "Audithelm-V1", dir }), /will not adopt or overwrite/);
    // the guard is read-only — nothing was removed
    assert.deepEqual(fs.readdirSync(dir).sort(), ["README.md", "some-other-project"]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("a broken .palsync.json counts as unrecognized, never as an empty folder to fill", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".palsync.json"), "{ this is not json");
    const check = inspectWorkspace(dir, { palGuid: "GUID-1" });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "unrecognized-nonempty");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("the same pal reached from a second account on the same cloud is allowed", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({
        cloudUrl: "https://secure.cloudpiston.com", username: "teammate@example.com",
        palGuid: "GUID-1", palName: "Shared Pal"
    }));
    const check = inspectWorkspace(dir, { palGuid: "GUID-1", cloudUrl: "https://secure.cloudpiston.com", username: "dev@example.com" });
    assert.equal(check.ok, true);
    assert.equal(check.sameAccount, false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("a forgotten folder explains itself without inventing a path", () => {
    const message = describeRefusal({ reason: "missing" }, { palName: "Audithelm-V1", dir: "/gone/Audithelm-V1" });
    assert.match(message, /is gone/);
    assert.match(message, /will not create a replacement/);
    assert.match(describeRefusal({ reason: "missing" }, { palName: "Audithelm-V1", dir: null }, ), /No workspace folder is remembered/);
});
