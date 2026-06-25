"use strict";
// Unit tests for `palsync upgrade` — pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const { repoSlug, installedSha } = require("../src/cli/upgradeCommand");

test("repoSlug: derives owner/repo from package.json repository", () => {
    assert.equal(repoSlug(), "contractpal/palsync");
});

test("installedSha: null when no SHA stamp is present (dev clone / first run)", () => {
    // A dev clone has no .installed-sha stamp, so it reports unknown — which makes the first
    // `palsync upgrade` reinstall and write the stamp, after which it no-ops when current.
    assert.equal(installedSha(), null);
});
