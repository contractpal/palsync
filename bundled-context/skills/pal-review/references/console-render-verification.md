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
   same args (page, viewport, fullPage). Playwright replays the cp-auth redirect chain when Chromium
   is installed. Don't assume MCP.
2. **`captured:true`** → the render is agent-visible after all.
   - **Check the final captured URL.** It must be the intended console screen. A redirect to a
     `/login/` or Login route is expired authentication, not a successful render, even when the
     login page itself rendered without `renderError`. `pal_screenshot` reports this as
     `captured:false, authExpired:true` with a sanitized final URL; run it again for a fresh session.
   - **First check `renderError`.** A screenshot can capture a page that THREW at runtime — the
     workflow compiled and `pal_test` validated, but it errored while rendering (bad SQL, null deref,
     a column the table doesn't have) so CloudPiston painted its error block instead of the UI.
     `pal_screenshot` parses that block and returns `renderError` (message, workflow, function, line).
     **A non-null `renderError` is a hard FAIL — never `done`.** Read the fault, fix it, push, and
     screenshot again. `pal_test` passing does NOT clear this; only a clean render does.
   - If `renderError` is null, judge the image against the §12 VISUAL criterion (renders per
     DESIGN_SYSTEM.md, no anti-slop fingerprints) exactly like a web render, and mark the task `done`
     on that real evidence.
3. **`captured:false`** (no Chromium, auth expiry/login redirect, or replay failure/timeout) → do NOT mark the render
   `done`, and do NOT guess from HTML. Do the buildable part, verify everything else you can
   (validate, test, data read-back), then set `needs-human` with a Blockers entry prefixed
   `HUMAN GATE:` naming exactly what to eyeball (open screen X, confirm it renders + the §5 happy
   path works). Never skip this silently.

## Why the fallback always stays paired
Console auth replay is live-verified, but it is a **capability, not a guarantee** — Chromium may be
absent or the replay may fail. So every console VISUAL criterion carries its human-eyeball fallback
alongside it; the gate is never dropped just because capture usually works.
