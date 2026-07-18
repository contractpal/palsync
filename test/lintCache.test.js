"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { cachedLint, keyFor, readStats, RULES_VERSION, RULE_VERSIONS, WORKSPACE_RULE_VERSIONS,
    pushGateRulesVersion } = require("../src/core/lintCache");
const { validateWorkspace } = require("../src/core/validate");
const { TOOLS } = require("../src/mcp/tools");

test("content-addressed lint cache hits exactly and invalidates content/rules independently", () => {
    const ws = tmpWorkspace();
    let computes = 0;
    const run = (rel, content, rulesVersion = RULES_VERSION) => cachedLint(ws,
        { rel, content, mode: "test", rulesVersion }, () => [{ rel, content, compute: ++computes }]);
    const first = run("workflows/a.js", "one");
    assert.deepStrictEqual(run("workflows/a.js", "one"), first);
    run("workflows/a.js", "two");
    const other = run("workflows/b.js", "same");
    assert.deepStrictEqual(run("workflows/b.js", "same"), other);
    run("workflows/a.js", "one", RULES_VERSION + 1);
    assert.equal(computes, 4);
    assert.deepStrictEqual(readStats(ws), {
        version: 2, hits: 2, misses: 4, bypasses: 0,
        missReasons: { content: 1, deps: 0, rulesVersion: 1, palsyncVersion: 0, evicted: 0, cold: 2 }
    });
    fs.rmSync(ws, { recursive: true, force: true });
});

test("push-gate cache invalidates when a shared workspace rule version changes", () => {
    const ws = tmpWorkspace();
    const content = "<main>same content</main>";
    let computes = 0;
    const run = rulesVersion => cachedLint(ws, Object.assign({
        rel: "pages/home.html", content, mode: "push-gate"
    }, rulesVersion == null ? {} : { rulesVersion }), () => ({ compute: ++computes }));
    const current = pushGateRulesVersion();
    const bumped = pushGateRulesVersion(Object.assign({}, WORKSPACE_RULE_VERSIONS, {
        "workspace-markup": WORKSPACE_RULE_VERSIONS["workspace-markup"] + 1
    }));

    assert.equal(RULE_VERSIONS["push-gate"], current);
    assert.deepStrictEqual(run(), { compute: 1 });
    assert.deepStrictEqual(run(), { compute: 1 });
    assert.deepStrictEqual(run(bumped), { compute: 2 });
    assert.equal(readStats(ws).missReasons.rulesVersion, 1);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("cache misses are recorded when writing the cache entry fails", () => {
    const ws = tmpWorkspace();
    const renameSync = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (to.includes(`${path.sep}lint${path.sep}`)) throw new Error("simulated entry write failure");
        return renameSync(from, to);
    };
    try {
        assert.deepStrictEqual(cachedLint(ws, {
            rel: "pages/home.html", content: "<main></main>", mode: "push-gate"
        }, () => ({ valid: true })), { valid: true });
        assert.equal(readStats(ws).misses, 1);
        assert.equal(readStats(ws).missReasons.cold, 1);
    } finally {
        fs.renameSync = renameSync;
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("dependency changes invalidate only dependent entries and count miss reasons", () => {
    const ws = tmpWorkspace();
    let computes = 0;
    const run = (rel, content, dep, extra = {}) => cachedLint(ws, Object.assign({
        rel, content, mode: "deps-test", deps: [{ path: "central-map", content: dep }]
    }, extra), () => ({ compute: ++computes }));
    const a = run("pages/a.html", "a", "one");
    const b = run("pages/b.html", "b", "one");
    assert.deepStrictEqual(run("pages/a.html", "a", "one"), a);
    assert.deepStrictEqual(run("pages/b.html", "b", "one"), b);
    run("pages/a.html", "a", "two");
    assert.deepStrictEqual(run("pages/b.html", "b", "one"), b, "unrelated entry remains a hit");
    run("pages/a.html", "changed", "two");
    run("pages/a.html", "changed", "two", { palsyncVersion: "next" });
    const stats = readStats(ws);
    assert.equal(stats.missReasons.cold, 2);
    assert.equal(stats.missReasons.deps, 1);
    assert.equal(stats.missReasons.content, 1);
    assert.equal(stats.missReasons.palsyncVersion, 1);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("valid JSON with an invalid cache envelope is recomputed", () => {
    const ws = tmpWorkspace();
    const options = { rel: "pal.json", content: "{\"stlyes\":{}}", mode: "push-gate" };
    const file = path.join(ws, ".palsync", "cache", "lint", keyFor(options) + ".json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, result: [] }));
    let computes = 0;
    const result = cachedLint(ws, options, () => [{ rule: "unknownPalJsonKey", compute: ++computes }]);
    assert.equal(computes, 1);
    assert.equal(result[0].rule, "unknownPalJsonKey");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("PALSYNC_NO_CACHE bypasses reads and writes", () => {
    const ws = tmpWorkspace();
    const before = process.env.PALSYNC_NO_CACHE;
    process.env.PALSYNC_NO_CACHE = "1";
    let computes = 0;
    try {
        const run = () => cachedLint(ws, { rel: "workflows/a.js", content: "one" }, () => ++computes);
        assert.equal(run(), 1);
        assert.equal(run(), 2);
        assert.equal(fs.existsSync(path.join(ws, ".palsync/cache/lint")), false);
        assert.equal(readStats(ws).bypasses, 2);
    } finally {
        if (before === undefined) delete process.env.PALSYNC_NO_CACHE;
        else process.env.PALSYNC_NO_CACHE = before;
        fs.rmSync(ws, { recursive: true, force: true });
    }
});

test("markup dependency fingerprints invalidate parseable and design-system changes", () => {
    const ws = tmpWorkspace({
        "fragments/track.html": "<script>var x = `${value}`;</script>\n",
        "pages/form.html": "<input type=\"text\" />\n",
        "pal.json": JSON.stringify({ fragments: { entry: [{ string: "track.html", Fragment: { parseable: true } }] } })
    });
    const first = validateWorkspace(ws);
    assert.ok(first.findings.some(f => f.file === "fragments/track.html"));
    const pal = JSON.parse(fs.readFileSync(path.join(ws, "pal.json"), "utf8"));
    pal.fragments.entry[0].Fragment.parseable = false;
    fs.writeFileSync(path.join(ws, "pal.json"), JSON.stringify(pal));
    const nonParseable = validateWorkspace(ws);
    assert.ok(!nonParseable.findings.some(f => f.file === "fragments/track.html" && /inline|template/i.test(f.message)));
    fs.writeFileSync(path.join(ws, "DESIGN_SYSTEM.md"), "# Design\n");
    const designed = validateWorkspace(ws);
    assert.ok(designed.findings.some(f => f.rule === "designClassRequired" && f.file === "pages/form.html"));
    fs.rmSync(ws, { recursive: true, force: true });
});

test("pal_spec_lint cache invalidates when a sibling MAP.md appears", async () => {
    const ws = tmpWorkspace({ "SPEC.md": "# SPEC\n" });
    const tool = TOOLS.find(value => value.name === "pal_spec_lint");
    const first = await tool.run({ workspaceDir: ws }, {});
    const afterFirst = readStats(ws);
    await tool.run({ workspaceDir: ws }, {});
    const afterRepeat = readStats(ws);
    assert.equal(afterRepeat.hits, afterFirst.hits + 1);
    fs.writeFileSync(path.join(ws, "MAP.md"), "# MAP\n");
    const brownfield = await tool.run({ workspaceDir: ws }, {});
    const afterMap = readStats(ws);
    assert.equal(afterMap.misses, afterRepeat.misses + 1);
    assert.equal(first.mapPresent, false);
    assert.equal(brownfield.mapPresent, true);
    fs.rmSync(ws, { recursive: true, force: true });
});
