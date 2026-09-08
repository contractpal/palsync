# Regression baseline — optional, on demand

`pal_regression` compares an existing pal against `baseline/baseline.json`. The baseline is
**optional**: no `baseline/` means regression does not apply, and nothing creates one
automatically. Capture one only when a change is broad enough that "did I break something
untouched?" is a real question (shared fragment, shared workflow, auth, schema), or when the
user asks for regression coverage.

## Capture (before the change)

Record what passes right now:

- `pal_validate` → current `diagnosticCount` (`ok:false` → you inherited it; record it).
- `pal_test` on the primary workflow(s) → current VALIDATED state.
- Web: `pal_fetch`/`pal_preview` on key pages → note the H1s.
- `pal_screenshot` the key screens. A viewport that times out is not a failure — record it
  `eyeball_only` and move on.

Write `baseline/baseline.json` at the workspace root in this exact shape (`pal_regression`
parses it; do not rename fields):

```json
{
  "mapped": "2026-06-12 17:29:25.0",
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
