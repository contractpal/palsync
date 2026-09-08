"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { hashWorkspaceFiles } = require("../src/core/workspaceHash");
const verifyCommand = require("../src/cli/verifyCommand");
const { run } = require("../src/cli/syncCommands");

function makeWorkspace(manifest, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-verify-cli-"));
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(manifest || {}, null, 2));
    for (const [rel, content] of Object.entries(files || {})) {
        const file = path.join(dir, ...rel.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    const fileHashes = hashWorkspaceFiles(dir).files;
    fs.writeFileSync(path.join(dir, ".palsync.json"), JSON.stringify({ fileHashes }));
    return dir;
}

async function describe(dir, verification = "standard") {
    const oldVerification = process.env.PALSYNC_VERIFICATION;
    const oldReview = process.env.PALSYNC_REVIEW;
    process.env.PALSYNC_VERIFICATION = verification;
    process.env.PALSYNC_REVIEW = "ask";
    try { return await verifyCommand.describe(dir); }
    finally {
        if (oldVerification === undefined) delete process.env.PALSYNC_VERIFICATION;
        else process.env.PALSYNC_VERIFICATION = oldVerification;
        if (oldReview === undefined) delete process.env.PALSYNC_REVIEW;
        else process.env.PALSYNC_REVIEW = oldReview;
    }
}

function workflowManifest(name, workflowType = 7) {
    return {
        workflows: {
            entry: [{ string: name, Workflow: { filename: name, workflowType } }]
        }
    };
}

test("verify CLI describes a low-risk UI change without internal jargon", async () => {
    const dir = makeWorkspace({}, { "styles/styles.css": ".card { padding: 1rem; }" });
    fs.appendFileSync(path.join(dir, "styles", "styles.css"), "\n.card { gap: 1rem; }");
    const logged = [];
    const oldLog = console.log;
    const oldVerification = process.env.PALSYNC_VERIFICATION;
    const oldReview = process.env.PALSYNC_REVIEW;
    console.log = value => logged.push(value);
    process.env.PALSYNC_VERIFICATION = "standard";
    process.env.PALSYNC_REVIEW = "ask";
    try {
        assert.equal(await run("verify", ["--dir", dir]), 0);
        const output = logged.join("\n");
        assert.match(output, /Change: low risk/);
        assert.match(output, /✓ render check/);
        assert.match(output, /– mobile render check/);
        assert.match(output, /Changed: styles\/styles\.css/);
        assert.doesNotMatch(output, /fanout|decision table|policy engine|strategy/i);
    } finally {
        console.log = oldLog;
        if (oldVerification === undefined) delete process.env.PALSYNC_VERIFICATION;
        else process.env.PALSYNC_VERIFICATION = oldVerification;
        if (oldReview === undefined) delete process.env.PALSYNC_REVIEW;
        else process.env.PALSYNC_REVIEW = oldReview;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("verify describes one interaction as medium and proves the changed behavior", async () => {
    const dir = makeWorkspace(workflowManifest("console.js"), {
        "workflows/console.js": "function run() { return true; }"
    });
    fs.appendFileSync(path.join(dir, "workflows", "console.js"), "\nfunction save() { return true; }");
    try {
        const output = await describe(dir);
        assert.match(output, /Change: medium risk/);
        assert.match(output, /✓ workflow compile check/);
        assert.match(output, /✓ behavior check/);
        assert.match(output, /– render check/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("verify detects high-risk transaction and auth workflows from repository facts", async () => {
    const transaction = makeWorkspace(workflowManifest("checkout.js", 2), {
        "workflows/checkout.js": "function run() { return true; }"
    });
    fs.appendFileSync(path.join(transaction, "workflows", "checkout.js"), "\n// changed");
    const auth = makeWorkspace(workflowManifest("auth-login.js"), {
        "workflows/auth-login.js": "function login() { return true; }"
    });
    fs.appendFileSync(path.join(auth, "workflows", "auth-login.js"), "\n// changed");
    try {
        assert.match(await describe(transaction), /Change: high risk — .*transaction or webservice\/tunnel workflow changed/);
        assert.match(await describe(auth), /Change: high risk — .*authentication or access-control code changed/);
    } finally {
        fs.rmSync(transaction, { recursive: true, force: true });
        fs.rmSync(auth, { recursive: true, force: true });
    }
});

test("verify uses markup dependents to escalate a shared fragment and keep regression", async () => {
    const pages = {};
    const pageEntries = [];
    for (const name of ["one.html", "two.html", "three.html"]) {
        pages["pages/" + name] = '<c:fragment name="shared/nav"/>';
        pageEntries.push({ string: name, Page: { filename: name, palType: "palTypeConsole" } });
    }
    const dir = makeWorkspace({ pages: { entry: pageEntries } }, Object.assign(pages, {
        "fragments/shared/nav.html": "<nav>Old</nav>"
    }));
    fs.writeFileSync(path.join(dir, "fragments", "shared", "nav.html"), "<nav>New</nav>");
    fs.mkdirSync(path.join(dir, "baseline"));
    fs.writeFileSync(path.join(dir, "baseline", "baseline.json"), "{}");
    try {
        const output = await describe(dir);
        assert.match(output, /Change: high risk — this file is used in 3 places/);
        assert.match(output, /✓ regression check/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("verify treats a manifest-only dataset schema edit as high risk", async () => {
    const before = {
        datasets: { entry: [{ string: "orders", Dataset: { name: "orders", fields: { DatasetField: [] } } }] }
    };
    const dir = makeWorkspace(before, {});
    before.datasets.entry[0].Dataset.fields.DatasetField.push({ fieldName: "orderId", fieldType: "Primary key" });
    fs.writeFileSync(path.join(dir, "pal.json"), JSON.stringify(before, null, 2));
    try {
        const output = await describe(dir);
        assert.match(output, /Change: high risk — pal\.json structure changed/);
        assert.match(output, /Changed: pal\.json/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("verify reports deleted tracked files instead of claiming there are no changes", async () => {
    const dir = makeWorkspace({}, { "pages/old.html": "<h1>Old</h1>" });
    fs.unlinkSync(path.join(dir, "pages", "old.html"));
    try {
        const output = await describe(dir);
        assert.doesNotMatch(output, /No local changes/);
        assert.match(output, /Changed: pages\/old\.html/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("verify works without a configured workspace or network", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-verify-empty-"));
    try {
        const output = await describe(dir, "fast");
        assert.match(output, /PalSync: Fast checks · Final review: Ask/);
        assert.match(output, /No local changes to check yet\./);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
