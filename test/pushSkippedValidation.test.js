"use strict";
// A push that went past validation errors (developer's validation slider / --skip-validation) must
// not become the new baseline. The push gate lints only files changed since the last push, so a
// broken file recorded as "already pushed" would stay invisible once validation is switched back on.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const lock = require("../src/core/lock");
const { CloudPistonAPIManager } = require("../lib/apiManager");

// push.js destructures refreshResolvedPal at load, so stub it before push.js is first required.
const resolvePath = require.resolve("../src/core/resolve");
const realResolve = require(resolvePath);
require.cache[resolvePath].exports = Object.assign({}, realResolve, {
    refreshResolvedPal: async () => ({ lastModifiedDate: "2026-01-02T00:00:00Z" }),
    resolveServerPalByGuid: async () => ({ lastModifiedDate: "2026-01-02T00:00:00Z" }),
});
delete require.cache[require.resolve("../src/core/push")];
const { push, gateLint } = require("../src/core/push");

const PAL_JSON = JSON.stringify({
    pages: { entry: [{ string: "web.html", Page: { filename: "web.html", name: "web" } }] },
    fragments: { entry: [] }, styles: { entry: [] }, scripts: { entry: [] }, images: { entry: [] },
    emails: { entry: [] }, attachments: { entry: [] }, datasets: { entry: [] },
});
const BROKEN = '<html xmlns:c="contractpal"><body><p>hi<br></p></body></html>';

function stubServer() {
    const saved = { acquire: lock.acquireByGuid, save: CloudPistonAPIManager.savePal };
    lock.acquireByGuid = async () => ({ acquired: true, resolved: { id: "ID1", lastModifiedDate: "2026-01-01T00:00:00Z" }, getPalResp: null });
    CloudPistonAPIManager.savePal = async () => ({ success: true });
    return () => { lock.acquireByGuid = saved.acquire; CloudPistonAPIManager.savePal = saved.save; };
}

test("a push past validation errors leaves the broken file 'changed' so the gate re-checks it", async () => {
    const dir = tmpWorkspace({ "pal.json": PAL_JSON, "pages/web.html": '<html xmlns:c="contractpal"><body><p>hi</p></body></html>' });
    const record = { palGuid: "PAL-1", lastModifiedDate: "2026-01-01T00:00:00Z", fileHashes: hashWorkspaceFiles(dir).files };
    const restore = stubServer();
    try {
        require("node:fs").writeFileSync(path.join(dir, "pages", "web.html"), BROKEN);
        assert.ok(gateLint(record, dir).errors > 0, "precondition: the broken file is a gate error");

        const off = await push({}, record, dir, { skipValidation: true });
        assert.strictEqual(off.pushed, true);
        assert.strictEqual(off.skippedValidation, true);
        assert.strictEqual(off.serverPaths, null, "no serverPaths, so the caller leaves fileHashes alone");
        assert.ok(gateLint(record, dir).errors > 0, "validation back on: the same file must be refused again");

        const on = await push({}, record, dir, {});
        assert.strictEqual(on.pushed, false);
        assert.strictEqual(on.refused, "validation");
    } finally { restore(); }
});

test("a push with validation skipped but no errors still advances the baseline", async () => {
    const dir = tmpWorkspace({ "pal.json": PAL_JSON, "pages/web.html": '<html xmlns:c="contractpal"><body><p>hi</p></body></html>' });
    const record = { palGuid: "PAL-1", lastModifiedDate: "2026-01-01T00:00:00Z", fileHashes: {} };
    const restore = stubServer();
    try {
        const res = await push({}, record, dir, { skipValidation: true });
        assert.strictEqual(res.pushed, true);
        assert.strictEqual(res.skippedValidation, false);
        assert.ok(Array.isArray(res.serverPaths) && res.serverPaths.length > 0);
    } finally { restore(); }
});
