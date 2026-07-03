"use strict";
// The palsync MCP tools. Each `run(ctx, args)` is a plain async function (so it's directly
// testable); server.js wraps them for the MCP SDK. ctx = { session, record, workspaceDir,
// lifecycle, persist() }. Datasets/dataviews are never created or destroyed by any tool.
const { z } = require("zod");
const { pull } = require("../core/pull");
const { push } = require("../core/push");
const { runTest } = require("../core/test");
const { runPreview, fetchPagePath, checkExpect, extractSelector } = require("../core/preview");
const { runScreenshot } = require("../core/screenshot");
const { mergeWorkspace, formatMerge } = require("../core/merge");
const { runSeoAudit, formatSeoAudit } = require("../core/seoAudit");
const { runRegression } = require("../core/regression");
const { lintSpec, formatSpecLint } = require("../core/specLint");
const { syncDatasets } = require("../core/datasets");
const { validateWorkspace, formatValidation: formatLint } = require("../core/validate");
const { openUrl } = require("../platform/openUrl");
const fs = require("fs");
const os = require("os");
const pathMod = require("path");

// How much rendered HTML to inline in the tool result before pointing the agent at the full
// file. Enough to see structure + content without flooding a small model's context.
const PREVIEW_INLINE_CAP = 12000;
const lock = require("../core/lock");
const drift = require("../core/drift");
const { resolveServerPalByGuid } = require("../core/resolve");
const { hashWorkspace, hashPaths } = require("../core/workspaceHash");
const { diffWorkspace, describeDiff } = require("../core/localDrift");

// Refresh the record's local baseline after a pull/push: localHash (legacy combined hash) +
// fileHashes (per-file map over exactly the server-tracked paths — preserved local-only files
// must NOT enter it, or the next pull would mistake them for server-side deletes).
function refreshBaseline(record, workspaceDir, serverPaths) {
    record.localHash = hashWorkspace(workspaceDir);
    if (serverPaths) record.fileHashes = hashPaths(workspaceDir, serverPaths);
}

function nowIso() { return new Date().toISOString(); }

// Print the FULL text of every server validation note (group/object: message), not just a count —
// a count hides content-affecting warnings (e.g. a page with no body tag that won't save).
function formatValidation(notes) {
    if (!notes || !notes.length) return "No validation notes.";
    return "Server validation notes (" + notes.length + "):\n" +
        notes.map(v => "   - " + (v.group || "?") + "/" + (v.object || "(general)") + ": " + v.message).join("\n");
}

// Token-efficient verification message: the per-string verdict, never the page body. `meta`
// carries the response facts (status, bytes) the agent still needs to trust the result.
function formatExpect(headline, meta, chk) {
    const misses = chk.results.filter(r => !r.found).length;
    const lines = [headline + " — status=" + meta.status + " size=" + meta.bytes + " bytes. " +
        (chk.pass ? "ALL " + chk.results.length + " expected string(s) found." : misses + " of " + chk.results.length + " expected string(s) MISSING.")];
    for (const r of chk.results) lines.push("   " + (r.found ? "✓ found" : "✗ MISSING") + " " + JSON.stringify(r.string) + (r.found ? "  @ " + r.matchedLine : ""));
    return lines.join("\n");
}

// Build a capped-inline + full-file-on-disk HTML result, optionally narrowed to one region by a
// simple selector. Shared by pal_fetch and pal_preview's selector/maxChars modes.
function htmlRegionResult(res, { headline, filePrefix, guid, selector, maxChars, extraLine = "", dirtyNote = "" }) {
    let body = res.html, missSel = false;
    if (selector) { const region = extractSelector(res.html, selector); if (region == null) { missSel = true; body = ""; } else body = region; }
    let filePath = null;
    try {
        filePath = pathMod.join(os.tmpdir(), filePrefix + guid.replace(/[^A-Za-z0-9_-]/g, "") + ".html");
        fs.writeFileSync(filePath, body, "utf8");
    } catch (e) { /* best-effort */ }
    const cap = maxChars && maxChars > 0 ? maxChars : PREVIEW_INLINE_CAP;
    const truncated = body.length > cap;
    const shown = truncated ? body.slice(0, cap) : body;
    const selNote = selector
        ? (missSel ? "\n  selector " + JSON.stringify(selector) + " matched nothing — drop it to see the full page."
                   : "\n  selector " + JSON.stringify(selector) + " -> " + body.length + " bytes extracted")
        : "";
    const safe = Object.assign({}, res); delete safe.html;
    return Object.assign(safe, {
        htmlFile: missSel ? null : filePath,
        message: headline + " — status=" + res.status + " content-type=" + res.contentType +
            " title=" + JSON.stringify(res.title) + " size=" + res.bytes + " bytes" + extraLine + selNote + dirtyNote +
            (missSel ? "" : (filePath ? "\n  Full " + (selector ? "region" : "body") + " saved to: " + filePath : "") +
                "\n\n--- " + (selector ? "selected markup" : "served body") +
                (truncated ? " (first " + cap + " of " + body.length + " bytes — read the file for the rest)" : "") + " ---\n" + shown)
    });
}

// High-friction override: the user must type this EXACT phrase, echoing the pal name, so it can't
// be passed casually. (Lock-Force itself is still disabled pending verification — see core/lock.)
function overridePhrase(palName) { return "OVERRIDE " + palName; }

// Build an honest, owner-aware message for a blocked lock. Never implies "probably you" unless
// teamInfo actually shows the owner is us.
function blockedMessage(blocked, info, palName) {
    if (blocked === "gui-lock-self") {
        return "This pal is locked — you have \"" + palName + "\" checked out in PalBuilder (since " + info.since + ").\n" +
            "Unlock and close it in PalBuilder, then re-run palsync.";
    }
    if (blocked === "gui-lock-other") {
        return "This pal is locked by " + info.holder + " (since " + info.since + ").\n" +
            "They must unlock and close it in PalBuilder. Overriding may DESTROY their unsaved work.";
    }
    if (blocked === "override-disabled") {
        return "Override is not enabled in this build — palsync has not verified that force-override " +
            "safely breaks a PalBuilder lock, and breaking one can destroy unsaved work.\n" +
            "Unlock and close it in PalBuilder instead. (Held by " + info.holder + " since " + info.since + ".)";
    }
    // unknown-holder
    return "This pal is locked and palsync can't determine the holder (the server did not report it).\n" +
        "Unlock and close it in PalBuilder, then re-run palsync. Overriding may destroy another user's unsaved work.";
}

// Append the typed-OVERRIDE instructions when the user hasn't confirmed yet.
function withOverrideGate(message, confirmOverride, palName) {
    if (confirmOverride === overridePhrase(palName)) return message;
    return message + "\n\nThis will NOT proceed without an explicit typed confirmation. To override, " +
        "call again with EXACTLY:\n  confirmOverride: \"" + overridePhrase(palName) + "\"";
}

const TOOLS = [
    {
        name: "pal_status",
        description: "Report whether the server is newer than your last pull, and who holds the lock (read-only).",
        inputShape: {},
        async run(ctx) {
            const live = await resolveServerPalByGuid(ctx.session, ctx.record.palGuid);
            const serverNewer = live ? drift.serverAdvanced(ctx.record.lastModifiedDate, live.lastModifiedDate) : false;
            const st = await lock.statusByGuid(ctx.session, ctx.record.palGuid); // read-only — no lock attempt
            let lockMsg;
            if (!st.locked) lockMsg = "not locked";
            else if (st.kind === "gui") lockMsg = (st.byUs ? "checked out by you in PalBuilder" : "locked by " + st.holder) + " since " + st.since;
            else lockMsg = "held by this palsync session";
            // Both directions: server-vs-last-pull (above) AND disk-vs-last-pull (below).
            const d = diffWorkspace(ctx.record, ctx.workspaceDir);
            const localMsg = (d.dirty || d.added.length)
                ? "Local: UN-PUSHED changes on disk —\n" + describeDiff(d)
                : "Local: no un-pushed changes.";
            const message =
                "Pal: " + ctx.record.palName + " (" + ctx.record.palGuid + ")\n" +
                (serverNewer ? "Server IS NEWER than your last pull — run pal_pull before pushing.\n" : "In sync with your last pull.\n") +
                "  your marker  : " + ctx.record.lastModifiedDate + "\n" +
                "  server marker: " + (live ? live.lastModifiedDate : "(unknown)") + "\n" +
                localMsg + "\n" +
                "Lock: " + lockMsg;
            return { message, serverNewer, storedMarker: ctx.record.lastModifiedDate, liveMarker: live && live.lastModifiedDate,
                     localChanges: { dirty: d.dirty, changed: d.changed, added: d.added, deleted: d.deleted }, lock: st };
        }
    },
    {
        name: "pal_validate",
        description: "Check the pal's code OFFLINE (no server/network) for mistakes that silently break in PalBuilder: invalid workflow JS (object literals, let/const, ES6 the restricted engine rejects) and invalid markup (unclosed void tags, undocumented c: attributes, ${} in inline <script>, DOMContentLoaded in fragments). Returns each finding's file, line, ERROR/WARNING label, and the fix. Run BEFORE pal_push to catch problems early (pal_push runs it too and refuses on errors).",
        // Fully offline + read-only: validateWorkspace lints local files (fs/acorn only — no
        // CloudPiston call, no lock). Opt out of the ctx/login/lock lifecycle. The lifecycle guard
        // below already no-ops when ctx has no lifecycle, so the bare { workspaceDir } ctx is safe.
        needsCtx: false,
        inputShape: {},
        async run(ctx) {
            const lint = validateWorkspace(ctx.workspaceDir);
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            return Object.assign({ ran: true }, lint, { message: formatLint(lint, { context: "validate" }) });
        }
    },
    {
        name: "pal_test",
        description: "Validate a workflow ON THE SERVER and open a live preview in the user's browser; returns the server's validation notes. The preview URL carries the user's credentials, is NEVER returned to you, and you CANNOT see the rendered page — ask the user if you need to know. Use after a push to confirm the workflow runs server-side. (Offline code check that needs no push: pal_validate.)",
        inputShape: {
            workflow: z.enum(["console", "web", "transaction"]).optional(),
            workflowName: z.string().optional(),
            preview: z.boolean().optional()
        },
        async run(ctx, { workflow, workflowName, preview = true } = {}) {
            const res = await runTest(ctx.session, ctx.record.palGuid, { kind: workflow, workflowName });
            if (ctx.lifecycle) ctx.lifecycle.onActivity(); // pal_test takes the lock — re-arm idle
            if (!res.ran) {
                if (res.blocked === "no-testable-workflow") {
                    return { ran: false, message: "No runnable workflow to test on this pal (need a console/web/transaction workflow)." };
                }
                if (res.blocked === "no-lock" || /lock/.test(res.blocked || "")) {
                    return { ran: false, message: "Couldn't acquire the lock to test (" + res.blocked + (res.holder ? ", held by " + res.holder : "") + ")." };
                }
                return { ran: false, message: "Test could not run (" + (res.blocked || "unknown") + ")." };
            }
            // Open the live preview locally if it validated — the URL carries the credential, so
            // it is NEVER put in the tool result. The agent only learns that it opened.
            let previewMsg;
            if (res._previewUrl && preview) {
                const opened = await openUrl(res._previewUrl);
                previewMsg = opened.opened
                    ? "Live preview opened in your browser" + (res.kind === "console" ? " (the console pal renders inside the CloudPiston console shell)." : ".")
                    : "Live preview URL is ready but the browser couldn't be opened automatically (" + opened.reason + ") — it carries your credentials, so it isn't shown here; re-run on a desktop session.";
            } else if (res._previewUrl) {
                previewMsg = "Live preview available (preview:false set — not opened).";
            } else {
                previewMsg = "No live preview — the workflow did not validate (fix the notes above, push, and test again).";
            }
            const verdict = res.validated
                ? "✅ " + res.kind + " workflow VALIDATED on the server."
                : "❌ " + res.kind + " workflow did NOT validate.";
            // Server-level messages (e.g. "Pal is not a Web Pal") explain a whole-test failure that
            // never shows up in per-rule validation notes — surface them or the real cause is lost.
            const serverMsgs = (res.messages || []).filter(m => m && m.message);
            const msgText = serverMsgs.length
                ? "Server message(s):\n" + serverMsgs.map(m => "   - " + (m.type ? m.type + ": " : "") + m.message).join("\n") + "\n"
                : "";
            const message = "Tested " + ctx.record.palName + " (" + res.kind + ").\n" +
                verdict + "\n" + msgText + formatValidation(res.validation) + "\n" + previewMsg +
                (res.availableKinds.length > 1 ? "\n(testable engines on this pal: " + res.availableKinds.join(", ") + ")" : "");
            // Strip the credential URL before returning — defense in depth.
            const safe = Object.assign({}, res); delete safe._previewUrl;
            return Object.assign(safe, { message });
        }
    },
    {
        name: "pal_preview",
        description: "See what the pal RENDERS. WEB pal: pass expect:[strings] for a found/missing verdict (token-efficient default), or selector/maxChars for markup; full HTML otherwise. CONSOLE/transaction pal: opens in the user's browser and you will NOT see it (ask the user). Shows the LAST PUSHED version — pal_push first. (Pass/fail: pal_test; offline check: pal_validate.)",
        inputShape: {
            workflow: z.enum(["console", "web", "transaction"]).optional(),
            expect: z.array(z.string()).optional().describe("Strings the rendered page must contain — returns a per-string found/missing verdict instead of the HTML (the default, token-efficient check)."),
            selector: z.string().optional().describe("Simple CSS selector (tag/.class/#id) to return only that region's markup."),
            maxChars: z.number().optional().describe("Cap the returned markup to this many characters.")
        },
        async run(ctx, { workflow, expect, selector, maxChars } = {}) {
            const res = await runPreview(ctx.session, ctx.record.palGuid, ctx.record, ctx.workspaceDir, { workflow });
            if (ctx.lifecycle) ctx.lifecycle.onActivity(); // preview takes the lock — re-arm idle
            const dirtyNote = res.dirty
                ? "\n⚠ You have un-pushed local changes (" + (res.dirtyFiles || []).join(", ") + "). This preview shows the LAST PUSHED version, NOT your current edits — run pal_push, then pal_preview again to see them."
                : "";
            if (!res.previewed) {
                if (res.validated === false) {
                    return Object.assign(res, { message: "Cannot preview — the pal did not validate on the server:\n" + formatValidation(res.validation) + "\n" + res.reason + dirtyNote });
                }
                return Object.assign(res, { message: "Cannot preview: " + res.reason + dirtyNote });
            }
            if (res.kind === "web" && res.agentVisible) {
                // Token-efficient default: verify expected strings, never return the page body.
                if (expect && expect.length) {
                    const chk = checkExpect(res.html, expect);
                    const safe = Object.assign({}, res); delete safe.html;
                    return Object.assign(safe, { pass: chk.pass, results: chk.results,
                        message: formatExpect("WEB preview (" + res.url + ")", { status: res.status, bytes: res.bytes }, chk) + dirtyNote });
                }
                // Narrowed markup: one region and/or a char cap when the agent genuinely needs HTML.
                if (selector || maxChars) {
                    return htmlRegionResult(res, { headline: "WEB preview rendered", filePrefix: "palsync-preview-", guid: ctx.record.palGuid, selector, maxChars, dirtyNote });
                }
                // Save the full HTML to a file the agent can Read, and inline a capped slice.
                let filePath = null;
                try {
                    filePath = pathMod.join(os.tmpdir(), "palsync-preview-" + ctx.record.palGuid.replace(/[^A-Za-z0-9_-]/g, "") + ".html");
                    fs.writeFileSync(filePath, res.html, "utf8");
                } catch (e) { /* best-effort */ }
                const truncated = res.html.length > PREVIEW_INLINE_CAP;
                const shown = truncated ? res.html.slice(0, PREVIEW_INLINE_CAP) : res.html;
                const safe = Object.assign({}, res); delete safe.html; // don't double-include in structured result
                return Object.assign(safe, {
                    htmlFile: filePath,
                    message: "WEB preview rendered — this is your pal's actual server-rendered HTML output.\n" +
                        "  url=" + res.url + "  content-type=" + res.contentType + "  title=" + JSON.stringify(res.title) + "  size=" + res.bytes + " bytes" + dirtyNote +
                        (filePath ? "\n  Full HTML saved to: " + filePath + " (Read it to inspect the whole page)." : "") +
                        "\n\n--- rendered HTML" + (truncated ? " (first " + PREVIEW_INLINE_CAP + " of " + res.bytes + " bytes — read the file for the rest)" : "") + " ---\n" + shown
                });
            }
            // console/transaction — open in the user's browser; the agent cannot see it.
            let opened = { opened: false };
            if (res._previewUrl) opened = await openUrl(res._previewUrl);
            const safe = Object.assign({}, res); delete safe._previewUrl;
            return Object.assign(safe, {
                message: (opened.opened ? "Opened the preview in the user's browser. " : "Could not open a browser automatically (" + opened.reason + "). ") +
                    res.reason + dirtyNote
            });
        }
    },
    {
        name: "pal_fetch",
        description: "Verify ONE page of a WEB pal renders. DEFAULT: pass expect:[strings] for a per-string found/missing verdict WITHOUT the body — the token-efficient post-push check. A successful push does NOT prove render (files missing from pal.json are silently skipped); this does. selector/maxChars return markup instead. path is site-root-relative, e.g. \"about.html\". Shows the LAST PUSHED version.",
        inputShape: {
            path: z.string().describe("Page path relative to the site root, e.g. \"about.html\""),
            expect: z.array(z.string()).optional().describe("Strings the served page must contain — returns a per-string found/missing verdict instead of the HTML (the default, token-efficient check)."),
            selector: z.string().optional().describe("Simple CSS selector (tag/.class/#id) to return only that region's markup."),
            maxChars: z.number().optional().describe("Cap the returned markup to this many characters.")
        },
        async run(ctx, { path, expect, selector, maxChars } = {}) {
            const res = await fetchPagePath(ctx.session, ctx.record.palGuid, path);
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            if (!res.fetched) {
                return Object.assign(res, { message: "Could not fetch \"" + path + "\": " + res.reason + (res.validation ? "\n" + formatValidation(res.validation) : "") });
            }
            // Token-efficient default: verify expected strings, never return the page body.
            if (expect && expect.length) {
                const chk = checkExpect(res.html, expect);
                const safe = Object.assign({}, res); delete safe.html;
                return Object.assign(safe, { pass: chk.pass, results: chk.results,
                    message: formatExpect("Fetched " + path, { status: res.status, bytes: res.bytes }, chk) });
            }
            if (selector || maxChars) {
                return htmlRegionResult(res, { headline: "Fetched " + path, filePrefix: "palsync-fetch-", guid: ctx.record.palGuid, selector, maxChars });
            }
            let filePath = null;
            try {
                filePath = pathMod.join(os.tmpdir(), "palsync-fetch-" + ctx.record.palGuid.replace(/[^A-Za-z0-9_-]/g, "") + ".html");
                fs.writeFileSync(filePath, res.html, "utf8");
            } catch (e) { /* best-effort */ }
            const truncated = res.html.length > PREVIEW_INLINE_CAP;
            const shown = truncated ? res.html.slice(0, PREVIEW_INLINE_CAP) : res.html;
            const safe = Object.assign({}, res); delete safe.html;
            return Object.assign(safe, {
                htmlFile: filePath,
                message: "Fetched " + path + " — status=" + res.status + " content-type=" + res.contentType +
                    " title=" + JSON.stringify(res.title) + " size=" + res.bytes + " bytes" +
                    (filePath ? "\n  Full body saved to: " + filePath : "") +
                    "\n\n--- served body" + (truncated ? " (first " + PREVIEW_INLINE_CAP + " bytes — read the file for the rest)" : "") + " ---\n" + shown
            });
        }
    },
    {
        name: "pal_screenshot",
        description: "Render a pal's screen in a headless browser and return a PNG so you can judge its UI/UX visually (pal-review's visual arm). Acts on the LAST PUSHED version — pal_push first. " +
            "Options: page (WEB only — path under the site root, e.g. \"about.html\"; default home), viewport (\"desktop\" 1280x800 default, or \"mobile\" ~390x844), fullPage (whole scroll height). " +
            "WEB pals render directly; CONSOLE/transaction pals render via authenticated replay. If auth fails, or the runtime lacks Playwright/Chromium, it returns a clean unavailable signal (review falls back to the human eyeball gate) — never a blank or fake image.",
        inputShape: {
            page: z.string().optional().describe("Page path under the site root, e.g. \"about.html\". Default: home page."),
            viewport: z.enum(["desktop", "mobile"]).optional(),
            fullPage: z.boolean().optional()
        },
        async run(ctx, { page, viewport, fullPage } = {}) {
            const res = await runScreenshot(ctx.session, ctx.record.palGuid, { page, viewport, fullPage });
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            if (!res.captured) {
                return Object.assign(res, {
                    message: (res.available === false ? "Screenshot unavailable: " : "Could not screenshot: ") + res.reason +
                        (res.validation ? "\n" + formatValidation(res.validation) : "")
                });
            }
            // Save the PNG to a file the harness can Read, and return MCP image content so a
            // vision-capable model sees the render inline.
            let filePath = null;
            try {
                filePath = pathMod.join(os.tmpdir(), "palsync-screenshot-" + ctx.record.palGuid.replace(/[^A-Za-z0-9_-]/g, "") + "-" + res.viewportName + ".png");
                fs.writeFileSync(filePath, Buffer.from(res.pngBase64, "base64"));
            } catch (e) { /* best-effort */ }
            const text = (res.kind ? res.kind.toUpperCase() : "WEB") + " screenshot captured — " + res.viewportName + " " + res.viewport.width + "x" + res.viewport.height +
                (fullPage ? " (full page)" : "") + "\n  url=" + res.url +
                (filePath ? "\n  PNG saved to: " + filePath : "");
            const safe = Object.assign({}, res); delete safe.pngBase64; // don't double-include the base64 blob
            return Object.assign(safe, {
                pngFile: filePath,
                message: text,
                content: [
                    { type: "text", text },
                    { type: "image", data: res.pngBase64, mimeType: "image/png" }
                ]
            });
        }
    },
    {
        name: "pal_seo_audit",
        description: "Run an on-page SEO audit of a WEB pal's actual server-rendered page (last pushed). " +
            "Checks title + meta description, canonical, the 5 core og: tags with ABSOLUTE og:image/og:url, twitter:card, " +
            "exactly one H1, viewport, JSON-LD, img alt, non-ASCII in meta attributes (a PalBuilder server flag), and " +
            "robots.txt/sitemap.xml/llms.txt (homepage-HTML fallthrough, content-type, required content). " +
            "Returns each problem as a sentence with the exact fix, plus the checks that PASSED. " +
            "Use after pushing a web page; fix every ERROR. Not for console pals (behind login — not crawled). " +
            "Read the seo-core skill BEFORE writing web-page heads; this tool verifies the result.",
        inputShape: {},
        async run(ctx) {
            const res = await runSeoAudit(ctx.session, ctx.record.palGuid, ctx.record, ctx.workspaceDir);
            if (ctx.lifecycle) ctx.lifecycle.onActivity(); // audit takes the lock via preview — re-arm idle
            if (!res.audited) {
                return Object.assign(res, { message: "SEO audit could not run: " + res.reason +
                    (res.validation && res.validation.length ? "\n" + formatValidation(res.validation) : "") });
            }
            const dirtyNote = res.dirty
                ? "\n⚠ You have un-pushed local changes (" + (res.dirtyFiles || []).join(", ") + "). This audit reflects the LAST PUSHED version — pal_push, then audit again to check your latest edits."
                : "";
            return Object.assign(res, { message: formatSeoAudit(res) + dirtyNote });
        }
    },
    {
        name: "pal_spec_lint",
        description: "Lint a SPEC.md OFFLINE for the MECHANICAL half of pal-spec's reality check: placeholders (TBD/decide-later), dead §3 links, §8a primary-key/type/size/indexability against palbuilder-types.md, §5 dataset references, and the §12 floor (plus the REGRESSION criterion when a MAP.md sits beside it). Returns HARD_FLAG/FLAG/NOTE findings; capability->primitive mapping and component checks stay manual.",
        needsCtx: false,
        inputShape: { spec: z.string().optional().describe("Path to the SPEC.md (default: SPEC.md in the workspace).") },
        async run(ctx, { spec } = {}) {
            const specPath = spec ? pathMod.resolve(spec) : pathMod.join(ctx.workspaceDir, "SPEC.md");
            let text;
            try { text = fs.readFileSync(specPath, "utf8"); }
            catch (e) { return { ran: false, message: "Could not read " + specPath + ": " + (e && e.message ? e.message : e) }; }
            const res = lintSpec(text, { workspaceDir: pathMod.dirname(specPath) });
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            return Object.assign({ ran: true }, res, { message: formatSpecLint(res) });
        }
    },
    {
        name: "pal_regression",
        description: "Brownfield regression check against baseline/baseline.json (pal-init Step 3). FIRST compares the baseline's mapped marker to the live server — moved => STALE, stops (never verdicts against a stale baseline). Then re-runs validate / pal_test / page-H1 checks vs the baseline, separating CAUSED failures from INHERITED (known_issues) ones; eyeball_only viewports are needs-human, never auto-passed.",
        inputShape: {},
        async run(ctx) {
            const res = await runRegression(ctx.session, ctx.record, ctx.workspaceDir);
            if (ctx.lifecycle) ctx.lifecycle.onActivity(); // runs pal_test — takes the lock, re-arm idle
            return Object.assign(res, { message: res.summary });
        }
    },
    {
        name: "pal_sync_datasets",
        description: "Create or update dataset TABLES on the server from the dataset definitions in pal.json. " +
            "A dataset has a DEFINITION (schema in datasets/<name>.json + a pal.json entry, saved by a normal push) and a TABLE (real storage); " +
            "editing the .json only changes the definition — this tool provisions the table (it saves the pal first). " +
            "Default is a SAFE sync: create if missing, additive changes only, never deletes data. " +
            "recreate:true DROPS AND REBUILDS a table, DELETING ALL ITS ROWS, and requires a separate exact typed confirmation — it can't happen by accident. " +
            "New dataset: write datasets/<name>.json, add a matching pal.json entry, then call this tool.",
        inputShape: {
            datasets: z.array(z.string()).optional(),
            recreate: z.boolean().optional(),
            confirmRecreate: z.string().optional(),
            force: z.boolean().optional()
        },
        async run(ctx, { datasets, recreate = false, confirmRecreate, force = false } = {}) {
            const res = await syncDatasets(ctx.session, ctx.record, ctx.workspaceDir, { datasets, recreate, confirmRecreate, force });
            if (ctx.lifecycle) ctx.lifecycle.onActivity(); // sync saves + locks — re-arm the idle timer
            if (res.synced) {
                // The push inside sync advanced the baseline — persist it.
                if (res.saveResult && res.saveResult.serverPaths) refreshBaseline(ctx.record, ctx.workspaceDir, res.saveResult.serverPaths);
                await ctx.persist();
                const verb = res.recreated ? "RECREATED (dropped + rebuilt, data deleted)" : "synced (created/updated, data kept)";
                return Object.assign(res, {
                    message: "Datasets " + verb + " on the server — " + res.targets.length + " table(s):\n" +
                        res.schemas.map(s => "   - " + s).join("\n") +
                        "\nThe tables now match these schemas. (A dataset table exists only after this step — editing the .json alone never creates it.)"
                });
            }
            if (res.refused === "recreate-unconfirmed") {
                return Object.assign(res, { message: "REFUSED (recreate not confirmed): " + res.reason });
            }
            if (res.refused === "save-failed") {
                // Bubble up the underlying push refusal text so the agent knows exactly what to fix.
                const sr = res.saveResult || {};
                let detail;
                if (sr.refused === "validation" && sr.lint) detail = "code errors — run pal_validate:\n" + formatLint(sr.lint, { context: "pre-push" });
                else if (sr.refused === "drift") detail = "the server changed since your last pull — run pal_pull first (or force:true).";
                else if (res.serverNotes && res.serverNotes.length) detail = "the server rejected the save:\n   - " + res.serverNotes.join("\n   - ");
                else detail = sr.refused || "unknown reason";
                return Object.assign(res, { message: "REFUSED: could not save the dataset definitions before provisioning.\n" + detail });
            }
            if (res.refused === "no-datasets" || res.refused === "unknown-dataset") {
                return Object.assign(res, { message: "REFUSED: " + res.reason });
            }
            return Object.assign(res, { message: "Dataset sync did not complete: " + (res.reason || res.refused || "unknown") });
        }
    },
    {
        name: "pal_pull",
        description: "Pull (sync) the pal from the server. New un-pushed local files are preserved. Refuses if it would overwrite locally-modified server files (use force to override).",
        inputShape: { force: z.boolean().optional() },
        async run(ctx, { force = false } = {}) {
            // Reverse drift guard, per-file: changed/deleted server-tracked files (and pure
            // pal.json mutations) block the pull; NEW local files don't — sync preserves them.
            const d = diffWorkspace(ctx.record, ctx.workspaceDir);
            if (d.dirty && !force) {
                return { pulled: false, refused: "local-changes", changed: d.changed, deleted: d.deleted, added: d.added,
                    message: "REFUSED: un-pushed local changes would be lost by this pull.\n" + describeDiff(d) +
                        "\npal_push first; or pal_merge to keep BOTH your changes and the server's where they don't collide; or pal_pull with force:true to discard your local changes." +
                        (d.legacy ? "" : " (New local files are preserved either way.)") };
            }
            const { resolved, written, removed, preserved, serverPaths } = await pull(ctx.session, ctx.record.palGuid, ctx.workspaceDir, { baseline: ctx.record.fileHashes || null });
            ctx.record.lastModifiedDate = resolved.lastModifiedDate;
            refreshBaseline(ctx.record, ctx.workspaceDir, serverPaths);
            ctx.record.pulledAt = nowIso();
            await ctx.persist();
            return { pulled: true, files: written.base64.length, dataFiles: written.json.length, marker: resolved.lastModifiedDate,
                message: "Pulled " + ctx.record.palName + ": " + written.base64.length + " code files + " + written.json.length + " data/schema files. marker=" + resolved.lastModifiedDate +
                    (removed.length ? "\nRemoved (deleted on server): " + removed.join(", ") : "") +
                    (preserved.length ? "\nPreserved local work:\n" + preserved.map(p => "   - " + p.rel + " — " + p.note).join("\n") : "") };
        }
    },
    {
        name: "pal_merge",
        description: "Reconcile un-pushed LOCAL changes with SERVER changes since your last pull, keeping BOTH where they don't collide (3-way merge). Files only you changed stay yours; files only the server changed are taken from it; a file BOTH sides changed is kept as YOURS with the server's saved beside it as <file>.server to combine by hand. Never overwrites your work silently. Use instead of force-push/pull when both sides edited the pal; a clean merge clears drift so a follow-up pal_push isn't blocked.",
        inputShape: {},
        async run(ctx) {
            const res = await mergeWorkspace(ctx.session, ctx.record.palGuid, ctx.record, ctx.workspaceDir);
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            if (res.merged) {
                refreshBaseline(ctx.record, ctx.workspaceDir, res.serverPaths);
                ctx.record.pulledAt = nowIso();
                await ctx.persist();
            }
            return Object.assign(res, { message: formatMerge(res) });
        }
    },
    {
        name: "pal_push",
        description: "Push local changes to the server (UPDATE). FIRST runs the offline code check (pal_validate) and REFUSES on errors — fix them, or skipValidation:true to push anyway (not recommended). Also refuses on drift (force:true) or if the pal is locked by another person (typed confirmOverride). On success returns the server's save result plus any code WARNINGS.",
        inputShape: { force: z.boolean().optional(), confirmOverride: z.string().optional(), skipValidation: z.boolean().optional() },
        async run(ctx, { force = false, confirmOverride, skipValidation = false } = {}) {
            const palName = ctx.record.palName;
            const overrideLock = confirmOverride === overridePhrase(palName);
            const res = await push(ctx.session, ctx.record, ctx.workspaceDir, { force: !!force, overrideLock, skipValidation: !!skipValidation });
            // Pre-push lint refusal: errors found, push not attempted.
            if (res.refused === "validation") {
                return Object.assign(res, {
                    message: "REFUSED: the offline code check found errors that would break in PalBuilder, so nothing was pushed.\n\n" +
                        formatLint(res.lint, { context: "pre-push" }) +
                        "\n\nFix the ERROR items above and push again. To push anyway without fixing them, call pal_push with skipValidation:true (not recommended)."
                });
            }
            if (res.pushed) {
                refreshBaseline(ctx.record, ctx.workspaceDir, res.serverPaths);
                await ctx.persist();
                // Surface any pre-push WARNINGS even on success (errors can't reach here unless
                // skipValidation forced past them — say so loudly).
                const warnBlock = res.lint && res.lint.warnings > 0
                    ? "\n\n⚠ Code warnings (did not block the push — review them):\n" + formatLint(res.lint, { context: "validate" })
                    : "";
                const skippedBlock = res.skippedValidation
                    ? "\n\n⚠ You pushed past " + res.lint.errors + " validation ERROR(s) with skipValidation — the pal may not compile/render in PalBuilder:\n" + formatLint(res.lint, { context: "validate" })
                    : "";
                const webBlock = res.webRegistered
                    ? "\n\n🌐 Registered \"" + res.webRegistered + "\" as the pal's web workflow (this makes it a Web Pal so it can render/preview). Run pal_pull to sync the registration into pal.json."
                    : "";
                return Object.assign(res, {
                    message: "Pushed " + res.filesPushed + " files" + (res.forced ? " (forced past drift)" : "") +
                        ". save " + (res.pushed ? "OK" : "FAILED") + ". marker=" + res.newMarker + ".\n" +
                        formatValidation(res.validation) +
                        (res.skipped && res.skipped.length
                            ? "\n⚠ Skipped — these can't be created via palsync; make them in PalBuilder:\n" +
                              res.skipped.map(s => "   - " + s.type + "/" + s.file + " (" + s.reason + ")").join("\n")
                            : "") +
                        (res.strayCreatable && res.strayCreatable.length
                            ? "\n\n🚨 WARNING: " + res.strayCreatable.length + " file(s) on disk were NOT pushed — they have no pal.json entry, so the server never receives them:\n" +
                              res.strayCreatable.map(f => "   - " + f).join("\n") +
                              "\nFix: add a matching entry to pal.json (copy an existing entry of the same type, e.g. a Page entry for pages/, a Fragment entry for fragments/, set string+filename to the file name), then push again. Until you do, these files exist only on disk."
                            : "") + skippedBlock + warnBlock + webBlock
                });
            }
            if (res.refused === "drift") {
                return Object.assign(res, {
                    message: "REFUSED (drift): the server was saved after your last pull.\n" +
                        "  your marker  : " + res.storedMarker + "\n" +
                        "  server marker: " + res.liveMarker + "\n" +
                        "  last edited by: " + res.lastEditUser + " at " + res.lastEditDate + "\n" +
                        "Run pal_pull to reconcile, or pal_push with force:true to overwrite."
                });
            }
            // lock-blocked refusals (gui-lock-self / gui-lock-other / override-disabled / unknown-holder)
            if (["gui-lock-self", "gui-lock-other", "override-disabled", "unknown-holder"].includes(res.refused)) {
                return Object.assign(res, { message: withOverrideGate("REFUSED: " + blockedMessage(res.refused, res, palName), confirmOverride, palName) });
            }
            // Server REJECTED the save (it ran the lint + lock + drift, then the server said no).
            // Show the server's validation notes — this is the real reason (e.g. a tag the server
            // doesn't allow), not a generic failure.
            if (res.refused === "save-rejected") {
                return Object.assign(res, {
                    message: "PUSH FAILED: the server rejected the save (nothing was saved). The server's reasons:\n" +
                        formatValidation(res.validation) +
                        "\n\nFix the issue(s) above in your files and push again. (These come from the PalBuilder server, not the offline check.)"
                });
            }
            return Object.assign(res, { message: "Push failed: " + (res.reason || res.refused || "unknown") });
        }
    },
    {
        name: "pal_lock",
        description: "Acquire the pal lock. Reports the real holder (from teamInfo) when blocked; override is high-friction and typed.",
        inputShape: { confirmOverride: z.string().optional() },
        async run(ctx, { confirmOverride } = {}) {
            const palName = ctx.record.palName;
            // Route through the lifecycle (not core/lock directly) so an explicit pal_lock clears
            // a prior pal_unlock's userReleased flag and restarts the idle timer.
            let lk = await ctx.lifecycle.acquire({ force: false });
            if (lk.acquired) return { locked: true, byUs: true, message: "Lock held by you" + (lk.reclaimed ? " (reclaimed)" : "") + "." };
            // blocked — if the user typed the exact override phrase, attempt force (currently dormant).
            if (confirmOverride === overridePhrase(palName)) {
                lk = await ctx.lifecycle.acquire({ force: true });
                if (lk.acquired) return { locked: true, byUs: true, forced: true, message: "Lock force-acquired." };
            }
            return { locked: false, blocked: lk.blocked, holder: lk.holder, since: lk.since,
                message: withOverrideGate(blockedMessage(lk.blocked, lk, palName), confirmOverride, palName) };
        }
    },
    {
        name: "pal_unlock",
        description: "Release palsync's lock. Cannot release a PalBuilder checkout — that must be released in PalBuilder.",
        inputShape: {},
        async run(ctx) {
            if (ctx.session.lockInfo) {
                // userRequested: an explicit unlock must stick — tool activity won't re-acquire
                // past it (only an explicit pal_lock re-arms the lifecycle).
                const rel = await ctx.lifecycle.release("user-request", { userRequested: true });
                return { unlocked: rel.released, message: rel.released ? "Lock released." : "No lock held." };
            }
            const st = await lock.statusByGuid(ctx.session, ctx.record.palGuid);
            if (st.locked && st.kind === "gui") {
                return { unlocked: false, message: (st.byUs ? "You hold \"" + ctx.record.palName + "\" as a PalBuilder checkout" : "Locked by " + st.holder) +
                    " — release it in PalBuilder; palsync can't unlock a PalBuilder lock." };
            }
            return { unlocked: false, message: "No palsync lock to release." };
        }
    }
];

module.exports = { TOOLS, overridePhrase, blockedMessage };
