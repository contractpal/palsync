# Implementation brief — pal_screenshot tool (autonomous UI/UX review)

For Claude Code, in the palsync repo. This needs live-server testing (console auth replay), so
it's a build-and-verify job, not a blind drop-in. Grounded in functions that already exist.

## Goal
A new MCP tool `pal_screenshot` that renders a pal screen in a headless browser and returns a PNG,
so pal-review's visual arm (and a vision-capable model) can judge UI/UX automatically instead of
parking every visual check at the human eyeball gate.

## Why this is mostly already solved
palsync already owns the hard PalBuilder-specific part — building the authenticated runnable URL:
- `src/core/test.js` → `buildPreviewUrl(session, token, kind, profileId, workflowName)` produces
  the runnable URL. WEB pals resolve to a directly-fetchable URL on webpals.cloudpiston.com with
  NO auth. CONSOLE pals get `&cp-auth=` (+ `nxProfileId`, `cp-workflow`) injected.
- `src/core/preview.js` → `openInstanceSession(session, guid)` already activates a test session
  and replays the redirect/cookie chain console rendering needs (see the note at preview.js ~L77
  about cookies absorbed during the fetch redirect chain).
So the screenshot tool does NOT re-solve auth — it drives a headless browser to a URL/session
palsync already knows how to construct.

## Build order (ship web first — big win, low risk)

### Phase 1 — WEB pals (do this first)
- Add Playwright (headless Chromium) as an OPTIONAL dependency of the tool runtime.
- `pal_screenshot({ page?, viewport?, fullPage? })`:
  1. Resolve the web pal's directly-fetchable URL via the existing test/preview path (the WEB
     rawToken is already fetchable, no auth — confirmed in test.js comments).
  2. Playwright: launch Chromium, set viewport (default desktop 1280×800; accept `viewport:
     "mobile"` → ~390×844 for responsive checks), goto URL, wait for network idle, screenshot
     (fullPage optional).
  3. Return the PNG (base64 or a saved path the harness can read) plus the resolved URL and
     viewport used.
- This alone gives autonomous visual review for every marketing/web pal (e.g. the MacroWeek site).

### Phase 2 — CONSOLE pals (after web works)  ✅ IMPLEMENTED + LIVE-VERIFIED (T8)
- IMPLEMENTED: `runScreenshot` auto-detects the engine. For CONSOLE/transaction it navigates
  Playwright to `runTest`'s `_previewUrl` (the cp-auth'd URL pal_test already opens in the user's
  browser); the browser absorbs the auth redirect chain — no separate cookie loading needed. A
  failed/timed-out auth replay is caught and returned as `{ captured: false, reason }` (eyeball-gate
  fallback). The returned `url` is sanitized to origin+path so no credential is surfaced, and the
  error path strips URL-shaped text. `_previewUrl` is never returned or logged.
- ✅ LIVE-VERIFIED (against ISR-SEO-Dashboard, a real authenticated console pal): pal_screenshot
  returned `captured:true` with a valid PNG (79,828 bytes, 1280×800) that visibly rendered the
  authenticated AuditHelm "Clients" console dashboard (real client rows). Security scan of the
  result object found NO leak of the cp-auth token / password / authed URL; the returned `url` was
  the sanitized `…/RunConsoleApp.do` (no query). A second pal (Allan-Iverson) that didn't validate
  server-side returned the clean `captured:false` fallback, confirming the safe-degrade path.
  The navigation-based replay was sufficient — no explicit cookie loading was needed.
- Regression coverage: `test/screenshot.test.js` mocks the auth-replay path (console navigates the
  cp-auth'd `_previewUrl` → sanitized url + no cred leak; replay failure → clean `captured:false`,
  never a throw; web rawToken; no-Chromium unavailable; unvalidated pal).

## Harness-agnostic + graceful degradation (required)
- **No Playwright/Chromium in the runtime** (some harnesses won't have it) → the tool reports
  unavailable; pal-review detects this and routes visual checks to the eyeball gate. Capability,
  not assumption — same pattern as the delegation protocol.
- **No vision-capable model** in the loop (GLM/DeepSeek text legs) → the screenshot is still
  captured, but judging is deferred to a vision model or the human. pal-review handles this.

## Security (match existing posture)
- test.js already flags that the runnable URL embeds the base64 password and is NEVER returned to
  the caller. Same rule here: never return the cp-auth URL or credentials in the tool output —
  return only the image + a sanitized URL. Don't log the auth'd URL.

## Tool naming / wiring
- Name `pal_screenshot`, register in `src/mcp/tools.js` alongside pal_preview/pal_fetch.
- Keep it read-only (renders the last-pushed version; like preview/test it acts on what's pushed).
- Add to pal-spec §9 "PalBuilder surface" awareness only if used; pal-review auto-detects it.

## Acceptance (how you'll know it works)
- Web: `pal_screenshot` on a known web pal returns a PNG that visibly matches the live page.
- Console (phase 2): returns a PNG of an authenticated console screen, or a clean
  `captured:false` fallback.
- Unavailable runtime: returns a clear "unavailable" signal, and pal-review degrades to eyeball.

## Status
Both items below are done — pal-spec's §12 now requires a VISUAL criterion (web: required; console:
required with a human-eyeball fallback) verifiable via `pal_screenshot`/pal-review's visual arm, and
console auth replay (Phase 2) is implemented and live-verified (see above). pal-loop's task cycle and
"Build complete → hand off to pal-review" section both route console renders through
`pal_screenshot` first, falling back to the human-eyeball gate only on `captured:false`.

## Future / deferred
- None outstanding from the original design. Next gap to watch: the global `palsync` install many
  workspaces run can drift behind this repo's HEAD (check `.installed-sha` / `palsync status`) —
  pal_screenshot, pal-review, and this capability-gated wiring only exist in workspaces injected by
  a build that includes them. Run `palsync upgrade` to pick up new skills/tools.
