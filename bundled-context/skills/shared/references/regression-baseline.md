# Regression baseline — optional, on demand

`pal_regression` compares an existing pal against `baseline/baseline.json`. The baseline is
**optional**: no `baseline/` means regression does not apply, and nothing creates one
automatically. Capture one only when a change is broad enough that "did I break something
untouched?" is a real question (shared fragment, shared workflow, auth, schema), or when the
user asks for regression coverage.

## Capture (before the change)

Capture is explicit and never runs after `pal_push`. First call `pal_status`, then have the
operator approve that exact observed marker. Call `pal_capture_baseline` with:

- `revision`: the exact `server marker` from `pal_status`.
- `approval`: `CAPTURE <pal-guid> @ <revision>` — typed by the operator, not inferred from a
  passing push or an agent assessment.

Capture refuses unknown identity/revision, any local tracked-file addition/modification/deletion,
validation errors, failed workflow/page evidence, incomplete required screenshots, or a marker
change during capture. `force` never bypasses these gates. It does not save the Pal or alter
production datasets/records.

On refresh it reruns every workflow, page, viewport, and screenshot already in the approved
snapshot; it preserves `known_issues` and uncaptured `eyeball_only` coverage. A required screenshot
must produce and write its PNG or the prior baseline remains untouched. A first capture records
validation plus a fresh server workflow test; add page/screenshot coverage through a reviewed
baseline rather than letting the agent guess critical screens.

`baseline/baseline.json` is the user-approved regression snapshot. It is separate from
`.palsync/baseline/`, the internal text-content store used only for push/merge drift protection.
The snapshot uses this backward-compatible shape (`pal_regression` parses it; do not rename
load-bearing fields):

```json
{
  "mapped": "2026-06-12 17:29:25.0",
  "captured_at": "2026-06-12T17:31:02.123Z",
  "metadata": { "pal_guid": "…", "server_timestamp": "2026-06-12 17:29:25.0" },
  "validate": { "errors": 0, "warnings": 0 },
  "test": { "web": { "status": "VALIDATED", "notes": 0 } },
  "pages": {
    "home.html": {
      "h1s": ["Custom Concrete Coatings in Utah."],
      "viewports": {
        "mobile":  { "captured": true, "screenshot": "screenshots/home.html-mobile.png" },
        "desktop": { "captured": false, "reason": "timeout", "eyeball_only": true }
      }
    }
  },
  "known_issues": ["<confirmed pre-existing defect>"]
}
```

Screenshots live in `baseline/screenshots/<page>-<viewport>.png`. Pull never touches `baseline/`.

Two fields are load-bearing:

- **`mapped`** — the SAME sql-timestamp string `pal_status` reports as its pull/server marker
  (`"yyyy-MM-dd HH:mm:ss.S"`), not a human-readable date.
- **`known_issues`** — confirmed, observed pre-existing defects, so an inherited failure is
  never scored as one you caused. Not speculation.

## Freshness (canonical)

Before any comparison, `mapped` is checked against a fresh `pal_status`. Server moved since
`mapped` → the baseline is STALE, `pal_regression` returns `{stale}` and produces NO verdict.
Refresh the baseline with the capture steps above, or report the stale state; never verdict
against a stale baseline.
