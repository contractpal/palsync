"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { tmpWorkspace } = require("./helpers");
const { cachedLint, keyFor, readStats, RULES_VERSION } = require("../src/core/lintCache");
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
    assert.deepStrictEqual(readStats(ws), { version: 1, hits: 2, misses: 4, bypasses: 0 });
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
