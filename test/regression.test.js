"use strict";
// §2 pal_regression: freshness gate, caused-vs-inherited separation, eyeball_only -> needs-human.
// Network-touching steps (marker, pal_test, page fetch) are injected; the baseline is a real file
// so readBaseline + JSON parsing are exercised for real.
const { test } = require("node:test");
const assert = require("node:assert");
const { runRegression } = require("../src/core/regression");
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
