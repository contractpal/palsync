"use strict";
// fetchRepoFiles: developer-gated, one-at-a-time download of a repository pal's files. GetPal and
// CheckOut.do are stubbed; response shapes follow what was verified live on secure.cloudpiston.com.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { CloudPistonAPIManager } = require("../lib/apiManager");
const { fetchRepoFiles, limitsFor } = require("../src/core/repoFetch");
const { tmpWorkspace } = require("./helpers");

const sha = b => crypto.createHash("sha256").update(b).digest("hex");

function listingPal() {
    const ent = (string, key, extra) => ({ string, [key]: Object.assign({ filename: string, contentType: "text/html" }, extra) });
    return {
        success: true, repositoryPal: true,
        pal: {
            layout: { name: "Repo" },
            pages: { entry: [ent("console.html", "Page")] },
            fragments: { entry: [ent("a/b.html", "Fragment")] },
            attachments: { entry: [ent("form.docx", "Attachment", { contentType: "application/msword" }), ent("big.docx", "Attachment")] },
            images: { entry: [ent("logo.png", "Image", { contentType: "image/png" })] }
        }
    };
}

// contents: name -> Buffer. Records every network call.
async function withStubs(contents, fn, { listing = listingPal() } = {}) {
    const dir = tmpWorkspace({});
    const calls = { getPal: 0, checkOut: [] };
    const origGet = CloudPistonAPIManager.getPal;
    const origCheck = CloudPistonAPIManager.checkOutFile;
    CloudPistonAPIManager.getPal = async () => { calls.getPal++; return listing; };
    CloudPistonAPIManager.checkOutFile = async (s, id, type, file) => {
        calls.checkOut.push(type + ":" + file);
        const buf = contents[file];
        return buf ? { success: true, palFile: { content: buf.toString("base64") } } : { success: true, palFile: { content: "" } };
    };
    const record = { palGuid: "G", fileHashes: {} };
    try { await fn({ dir, calls, record, resolved: { id: "ID" } }); }
    finally {
        CloudPistonAPIManager.getPal = origGet;
        CloudPistonAPIManager.checkOutFile = origCheck;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const f = (type, file) => ({ type, file });

test("one file needs no approval: written to its folder and its baseline entry updated", async () => {
    await withStubs({ "console.html": Buffer.from("<html>hi</html>") }, async ({ dir, calls, record, resolved }) => {
        const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "console.html")] });
        assert.equal(r.ok, true);
        assert.equal(r.fetched, 1);
        assert.deepEqual(calls.checkOut, ["page:console.html"]);
        const p = path.join(dir, "pages", "console.html");
        assert.equal(fs.readFileSync(p, "utf8"), "<html>hi</html>");
        const h = sha(fs.readFileSync(p));
        assert.equal(record.fileHashes["pages/console.html"], h, "baseline now includes the fetched file");
        assert.equal(fs.readFileSync(path.join(dir, ".palsync", "baseline", "pages", "console.html"), "utf8"), "<html>hi</html>");
        assert.ok(record.localHash, "legacy combined hash refreshed");
    });
});

test("binary content survives byte-for-byte and is not put in the text baseline store", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x00, 0x01]);
    await withStubs({ "form.docx": bytes }, async ({ dir, record, resolved }) => {
        const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("attachment", "form.docx")] });
        assert.equal(r.fetched, 1);
        assert.ok(fs.readFileSync(path.join(dir, "attachments", "form.docx")).equals(bytes));
        assert.equal(fs.existsSync(path.join(dir, ".palsync", "baseline", "attachments", "form.docx")), false);
    });
});

test("subfolder names and folder-style / mixed-case type names work", async () => {
    await withStubs({ "a/b.html": Buffer.from("x") }, async ({ dir, calls, record, resolved }) => {
        const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("Fragments", "a/b.html")] });
        assert.equal(r.fetched, 1);
        assert.deepEqual(calls.checkOut, ["fragment:a/b.html"], "CheckOut.do needs the singular type");
        assert.equal(fs.readFileSync(path.join(dir, "fragments", "a", "b.html"), "utf8"), "x");
    });
});

test("more than one file is refused without askedUser, before any network call", async () => {
    await withStubs({}, async ({ dir, calls, record, resolved }) => {
        const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("attachment", "form.docx"), f("image", "logo.png")] });
        assert.equal(r.ok, false);
        assert.equal(r.refused, "interview-needed");
        assert.match(r.reason, /developer decides/);
        assert.equal(calls.getPal, 0);
        assert.equal(calls.checkOut.length, 0);
    });
});

test("duplicate requests collapse, so a repeated single file is still one file", async () => {
    await withStubs({ "console.html": Buffer.from("x") }, async ({ dir, calls, record, resolved }) => {
        const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "console.html"), f("pages", "console.html")] });
        assert.equal(r.ok, true);
        assert.equal(calls.checkOut.length, 1);
    });
});

test("askedUser unlocks a batch, still capped by repoFetch.maxFilesPerCall", async () => {
    await withStubs({ "form.docx": Buffer.from("a"), "logo.png": Buffer.from("b") }, async ({ dir, calls, record, resolved }) => {
        const batch = [f("attachment", "form.docx"), f("image", "logo.png")];
        const ok = await fetchRepoFiles({}, resolved, dir, record, { files: batch, askedUser: true });
        assert.equal(ok.fetched, 2);
        record.repoFetch = { maxFilesPerCall: 1 };
        fs.rmSync(path.join(dir, "attachments"), { recursive: true, force: true });
        fs.rmSync(path.join(dir, "images"), { recursive: true, force: true });
        const capped = await fetchRepoFiles({}, resolved, dir, record, { files: batch, askedUser: true });
        assert.equal(capped.refused, "over-cap");
        assert.match(capped.reason, /maxFilesPerCall/);
        assert.equal(calls.checkOut.length, 2, "the capped call made no downloads");
    });
});

test("the byte budget stops a batch as bytes arrive and reports the rest as not fetched", async () => {
    await withStubs({ "form.docx": Buffer.alloc(600), "big.docx": Buffer.alloc(600), "logo.png": Buffer.alloc(10) }, async ({ dir, calls, record, resolved }) => {
        record.repoFetch = { maxBytesPerCall: 1000 };
        const r = await fetchRepoFiles({}, resolved, dir, record, {
            files: [f("attachment", "form.docx"), f("attachment", "big.docx"), f("image", "logo.png")], askedUser: true
        });
        // 600 < 1000 so big.docx is fetched (budget is checked before each file); 1200 >= 1000 stops logo.png
        assert.deepEqual(r.results.map(x => x.status), ["fetched", "fetched", "budget"]);
        assert.equal(r.bytes, 1200);
        assert.equal(calls.checkOut.length, 2);
        assert.equal(r.notFetched, 1);
    });
});

test("pauseMs paces downloads: a pause between files, none before the first", async () => {
    await withStubs({ "form.docx": Buffer.from("a"), "logo.png": Buffer.from("b") }, async ({ dir, record, resolved }) => {
        record.repoFetch = { pauseMs: 250 };
        const slept = [];
        await fetchRepoFiles({}, resolved, dir, record, {
            files: [f("attachment", "form.docx"), f("image", "logo.png")], askedUser: true, sleep: async ms => { slept.push(ms); }
        });
        assert.deepEqual(slept, [250]);
    });
});

test("a name the server's listing does not have is refused without CheckOut (it would answer empty success)", async () => {
    await withStubs({}, async ({ dir, calls, record, resolved }) => {
        const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "consol.html")] });
        assert.equal(r.results[0].status, "unknown-name");
        assert.match(r.results[0].reason, /Similar: console\.html/);
        assert.equal(calls.checkOut.length, 0);
        assert.equal(fs.existsSync(path.join(dir, "pages", "consol.html")), false);
    });
});

test("a pal that is not a repository pal is refused", async () => {
    const notRepo = Object.assign(listingPal(), { repositoryPal: false });
    await withStubs({}, async ({ dir, calls, record, resolved }) => {
        const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "console.html")] });
        assert.equal(r.refused, "not-repository");
        assert.equal(calls.checkOut.length, 0);
    }, { listing: notRepo });
});

test("an unfetched 0-byte stub is fetched; an unedited fetched file is skipped; an edited one is never overwritten", async () => {
    await withStubs({ "console.html": Buffer.from("server") }, async ({ dir, calls, record, resolved }) => {
        const p = path.join(dir, "pages", "console.html");
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, "");                                     // the stub a pull leaves behind
        let r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "console.html")] });
        assert.equal(r.results[0].status, "fetched");

        r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "console.html")] });
        assert.equal(r.results[0].status, "already-present");
        assert.equal(calls.checkOut.length, 1, "no second download");

        fs.writeFileSync(p, "my edit");
        r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "console.html")] });
        assert.equal(r.results[0].status, "local-content");
        assert.match(r.results[0].reason, /differs from the baseline/);
        assert.equal(fs.readFileSync(p, "utf8"), "my edit");
        assert.equal(calls.checkOut.length, 1);
    });
});

test("a server refusal is reported per file and nothing is written", async () => {
    await withStubs({}, async ({ dir, record, resolved }) => {
        const orig = CloudPistonAPIManager.checkOutFile;
        CloudPistonAPIManager.checkOutFile = async () => ({ success: false, messages: { "com.contractpal.Message": { message: "nope" } } });
        try {
            const r = await fetchRepoFiles({}, resolved, dir, record, { files: [f("page", "console.html")] });
            assert.equal(r.results[0].status, "refused");
            assert.match(r.results[0].reason, /nope/);
            assert.equal(r.fetched, 0);
            assert.equal(fs.existsSync(path.join(dir, "pages", "console.html")), false);
        } finally { CloudPistonAPIManager.checkOutFile = orig; }
    });
});

test("limits fall back to safe defaults for missing or junk settings", () => {
    assert.deepEqual(limitsFor({}), { maxFilesPerCall: 10, maxBytesPerCall: 25 * 1024 * 1024, pauseMs: 0 });
    assert.deepEqual(limitsFor({ repoFetch: { maxFilesPerCall: "x", maxBytesPerCall: -5, pauseMs: -1 } }),
        { maxFilesPerCall: 10, maxBytesPerCall: 25 * 1024 * 1024, pauseMs: 0 });
    assert.equal(limitsFor({ repoFetch: { maxFilesPerCall: 3 } }).maxFilesPerCall, 3);
});
