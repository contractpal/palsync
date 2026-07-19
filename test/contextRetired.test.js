'use strict';

// Pins the retired-`context` guard in bin/palsync.js: the CLI subcommand was renamed to `ctx`
// (2026-07-18) to end the collision with the MCP `pal_context` tool. The retired name must fail
// fast with a redirect, NOT fall through to the interactive launcher (which hangs in an agent
// shell — the test-07 failure mode). A 10s timeout doubles as the hang detector.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'palsync.js');

test('retired `palsync context` is rejected and redirected, not launched', () => {
    let err;
    try {
        execFileSync('node', [BIN, 'context', 'inspect'],
            { timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        assert.fail('expected `palsync context` to exit non-zero');
    } catch (e) {
        err = e;
    }
    assert.ok(err && err.status !== 0, 'must exit non-zero (and must not hang past the timeout)');
    const out = (err.stderr || '') + (err.stdout || '');
    assert.match(out, /palsync ctx/, 'must point at the renamed `palsync ctx`');
    assert.match(out, /pal_context/, 'must point at the MCP `pal_context` tool');
});
