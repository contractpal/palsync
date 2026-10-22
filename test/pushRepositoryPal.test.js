"use strict";
// A repository pal is pushed as precise per-file edits: a Repository-Payload header naming exactly
// the files to insert/update/delete, with only those files' bytes in the request. A save without it
// is accepted but updates no row (reproduced live), so there must be a baseline to diff against.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { push, repositoryPushRefusal } = require("../src/core/push");
const lock = require("../src/core/lock");
const { CloudPistonAPIManager } = require("../lib/apiManager");
const { tmpWorkspace } = require("./helpers");

const sha = b => crypto.createHash("sha256").update(b).digest("hex");

test("repositoryPushRefusal only refuses a repository pal that has no baseline", () => {
    const repo = { success: true, repositoryPal: true };
    const r = repositoryPushRefusal(repo, { palGuid: "G" });
    assert.equal(r.pushed, false);
    assert.equal(r.refused, "repository-no-baseline");
    assert.equal(repositoryPushRefusal(repo, { fileHashes: {} }), null);
    assert.equal(repositoryPushRefusal({ success: true, repositoryPal: false }, { palGuid: "G" }), null);
    assert.equal(repositoryPushRefusal(undefined, {}), null);
});

function palJson() {
    const ent = (name, key, extra) => ({ string: name, name, filename: name, [key]: Object.assign({ filename: name }, extra) });
    return {
        layout: { name: "Repo", category: "Repo" },
        pages: { entry: [ent("console.html", "Page", { contentType: "text/html", palType: "palTypeConsole" })] },
        attachments: { entry: [
            ent("edited.docx", "Attachment", { contentType: "application/msword" }),
            ent("untouched.docx", "Attachment", { contentType: "application/msword" })
        ] }
    };
}

// Runs a real push() against a workspace, with the lock and savePal stubbed; returns what savePal got.
async function pushRepo({ files, baselineFiles, serverPal }) {
    const dir = tmpWorkspace({ "pal.json": JSON.stringify(palJson()) });
    for (const [rel, buf] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), buf);
    }
    const record = { palGuid: "G", lastModifiedDate: "2026-01-01 00:00:00.0", fileHashes: {} };
    for (const [rel, buf] of Object.entries(baselineFiles)) record.fileHashes[rel] = sha(buf);
    record.fileHashes["pal.json"] = sha(fs.readFileSync(path.join(dir, "pal.json")));

    const origAcquire = lock.acquireByGuid;
    const origSave = CloudPistonAPIManager.savePal;
    let sent = null;
    lock.acquireByGuid = async () => ({ acquired: true, resolved: { id: "ID", lastModifiedDate: "2026-01-01 00:00:00.0" },
        getPalResp: { success: true, repositoryPal: true, pal: Object.assign({ lastModifiedDate: "2026-01-01 00:00:00.0" }, serverPal || {}) } });
    // answer "rejected" so push() stops before its post-save network refresh; we only inspect the request
    CloudPistonAPIManager.savePal = async (session, pal, id, opts) => { sent = { pal: JSON.parse(JSON.stringify(pal)), opts }; return { success: false }; };
    try {
        const res = await push({ lockInfo: {} }, record, dir, { skipValidation: true });
        return { res, sent };
    } finally {
        lock.acquireByGuid = origAcquire;
        CloudPistonAPIManager.savePal = origSave;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const items = header => {
    const xml = zlib.gunzipSync(Buffer.from(header, "base64")).toString("utf8");
    return [...xml.matchAll(/<RepositoryItem><type>(\w+)<\/type><name>([^<]+)<\/name><action>(\d)<\/action>/g)].map(m => m[3] + ":" + m[1] + ":" + m[2]);
};
const contentOf = (pal, folder, key, name) => [].concat(pal[folder].entry).find(x => x.string === name)[key].content;

test("push() sends ONLY the edited file's bytes plus a payload naming it", async () => {
    const stub = Buffer.alloc(0);
    const real = Buffer.from("the unedited fetched content");
    const edited = Buffer.from("the NEW content");
    const { sent, res } = await pushRepo({
        files: { "pages/console.html": stub, "attachments/edited.docx": edited, "attachments/untouched.docx": real },
        baselineFiles: { "pages/console.html": stub, "attachments/edited.docx": Buffer.from("old content"), "attachments/untouched.docx": real }
    });
    assert.ok(sent, "savePal was called");
    assert.deepEqual(items(sent.opts.repositoryPayload), ["2:attachment:edited.docx"]);
    assert.equal(contentOf(sent.pal, "attachments", "Attachment", "edited.docx"), edited.toString("base64"));
    assert.equal(contentOf(sent.pal, "attachments", "Attachment", "untouched.docx"), undefined, "unchanged bytes are not sent");
    assert.equal(contentOf(sent.pal, "pages", "Page", "console.html"), undefined, "an empty stub is not sent either");
    assert.equal(res.filesPushed, 1);
    assert.equal(res.repositoryItems, 1);
});

test("push() with a lost baseline sends UPDATE (not INSERT) for files the server already lists", async () => {
    const stub = Buffer.alloc(0);
    const body = Buffer.from("real content");
    // the baseline knows nothing about the attachments, so both look "added" — but the server lists one of them
    const { sent } = await pushRepo({
        files: { "pages/console.html": stub, "attachments/edited.docx": body, "attachments/untouched.docx": stub },
        baselineFiles: { "pages/console.html": stub },
        serverPal: { attachments: { entry: [{ string: "edited.docx", Attachment: { filename: "edited.docx" } }] } }
    });
    assert.deepEqual(items(sent.opts.repositoryPayload).sort(), ["1:attachment:untouched.docx", "2:attachment:edited.docx"]);
});

test("push() with nothing edited still sends an (empty) payload and no file bytes", async () => {
    const stub = Buffer.alloc(0);
    const { sent } = await pushRepo({
        files: { "pages/console.html": stub, "attachments/edited.docx": stub, "attachments/untouched.docx": stub },
        baselineFiles: { "pages/console.html": stub, "attachments/edited.docx": stub, "attachments/untouched.docx": stub }
    });
    assert.deepEqual(items(sent.opts.repositoryPayload), []);
    assert.ok(sent.opts.repositoryPayload, "a payload header must always accompany a repository save");
});

test("push() turns a baseline file that is gone and unlisted into a DELETE", async () => {
    const stub = Buffer.alloc(0);
    const { sent } = await pushRepo({
        files: { "pages/console.html": stub, "attachments/untouched.docx": stub, "attachments/edited.docx": stub },
        baselineFiles: { "pages/console.html": stub, "attachments/untouched.docx": stub, "attachments/edited.docx": stub,
                         "images/gone.png": Buffer.from("old") }
    });
    // images/gone.png was in the baseline, is not on disk, and pal.json lists no images -> a real delete
    assert.deepEqual(items(sent.opts.repositoryPayload), ["3:image:gone.png"]);
});

test("push() never deletes a row for a file that is merely missing locally while still listed", async () => {
    const stub = Buffer.alloc(0);
    const { sent } = await pushRepo({
        files: { "pages/console.html": stub, "attachments/untouched.docx": stub },        // edited.docx not downloaded
        baselineFiles: { "pages/console.html": stub, "attachments/untouched.docx": stub, "attachments/edited.docx": stub }
    });
    assert.deepEqual(items(sent.opts.repositoryPayload), []);
});

test("push() on a repository pal without a baseline is refused and never calls savePal", async () => {
    const origAcquire = lock.acquireByGuid;
    const origSave = CloudPistonAPIManager.savePal;
    let saved = false;
    lock.acquireByGuid = async () => ({ acquired: true, resolved: { id: "ID" }, getPalResp: { success: true, repositoryPal: true } });
    CloudPistonAPIManager.savePal = async () => { saved = true; return { success: true }; };
    const dir = tmpWorkspace({});
    try {
        const res = await push({ lockInfo: {} }, { palGuid: "G", lastModifiedDate: "x" }, dir, { skipValidation: true });
        assert.equal(res.refused, "repository-no-baseline");
        assert.equal(saved, false);
    } finally {
        lock.acquireByGuid = origAcquire;
        CloudPistonAPIManager.savePal = origSave;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
