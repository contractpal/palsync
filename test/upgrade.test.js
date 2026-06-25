"use strict";
// Unit tests for `palsync upgrade` version logic — pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const { parseSemver, cmpSemver, pickLatestTag, repoSlug } = require("../src/cli/upgradeCommand");

test("parseSemver: strips v, rejects junk", () => {
    assert.deepEqual(parseSemver("v0.20.0"), [0, 20, 0]);
    assert.deepEqual(parseSemver("0.19.0"), [0, 19, 0]);
    assert.equal(parseSemver("nightly"), null);
});

test("cmpSemver: orders by major/minor/patch", () => {
    assert.ok(cmpSemver("v0.20.0", "0.19.0") > 0);
    assert.ok(cmpSemver("0.19.0", "v0.20.0") < 0);
    assert.equal(cmpSemver("0.20.0", "v0.20.0"), 0);
    assert.ok(cmpSemver("1.0.0", "0.99.99") > 0);
});

test("pickLatestTag: highest semver, ignores non-semver tags", () => {
    assert.equal(pickLatestTag([{ name: "v0.6.0" }, { name: "v0.20.0" }, { name: "v0.13.0" }]), "v0.20.0");
    assert.equal(pickLatestTag([{ name: "latest" }, { name: "v0.2.0" }]), "v0.2.0");
    assert.equal(pickLatestTag([{ name: "nope" }]), null);
    assert.equal(pickLatestTag([]), null);
});

test("repoSlug: derives owner/repo from package.json repository", () => {
    assert.equal(repoSlug(), "contractpal/palsync");
});
