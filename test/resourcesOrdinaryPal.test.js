"use strict";
// Chain pals that are not repository, not shadow and not the Root pal ("ordinary" pals) arrive with
// workflows intact and placeholders for everything else. When something besides a workflow is
// needed, ONE full GetPal brings the whole pal down — they are small, so that beats a CheckOut
// round trip per file, and the validators then see real ids, names and routes.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CloudPistonAPIManager } = require("../lib/apiManager");
const { fetchResourceFile } = require("../src/core/resources");

const b64 = s => Buffer.from(s).toString("base64");

// full=true is how Root and (on secure.cloudpiston.com) Cloud really arrive: every file with content.
function chainResp() {
    const pal = (name, pages, full) => ({
        layout: { name },
        pages: { entry: pages.map(n => ({ string: n, Page: { content: full ? b64("<page " + n + "/>") : "" } })) },
        fragments: { entry: [{ string: "f.html", Fragment: { content: full ? b64("<frag/>") : "" } }] }
    });
    return {
        success: true,
        customObject: { palInfoList: { PalInfoEx: [
            { id: "ID-REPO", guid: "PAL-REPO", repository: true, importPal: pal("Repo", ["console.html"]) },
            { guid: "SYS-ROOT", importPal: pal("Root", ["r.html"], true) },
            { id: "ID-CLOUD", guid: "SYS-CLOUD", repository: false, importPal: pal("Cloud", ["c.html"], true) },
            { id: "ID-SYSEMPTY", guid: "SYS-EMPTY", repository: false, importPal: pal("SysEmpty", ["e.html"]) },
            { id: "ID-LIB", guid: "PAL-LIB", repository: false, shadow: false, importPal: pal("Lib", ["p.html"]) },
            { id: "ID-SH", guid: "PAL-SH", repository: false, shadow: true, importPal: pal("Shady", ["s.html"]) }
        ] } }
    };
}
const fullLib = () => ({
    success: true,
    pal: {
        layout: { name: "Lib" },
        pages: { entry: [{ string: "p.html", Page: { filename: "p.html", content: b64("<page/>") } }] },
        fragments: { entry: [{ string: "f.html", Fragment: { filename: "f.html", content: b64('<div id="widget"/>') } }] },
        workflows: { entry: [{ string: "lib.js", Workflow: { filename: "lib.js", content: b64("function run(){}") } }] }
    }
});

// getPal stubs the full GetPal; checkOut stubs the per-file read used by repository/shadow pals.
async function withStubs(fn, { getPal = fullLib } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resord-"));
    const calls = { getPal: [], checkOut: [] };
    const orig = { fetchAPI: CloudPistonAPIManager.fetchAPI, getPal: CloudPistonAPIManager.getPal, checkOutFile: CloudPistonAPIManager.checkOutFile };
    CloudPistonAPIManager.fetchAPI = async () => chainResp();
    CloudPistonAPIManager.getPal = async (s, id) => { calls.getPal.push(id); return getPal(id); };
    CloudPistonAPIManager.checkOutFile = async (s, id, type, file) => { calls.checkOut.push([id, type, file]); return { success: true, palFile: { content: b64("shadow-bytes") } }; };
    try { await fn({ dir, calls, session: { lockInfo: { toHeaderString: () => "x" } } }); }
    finally { Object.assign(CloudPistonAPIManager, orig); fs.rmSync(dir, { recursive: true, force: true }); }
}

const resolved = { id: "DEV", profileId: "P" };

test("an ordinary chain pal is read with ONE full GetPal: every file gets real content, no CheckOut", async () => {
    await withStubs(async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Lib", type: "fragment", file: "f.html" });
        assert.equal(r.ok, true);
        assert.equal(r.mode, "full-pal");
        assert.equal(r.path, ".resources/Lib/fragments/f.html");
        assert.deepEqual(calls.getPal, ["ID-LIB"], "the chain item id is the pal id");
        assert.equal(calls.checkOut.length, 0, "no per-file CheckOut for an ordinary pal");
        const base = path.join(dir, ".resources", "Lib");
        assert.equal(fs.readFileSync(path.join(base, "fragments", "f.html"), "utf8"), '<div id="widget"/>');
        assert.equal(fs.readFileSync(path.join(base, "pages", "p.html"), "utf8"), "<page/>", "the OTHER files arrived in the same call");
        assert.equal(fs.readFileSync(path.join(base, "workflows", "lib.js"), "utf8"), "function run(){}");
        assert.equal(r.files, 3);
    });
});

test("pal alone (no type/file) fetches an ordinary pal whole; the index records that it is full", async () => {
    await withStubs(async ({ dir, calls, session }) => {
        fs.mkdirSync(path.join(dir, ".resources"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".resources", "index.json"), JSON.stringify({ entries: [{ slug: "Lib", files: 0 }, { slug: "Repo", files: 2 }] }));
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Lib" });
        assert.equal(r.ok, true);
        assert.equal(r.type, undefined);
        assert.equal(calls.getPal.length, 1);
        const idx = JSON.parse(fs.readFileSync(path.join(dir, ".resources", "index.json"), "utf8"));
        assert.equal(idx.entries.find(e => e.slug === "Lib").fullContent, true);
        assert.equal(idx.entries.find(e => e.slug === "Lib").files, 3);
        assert.equal(idx.entries.find(e => e.slug === "Repo").fullContent, undefined, "other entries untouched");
    });
});

test("a file name the ordinary pal does not have is refused after the GetPal, and nothing is written", async () => {
    await withStubs(async ({ dir, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Lib", type: "fragment", file: "g.html" });
        assert.equal(r.ok, false);
        assert.match(r.reason, /no fragment named "g\.html"/);
        assert.equal(fs.existsSync(path.join(dir, ".resources", "Lib")), false);
    });
});

test("a refused GetPal (a pal the developer cannot open) is reported with a clear explanation; nothing is written", async () => {
    const refuse = () => ({ success: false, messages: { "com.contractpal.Message": { message: "The Pal is not a development Pal." } } });
    await withStubs(async ({ dir, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Lib", type: "page", file: "p.html" });
        assert.equal(r.ok, false);
        assert.match(r.reason, /GetPal\.do refused Lib: The Pal is not a development Pal\./);
        assert.match(r.reason, /refuses on-demand reads/);
        assert.equal(fs.existsSync(path.join(dir, ".resources", "Lib")), false);
    }, { getPal: refuse });
});

test("a shadow pal is still read per file (CheckOut), never by full GetPal", async () => {
    await withStubs(async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Shady", type: "page", file: "s.html" });
        assert.equal(r.ok, true);
        assert.equal(r.bytes, 12);
        assert.deepEqual(calls.getPal, []);
        assert.deepEqual(calls.checkOut, [["ID-SH", "page", "s.html"]]);
    });
});

test("a repository pal is never fetched whole, even when only the pal is named", async () => {
    await withStubs(async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Repo" });
        assert.equal(r.ok, false);
        assert.match(r.reason, /repository pal and is read one file at a time/);
        assert.deepEqual(calls.getPal, []);
        assert.equal(calls.checkOut.length, 0);
    });
});

test("Root and Cloud arrive with content: reading them makes NO request at all", async () => {
    await withStubs(async ({ dir, calls, session }) => {
        for (const slug of ["Root", "Cloud"]) {
            const whole = await fetchResourceFile(session, resolved, dir, { pal: slug });
            assert.equal(whole.ok, true);
            assert.equal(whole.mode, "already-present");
            assert.match(whole.note, /already has content for every file/);
        }
        const one = await fetchResourceFile(session, resolved, dir, { pal: "Cloud", type: "page", file: "c.html" });
        assert.equal(one.ok, true);
        assert.equal(one.mode, "already-present");
        assert.equal(one.path, ".resources/Cloud/pages/c.html");
        assert.equal(one.bytes, "<page c.html/>".length);
        assert.equal(calls.getPal.length + calls.checkOut.length, 0, "no GetPal, no CheckOut");
    });
});

test("a system (SYS-) pal whose files arrive EMPTY is read like a repository: per file, never a whole GetPal", async () => {
    await withStubs(async ({ dir, calls, session }) => {
        const whole = await fetchResourceFile(session, resolved, dir, { pal: "SysEmpty" });
        assert.equal(whole.ok, false);
        assert.match(whole.reason, /system resource pal and is read one file at a time/);
        const r = await fetchResourceFile(session, resolved, dir, { pal: "SysEmpty", type: "page", file: "e.html" });
        assert.equal(r.ok, true);
        assert.equal(r.mode, undefined, "a real per-file read, not the already-present shortcut");
        assert.deepEqual(calls.getPal, []);
        assert.deepEqual(calls.checkOut, [["ID-SYSEMPTY", "page", "e.html"]]);
    });
});

test("an ordinary pal is not mistaken for already-present just because it has an id", async () => {
    await withStubs(async ({ dir, calls, session }) => {
        const r = await fetchResourceFile(session, resolved, dir, { pal: "Lib", type: "page", file: "p.html" });
        assert.equal(r.mode, "full-pal");
        assert.equal(calls.getPal.length, 1);
    });
});
