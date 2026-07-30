"use strict";
// `palsync doctor` judgment is a pure function of injected probe results — these tests never
// touch the real keychain, playwright, git, or gh. Invariants pinned here:
//   * every check is { name, status: ok|warn|fail, detail, remedy }
//   * doctor ALWAYS exits 0, whatever mix of statuses it finds (informational, never a gate)
//   * the keychain remedy is keychain.backendHint() verbatim (no duplicated hint text)
//   * the Node threshold/remedy derive from preflight (MIN_NODE_MAJOR / nodeMessage)
//   * git capability problems are warn at worst, never fail
//   * gh missing/unauthenticated is warn ONLY and the detail carries the "gh does not prevent
//     git push over HTTPS" caveat
//   * a LISTED keychain account whose password does not resolve is a warn, not an ok
//   * the report never prints a username/e-mail or a Chromium executable path
const { test } = require("node:test");
const assert = require("node:assert");
const { buildChecks, formatDoctor, runDoctor, parseRemotes, originHttpsHost, GH_CAVEAT } = require("../src/core/doctor");
const keychain = require("../src/platform/keychain");
const preflight = require("../src/preflight");

function goodProbes(overrides = {}) {
    return {
        nodeMajor: preflight.MIN_NODE_MAJOR + 2,
        nodeVersion: "v" + (preflight.MIN_NODE_MAJOR + 2) + ".0.0",
        nodeInstallMethod: "system",
        keychain: { ok: true },
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: 1, resolvable: 1 }],
        envPassword: false,
        chromium: { module: true, browser: true },
        git: { onPath: true,
               remotes: [{ name: "origin", url: "https://github.com/x/y.git" }],
               credential: { host: "github.com", filled: true } },
        gh: { onPath: true, authOk: true },
        ...overrides
    };
}

function byName(checks, name) {
    const c = checks.find(x => x.name === name);
    assert.ok(c, "missing check: " + name);
    return c;
}

test("doctor: every check has the {name,status,detail,remedy} shape; all ok on a healthy box", () => {
    const checks = buildChecks(goodProbes());
    assert.ok(checks.length >= 6);
    for (const c of checks) {
        assert.equal(typeof c.name, "string");
        assert.ok(["ok", "warn", "fail"].includes(c.status), c.name + " has bad status " + c.status);
        assert.equal(typeof c.detail, "string");
        assert.equal(typeof c.remedy, "string");
        assert.equal(c.status, "ok", c.name + " should be ok on a healthy box");
    }
});

test("doctor: Node below MIN_NODE_MAJOR fails with preflight's nodeMessage as the remedy", () => {
    const checks = buildChecks(goodProbes({ nodeMajor: preflight.MIN_NODE_MAJOR - 1, nodeVersion: "v12.0.0" }));
    const node = byName(checks, "node");
    assert.equal(node.status, "fail");
    assert.equal(node.remedy, preflight.nodeMessage("system")); // reused, not re-worded
    assert.match(node.detail, new RegExp(String(preflight.MIN_NODE_MAJOR)));
});

test("doctor: unreachable keychain warns with backendHint() verbatim and marks clouds uncheckable", () => {
    const checks = buildChecks(goodProbes({
        keychain: { ok: false, error: "OS keychain unavailable (list): no backend." },
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: null, resolvable: null }]
    }));
    const kc = byName(checks, "keychain");
    assert.equal(kc.status, "warn");
    assert.equal(kc.remedy, keychain.backendHint()); // verbatim — the hint lives in ONE place
    const cred = byName(checks, "credentials (Cloudpiston)");
    assert.equal(cred.status, "warn");
    assert.match(cred.remedy, /CP_PASS/);
});

test("doctor: no cached credentials warns and the remedy names `palsync setup`; CP_PASS soothes it", () => {
    const empty = buildChecks(goodProbes({
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: 0, resolvable: 0 }]
    }));
    const cred = byName(empty, "credentials (Cloudpiston)");
    assert.equal(cred.status, "warn");
    assert.match(cred.remedy, /`palsync setup`/); // the exact headless command, not a paraphrase
    assert.match(cred.remedy, /CP_PASS/);

    const withEnv = buildChecks(goodProbes({
        envPassword: true,
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: 0, resolvable: 0 }]
    }));
    const cred2 = byName(withEnv, "credentials (Cloudpiston)");
    assert.equal(cred2.status, "warn");
    assert.match(cred2.detail, /CP_PASS IS set/);
    assert.equal(cred2.remedy, "");
});

// The review finding: listUsernames() succeeding is NOT proof of a usable credential. A listed
// account whose secret no longer resolves must warn, or doctor reports "ok" for a login that will
// fail. Only counts are judged — the probe returns no usernames at all.
test("doctor: a listed but unresolvable keychain account warns instead of reporting ok", () => {
    const stale = byName(buildChecks(goodProbes({
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: 2, resolvable: 1 }]
    })), "credentials (Cloudpiston)");
    assert.equal(stale.status, "warn");
    assert.match(stale.detail, /1 of 2 cached account\(s\)/);
    assert.match(stale.detail, /stale keychain entry/);
    assert.match(stale.remedy, /`palsync setup`/);

    // Even with the global CP_PASS fallback set, a stale entry still warns — the keychain lie is
    // real and would surface later as a login failure.
    const staleWithEnv = byName(buildChecks(goodProbes({
        envPassword: true,
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: 1, resolvable: 0 }]
    })), "credentials (Cloudpiston)");
    assert.equal(staleWithEnv.status, "warn");

    // All listed accounts resolving is the only ok state, and it reports a COUNT, never a name.
    const good = byName(buildChecks(goodProbes({
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: 2, resolvable: 2 }]
    })), "credentials (Cloudpiston)");
    assert.equal(good.status, "ok");
    assert.match(good.detail, /2 cached account\(s\).*all resolve/);
});

test("doctor: the report never prints a username/e-mail or a Chromium executable path", () => {
    const { text } = runDoctor({ probes: goodProbes({
        clouds: [{ name: "Cloudpiston", url: "https://secure.cloudpiston.com", listed: 1, resolvable: 0 }]
    }) });
    assert.doesNotMatch(text, /@[a-z0-9.-]+\.[a-z]{2,}/i); // no e-mail-shaped account identifier
    assert.doesNotMatch(text, /chromium.*\//i);            // no executable path in the chromium row
    const ok = byName(buildChecks(goodProbes()), "chromium");
    assert.equal(ok.status, "ok");
    assert.equal(ok.detail, "Playwright + Chromium installed.");
});

test("doctor: Chromium remedies — module missing vs browser missing", () => {
    const noModule = byName(buildChecks(goodProbes({
        chromium: { module: false, browser: false }
    })), "chromium");
    assert.equal(noModule.status, "warn");
    assert.match(noModule.remedy, /npm i playwright && npx playwright install chromium/);

    const noBrowser = byName(buildChecks(goodProbes({
        chromium: { module: true, browser: false }
    })), "chromium");
    assert.equal(noBrowser.status, "warn");
    assert.equal(noBrowser.remedy, "npx playwright install chromium");
});

test("doctor: git capability problems warn but NEVER fail", () => {
    const offPath = buildChecks(goodProbes({ git: { onPath: false, remotes: null, credential: null } }));
    assert.equal(byName(offPath, "git").status, "warn");
    assert.ok(offPath.every(c => c.name.startsWith("git") ? c.status !== "fail" : true));

    const noRepo = buildChecks(goodProbes({ git: { onPath: true, remotes: null, credential: null } }));
    assert.equal(byName(noRepo, "git").status, "ok");
    assert.match(byName(noRepo, "git").detail, /not a git repository/);

    const unfilled = buildChecks(goodProbes({
        git: { onPath: true, remotes: [{ name: "origin", url: "https://github.com/x/y.git" }],
               credential: { host: "github.com", filled: false } }
    }));
    const cred = byName(unfilled, "git-credential");
    assert.equal(cred.status, "warn");
    assert.match(cred.remedy, /credential\.helper/);

    const ssh = buildChecks(goodProbes({
        git: { onPath: true, remotes: [{ name: "origin", url: "git@github.com:x/y.git" }],
               credential: { host: null, ssh: true } }
    }));
    assert.equal(byName(ssh, "git-credential").status, "ok");
});

// `git remote -v` prints a (fetch) and a (push) line per remote and the two URLs can differ
// (pushurl, or an https mirror fetched read-only). Credentials are needed for the PUSH URL, so the
// markers must be parsed — "first line wins" would probe the wrong host.
test("doctor: parseRemotes reads fetch/push markers and originHttpsHost prefers the push URL", () => {
    const remotes = parseRemotes([
        "origin\thttps://fetch.example.com/x/y.git (fetch)",
        "origin\thttps://push.example.com/x/y.git (push)",
        "upstream\thttps://github.com/u/y.git (fetch)",
        "upstream\thttps://github.com/u/y.git (push)"
    ].join("\n"));
    assert.deepEqual(remotes.map(r => r.name), ["origin", "upstream"]);
    const origin = remotes[0];
    assert.equal(origin.fetch, "https://fetch.example.com/x/y.git");
    assert.equal(origin.push, "https://push.example.com/x/y.git");
    assert.equal(originHttpsHost(remotes).host, "push.example.com");

    // https fetch mirror + ssh push URL: the credential-helper probe does not apply.
    const mixed = parseRemotes("origin\thttps://github.com/x/y.git (fetch)\norigin\tgit@github.com:x/y.git (push)");
    assert.deepEqual(originHttpsHost(mixed), { origin: "git@github.com:x/y.git", host: null, ssh: true });

    // Unmarked lines (older/odd output) still parse; both directions take the single URL.
    const bare = parseRemotes("origin\thttps://github.com/x/y.git");
    assert.equal(bare[0].push, "https://github.com/x/y.git");
    assert.equal(originHttpsHost(bare).host, "github.com");

    assert.deepEqual(originHttpsHost(parseRemotes("")), { origin: null, host: null, ssh: false });
    assert.deepEqual(originHttpsHost([{ name: "upstream", url: "https://github.com/u/y.git" }]),
        { origin: null, host: null, ssh: false });
});

test("doctor: gh missing or unauthenticated is warn only and the detail carries the push caveat", () => {
    assert.match(GH_CAVEAT, /does not prevent `git push`/);
    assert.match(GH_CAVEAT, /credential helper/);

    const missing = byName(buildChecks(goodProbes({ gh: { onPath: false, authOk: null } })), "gh");
    assert.equal(missing.status, "warn");
    assert.ok(missing.detail.includes(GH_CAVEAT));

    const stale = byName(buildChecks(goodProbes({ gh: { onPath: true, authOk: false } })), "gh");
    assert.equal(stale.status, "warn");
    assert.ok(stale.detail.includes(GH_CAVEAT));
});

test("doctor: runDoctor exits 0 with a mixed ok/warn/fail table", () => {
    const probes = goodProbes({
        nodeMajor: preflight.MIN_NODE_MAJOR - 1, nodeVersion: "v12.0.0",
        chromium: { module: true, browser: false },
        gh: { onPath: false, authOk: null }
    });
    const { checks, text, exitCode } = runDoctor({ probes });
    assert.equal(exitCode, 0); // informational — NEVER a gate
    const statuses = new Set(checks.map(c => c.status));
    assert.ok(statuses.has("ok") && statuses.has("warn") && statuses.has("fail"));
    assert.match(text, /palsync doctor/);
    assert.match(text, /✖ node/);
    assert.match(text, /npx playwright install chromium/);
});
