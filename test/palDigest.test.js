"use strict";
// injectFileContent refreshes an existing Workflow.digest from the exact file bytes (PalFile.java:335).
const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pal } = require("../lib/pal");

test("injectFileContent rewrites a stale Workflow.digest and never adds one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paldigest-"));
    try {
        fs.mkdirSync(path.join(dir, "workflows"));
        const bytes = Buffer.from("console.log('new');\n");
        fs.writeFileSync(path.join(dir, "workflows", "a.js"), bytes);
        fs.writeFileSync(path.join(dir, "workflows", "b.js"), bytes);
        const pal = new Pal({
            path: dir,
            workflows: { entry: [
                { string: "a.js", Workflow: { digest: "STALE" } },
                { string: "b.js", Workflow: { name: "b" } }
            ] }
        });
        await pal.injectFileContent();
        const [a, b] = pal.allWorkflows;
        assert.strictEqual(a.Workflow.digest, crypto.createHash("sha1").update(bytes).digest("base64"));
        assert.strictEqual(a.Workflow.content, bytes.toString("base64"));
        assert.ok(!("digest" in b.Workflow));
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
