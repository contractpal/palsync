"use strict";
// `palsync doctor` — OFFLINE, informational environment health report. No login, no session,
// no lock, no workspace required: it must run anywhere (including outside a palsync workspace)
// and NEVER block anything — it prints a check table and always exits 0. Every check is
// { name, status: ok|warn|fail, detail, remedy }.
//
// Probe collection (collectProbes) is separated from judgment (buildChecks) so the judgment is
// a pure function of injected probe results — tests never touch the real keychain/git/gh.
const fs = require("fs");
const { spawnSync } = require("child_process");
const keychain = require("../platform/keychain");
const { commandOnPath } = require("../platform/commandOnPath");
const preflight = require("../preflight");

// Exact caveat for gh problems: gh is OPTIONAL for pushing. Git pushes over HTTPS using its own
// credential helper, so a missing/unauthenticated gh must never be read as "cannot push".
const GH_CAVEAT = "gh being unavailable does not prevent `git push` over HTTPS — Git's own " +
    "credential helper supplies credentials independently of gh.";

const PROBE_TIMEOUT_MS = 10_000;

// ---- Probe collection (impure: real keychain, playwright, git, gh) -------------------------

// `git remote -v` prints one line per direction: "<name>\t<url> (fetch)" and "<name>\t<url> (push)".
// The two URLs can differ (a read-only https fetch mirror with an ssh push URL, or the reverse via
// remote.<name>.pushurl), so the marker must be parsed — collapsing to "first line wins" would probe
// credentials for a host the user never pushes to.
function parseRemotes(stdout) {
    const byName = new Map();
    for (const raw of String(stdout || "").split("\n")) {
        const m = raw.trim().match(/^(\S+)\s+(\S+)(?:\s+\((fetch|push)\))?$/);
        if (!m) continue;
        const [, name, url, kind] = m;
        if (!byName.has(name)) byName.set(name, { name, fetch: null, push: null });
        const entry = byName.get(name);
        if (kind === "push") { if (!entry.push) entry.push = url; }
        else if (kind === "fetch") { if (!entry.fetch) entry.fetch = url; }
        else { if (!entry.fetch) entry.fetch = url; if (!entry.push) entry.push = url; }
    }
    // `url` is the credential-relevant one: pushing is what needs stored credentials.
    return [...byName.values()].map(e => Object.assign(e, { url: e.push || e.fetch }));
}

function originHttpsHost(remotes) {
    const origin = (remotes || []).find(r => r.name === "origin");
    const url = origin && (origin.push || origin.url || origin.fetch);
    if (!url) return { origin: null, host: null, ssh: false };
    if (/^https?:\/\//i.test(url)) {
        try { return { origin: url, host: new URL(url).host, ssh: false }; }
        catch (e) { return { origin: url, host: null, ssh: false }; }
    }
    return { origin: url, host: null, ssh: true };
}

function collectProbes({ env = process.env } = {}) {
    const probes = {};

    // Node runtime.
    probes.nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
    probes.nodeVersion = process.version;
    probes.nodeInstallMethod = preflight.detectNodeInstallMethod();

    // Keychain reachability + per-configured-cloud credential USABILITY. The configured clouds
    // are exactly what the login flow offers: DEFAULT_CLOUDS + ~/.palsync/config.json customClouds.
    //
    // A listed username is NOT proof of a usable credential: the keychain index can list an entry
    // whose secret was revoked/deleted out from under us, and `palsync` would then fail at login
    // with a report that said "ok". So each listed account is resolved through credentialStore
    // (the same resolver the real auth path uses) and only COUNTS come back — never a password,
    // never a username/email.
    //
    // PROBED IN A CHILD PROCESS WITH A TIMEOUT: on macOS an unauthorized binary makes the OS
    // pop a keychain authorization dialog that BLOCKS the synchronous native call — in a
    // headless/agent shell nobody can click it and doctor would hang forever. A killed child
    // degrades to "keychain unreachable" (listed: null) instead of hanging; doctor must stay
    // strictly non-interactive. EVERY keychain touch (list AND per-account resolve) happens
    // inside this timeboxed child for that reason.
    const { getClouds } = require("../auth/credentials");
    const cloudList = getClouds().map(c => ({ name: c.name, url: c.url }));
    const kcScript =
        "const k = require(" + JSON.stringify(require.resolve("../platform/keychain")) + ");" +
        "const cs = require(" + JSON.stringify(require.resolve("../auth/credentialStore")) + ");" +
        "const clouds = " + JSON.stringify(cloudList) + ";" +
        // CP_PASS is stripped for the per-account resolution: it is a GLOBAL fallback that would
        // answer for every account and hide a stale keychain entry. It is reported separately as
        // probes.envPassword. Scoped PALSYNC_PASSWORD_* vars stay in env because resolvePassword
        // only honours the one matching this exact (cloud, username) pair — an unrelated scoped
        // var must never read as "credentials fine".
        "const env = Object.assign({}, process.env); delete env.CP_PASS;" +
        "const out = { error: null, clouds: [] };" +
        "for (const c of clouds) {" +
        "  try {" +
        "    const users = k.listUsernames(c.url);" +
        "    let resolvable = 0;" +
        "    for (const u of users) {" +
        "      try { if (cs.resolvePassword(c.url, u, { env }).password) resolvable++; } catch (e) { /* unusable */ }" +
        "    }" +
        "    out.clouds.push({ url: c.url, listed: users.length, resolvable: resolvable });" +
        "  } catch (e) { if (!out.error) out.error = (e && e.message) ? e.message : String(e);" +
        "              out.clouds.push({ url: c.url, listed: null, resolvable: null }); }" +
        "}" +
        "process.stdout.write(JSON.stringify(out));";
    const kc = spawnSync(process.execPath, ["-e", kcScript], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
    let kcResult = null;
    if (kc.status === 0 && kc.stdout) { try { kcResult = JSON.parse(kc.stdout); } catch (e) { /* garbled */ } }
    if (kcResult) {
        const byUrl = new Map(kcResult.clouds.map(c => [c.url, c]));
        probes.clouds = cloudList.map(c => {
            const r = byUrl.get(c.url);
            return { name: c.name, url: c.url,
                listed: r && Number.isFinite(r.listed) ? r.listed : null,
                resolvable: r && Number.isFinite(r.resolvable) ? r.resolvable : null };
        });
        probes.keychain = kcResult.error ? { ok: false, error: kcResult.error } : { ok: true };
    } else {
        probes.clouds = cloudList.map(c => ({ name: c.name, url: c.url, listed: null, resolvable: null }));
        probes.keychain = { ok: false, error: kc.signal
            ? "Keychain probe timed out after " + PROBE_TIMEOUT_MS + "ms — the OS is likely waiting on a keychain authorization prompt this shell cannot show."
            : "Keychain probe failed (" + (kc.stderr || "no output").toString().trim().split("\n")[0] + ")." };
    }
    // ONLY CP_PASS — the global, account-agnostic fallback. A PALSYNC_PASSWORD_* var is scoped to
    // one (cloud, username) pair; an unrelated one proves nothing about this account, so it is
    // never counted here (it is honoured per-account by resolvePassword in the probe above).
    probes.envPassword = Boolean(env.CP_PASS);

    // Playwright/Chromium (screenshot/exercise capability). executablePath() never launches.
    const { loadChromium } = require("./screenshot");
    const chromium = loadChromium();
    if (!chromium) {
        probes.chromium = { module: false, browser: false };
    } else {
        // The resolved executable path is used for the existence test and then DROPPED: it is a
        // local filesystem path (often under the user's home) and the report is meant to be safe
        // to paste into an issue.
        let exists = false;
        try { const execPath = chromium.executablePath(); exists = Boolean(execPath) && fs.existsSync(execPath); }
        catch (e) { /* treat as browser missing */ }
        probes.chromium = { module: true, browser: exists };
    }

    // git: on PATH, remotes of the current directory (doctor may run outside any repo), and a
    // non-interactive credential-helper probe against the https origin host. Probed separately
    // from gh on purpose — git's HTTPS helper works without gh.
    const gitOnPath = commandOnPath("git");
    let remotes = null, credential = null;
    if (gitOnPath) {
        const rv = spawnSync("git", ["remote", "-v"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
        if (rv.status === 0) {
            remotes = parseRemotes(rv.stdout);
            const { host, ssh } = originHttpsHost(remotes);
            if (host) {
                // GIT_TERMINAL_PROMPT=0 + GIT_ASKPASS=echo: helpers may answer, but git can
                // never prompt a human. An empty askpass answer yields an empty password line.
                const fill = spawnSync("git", ["credential", "fill"], {
                    input: "protocol=https\nhost=" + host + "\n\n",
                    encoding: "utf8", timeout: PROBE_TIMEOUT_MS,
                    env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" }
                });
                credential = { host, filled: fill.status === 0 && /(^|\n)password=.+/.test(fill.stdout || "") };
            } else if (ssh) {
                credential = { host: null, ssh: true };
            }
        }
    }
    probes.git = { onPath: gitOnPath, remotes, credential };

    // gh: optional. Auth state read via `gh auth status` exit code only.
    const ghOnPath = commandOnPath("gh");
    let authOk = null;
    if (ghOnPath) {
        const r = spawnSync("gh", ["auth", "status"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
        authOk = r.status === 0;
    }
    probes.gh = { onPath: ghOnPath, authOk };

    return probes;
}

// ---- Judgment (pure function of probe results) ----------------------------------------------

function buildChecks(probes) {
    const checks = [];

    // Node — threshold derives from preflight's MIN_NODE_MAJOR; the remedy IS preflight's
    // nodeMessage (same guidance the launcher prints), not a re-worded copy.
    if (probes.nodeMajor >= preflight.MIN_NODE_MAJOR) {
        checks.push({ name: "node", status: "ok",
            detail: "Node " + probes.nodeVersion + " (needs >= " + preflight.MIN_NODE_MAJOR + ")", remedy: "" });
    } else {
        checks.push({ name: "node", status: "fail",
            detail: "Node " + probes.nodeVersion + " is below the required major " + preflight.MIN_NODE_MAJOR + ".",
            remedy: preflight.nodeMessage(probes.nodeInstallMethod) });
    }

    // Keychain reachability — the remedy is keychain.backendHint() verbatim (single source of
    // the platform-specific unlock guidance; never duplicated here).
    if (probes.keychain.ok) {
        checks.push({ name: "keychain", status: "ok", detail: "OS keychain reachable.", remedy: "" });
    } else {
        checks.push({ name: "keychain", status: "warn",
            detail: probes.keychain.error, remedy: keychain.backendHint() });
    }

    // Per configured cloud: cached credentials that ACTUALLY RESOLVE. Counts only — usernames and
    // e-mail addresses are never printed (the report is meant to be pasteable).
    const CP_PASS_NOTE = " (CP_PASS IS set — headless auth will work).";
    for (const cloud of probes.clouds) {
        const name = "credentials (" + cloud.name + ")";
        const resolvable = Number(cloud.resolvable) || 0;
        if (cloud.listed === null) {
            checks.push({ name, status: "warn",
                detail: "Keychain unavailable — cannot check cached credentials for " + cloud.url +
                    (probes.envPassword ? CP_PASS_NOTE : "."),
                remedy: probes.envPassword ? "" :
                    "Set CP_PASS (or a PALSYNC_PASSWORD_* variable scoped to the account) and use `palsync setup` for headless use, or fix the keychain above." });
        } else if (cloud.listed === 0) {
            checks.push({ name, status: "warn",
                detail: "No cached credentials for " + cloud.url +
                    (probes.envPassword ? CP_PASS_NOTE : "."),
                remedy: probes.envPassword ? "" :
                    "Run `palsync` once to log in (stores the password in the OS keychain), or set CP_PASS and run `palsync setup` for headless use." });
        } else if (resolvable >= cloud.listed) {
            checks.push({ name, status: "ok",
                detail: cloud.listed + " cached account(s) for " + cloud.url + "; all resolve to a usable password.",
                remedy: "" });
        } else {
            // Listed but unreadable: the keychain index still advertises the account while the
            // secret is gone. Reporting the listing alone as "ok" is exactly the lie this warns
            // about — login would fail later with no warning here.
            checks.push({ name, status: "warn",
                detail: (cloud.listed - resolvable) + " of " + cloud.listed + " cached account(s) for " + cloud.url +
                    " are listed but their password could not be read (stale keychain entry)" +
                    (probes.envPassword ? CP_PASS_NOTE : "."),
                remedy: "Run `palsync` once to log in again (rewrites the keychain entry), or set CP_PASS " +
                    "(or a PALSYNC_PASSWORD_* variable scoped to that account) and run `palsync setup` for headless use." });
        }
    }

    // Chromium (screenshot / exercise / visual review capability).
    if (!probes.chromium.module) {
        checks.push({ name: "chromium", status: "warn",
            detail: "The playwright module is not installed — screenshot/exercise fall back to the human eyeball gate.",
            remedy: "npm i playwright && npx playwright install chromium" });
    } else if (!probes.chromium.browser) {
        checks.push({ name: "chromium", status: "warn",
            detail: "Playwright is installed but its Chromium browser is not.",
            remedy: "npx playwright install chromium" });
    } else {
        // No executable path here — a local filesystem path leaks the user's home layout and adds
        // nothing to the verdict.
        checks.push({ name: "chromium", status: "ok",
            detail: "Playwright + Chromium installed.", remedy: "" });
    }

    // git — capability information only: warn at worst, NEVER fail (git problems don't block
    // palsync's own push/pull, which talk to the PalBuilder server, not git).
    if (!probes.git.onPath) {
        checks.push({ name: "git", status: "warn", detail: "git was not found on PATH.",
            remedy: "Install git (https://git-scm.com/downloads) if you use the local checkpoint workflow." });
        checks.push({ name: "git-credential", status: "warn", detail: "Skipped — git is not on PATH.", remedy: "" });
    } else if (probes.git.remotes === null) {
        checks.push({ name: "git", status: "ok",
            detail: "git on PATH; current directory is not a git repository (remote probe skipped).", remedy: "" });
        checks.push({ name: "git-credential", status: "ok",
            detail: "Skipped — no repository here to read an origin remote from.", remedy: "" });
    } else {
        const names = probes.git.remotes.map(r => r.name);
        checks.push({ name: "git", status: "ok",
            detail: "git on PATH; remotes: " + (names.length ? names.join(", ") : "(none)") + ".", remedy: "" });
        const cred = probes.git.credential;
        if (!cred) {
            checks.push({ name: "git-credential", status: "ok",
                detail: "Skipped — no https origin remote to probe.", remedy: "" });
        } else if (cred.ssh) {
            checks.push({ name: "git-credential", status: "ok",
                detail: "origin uses SSH — the HTTPS credential-helper probe does not apply.", remedy: "" });
        } else if (cred.filled) {
            checks.push({ name: "git-credential", status: "ok",
                detail: "Git's credential helper supplied credentials for " + cred.host + ".", remedy: "" });
        } else {
            checks.push({ name: "git-credential", status: "warn",
                detail: "No stored HTTPS credentials for " + cred.host + " (probed non-interactively via `git credential fill`).",
                remedy: "Push once interactively to cache credentials, or configure a helper: git config --global credential.helper <helper>." });
        }
    }

    // gh — optional; missing or unauthenticated is warn ONLY, and the detail always carries the
    // caveat so nobody concludes "gh broken -> cannot push".
    if (!probes.gh.onPath) {
        checks.push({ name: "gh", status: "warn",
            detail: "GitHub CLI (gh) was not found on PATH. " + GH_CAVEAT,
            remedy: "Optional: install gh (https://cli.github.com/) and run `gh auth login`." });
    } else if (probes.gh.authOk === false) {
        checks.push({ name: "gh", status: "warn",
            detail: "gh is installed but `gh auth status` failed (stale or missing auth). " + GH_CAVEAT,
            remedy: "Optional: run `gh auth login` to refresh gh's own auth." });
    } else {
        checks.push({ name: "gh", status: "ok", detail: "gh on PATH and authenticated.", remedy: "" });
    }

    return checks;
}

// ---- Rendering + entry -----------------------------------------------------------------------

const ICONS = { ok: "✔", warn: "⚠", fail: "✖" };

function formatDoctor(checks) {
    const nameW = Math.max(...checks.map(c => c.name.length), 4);
    const lines = ["palsync doctor — offline environment report (informational; always exits 0)", ""];
    for (const c of checks) {
        lines.push(ICONS[c.status] + " " + c.name.padEnd(nameW) + "  " + c.status.padEnd(4) + "  " + c.detail);
        if (c.status !== "ok" && c.remedy) {
            for (const r of String(c.remedy).split("\n")) lines.push(" ".repeat(nameW + 12) + r);
        }
    }
    return lines.join("\n");
}

// Always exit 0 — doctor informs, it never gates.
function runDoctor({ probes } = {}) {
    const checks = buildChecks(probes || collectProbes());
    return { checks, text: formatDoctor(checks), exitCode: 0 };
}

module.exports = { runDoctor, collectProbes, buildChecks, formatDoctor, parseRemotes, originHttpsHost, GH_CAVEAT };
