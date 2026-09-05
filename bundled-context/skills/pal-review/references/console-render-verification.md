# Console render verification — the canonical rule

The single source of truth for how a console screen's **render** is verified, and when it falls back
to a human. Every skill that touches console verification points here instead of restating it
(pal-loop, pal-review, pal-spec's §12 + reality check, pal-init baseline capture).

## The distinction
- **Compile** is agent-verifiable, always: `pal_test` runs `TestConsole.do` and returns fresh server
  validation for console AND web. Compile is NOT a human gate.
- **Render** is the open question for console. `pal_preview` never renders a console screen for the
  agent — it opens the screen in the platform console chrome via a browser, for the *user*. Web
  renders ARE agent-visible (`pal_preview` returns the HTML), so web screens have no render gate.

## Verifying a console render
1. Try to capture it. The screenshot capability is either the `pal_screenshot` MCP tool (Claude
   Code) OR the `palsync screenshot` CLI subcommand (Pi / headless harnesses, no MCP) — same core,
   same args (page, viewport, fullPage, workflow, workflowName, action, params, expect). Explicit workflow/type/name selection wins over auto-detection. Workflow names are normalized by stripping file extensions consistently. Playwright replays the cp-auth redirect chain when Chromium is installed. Don't assume MCP.
   - **Targeting a console action.** `action` takes the same form `c:a` uses: `"openClientSetup"` or
     `"openClientSetup?id=9"`. `params:{id:9}` is the same thing spelled apart; giving both with
     different values is refused rather than silently resolved. The action is dispatched as
     `cp-ws-doaction`, the platform's own "open the test console at this action" mechanism.
   - **Always pass `expect:[...]`** when you target an action or a route — the visible strings that
     prove you are on the intended screen (e.g. `["Client Setup", "Step 8"]`). Without them the tool
     reports `stateVerified:null`: it captured *a* screen, but nothing proves it is *your* screen.
     Do not use the URL as the oracle — `c:a` navigation leaves `window.location` stale.
2. **`captured:true`** → the render is agent-visible after all.
   - **Check `stateVerified`.** `true` = every string in `expect` was visible, so this really is the
     requested screen. `null` = you declared no expectation; the image is not proven to be the screen
     you targeted — re-run with `expect` before treating it as evidence for a specific screen.
   - Expired authentication is reported as `captured:false, authExpired:true` (the tool already
     retried once against a fresh test instance), not as a render.
   - **First check `renderError`.** A screenshot can capture a page that THREW at runtime — the
     workflow compiled and `pal_test` validated, but it errored while rendering (bad SQL, null deref,
     a column the table doesn't have) so CloudPiston painted its error block instead of the UI.
     `pal_screenshot` parses that block and returns `renderError` (message, workflow, function, line).
     **A non-null `renderError` is a hard FAIL — never `done`.** Read the fault, fix it, push, and
     screenshot again. `pal_test` passing does NOT clear this; only a clean render does.
   - If `renderError` is null, judge the image against the §12 VISUAL criterion (renders per
     DESIGN_SYSTEM.md, no anti-slop fingerprints) exactly like a web render, and mark the task `done`
     on that real evidence.
3. **`captured:false, category:"targeting"`** → the browser rendered a DIFFERENT screen than you
   asked for. This is a FAIL, not a blocker: the reason names the requested action/paramKeys and the
   observed headings, and the retained image is labelled failure evidence, not render evidence. Fix
   the action/params (or the pal), then capture again. It records nothing toward the visual gate.

4. **`captured:false`** (no Chromium, auth expiry/login redirect, or replay failure/timeout) → do NOT mark the render
   `done`, and do NOT guess from HTML. Do the buildable part, verify everything else you can
   (validate, test, data read-back), then set `needs-human` with a Blockers entry prefixed
   `HUMAN GATE:` naming exactly what to eyeball (open screen X, confirm it renders + the §5 happy
   path works). Never skip this silently.

## Why the fallback always stays paired
Console auth replay is live-verified, but it is a **capability, not a guarantee** — Chromium may be
absent or the replay may fail. So every console VISUAL criterion carries its human-eyeball fallback
alongside it; the gate is never dropped just because capture usually works.
