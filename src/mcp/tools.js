"use strict";
// The palsync MCP tools. Each `run(ctx, args)` is a plain async function (so it's directly
// testable); server.js wraps them for the MCP SDK. ctx = { session, record, workspaceDir,
// lifecycle, persist() }. Datasets/dataviews are never created or destroyed by any tool.
const { z } = require("zod");
const { pull } = require("../core/pull");
const { push } = require("../core/push");
const { runTest } = require("../core/test");
const { runTunnelAction, listTunnelWorkflows, matchTunnelWorkflow } = require("../core/tunnel");
const { retrieveServerDebug } = require("../core/debug");
const { runPreview, fetchPagePath, checkExpect, extractSelector } = require("../core/preview");
const { runScreenshot } = require("../core/screenshot");
const { runExercise, formatExercise } = require("../core/exercise");
const { mergeWorkspace, formatMerge } = require("../core/merge");
const { runSeoAudit, formatSeoAudit } = require("../core/seoAudit");
const { runRegression } = require("../core/regression");
const { lintSpec, formatSpecLint } = require("../core/specLint");
const { syncDatasets } = require("../core/datasets");
const { validateWorkspace, formatValidation: formatLint } = require("../core/validate");
const { openUrl } = require("../platform/openUrl");
const {
    createWorkHistoryRun,
    writeArtifactFile,
    writeRunMetadata,
    writeRunNotes
} = require("./workHistory");
const fs = require("fs");
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

// Render-verification tracking (session-lifetime, lives on ctx so it survives across tool calls).
// ctx.renderVerified: undefined/false = not verified since the last push, true = a clean
// pal_screenshot/pal_fetch/pal_preview(expect) confirmed it, "unavailable" = the check tool
// isn't available in this runtime (accepted fallback: ask the user to eyeball it).
// Exists because pal_validate/pal_test only prove the code COMPILES — agents (esp. weaker
// models) declare a build "done" straight off that, without ever calling the one tool that can
// see the actual render. This reminder rides the tool response text itself (read every call),
// not just a skill doc read once at the start of a long session.
function renderNotVerifiedReminder(ctx) {
    if (ctx.renderVerified === true || ctx.renderVerified === "unavailable") return "";
    // Full paragraph once per session; every repeat rides the context window for the rest of
    // the conversation, so later occurrences use the short form (same rule, fewer bytes).
    if (ctx.renderReminderShown) {
        return "\n\n⚠ RENDER NOT VERIFIED — pal_screenshot (or pal_fetch/pal_preview expect:[strings]" +
            " for WEB) before declaring done; never report unobserved page content or flows as fact.";
    }
    ctx.renderReminderShown = true;
    return "\n\n⚠ RENDER NOT VERIFIED — this only proves the code compiles, not that it renders." +
        " Call pal_screenshot (web or console/transaction) — or for a WEB pal, pal_fetch/pal_preview with" +
        " expect:[strings] — before declaring this done. Do not report page content, saved data, or a" +
        " completed user flow (\"clicked Save\", \"item appears in the list\") as fact unless one of those" +
        " tools actually showed it to you.";
}

function formatStyleStatus(status) {
    if (!status || !status.inspected) return "CSS: not inspected";
    const parts = [
        "CSS: " + status.loaded + "/" + status.linked + " linked stylesheet(s) loaded"
    ];
    if (status.inlineStyleTags) parts.push(status.inlineStyleTags + " inline <style> tag(s)");
    if (status.missingStylesheets && status.missingStylesheets.length) {
        parts.push(status.missingStylesheets.length + " missing stylesheet(s)");
    }
    if (status.failedRequests && status.failedRequests.length) {
        parts.push(status.failedRequests.length + " failed stylesheet request(s)");
    }
    if (status.error) parts.push("inspection error: " + status.error);
    if (status.likelyLoaded === false) parts.push("NOT fully loaded before screenshot");
    return parts.join("; ");
}

function formatDesignAudit(audit) {
    if (!audit || !audit.inspected) return "Design audit: not inspected" + (audit && audit.error ? " (" + audit.error + ")" : "");
    const metrics = audit.metrics || {};
    const parts = ["Design audit: " + audit.errors + " error(s), " + audit.warnings + " warning(s)"];
    if (typeof metrics.horizontalOverflow === "number") parts.push("overflow=" + metrics.horizontalOverflow + "px");
    if (typeof metrics.visibleH1s === "number") parts.push("H1s=" + metrics.visibleH1s);
    if (typeof metrics.visibleControls === "number") parts.push("controls=" + metrics.visibleControls);
    return parts.join("; ");
}

// A page-level visual gate is only complete after every route the agent has started reviewing has
// one clean desktop and one clean mobile capture. A later failure replaces the prior pass, so stale
// evidence can never leave renderVerified=true. pal_push clears this map because screenshots prove
// the last pushed version, not whatever is currently on disk.
function recordScreenshotEvidence(ctx, { route, viewportName, clean }) {
    const routeKey = route || "/";
    if (!ctx.renderViewportEvidence || Array.isArray(ctx.renderViewportEvidence)) ctx.renderViewportEvidence = {};
    if (!ctx.renderViewportEvidence[routeKey]) ctx.renderViewportEvidence[routeKey] = {};
    ctx.renderViewportEvidence[routeKey][viewportName] = clean === true;

    const incomplete = Object.keys(ctx.renderViewportEvidence).filter(key => {
        const evidence = ctx.renderViewportEvidence[key] || {};
        return evidence.desktop !== true || evidence.mobile !== true;
    });
    const complete = Object.keys(ctx.renderViewportEvidence).length > 0 && incomplete.length === 0;
    ctx.renderVerified = complete;
    return { complete, route: routeKey, viewportName, clean: clean === true, incomplete };
}

// Print the FULL text of every server validation note (group/object: message), not just a count —
// a count hides content-affecting warnings (e.g. a page with no body tag that won't save).
function formatValidation(notes) {
    if (!notes || !notes.length) return "No validation notes.";
    const benign = [], blocking = [];
    for (const v of notes) (isBenignServerNote(v) ? benign : blocking).push(v);
    const fmt = (title, xs) => title + " (" + xs.length + "):\n" +
        xs.map(v => "   - " + (v.group || "?") + "/" + (v.object || "(general)") + ": " + v.message).join("\n");
    const parts = [];
    if (blocking.length) parts.push(fmt("Server validation notes", blocking));
    else parts.push("No blocking server validation notes.");
    if (benign.length) parts.push(fmt("Server informational notes (non-blocking)", benign));
    return parts.join("\n");
}

function isBenignServerNote(v) {
    const group = String((v && v.group) || "");
    const object = String((v && v.object) || "");
    const msg = String((v && v.message) || "");
    if (group === "workflow" && object === "Validation" && /^vCPU:\s*\d+,\s*batchSize:\s*\d+$/i.test(msg)) return true;
    if (group === "console" && object === "" && /^Console Desktop (Image|Label) required\.?$/i.test(msg)) return true;
    return false;
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
function htmlRegionResult(res, { headline, filePrefix, guid, selector, maxChars, extraLine = "", dirtyNote = "", workspaceDir, tool = "pal_fetch", feature }) {
    let body = res.html, missSel = false;
    if (selector) { const region = extractSelector(res.html, selector); if (region == null) { missSel = true; body = ""; } else body = region; }
    let filePath = null;
    let run = null;
    try {
        if (!missSel && workspaceDir) {
            run = createWorkHistoryRun(workspaceDir, { tool, feature: feature || headline });
            filePath = writeArtifactFile(run, selector ? "selected-markup.html" : "body.html", body, "utf8");
            writeRunMetadata(run, {
                palGuid: guid,
                status: res.status,
                contentType: res.contentType,
                title: res.title,
                bytes: res.bytes,
                selector: selector || null,
                maxChars: maxChars || null,
                artifact: filePath ? pathMod.basename(filePath) : null
            });
            writeRunNotes(run, [
                "# " + headline,
                "",
                "- Artifact: `" + (filePath ? pathMod.basename(filePath) : "not written") + "`",
                "- Status: " + res.status,
                "- Content-Type: " + res.contentType,
                selector ? "- Selector: `" + selector + "`" : null
            ]);
        }
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
            (run ? "\n  Work-history run: " + run.dir : "") +
            (missSel ? "" : (filePath ? "\n  Full " + (selector ? "region" : "body") + " saved to: " + filePath : "") +
                "\n\n--- " + (selector ? "selected markup" : "served body") +
                (truncated ? " (first " + cap + " of " + body.length + " bytes — read the file for the rest)" : "") + " ---\n" + shown)
    });
}

// How much c.debug text to inline before truncating to the TAIL (the most recent lines matter
// most when diagnosing the run that just happened).
const DEBUG_INLINE_CAP = 8000;

// Auto-attach the server-side c.debug buffer to a tool result whose call actually EXECUTED a
// workflow (tunnel call, server-rendered fetch/preview, screenshot) — the agent gets its debugs
// with the response it is diagnosing instead of asking the user to copy/paste from PalBuilder.
// Best-effort by design: never throws, and an empty buffer adds nothing. The retrieve CONSUMES
// the shared buffer (see core/debug), which is exactly what we want here: the debugs belong to
// the run this result describes. ctx.debugPalId caches the transient id across calls.
async function withServerDebug(ctx, out) {
    try {
        const dbg = await retrieveServerDebug(ctx.session, ctx.record.palGuid, { palId: ctx.debugPalId });
        if (dbg.palId) ctx.debugPalId = dbg.palId;
        if (!dbg.retrieved || dbg.empty) return out;
        out.serverDebug = dbg.text;
        const truncated = dbg.text.length > DEBUG_INLINE_CAP;
        const shown = truncated ? dbg.text.slice(-DEBUG_INLINE_CAP) : dbg.text;
        out.message = (out.message || "") +
            "\n\n--- server debug (c.debug output" + (truncated ? "; LAST " + DEBUG_INLINE_CAP + " of " + dbg.text.length + " chars" : "") + ") ---\n" + shown;
    } catch (e) { /* the primary result matters more than the debug garnish */ }
    return out;
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
            // read-only — no lock attempt; reuse the resolve above instead of a second account walk
            const st = await lock.statusByGuid(ctx.session, ctx.record.palGuid, { resolved: live });
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
        description: "Check the pal's code OFFLINE (no server/network) for the mistakes that silently break in PalBuilder: invalid workflow JS for the restricted engine, and invalid c:/XHTML markup. Returns each finding's file, line, ERROR/WARNING label, and the fix. Run BEFORE pal_push (pal_push runs it too and refuses on errors).",
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
        description: "Validate a workflow ON THE SERVER and return the server's validation notes. Does NOT open a browser by default; pass preview:true only when the user has stopped for human review and wants a live browser preview. The preview URL carries the user's credentials, is NEVER returned to you, and you CANNOT see the rendered page — use pal_screenshot/pal_exercise for agent-visible verification.",
        inputShape: {
            workflow: z.enum(["console", "web", "transaction"]).optional(),
            workflowName: z.string().optional(),
            preview: z.boolean().optional()
        },
        async run(ctx, { workflow, workflowName, preview = false } = {}) {
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
                previewMsg = "Live preview available but NOT opened (auto-mode default). For human review, call pal_test with preview:true; for agent-visible verification, use pal_screenshot or pal_exercise.";
            } else {
                previewMsg = "No live preview — the workflow did not validate (fix the notes above, push, and test again).";
            }
            const verdict = res.validated
                ? "✅ " + res.kind + " workflow VALIDATED on the server. (Compile-only: this does NOT clear " +
                  "pal_validate errors — those describe code that mis-renders or dies at runtime after a clean compile.)"
                : "❌ " + res.kind + " workflow did NOT validate.";
            // Server-level messages (e.g. "Pal is not a Web Pal") explain a whole-test failure that
            // never shows up in per-rule validation notes — surface them or the real cause is lost.
            const serverMsgs = (res.messages || []).filter(m => m && m.message);
            const msgText = serverMsgs.length
                ? "Server message(s):\n" + serverMsgs.map(m => "   - " + (m.type ? m.type + ": " : "") + m.message).join("\n") + "\n"
                : "";
            const message = "Tested " + ctx.record.palName + " (" + res.kind + ").\n" +
                verdict + "\n" + msgText + formatValidation(res.validation) + "\n" + previewMsg +
                (res.availableKinds.length > 1 ? "\n(testable engines on this pal: " + res.availableKinds.join(", ") + ")" : "") +
                (res.validated ? renderNotVerifiedReminder(ctx) : "");
            // Strip the credential URL before returning — defense in depth.
            const safe = Object.assign({}, res); delete safe._previewUrl;
            return Object.assign(safe, { message });
        }
    },
    {
        name: "pal_tunnel_test",
        description: "Test a TUNNEL workflow (workflowType 15) by ACTUALLY CALLING it as a web service and returning its JSON response — the one tool where you get real DATA back from the server, not just a validation verdict. REQUIRES askedUser:true, which attests the action/workflow/payload values came from the USER (their message specified them, or they answered your questions) — a call without it returns the questions to relay to the user instead of running. NEVER invent an action or payload. Credentials are minted and refreshed automatically (~5 min expiry). Acts on the LAST PUSHED version — pal_push first. An empty response means the workflow THREW at runtime.",
        inputShape: {
            action: z.string().optional().describe("Action string the workflow dispatches on via request.getAction(). Optional — omitted means the workflow sees null."),
            payload: z.record(z.string(), z.any()).optional().describe("JSON payload object — TOP-LEVEL keys are readable in the workflow via request.getPayload().get(key); nested objects do not survive the wire. Default: {}."),
            payloadFile: z.string().optional().describe("Path to a .json file to send as the payload (workspace-relative or absolute). Alternative to payload."),
            workflow: z.string().optional().describe("Tunnel workflow name, with or without .js (default: the pal's registered tunnelServiceWorkflow)."),
            askedUser: z.boolean().optional().describe("REQUIRED attestation: true means the action/workflow/payload values came from the USER in this conversation — their message specified them, or they answered your questions. NEVER set it alongside values you chose yourself.")
        },
        async run(ctx, { action, payload, payloadFile, workflow, askedUser } = {}) {
            // Local enumeration (last-pulled pal.json) — for name matching and for listing options.
            const { tunnels, defaultTunnel } = listTunnelWorkflows(ctx.workspaceDir);
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            const listLine = tunnels.length
                ? "Tunnel workflows on this pal: " + tunnels.map(t => t + (t === defaultTunnel ? " (default)" : "")).join(", ")
                : "No tunnel workflows (workflowType 15) found in the local pal.json — pal_pull to refresh, or create one.";
            // Interview gate: the developer chooses the action/workflow/payload — the agent must not.
            // UNCONDITIONAL on askedUser (an attestation the values came from the user): the first
            // version exempted calls that carried an explicit action, and agents simply invented one
            // ("test") and sailed through without ever asking. Enforced here, in the response the
            // agent reads every call, because description-only guidance gets skipped.
            if (!askedUser) {
                const supplied = [];
                if (action !== undefined) supplied.push("action:" + JSON.stringify(action));
                if (workflow) supplied.push("workflow:" + JSON.stringify(workflow));
                if (payload !== undefined || payloadFile) supplied.push(payloadFile ? "payloadFile:" + JSON.stringify(payloadFile) : "a payload");
                const inventedNote = supplied.length
                    ? "\nYou passed " + supplied.join(", ") + " — if the user did not give you these values, they are INVENTED; discard them and ask.\n"
                    : "\n";
                return { ran: false, refused: "interview-needed", tunnelWorkflows: tunnels, defaultTunnel,
                    message: "NOT RUN — this call must carry askedUser:true, attesting the values came from the user." + inventedNote +
                        "Ask the user (do not answer for them):\n" +
                        "  1. ACTION — which action string should the workflow receive? (optional — may be none)\n" +
                        "  2. WORKFLOW — " + listLine + "\n" +
                        "  3. PAYLOAD — one of: (a) no payload, (b) they type/paste JSON, (c) a path to a .json file (payloadFile).\n" +
                        "Then call again with their answers plus askedUser:true. If the user's original message already answered a question (e.g. \"test tunnel xyz with action getOrders\"), you may skip asking that one." };
            }
            let resolvedWorkflow = undefined; // undefined => server runs the registered default
            if (workflow) {
                const matched = matchTunnelWorkflow(workflow, tunnels);
                if (!matched && tunnels.length) {
                    return { ran: false, refused: "unknown-workflow", tunnelWorkflows: tunnels, defaultTunnel,
                        message: "REFUSED: " + JSON.stringify(workflow) + " does not match a tunnel workflow in pal.json.\n" + listLine };
                }
                resolvedWorkflow = matched || workflow; // pass through unmatched — the local list may be stale/empty
            }
            if (payloadFile && payload) {
                return { ran: false, refused: "payload-conflict", message: "REFUSED: pass payload OR payloadFile, not both." };
            }
            if (payloadFile) {
                const p = pathMod.isAbsolute(payloadFile) ? payloadFile : pathMod.join(ctx.workspaceDir, payloadFile);
                let text;
                try { text = fs.readFileSync(p, "utf8"); }
                catch (e) { return { ran: false, refused: "payload-file", message: "REFUSED: could not read payload file " + p + ": " + e.message }; }
                try { JSON.parse(text); }
                catch (e) { return { ran: false, refused: "payload-file", message: "REFUSED: " + p + " is not valid JSON: " + e.message }; }
                payload = text; // pre-validated string rides the wire as-is
            }
            const res = await runTunnelAction(ctx.session, ctx.record.palGuid, { action, payload, workflow: resolvedWorkflow, creds: ctx.tunnelCreds });
            // Cache the session's tunnel credentials (short-lived — runTunnelAction re-mints on 401).
            if (res.creds) { ctx.tunnelCreds = res.creds; }
            const safe = Object.assign({}, res, { tunnelWorkflows: tunnels, defaultTunnel }); delete safe.creds; // never hand credentials to the agent
            if (!res.ran) {
                return Object.assign(safe, { message: "Tunnel call did not run (" + (res.refused || "unknown") + "): " + res.reason });
            }
            const headline = "Tunnel workflow responded — workflow=" + (resolvedWorkflow || (defaultTunnel ? defaultTunnel + " (default)" : "(server default)")) +
                " action=" + (action ? JSON.stringify(action) : "(none)") + " status=" + res.status +
                (res.refreshedCredentials ? " (fresh tunnel credentials minted)" : "");
            if (res.emptyBody) {
                // The c.debug trail is the best evidence for WHERE the workflow died — attach it.
                return withServerDebug(ctx, Object.assign(safe, {
                    message: headline + "\n\n⚠ EMPTY response body. For a tunnel workflow this almost always means the workflow " +
                        "THREW at runtime (the server swallows the error and returns nothing) — or it returned an empty payload. " +
                        "Check the workflow for a bad method call / null deref on this action, push, and test again."
                }));
            }
            const shown = res.raw.length > PREVIEW_INLINE_CAP ? res.raw.slice(0, PREVIEW_INLINE_CAP) : res.raw;
            return withServerDebug(ctx, Object.assign(safe, {
                message: headline +
                    (res.parseError ? "\n⚠ Response was not valid JSON (" + res.parseError + ") — raw body below." : "") +
                    "\n\n--- response " + (res.parseError ? "body" : "JSON") +
                    (res.raw.length > shown.length ? " (first " + PREVIEW_INLINE_CAP + " of " + res.raw.length + " chars)" : "") +
                    " ---\n" + shown
            }));
        }
    },
    {
        name: "pal_debug",
        description: "Retrieve the pal's server-side c.debug(...) output — the PalBuilder IDE debug feed; any workflow engine on a test pal writes to it when it executes. CONSUME-ONCE and SHARED: reading clears the buffer for every viewer, including a developer watching PalBuilder's debug view. pal_tunnel_test / pal_fetch / pal_preview (web) / pal_screenshot attach this automatically — call this directly after an opt-in browser preview or a manual run in the user's browser.",
        inputShape: {},
        async run(ctx) {
            const dbg = await retrieveServerDebug(ctx.session, ctx.record.palGuid, { palId: ctx.debugPalId });
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            if (dbg.palId) ctx.debugPalId = dbg.palId;
            if (!dbg.retrieved) return Object.assign(dbg, { message: "Could not retrieve server debug: " + dbg.reason });
            if (dbg.empty) {
                return Object.assign(dbg, { message: "Server debug buffer is EMPTY. It is consume-once — a prior palsync tool result may already carry it (look for a \"server debug\" block), or the workflow hasn't executed since the last read, or it doesn't call c.debug()." });
            }
            const truncated = dbg.text.length > DEBUG_INLINE_CAP;
            const shown = truncated ? dbg.text.slice(-DEBUG_INLINE_CAP) : dbg.text;
            return Object.assign(dbg, {
                message: "Server debug output (buffer now cleared for all viewers" + (truncated ? "; LAST " + DEBUG_INLINE_CAP + " of " + dbg.text.length + " chars" : "") + "):\n" + shown
            });
        }
    },
    {
        name: "pal_preview",
        description: "See what the pal RENDERS. WEB pal: pass expect:[strings] for a found/missing verdict (token-efficient default), or selector/maxChars for markup; full HTML otherwise. CONSOLE/transaction pal: does NOT open a browser by default; pass open:true only at a human-review stop. Shows the LAST PUSHED version — pal_push first.",
        inputShape: {
            workflow: z.enum(["console", "web", "transaction"]).optional(),
            expect: z.array(z.string()).optional().describe("Strings the rendered page must contain — returns a per-string found/missing verdict instead of the HTML (the default, token-efficient check)."),
            selector: z.string().optional().describe("Simple CSS selector (tag/.class/#id) to return only that region's markup."),
            maxChars: z.number().optional().describe("Cap the returned markup to this many characters."),
            open: z.boolean().optional().describe("Console/transaction only: open the preview in the user's browser. Default false for auto mode.")
        },
        async run(ctx, { workflow, expect, selector, maxChars, open = false } = {}) {
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
                // HTML proves server rendering and copy, not responsive visual quality. The
                // desktop/mobile screenshot gate remains outstanding.
                // Token-efficient default: verify expected strings, never return the page body.
                if (expect && expect.length) {
                    const chk = checkExpect(res.html, expect);
                    const safe = Object.assign({}, res); delete safe.html;
                    return withServerDebug(ctx, Object.assign(safe, { pass: chk.pass, results: chk.results,
                        message: formatExpect("WEB preview (" + res.url + ")", { status: res.status, bytes: res.bytes }, chk) + dirtyNote }));
                }
                // Narrowed markup: one region and/or a char cap when the agent genuinely needs HTML.
                if (selector || maxChars) {
                    return withServerDebug(ctx, htmlRegionResult(res, {
                        headline: "WEB preview rendered",
                        filePrefix: "palsync-preview-",
                        guid: ctx.record.palGuid,
                        selector,
                        maxChars,
                        dirtyNote,
                        workspaceDir: ctx.workspaceDir,
                        tool: "pal_preview",
                        feature: "preview-" + (workflow || res.kind || "web")
                    }));
                }
                // Save the full HTML to a file the agent can Read, and inline a capped slice.
                let filePath = null;
                let run = null;
                try {
                    run = createWorkHistoryRun(ctx.workspaceDir, { tool: "pal_preview", feature: "preview-" + (workflow || res.kind || "web") });
                    filePath = writeArtifactFile(run, "rendered.html", res.html, "utf8");
                    writeRunMetadata(run, {
                        palGuid: ctx.record.palGuid,
                        palName: ctx.record.palName,
                        url: res.url,
                        status: res.status,
                        contentType: res.contentType,
                        title: res.title,
                        bytes: res.bytes,
                        dirty: !!res.dirty,
                        dirtyFiles: res.dirtyFiles || [],
                        artifact: filePath ? pathMod.basename(filePath) : null
                    });
                    writeRunNotes(run, [
                        "# pal_preview",
                        "",
                        "- URL: " + res.url,
                        "- Status: " + res.status,
                        "- Size: " + res.bytes + " bytes",
                        "- Artifact: `" + (filePath ? pathMod.basename(filePath) : "not written") + "`"
                    ]);
                } catch (e) { /* best-effort */ }
                const truncated = res.html.length > PREVIEW_INLINE_CAP;
                const shown = truncated ? res.html.slice(0, PREVIEW_INLINE_CAP) : res.html;
                const safe = Object.assign({}, res); delete safe.html; // don't double-include in structured result
                return withServerDebug(ctx, Object.assign(safe, {
                    htmlFile: filePath,
                    message: "WEB preview rendered — this is your pal's actual server-rendered HTML output.\n" +
                        "  url=" + res.url + "  content-type=" + res.contentType + "  title=" + JSON.stringify(res.title) + "  size=" + res.bytes + " bytes" + dirtyNote +
                        (run ? "\n  Work-history run: " + run.dir : "") +
                        (filePath ? "\n  Full HTML saved to: " + filePath + " (Read it to inspect the whole page)." : "") +
                        "\n\n--- rendered HTML" + (truncated ? " (first " + PREVIEW_INLINE_CAP + " of " + res.bytes + " bytes — read the file for the rest)" : "") + " ---\n" + shown
                }));
            }
            // console/transaction — optionally open in the user's browser; the agent cannot see it.
            let opened = { opened: false };
            if (res._previewUrl && open) opened = await openUrl(res._previewUrl);
            const safe = Object.assign({}, res); delete safe._previewUrl;
            const openMsg = open
                ? (opened.opened ? "Opened the preview in the user's browser. " : "Could not open a browser automatically (" + opened.reason + "). ")
                : "Preview available but NOT opened (auto-mode default). For human review, call pal_preview with open:true. ";
            return Object.assign(safe, {
                message: openMsg + res.reason + dirtyNote +
                    "\n⚠ You did NOT see this render. Do not report what the page shows, whether a save/click/flow" +
                    " succeeded, or any specific data as observed fact — you have no evidence of it. Use" +
                    " pal_screenshot to actually see a console/transaction render, or ask the user."
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
            // A fetched body proves routing/content, not responsive visual quality. Only audited
            // desktop/mobile screenshots satisfy the visual gate.
            // Token-efficient default: verify expected strings, never return the page body.
            if (expect && expect.length) {
                const chk = checkExpect(res.html, expect);
                const safe = Object.assign({}, res); delete safe.html;
                return withServerDebug(ctx, Object.assign(safe, { pass: chk.pass, results: chk.results,
                    message: formatExpect("Fetched " + path, { status: res.status, bytes: res.bytes }, chk) }));
            }
            if (selector || maxChars) {
                return withServerDebug(ctx, htmlRegionResult(res, {
                    headline: "Fetched " + path,
                    filePrefix: "palsync-fetch-",
                    guid: ctx.record.palGuid,
                    selector,
                    maxChars,
                    workspaceDir: ctx.workspaceDir,
                    tool: "pal_fetch",
                    feature: "fetch-" + path
                }));
            }
            let filePath = null;
            let run = null;
            try {
                run = createWorkHistoryRun(ctx.workspaceDir, { tool: "pal_fetch", feature: "fetch-" + path });
                filePath = writeArtifactFile(run, "body.html", res.html, "utf8");
                writeRunMetadata(run, {
                    palGuid: ctx.record.palGuid,
                    palName: ctx.record.palName,
                    path,
                    url: res.url,
                    status: res.status,
                    contentType: res.contentType,
                    title: res.title,
                    bytes: res.bytes,
                    artifact: filePath ? pathMod.basename(filePath) : null
                });
                writeRunNotes(run, [
                    "# pal_fetch",
                    "",
                    "- Path: `" + path + "`",
                    "- URL: " + res.url,
                    "- Status: " + res.status,
                    "- Size: " + res.bytes + " bytes",
                    "- Artifact: `" + (filePath ? pathMod.basename(filePath) : "not written") + "`"
                ]);
            } catch (e) { /* best-effort */ }
            const truncated = res.html.length > PREVIEW_INLINE_CAP;
            const shown = truncated ? res.html.slice(0, PREVIEW_INLINE_CAP) : res.html;
            const safe = Object.assign({}, res); delete safe.html;
            return withServerDebug(ctx, Object.assign(safe, {
                htmlFile: filePath,
                message: "Fetched " + path + " — status=" + res.status + " content-type=" + res.contentType +
                    " title=" + JSON.stringify(res.title) + " size=" + res.bytes + " bytes" +
                    (run ? "\n  Work-history run: " + run.dir : "") +
                    (filePath ? "\n  Full body saved to: " + filePath : "") +
                    "\n\n--- served body" + (truncated ? " (first " + PREVIEW_INLINE_CAP + " bytes — read the file for the rest)" : "") + " ---\n" + shown
            }));
        }
    },
    {
        name: "pal_screenshot",
        description: "Render a pal screen to a PNG for visual review, detect runtime render errors, and return a browser-computed designAudit (overflow, H1/main structure, form labels/orientation, target size, bare action links, visible skip links, table headers, and spacing metrics). Acts on the LAST PUSHED version — pal_push first. For page-level UI, capture both desktop and mobile; designAudit.errors must be 0, then inspect the pixels and fix/re-render visible failures. WEB renders directly; CONSOLE/transaction use authenticated replay. Missing Playwright/auth returns an honest unavailable signal, never a fake pass.",
        inputShape: {
            page: z.string().optional().describe("Page path under the site root, e.g. \"about.html\" (WEB only). Default: home page."),
            feature: z.string().optional().describe("Human label for the feature or flow being tested. Used to name the .agent-work-history run folder."),
            viewport: z.enum(["desktop", "mobile"]).optional().describe("desktop (1280x800, default) or mobile (~390x844)."),
            fullPage: z.boolean().optional().describe("Capture the whole scroll height, not just the viewport.")
        },
        async run(ctx, { page, feature, viewport, fullPage } = {}) {
            const res = await runScreenshot(ctx.session, ctx.record.palGuid, { page, viewport, fullPage });
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            if (!res.captured) {
                if (res.available === false) ctx.renderVerified = "unavailable"; // accepted fallback: ask the user to eyeball it
                return Object.assign(res, {
                    message: (res.available === false ? "Screenshot unavailable: " : "Could not screenshot: ") + res.reason +
                        (res.validation ? "\n" + formatValidation(res.validation) : "")
                });
            }
            // A clean capture (no renderError) is the only thing that actually proves the UI renders —
            // a renderError leaves renderVerified false so the reminder keeps firing until it's fixed.
            const auditClean = res.designAudit && res.designAudit.inspected && res.designAudit.errors === 0;
            const screenshotClean = !res.renderError && (!res.styleStatus || res.styleStatus.likelyLoaded !== false) && auditClean;
            const visualGate = recordScreenshotEvidence(ctx, {
                route: page || "/",
                viewportName: res.viewportName,
                clean: screenshotClean
            });
            // Save the PNG to a file the harness can Read, and return MCP image content so a
            // vision-capable model sees the render inline.
            let filePath = null;
            let auditPath = null;
            let run = null;
            const featureLabel = feature || (page ? "page-" + page : (res.kind || "pal") + "-" + res.viewportName);
            try {
                run = createWorkHistoryRun(ctx.workspaceDir, { tool: "pal_screenshot", feature: featureLabel });
                filePath = writeArtifactFile(run, "screenshot-" + res.viewportName + ".png", Buffer.from(res.pngBase64, "base64"));
                auditPath = writeArtifactFile(run, "design-audit.json", JSON.stringify(res.designAudit || { inspected: false }, null, 2), "utf8");
                writeRunMetadata(run, {
                    palGuid: ctx.record.palGuid,
                    palName: ctx.record.palName,
                    page: page || null,
                    url: res.url,
                    kind: res.kind,
                    viewportName: res.viewportName,
                    viewport: res.viewport,
                    fullPage: !!fullPage,
                    renderError: res.renderError || null,
                    styleStatus: res.styleStatus || null,
                    designAudit: res.designAudit || null,
                    artifact: filePath ? pathMod.basename(filePath) : null,
                    designAuditArtifact: auditPath ? pathMod.basename(auditPath) : null,
                    smallDims: res.smallDims || null
                });
                writeRunNotes(run, [
                    "# pal_screenshot",
                    "",
                    "- Feature: " + featureLabel,
                    "- URL: " + res.url,
                    "- Kind: " + (res.kind || "web"),
                    "- Viewport: " + res.viewportName + " " + res.viewport.width + "x" + res.viewport.height,
                    "- Full page: " + (!!fullPage),
                    "- Artifact: `" + (filePath ? pathMod.basename(filePath) : "not written") + "`",
                    "- Design audit: `" + (auditPath ? pathMod.basename(auditPath) : "not written") + "`",
                    "- " + formatStyleStatus(res.styleStatus),
                    "- " + formatDesignAudit(res.designAudit),
                    res.renderError ? "- Runtime render error: " + res.renderError.message : "- Runtime render error: none"
                ]);
            } catch (e) { /* best-effort */ }
            const errBlock = res.renderError
                ? "\n\n⚠ RUNTIME RENDER ERROR — the page did NOT render its UI; it threw at runtime:\n"
                    + "  " + res.renderError.message
                    + (res.renderError.workflow ? "\n  workflow: " + res.renderError.workflow : "")
                    + (res.renderError.function ? "  function: " + res.renderError.function : "")
                    + (res.renderError.methodCalled ? "\n  at: " + res.renderError.methodCalled : "")
                    + (res.renderError.line ? " (approx. line " + res.renderError.line + ")" : "")
                    + "\nThis is a FAIL — pal_test passing only means the workflow COMPILES. Fix the fault, push, and screenshot again before declaring the screen done."
                : "";
            const auditFailures = res.designAudit && res.designAudit.findings
                ? res.designAudit.findings.filter(f => f.severity === "error") : [];
            const auditBlock = auditFailures.length
                ? "\n\n⚠ DESIGN AUDIT FAILED — fix these rendered facts and re-capture this viewport:\n" +
                    auditFailures.map(f => "  - " + f.rule + ": " + f.message +
                        (f.samples && f.samples.length ? " [" + f.samples.join(", ") + "]" : "")).join("\n")
                : "";
            const text = (res.kind ? res.kind.toUpperCase() : "WEB") + " screenshot captured — " + res.viewportName + " " + res.viewport.width + "x" + res.viewport.height +
                (fullPage ? " (full page)" : "") + "\n  url=" + res.url +
                "\n  " + formatStyleStatus(res.styleStatus) +
                "\n  " + formatDesignAudit(res.designAudit) +
                "\n  Visual gate: " + (visualGate.complete ? "complete" : "incomplete; clean desktop + mobile still required for " + visualGate.incomplete.join(", ")) +
                (run ? "\n  Work-history run: " + run.dir : "") +
                (filePath ? "\n  PNG saved to: " + filePath : "") +
                (auditPath ? "\n  Design audit saved to: " + auditPath : "") + errBlock + auditBlock;
            const safe = Object.assign({}, res); delete safe.pngBase64; delete safe.jpegSmallBase64; // don't double-include the base64 blobs
            // Attach the c.debug trail (prime evidence beside a renderError) BEFORE assembling the
            // content blocks, so the debug text rides the visible text block too.
            const out = await withServerDebug(ctx, Object.assign(safe, { pngFile: filePath, visualGate, message: text }));
            // Inline a downscaled JPEG so the render doesn't ride at full resolution in every
            // subsequent turn's context; the full-res PNG is still on disk at pngFile. Falls back
            // to the full PNG if the in-page re-encode failed.
            const inlineImage = res.jpegSmallBase64
                ? { type: "image", data: res.jpegSmallBase64, mimeType: "image/jpeg" }
                : { type: "image", data: res.pngBase64, mimeType: "image/png" };
            out.content = [
                { type: "text", text: out.message },
                inlineImage
            ];
            return out;
        }
    },
    {
        name: "pal_exercise",
        description: "Functionally EXERCISE workflow actions end-to-end and assert the persisted result in the rendered output — the check above compile (pal_test) and render (pal_screenshot): did the WRITE actually do the right thing? Acts on the LAST PUSHED version — pal_push first. Each step triggers an action, then asserts expect:[strings that MUST appear] and absent:[strings that must NOT appear] — put the OLD value in absent after an edit to catch a duplicate insert. WEB pal: steps use action+params (headless). CONSOLE/transaction pal: steps use fill (inputs by name=) + click (the action link's exact visible text) — drives the real authenticated screen. Steps run in order and stop at the first failure. Use after building any create/edit/delete action, and to verify pal-loop's read-back requirement.",
        inputShape: {
            steps: z.array(z.object({
                page: z.string().optional().describe("WEB only: page path under the site root to load first, e.g. \"equipment.html\"."),
                action: z.string().optional().describe("WEB only: workflow action to invoke, e.g. \"saveEquipment\". Sent as ?action=<name> with params."),
                params: z.record(z.union([z.string(), z.number()])).optional().describe("WEB only: query params sent with the action, e.g. {\"name\":\"Camera\"}."),
                fill: z.record(z.union([z.string(), z.number()])).optional().describe("Fill inputs by their name= attribute before clicking, e.g. {\"name\":\"Camera\",\"category\":\"AV\"}."),
                click: z.string().optional().describe("EXACT visible text of the link/button to click (a c:a Save link), or a simple #id/.class selector."),
                expect: z.array(z.string()).optional().describe("Strings that MUST appear in the rendered output after this step (the saved value in the list)."),
                absent: z.array(z.string()).optional().describe("Strings that must NOT appear after this step (the pre-edit value; a stale row proves a duplicate insert).")
            })).min(1).max(10).describe("Steps run in order; the run stops at the first failing step."),
            workflow: z.enum(["console", "web", "transaction"]).optional().describe("Engine to exercise (default: auto-detected)."),
            viewport: z.enum(["desktop", "mobile"]).optional().describe("Browser-mode viewport (default desktop).")
        },
        async run(ctx, { steps, workflow, viewport } = {}) {
            const res = await runExercise(ctx.session, ctx.record.palGuid, { steps, workflow, viewport });
            if (ctx.lifecycle) ctx.lifecycle.onActivity();
            // Functional exercise proves behavior, not responsive visual quality. Only paired,
            // audited pal_screenshot captures can satisfy the page-level render gate.
            return Object.assign({}, res, { message: formatExercise(res) });
        }
    },
    {
        name: "pal_seo_audit",
        description: "On-page SEO audit of a WEB pal's server-rendered page (last pushed): title/meta, canonical, og/twitter, single H1, JSON-LD, img alt, robots.txt/sitemap.xml/llms.txt. Returns each problem + its fix, plus what PASSED. Use after pushing a web page; fix every ERROR. Not for console pals. Read the seo-core skill BEFORE writing heads; this verifies the result.",
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
        description: "Create or update dataset TABLES on the server from pal.json's dataset definitions (it saves the pal first — editing datasets/<name>.json alone only changes the definition, not the table). " +
            "Default is a SAFE sync: create if missing, additive changes only, never deletes data. " +
            "recreate:true DROPS AND REBUILDS a table, DELETING ALL ITS ROWS, and requires a separate exact typed confirmation — it can't happen by accident.",
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
                ctx.renderVerified = false;
                ctx.renderViewportEvidence = {};
                const verb = res.recreated ? "RECREATED (dropped + rebuilt, data deleted)" : "synced (created/updated, data kept)";
                const freeformNote = (res.freeformDefaulted && res.freeformDefaulted.length)
                    ? "\nSet freeform:true on " + res.freeformDefaulted.join(", ") + " (required so the table gets real per-field columns; without it column queries throw \"Unknown column\" at runtime). This was written back to pal.json."
                    : "";
                return Object.assign(res, {
                    message: "Datasets " + verb + " on the server — " + res.targets.length + " table(s):\n" +
                        res.schemas.map(s => "   - " + s).join("\n") +
                        "\nThe tables now match these schemas. (A dataset table exists only after this step — editing the .json alone never creates it.)" + freeformNote
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
        description: "Reconcile un-pushed LOCAL changes with SERVER changes since your last pull, keeping BOTH where they don't collide (3-way merge): yours-only stay, server-only are taken, a file BOTH changed is kept as YOURS with the server's beside it as <file>.server to combine by hand. Never overwrites your work silently. Use instead of force push/pull when both sides edited; a clean merge clears drift so pal_push isn't blocked.",
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
        description: "Push local changes to the server (UPDATE). FIRST runs the offline code check (pal_validate) and REFUSES on errors — every error must be fixed before the push can proceed; each finding says exactly how. force:true is drift-only: it can overwrite a newer server marker, but it cannot bypass validation errors. Also refuses if the pal is locked by another person (typed confirmOverride). On success returns the server's save result plus any code WARNINGS.",
        // skipValidation is deliberately NOT in inputShape (the MCP layer strips unknown keys, so
        // agents cannot pass it). In the test-06 haiku run the agent read the "call pal_push with
        // skipValidation:true" hint in this tool's refusal message, decided the validator was
        // "overly cautious", and pushed past 9 real errors six times in a row. Agents fix errors.
        // run() still accepts it because the CLI's --skip-validation flag (human escape hatch)
        // calls run() directly, bypassing the MCP schema.
        inputShape: { force: z.boolean().optional(), confirmOverride: z.string().optional() },
        async run(ctx, { force = false, confirmOverride, skipValidation = false } = {}) {
            const palName = ctx.record.palName;
            const overrideLock = confirmOverride === overridePhrase(palName);
            const res = await push(ctx.session, ctx.record, ctx.workspaceDir, { force: !!force, overrideLock, skipValidation: !!skipValidation });
            // Pre-push lint refusal: errors found, push not attempted.
            if (res.refused === "validation") {
                return Object.assign(res, {
                    message: "REFUSED: the offline code check found errors that would break in PalBuilder, so nothing was pushed.\n\n" +
                        formatLint(res.lint, { context: "pre-push" }) +
                        "\n\nFix the ERROR items above and push again — each finding tells you exactly how. There is no " +
                        "bypass: force:true is drift-only and cannot push past validation; these errors describe code the " +
                        "server will reject or mis-render, and a passing pal_test does not clear them."
                });
            }
            if (res.pushed) {
                refreshBaseline(ctx.record, ctx.workspaceDir, res.serverPaths);
                await ctx.persist();
                ctx.renderVerified = false; // a push can change what renders — re-verify before declaring done
                ctx.renderViewportEvidence = {};
                // Surface any pre-push WARNINGS even on success (errors can't reach here unless
                // skipValidation forced past them — say so loudly).
                const warnBlock = res.lint && res.lint.warnings > 0
                    ? "\n\n⚠ Code warnings (push allowed, task not done until handled):\n" + formatLint(res.lint, { context: "validate" }) +
                      "\n\nFix these warnings, or checkpoint why each one is safe before marking the task done."
                    : "";
                const skippedBlock = res.skippedValidation
                    ? "\n\n⚠ You pushed past " + res.lint.errors + " validation ERROR(s) with skipValidation — the pal may not compile/render in PalBuilder:\n" + formatLint(res.lint, { context: "validate" })
                    : "";
                const webBlock = res.webRegistered
                    ? "\n\n🌐 Registered \"" + res.webRegistered + "\" as the pal's web workflow (this makes it a Web Pal so it can render/preview). Run pal_pull to sync the registration into pal.json."
                    : "";
                const consoleBlock = res.consoleRegistered
                    ? "\n\nRegistered \"" + res.consoleRegistered + "\" as the pal's console workflow. Run pal_pull to sync the registration into pal.json."
                    : "";
                const folderBlock = res.prunedFolders && res.prunedFolders.length
                    ? "\n\nPruned phantom PalBuilder folder registrations from the push payload:\n" +
                      res.prunedFolders.map(f => "   - " + f.folderType + "/" + f.name + " (" + f.reason + ")").join("\n") +
                      "\nThese are local workspace bucket names, not real PalBuilder subfolders; removing them prevents empty folders from appearing in Pal Explorer."
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
                            : "") + folderBlock + skippedBlock + warnBlock + webBlock + consoleBlock + renderNotVerifiedReminder(ctx)
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

module.exports = { TOOLS, overridePhrase, blockedMessage, formatExpect, formatValidation, isBenignServerNote,
    htmlRegionResult, recordScreenshotEvidence };
