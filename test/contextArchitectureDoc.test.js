"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

// docs/context-architecture.md had drifted to numbers nobody could reproduce -- it claimed 16,689
// tool-definition bytes when the advertised schema is 19,354, stamped an old release, with no generator
// and nothing holding it to reality. The table is generated from `.palsync/context-manifest.json` now,
// and this is what makes the drift impossible to reintroduce silently: a context change that moves any
// byte count fails here until the doc is regenerated.
const generator = require("../scripts/gen-context-architecture");

test("the committed context table matches the live manifest measurement", async () => {
    const doc = fs.readFileSync(generator.DOC, "utf8");
    const start = doc.indexOf(generator.START);
    const end = doc.indexOf(generator.END);
    assert.ok(start !== -1 && end > start, "generated-table markers are present");

    const measured = generator.renderTable(await generator.measure());
    const committed = doc.slice(start, end + generator.END.length);
    assert.equal(committed, measured,
        "docs/context-architecture.md is stale — run: node scripts/gen-context-architecture.js");
});

test("the measurement itself is well formed and reports real sections", async () => {
    const { palsyncVersion, rows } = await generator.measure();
    assert.equal(palsyncVersion, require("../package.json").version);
    assert.ok(rows.length > 0);
    for (const row of rows) {
        assert.ok(Number.isInteger(row.bytes) && row.bytes > 0, row.section);
        assert.ok(Number.isInteger(row.estimatedTokens) && row.estimatedTokens > 0, row.section);
        assert.ok(row.runtime && row.section && row.source && row.loading, row.section);
    }
    // The tool schema is the one row an MCP host always pays for, and it is the number that was wrong.
    // Pinned against the same measurement bench/efficiency-baseline.json records, so the doc and the
    // benchmark can never disagree about it.
    const tools = rows.filter(row => row.section === "tool-definitions");
    assert.equal(tools.length, 1, "tool definitions are identical across hosts");
    assert.equal(tools[0].runtime, "All");
    assert.equal(tools[0].bytes, require("../bench/efficiency-baseline.json").toolSchemaBytes);
});
