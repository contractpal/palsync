"use strict";
// CLI flag parsing for human-vs-agent preview behavior. The MCP pal_preview tool remains
// no-open by default; the standalone CLI opens unless the caller explicitly opts out.
const { test } = require("node:test");
const assert = require("node:assert");
const { parseFlags, defaultPreviewOpen, USAGE } = require("../src/cli/syncCommands");

test("parseFlags: preview open is tri-state", () => {
    assert.equal(parseFlags([]).open, undefined);
    assert.equal(parseFlags(["--open"]).open, true);
    assert.equal(parseFlags(["--no-open"]).open, false);
});

test("defaultPreviewOpen: true even when launched from a non-TTY runner", () => {
    const oldIn = process.stdin.isTTY;
    const oldOut = process.stdout.isTTY;
    try {
        process.stdin.isTTY = true;
        process.stdout.isTTY = true;
        assert.equal(defaultPreviewOpen(), true);
        process.stdout.isTTY = false;
        assert.equal(defaultPreviewOpen(), true);
        process.stdin.isTTY = false;
        process.stdout.isTTY = true;
        assert.equal(defaultPreviewOpen(), true);
    } finally {
        process.stdin.isTTY = oldIn;
        process.stdout.isTTY = oldOut;
    }
});

test("USAGE documents browser-open preview default and no-open escape hatch", () => {
    assert.match(USAGE, /--open\|--no-open/);
    assert.match(USAGE, /browser by default/);
    assert.match(USAGE, /--no-open/);
});
