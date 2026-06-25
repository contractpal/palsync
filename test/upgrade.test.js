"use strict";
// Unit tests for `palsync upgrade` — pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const { repoSlug, installedSha } = require("../src/cli/upgradeCommand");

test("repoSlug: derives owner/repo from package.json repository", () => {
    assert.equal(repoSlug(), "contractpal/palsync");
});

test("installedSha: null in a dev clone (no git-install metadata)", () => {
    // This repo's own package.json has no _resolved/gitHead, so a dev run reports unknown —
    // which makes `palsync upgrade` always reinstall the latest HEAD.
    assert.equal(installedSha(), null);
});
