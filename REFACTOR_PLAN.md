# palsync — full review + refactor: spacing fix, runtime perf, weak-model efficiency

## Context

palsync ships an MCP server + bundled agent context (18 skills, 2 starters, pb-* CSS design system) that agents — including weak models like Haiku — use to build pals on PalBuilder. Sam ran a Haiku test build (`~/PalBuilder/equipment_checkout-haiku`, eval spec 01) and the UI came out cramped: content flush to viewport edges, form fields touching, sections with no rhythm. This plan fixes the spacing problem at the root (correct-by-default starters + prescriptive rules), removes two real runtime hot paths in the MCP server, and cleans up stale context — while explicitly protecting the weak-model guardrails that earn their tokens.

Sam's decisions (2026-07-09): rewrite eval stub to pb-* ✓; verification = static checks only (no fresh Haiku eval run) ✓; token trimming = conservative ✓.

**Executor: Codex.** Every step is self-contained. Repo: `/Users/apple/Documents/palsync`, branch `main`, clean at planning time.

## Diagnosis summary (exploration complete, screenshot-verified)

The pb-* primitives are fine (tables/buttons/inputs have correct internal padding). The failure is structural wrappers + guidance:

1. **The shipped starter shell itself is the root bug.** `bundled-context/starters/console-app/pages/console.html:14` wraps fragments in `<div id="body" class="app-body">` — `app-body` is defined **nowhere** in either CSS file. Haiku copied the shell verbatim → no max-width, no gutter, content at x=0 while the navbar (`.pb-navbar-inner`, 1200px centered) sits inset → misaligned gutters. The starter's own `dashboard.html` fragment wraps itself in `<main id="main" class="pb-main">`, but nothing tells a builder that new fragments must do the same, so they don't.
2. **Siblings inside `.pb-main` touch.** `.pb-main` (design-system.css:130) is a plain block (padding only). `.pb-section` (:131, grid gap 24px), `.pb-stack` (:132, 16px), `.pb-cluster` (:133, 12px), `.pb-grid-2/3` (:134-135, 24px) exist but `component-library.md` (931 lines, 55 headings) has **no Layout/Spacing section** — the primitives are never explained. The starter dashboard even models the flush layout (`pb-grid-3` + `pb-card` as direct `pb-main` children, touching).
3. **Form fields stack with zero gap.** `.pb-field-group` (design-system.css:191) spaces only its own label→input; `.pb-card` (:220) has padding but no child gap. No doc states "wrap multiple fields in `.pb-stack`/`.pb-form-grid`". Haiku stacked 3 field-groups touching.
4. **Two conflicting spacing scales**, undocumented: `--s5`=24px (spacing.css:12) vs `--ds-space-5`=20px (design-system.css tokens). No renumbering (breaks everything); needs a one-line usage rule.
5. **No spacing item in any checklist** (design-build acceptance :117-136, design-principles review :168-181, pal-review vision-gated "spacing rhythm" one-worder).
6. **Eval stub contradiction**: `eval/specs/DESIGN_SYSTEM.md` prescribes bootstrap 5.3.5 classes while starters scaffold pb-* CSS — two authorities.
7. **Runtime**: `usage.recordToolCall` (src/core/usage.js:41-58) does sync read-modify-write of `.palsync.usage.json` on EVERY MCP tool call (src/mcp/server.js:50). `pal_screenshot` (src/core/screenshot.js:288) cold-launches Chromium per call.

### Load-bearing facts (do not break)
- `id="body"` is targeted by `document.getElementById("body").scrollTop = 0` in `bundled-context/skills/palbuilder-frontend/SKILL.md:311` — the shell fix must keep the id.
- Canonical CSS: `bundled-context/skills/design-system-init/references/{spacing.css,design-system.css}` with byte-identical copies in `bundled-context/starters/console-app/styles/` and `bundled-context/starters/web-marketing/styles/`. Every CSS edit syncs to all 3 copies (md5 check).
- `test/amendmentLoop.test.js` regex-pins phrases in pal-loop/pal-spec SKILL.md — pinned phrases stay single-line. Run `npm test` (222 tests) after any doc edit.
- usage.js instrumentation is best-effort by design ("never let metering break a tool call") — losing ≤1s of tally on crash is acceptable.
- `formatCost` (usage.js:108) reads the usage file at server shutdown (server.js:117) — flush ordering matters.
- Weak-model doc style (eval-derived): short imperative sentences, IF→THEN, critical rules INLINE (pointers alone don't get followed), code examples verbatim (they get transcribed).

---

## Milestone A — Spacing fix (highest impact)

Principle: **correct-by-default > documented > checklisted** — do all three layers, but the starter fix does most of the work because weak models copy the starter.

### A1. Fix the starter console shell (root cause)
`bundled-context/starters/console-app/pages/console.html:14` — replace:
```html
<div id="body" class="app-body">
    <c:fragment name="${frag}" />
</div>
```
with:
```html
<main id="body" class="pb-main">
    <c:fragment name="${frag}" />
</main>
```
Shell now owns the page container: every fragment automatically gets max-width 1200px, centering, and 32px gutters (20px mobile). Keeps `id="body"` (scroll-reset target).

### A2. Update starter dashboard fragment to match
`bundled-context/starters/console-app/fragments/dashboard.html` — the fragment currently wraps itself in `<main id="main" class="pb-main">`. With A1 that would nest `<main>` inside `<main>` (invalid) and double the padding. Change the fragment root to:
```html
<c:ignore xmlns:c="contractpal">
  <div class="pb-section">
    ...existing content unchanged...
  </div>
</c:ignore>
```
`.pb-section` (grid, gap 24px) gives automatic rhythm between page-head → stat grid → card — this also fixes the "grid and card render touching" defect the old starter modeled.

### A3. CSS: stop page-head margin stacking inside grid wrappers
With A2, `.pb-page-head`'s `margin-bottom: var(--ds-space-8)` (design-system.css:229) would stack with the section gap (32+24=56px). Add one rule to `design-system.css` near line 229 (canonical file):
```css
.pb-section > .pb-page-head, .pb-stack > .pb-page-head { margin-bottom: 0; }
```
Then **sync byte-identical** to both starters' `styles/design-system.css`.

**Rejected alternative** (note for reviewer): making `.pb-main` itself a grid with gap. Correct-by-default appeal, but it changes layout for every existing pb-main child using margins — risks regressing the v3 showcase verified pixel-perfect on 2026-07-08. `.pb-section` as fragment root gets the same effect with zero blast radius.

### A4. component-library.md: new "Page Shell & Spacing" section (mandatory rules)
`bundled-context/skills/design-system-init/references/component-library.md` — insert a new `##` section immediately after "## Load Order" (line 23 block ends ~line 42). Content (draft; keep weak-model style — imperative, copyable, ~45 lines; file is 931/1000 lines, stays within budget):

```markdown
## Page Shell & Spacing (mandatory)

Every console page shell wraps its fragments in the main container. Fragments NEVER
include `.pb-main` themselves — the shell owns it.

Navbar-only shell (matches the console-app starter):
​```html
<body>
    <div id="cp-root">
        <c:fragment name="navbar" />
        <main id="body" class="pb-main">
            <c:fragment name="${frag}" />
        </main>
        <c:debug />
    </div>
</body>
​```
Sidebar shell: see section 49 (`.pb-layout` wraps sidebar + `<main id="body" class="pb-main">`).

Fragment root = `<div class="pb-section">`. It is a grid with a 24px gap: page header,
toolbars, grids, and cards inside it space themselves. Without it siblings touch.

Spacing primitives (use these, never hand-written margins):
| Class | Gap | Use for |
|---|---|---|
| `.pb-section` | 24px | fragment root; rhythm between page-level blocks |
| `.pb-stack` | 16px | vertical stack inside a card: fields, list rows |
| `.pb-cluster` | 12px | inline row: buttons, chips, filters |
| `.pb-grid-2` / `.pb-grid-3` | 24px | equal-width card/stat grids |
| `.pb-form-grid` | 16/20px | two-column form layouts |

`.pb-field-group` spaces only its own label→input. IF a form has more than one field,
THEN wrap the fields in `.pb-stack` (single column) or `.pb-form-grid` (two column):
​```html
<div class="pb-card">
    <div class="pb-stack">
        <div class="pb-field-group"><label class="pb-label">Name</label><c:field ... /></div>
        <div class="pb-field-group"><label class="pb-label">Category</label><c:field ... /></div>
        <div class="pb-cluster"><button class="pb-btn pb-btn-primary">Save</button></div>
    </div>
</div>
​```

Empty states use `.pb-state`; notices use `.pb-alert` — never a bare styled `<p>`.
Custom CSS (PAL OVERRIDES only) uses `--ds-space-*` tokens. Utility classes
(`.p-*`, `.gap-*`, `.mt-*`) come from spacing.css and follow its own `--s*` scale —
fine in markup, but never mix raw px values or the two scales in one rule.
```

Adjust the field example's `c:field` markup to match the file's existing canonical field snippets (section 3) verbatim — do not invent attribute shapes.

### A5. Consistency fix in sidebar example
`component-library.md` section 49 (~line 839): `<main class="pb-main">` → `<main id="body" class="pb-main">`.

### A6. design-build/SKILL.md: spacing in the review gate + acceptance checklist
`bundled-context/skills/design-build/SKILL.md`:
- Under "**Against structure**" (~line 84), add one bullet: `- Page content sits inside the shell's `pb-main`; fragment root is `pb-section`; sibling blocks are separated by layout primitives (`pb-stack`/`pb-cluster`/grid gaps), never touching and never spaced by hand-written margins.`
- In "## Acceptance checklist" (~lines 117-136), add two items:
  - `- [ ] Shell owns `<main id="body" class="pb-main">`; every fragment root is `pb-section`; multi-field forms wrap fields in `pb-stack` or `pb-form-grid`.`
  - `- [ ] No undefined classes: every `class=` value in pages/fragments resolves to design-system.css, spacing.css, or COMPONENTS.md-recorded local styles.`

### A7. design-system-init/SKILL.md: map Density answer to concrete tokens
`bundled-context/skills/design-system-init/SKILL.md` — the interview asks "Density: compact, balanced, or spacious?" (line 102) and the emitted DESIGN_SYSTEM.md spec lists "Density: page rhythm, table/list row height, card padding, mobile collapse behavior" (line 202) as prose only. Extend the line-202 bullet so the emitted doc must state concrete values, e.g.:
`- Density: map the interview answer to tokens and write the numbers into DESIGN_SYSTEM.md — compact: section gap --ds-space-5 (20px), card padding --ds-space-4; balanced (default): section gap --ds-space-6 (24px), card padding --ds-space-5; spacious: section gap --ds-space-8 (32px), card padding --ds-space-6. Express deviations from the default as PAL OVERRIDES, never hand-edits.`

### A8. design-principles.md: spacing item in the AI review checklist
`bundled-context/skills/design-system-init/references/design-principles.md` (~lines 168-181): add one checklist line: `- Spacing: page content sits in a container with visible gutters; unrelated blocks are ≥24px apart; every gap comes from the scale, none hand-written.`

### A9. pal-review/SKILL.md: grep-able structural spacing checks (works without vision)
`bundled-context/skills/pal-review/SKILL.md` (~lines 72-74) — the current spacing check is vision-gated and degrades to `needs-human`. Add static checks a blind reviewer can run:
- fragments root in `pb-section` (`rg -L 'class="pb-section' fragments/`),
- shell has `<main id="body" class="pb-main">` and no undefined wrapper classes,
- any fragment with ≥2 `pb-field-group` also contains `pb-stack` or `pb-form-grid`.
Phrase as IF→THEN rules with the exact grep commands.

### A10. Rewrite eval stub to pb-* (Sam-approved)
`eval/specs/DESIGN_SYSTEM.md` — replace the "## Foundation" bootstrap prescription (bootstrap 5.3.5, `container`, `mb-3`, `btn-primary`, badges) with the shipped system: pb-* components, shell owns `pb-main`, fragment root `pb-section`, forms wrap fields in `pb-stack`/`pb-form-grid`, empty states `.pb-state`, one `pb-btn-primary` per region. Keep "## Reference precedence" and "## Anti-slop rules" (update the `btn-primary` mention to `pb-btn-primary`). Add one line to `eval/run.md` noting the stub changed on 2026-07-09 and scores before/after are not directly comparable.

---

## Milestone B — Runtime perf (MCP server)

### B1. usage.js: in-memory tally, throttled flush
`src/core/usage.js:41-58` — `recordToolCall` currently does readFileSync + parse + stringify + writeFileSync per tool call. Replace with:
- Module-level `Map<workspaceDir, tally>` seeded lazily from disk (same pid-mismatch⇒new-session logic, once per workspaceDir).
- `recordToolCall` mutates memory only, then schedules a flush if none pending: `setTimeout(flush, 1000).unref()`.
- `flush(workspaceDir)` = current writeFileSync of the in-memory object (keep sync — rare now).
- `process.once("exit", ...)` sync-flushes all pending tallies.
- `formatCost` (usage.js:108) must see current numbers: flush the workspace tally (or read from memory) before formatting. server.js:117 calls it at shutdown — verify order with the exit hook.
- Keep the whole body inside the existing try/swallow ("never let metering break a tool call"). API surface (`module.exports` at :141) unchanged.
Risk: crash loses ≤1s of counts — acceptable, instrumentation is best-effort by design. Concurrency: file is pid-keyed per session; last-writer-wins across processes is the existing behavior, unchanged.

### B2. screenshot.js: reuse Chromium across calls
`src/core/screenshot.js:286-341` — currently `browser = await chromium.launch()` per call and `browser.close()` at the end. Change to a module-level shared instance:
- `getBrowser()`: lazily launch, cache the promise; if `browser.isConnected()` false, relaunch. Keep the existing launch-failure → "Chromium not installed" result (:288-291) intact.
- Per-call `browser.newContext(...)` stays (cookie/viewport isolation) — close the **context** at :341 instead of the browser.
- Idle reaper: after each call, `setTimeout(closeIfIdle, 60_000).unref()` — close the browser if no call since. `process.once("exit")` best-effort close.
- Check `src/core/exercise.js` and `src/core/seoAudit.js` for their own `chromium.launch()` — if they launch too, share the same helper (export from screenshot.js or a small `src/core/browser.js` ONLY if ≥2 consumers need it; one consumer = keep it local, no speculative module).
- CLI one-shot path unaffected: process exits, hook closes.

### B3. Rejected as not worth it (record, don't implement)
- **validate/push mtime cache**: pals are dozens of small files; sync walk+read is µs–ms scale. Cache complexity not justified. Consistent with the 2026-07-04 rejections (baseline.snapshot buffer-threading, workspaceHash async).
- **tools.js (969 lines) / contracts.js (809 lines) split**: maintainability churn, zero runtime win; validators are hot in tests and the split risks import cycles. Skip.
- **lib/ → src/core consolidation**: 13 files / 17 require sites import lib/* (palpush.js headless path included); pure path churn, zero behavior change. Skip.

### Standing out-of-scope (rejected 2026-07-04, memory: project-refactor-decisions — do NOT touch)
MCP tool description trim; baseline.snapshot buffer-threading / workspaceHash async; releaseByGuid full account walk; pull.js listTrackedFiles unification into fsWalk walkTree.

---

## Milestone C — Bundled-context cleanup (conservative, Sam-approved scope)

**Keep all inline guardrail repetition** (ES3 rule ×5, validate/push reminder ×7, c-tag guidance ×3): skills load independently and eval-derived law says weak models don't follow pointers. No dedupe.

### C1. eval/specs/README.md — stale, superseded by eval/run.md
Replace the body with a 3-5 line pointer: what the specs are, "protocol + scoring live in ../run.md and ../scoring.md". First `rg -l 'specs/README' eval/ README.md HEADLESS.md` and fix any references.

### C2. Retired-skill stale references
`rg -n 'design-core|palbuilder-design|palbuilder-jobs-http|palbuilder-websockets' bundled-context/ --glob '!node_modules'` (exclude contextInject.js's own RETIRED_SKILLS list in src/). Fix any hits in shipped SKILL bodies; expect zero-to-few.

### C3. Local cruft
`outputs/` (2.2MB, gitignored, unshipped) — delete from working tree. No commit needed.

---

## Verification (static — per Sam's decision)

Run after each milestone; all must pass before commit:

```bash
cd /Users/apple/Documents/palsync

# 1. CSS copies byte-identical (3 files must share one hash per name)
md5 bundled-context/skills/design-system-init/references/design-system.css \
    bundled-context/starters/console-app/styles/design-system.css \
    bundled-context/starters/web-marketing/styles/design-system.css
md5 bundled-context/skills/design-system-init/references/spacing.css \
    bundled-context/starters/console-app/styles/spacing.css \
    bundled-context/starters/web-marketing/styles/spacing.css

# 2. Spacing-fix grep assertions
rg -c 'app-body' bundled-context/ && echo "FAIL: app-body survives" || echo "OK"
rg -n '<main id="body" class="pb-main">' bundled-context/starters/console-app/pages/console.html
rg -n 'Page Shell & Spacing' bundled-context/skills/design-system-init/references/component-library.md
rg -n 'pb-section > .pb-page-head' bundled-context/skills/design-system-init/references/design-system.css
rg -cn '<main' bundled-context/starters/console-app/fragments/dashboard.html && echo "FAIL: nested main in fragment" || echo "OK"
rg -n 'pb-btn-primary' eval/specs/DESIGN_SYSTEM.md   # stub now pb-*
rg -n 'bootstrap 5.3.5' eval/specs/DESIGN_SYSTEM.md && echo "FAIL" || echo "OK"

# 3. Line budget
wc -l bundled-context/skills/design-system-init/references/component-library.md   # must be ≤1000

# 4. Full test suite (also guards amendmentLoop pinned phrases)
npm test   # 222 tests green

# 5. Perf changes — targeted
node --test test/usage*.test.js test/screenshot*.test.js 2>/dev/null || npm test
# usage flush behavior: after B1, add/extend a unit test asserting recordToolCall×N + flush
# produces the same file shape as before (pid, totalCalls, tools map). Screenshot: existing
# screenshot.test.js exercises the no-browser fallback paths; keep them green.

# 6. Context cost snapshot (before/after C1)
bash eval/context-cost.sh
```

Codex stop rules: if `npm test` fails on a phrase-pin (amendmentLoop), the doc edit re-wrapped a pinned line — restore it to one line, don't reword the test. If any md5 differs after sync, re-copy from canonical references/, never edit a starter copy directly. If exercise.js/seoAudit.js browser sharing turns messy, ship B2 for screenshot.js only and note the deferral.

## Suggested commit slicing
1. `fix(starters): console shell owns pb-main; dashboard fragment roots pb-section` (A1-A3 + CSS sync)
2. `docs(design): mandatory page-shell & spacing rules across design skills` (A4-A9)
3. `eval: align design stub with shipped pb-* system` (A10 + run.md note)
4. `perf(mcp): in-memory usage tally with throttled flush` (B1)
5. `perf(screenshot): reuse Chromium across calls with idle close` (B2)
6. `chore: retire stale eval README + retired-skill refs` (C1-C3)
