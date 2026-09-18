"use strict";
// §2 pal_regression: freshness gate, caused-vs-inherited separation, eyeball_only -> needs-human.
// Network-touching steps (marker, pal_test, page fetch) are injected; the baseline is a real file
// so readBaseline + JSON parsing are exercised for real.
const { test } = require("node:test");
const assert = require("node:assert");
const { runRegression, captureBaseline, captureApproval } = require("../src/core/regression");
const { tmpWorkspace } = require("./helpers");

function fixture(baseline) {
    return tmpWorkspace({ "baseline/baseline.json": JSON.stringify(baseline, null, 2) });
}

const REC = { palGuid: "guid-1", palName: "Demo" };
const CLEAN_BASELINE = {
    mapped: "2026-06-12 17:29:25.0",
    validate: { errors: 0, warnings: 0 },
    test: { web: { status: "VALIDATED", notes: 0 } },
    pages: { "home.html": { h1s: ["Welcome Home"], viewports: { desktop: { captured: true } } } },
    known_issues: []
};

// Deps that report a healthy pal matching the clean baseline.
function healthyDeps(overrides = {}) {
    return Object.assign({
        resolveServerPalByGuid: async () => ({ lastModifiedDate: "2026-06-12 17:29:25.0" }),
        validateWorkspace: () => ({ errors: 0, warnings: 0, findings: [] }),
        runTest: async () => ({ ran: true, validated: true, validation: [] }),
        fetchPagePath: async () => ({ fetched: true, status: 200, html: "<h1>Welcome Home</h1>" })
    }, overrides);
}

test("clean pass: every check matches baseline", async () => {
    const dir = fixture(CLEAN_BASELINE);
    const r = await runRegression({}, REC, dir, healthyDeps());
    assert.equal(r.stale, false);
    assert.equal(r.pass, true);
    assert.equal(r.caused.length, 0);
    assert.equal(r.needs_human.length, 0);
});

test("stale marker: server moved since mapped -> stops, no verdict", async () => {
    const dir = fixture(CLEAN_BASELINE);
    const r = await runRegression({}, REC, dir, healthyDeps({
        resolveServerPalByGuid: async () => ({ lastModifiedDate: "2026-06-20 09:00:00.0" })
    }));
    assert.equal(r.stale, true);
    assert.equal(r.mapped, "2026-06-12 17:29:25.0");
    assert.equal(r.current, "2026-06-20 09:00:00.0");
    assert.ok(!("pass" in r), "a stale baseline yields no pass/fail verdict");
});

test("caused failure: a recorded H1 no longer renders and is not a known issue", async () => {
    const dir = fixture(CLEAN_BASELINE);
    const r = await runRegression({}, REC, dir, healthyDeps({
        fetchPagePath: async () => ({ fetched: true, status: 200, html: "<h1>Something Else</h1>" })
    }));
    assert.equal(r.pass, false);
    assert.equal(r.caused.length, 1);
    assert.equal(r.inherited.length, 0);
    assert.match(r.caused[0].detail, /Welcome Home/);
});

test("inherited failure: same miss is listed in known_issues -> not caused, still passes", async () => {
    const dir = fixture(Object.assign({}, CLEAN_BASELINE, {
        known_issues: ["home.html hero H1 was removed in a hotfix, not yet restored"]
    }));
    const r = await runRegression({}, REC, dir, healthyDeps({
        fetchPagePath: async () => ({ fetched: true, status: 200, html: "<h1>Something Else</h1>" })
    }));
    assert.equal(r.caused.length, 0);
    assert.equal(r.inherited.length, 1);
    assert.equal(r.pass, true);
});

test("eyeball_only viewport -> needs-human, never captured/fetched as pass-fail", async () => {
    const dir = fixture(Object.assign({}, CLEAN_BASELINE, {
        pages: { "home.html": { h1s: ["Welcome Home"], viewports: {
            mobile: { captured: true },
            desktop: { captured: false, reason: "timeout", eyeball_only: true }
        } } }
    }));
    const r = await runRegression({}, REC, dir, healthyDeps());
    assert.equal(r.pass, true);
    assert.equal(r.needs_human.length, 1);
    assert.equal(r.needs_human[0].page, "home.html");
    assert.equal(r.needs_human[0].viewport, "desktop");
});

test("caused failure: workflow no longer VALIDATED", async () => {
    const dir = fixture(CLEAN_BASELINE);
    const r = await runRegression({}, REC, dir, healthyDeps({
        runTest: async () => ({ ran: true, validated: false, validation: [{ message: "x" }] })
    }));
    assert.equal(r.pass, false);
    assert.equal(r.caused.length, 1);
    assert.match(r.caused[0].detail, /VALIDATED/);
});

test("no baseline/ -> does not apply, ran:false", async () => {
    const dir = tmpWorkspace();
    const r = await runRegression({}, REC, dir, healthyDeps());
    assert.equal(r.ran, false);
    assert.equal(r.noBaseline, true);
});

const CAPTURE_REVISION = "2026-06-12 17:29:25.0";
const CAPTURE_RECORD = { palGuid: "guid-1", palName: "Demo", fileHashes: { "pal.json": "same" } };
function captureDeps(overrides = {}) {
    return Object.assign({
        diffWorkspace: () => ({ dirty: false, added: [], changed: [], deleted: [] }),
        resolveServerPalByGuid: async () => ({ guid: "guid-1", lastModifiedDate: CAPTURE_REVISION }),
        validateWorkspace: () => ({ errors: 0, warnings: 1 }),
        runTest: async (_session, _guid, opts) => ({ ran: true, validated: true, kind: (opts && opts.kind) || "web", validation: [] }),
        fetchPagePath: async () => ({ fetched: true, html: "<h1>Welcome Home</h1>" }),
        runScreenshot: async () => ({ captured: true, pngBase64: Buffer.from("png").toString("base64") })
    }, overrides);
}
function captureArgs(record = CAPTURE_RECORD) {
    return { revision: CAPTURE_REVISION, approval: captureApproval(record, CAPTURE_REVISION) };
}
function captureFixture() {
    return tmpWorkspace({
        "pal.json": "{}",
        "baseline/baseline.json": JSON.stringify(Object.assign({}, CLEAN_BASELINE, {
            mapped: "2026-06-01 00:00:00.0",
            pages: { "home.html": { h1s: ["Welcome Home"], viewports: {
                desktop: { captured: true, screenshot: "screenshots/home-desktop.png" },
                mobile: { captured: false, eyeball_only: true, reason: "browser unavailable" }
            } } },
            known_issues: ["legacy issue"]
        }), null, 2),
        "baseline/screenshots/home-desktop.png": "old"
    });
}

test("capture succeeds, preserves coverage, and a subsequent regression can run", async () => {
    const dir = captureFixture();
    const captured = await captureBaseline({}, CAPTURE_RECORD, dir, captureArgs(), captureDeps());
    assert.equal(captured.captured, true);
    assert.equal(captured.mapped, CAPTURE_REVISION);
    assert.ok(captured.filesWritten.includes("baseline/screenshots/home-desktop.png"));
    const saved = JSON.parse(require("fs").readFileSync(dir + "/baseline/baseline.json", "utf8"));
    assert.equal(saved.metadata.server_timestamp, CAPTURE_REVISION);
    assert.deepEqual(saved.known_issues, ["legacy issue"]);
    assert.deepEqual(saved.pages["home.html"].h1s, ["Welcome Home"]);
    assert.equal(saved.pages["home.html"].viewports.mobile.eyeball_only, true);
    const regression = await runRegression({}, CAPTURE_RECORD, dir, healthyDeps({
        resolveServerPalByGuid: async () => ({ lastModifiedDate: CAPTURE_REVISION })
    }));
    assert.equal(regression.ran, true);
    assert.equal(regression.pass, true);
});

test("capture refuses missing approval or an invalid/mismatched revision", async () => {
    const dir = captureFixture();
    const missing = await captureBaseline({}, CAPTURE_RECORD, dir, { revision: CAPTURE_REVISION }, captureDeps());
    assert.equal(missing.captured, false);
    assert.match(missing.reason, /Explicit operator approval/);
    const invalid = await captureBaseline({}, CAPTURE_RECORD, dir, { revision: "not-a-marker", approval: "anything" }, captureDeps());
    assert.equal(invalid.captured, false);
    assert.match(invalid.reason, /valid observed server revision/);
    const mismatch = await captureBaseline({}, CAPTURE_RECORD, dir, captureArgs(), captureDeps({
        resolveServerPalByGuid: async () => ({ guid: "guid-1", lastModifiedDate: "2026-06-13 00:00:00.0" })
    }));
    assert.equal(mismatch.captured, false);
    assert.match(mismatch.reason, /no longer matches/);
});

test("capture refuses local drift, validation failure, and failed test evidence", async () => {
    const dir = captureFixture();
    const local = await captureBaseline({}, CAPTURE_RECORD, dir, captureArgs(), captureDeps({
        diffWorkspace: () => ({ dirty: true, added: ["pages/new.html"], changed: [], deleted: [] })
    }));
    assert.match(local.reason, /unpushed changes/);
    const validation = await captureBaseline({}, CAPTURE_RECORD, dir, captureArgs(), captureDeps({
        validateWorkspace: () => ({ errors: 1, warnings: 0 })
    }));
    assert.match(validation.reason, /Validation failed/);
    const testFailure = await captureBaseline({}, CAPTURE_RECORD, dir, captureArgs(), captureDeps({
        runTest: async () => ({ ran: true, validated: false, validation: [{ message: "bad" }] })
    }));
    assert.match(testFailure.reason, /workflow test evidence failed/);
});

test("capture preserves the old baseline on incomplete screenshots, server changes, and write failure", async () => {
    for (const [name, overrides] of [
        ["screenshot", { runScreenshot: async () => ({ captured: false, reason: "timeout" }) }],
        ["server", { resolveServerPalByGuid: (() => { let n = 0; return async () => ({ guid: "guid-1", lastModifiedDate: ++n === 1 ? CAPTURE_REVISION : "2026-06-13 00:00:00.0" }); })() }],
        ["write", { writeIfChanged: async () => { throw new Error("disk full"); } }]
    ]) {
        const dir = captureFixture();
        const before = require("fs").readFileSync(dir + "/baseline/baseline.json", "utf8");
        const result = await captureBaseline({}, CAPTURE_RECORD, dir, captureArgs(), captureDeps(overrides));
        assert.equal(result.captured, false, name);
        assert.equal(require("fs").readFileSync(dir + "/baseline/baseline.json", "utf8"), before, name);
    }
});
