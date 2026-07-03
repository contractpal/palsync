# Session 3 — Tooling & code refactor report

Branch `session3-tooling` @ `014aab7` (off `main` @ `836e234`). All work is deterministic tooling
that moves mechanical procedures from skill prose into code: scripts run via bash/MCP so only their
OUTPUT consumes context, and a weak model can't misexecute code it doesn't run.

`npm test`: **97 passing, 0 failing** (66 at session start → +31 new). All existing tests unchanged
and green throughout.

---

## New MCP tools (descriptions ≤60 words, per guardrail)

| tool | words | chars | what it does |
|---|---|---|---|
| `pal_spec_lint` | 48 | 396 | mechanical half of pal-spec's reality check (offline) |
| `pal_regression` | 53 | 396 | mechanical brownfield regression vs `baseline/baseline.json` |

New CLI subcommands (all reuse the exact tool logic): `palsync regression`, `palsync spec-lint
<SPEC.md>`, `palsync task list [--ready]`, `palsync task <id> <status>`, `palsync checkpoint
"<line>"`, plus `--expect` / `--selector` / `--max-chars` on `palsync fetch|preview`. All listed in
`HEADLESS.md`.

New core modules: `src/core/preview.js` (+`checkExpect`/`extractSelector`), `src/core/findingCap.js`,
`src/core/regression.js`, `src/core/specLint.js`, `src/core/taskState.js`.

---

## §1 — Token-efficient verification (highest ROI)

`pal_fetch` / `pal_preview` gained three opt-in modes; **default behavior with no new param is
unchanged**:
- `expect: [strings]` → `{pass, results:[{string, found, matchedLine}]}` + status/bytes, **not the
  HTML**. Now the steered default (both descriptions, pal-loop step 6, pal-review arm 1).
- `selector` (simple `tag`/`.class`/`#id`) → one region's markup, **dependency-free** extractor.
- `maxChars` → caps inlined markup.
- Repeated identical findings collapsed ("…and N more of the same") in `pal_validate` (per
  file+message) and `pal_seo_audit` (per rule) via `findingCap.js`.

**Selector dependency decision:** the brief allowed "cheerio or equivalent light dep." I shipped a
dependency-free extractor instead (no new dep — repo stays at 7). `expect` (the stated default) and
`maxChars` need no parser and cover the 90% case; the hand-rolled `selector` handles the common
`head`/`nav`/`#id` grabs. If agents hit its limits in practice, add `node-html-parser` then. (I asked
via AskUserQuestion; no response in the window, so I made the minimal-dep call — easy to revisit.)

**Why this is the big win the static cost snapshot can't see:** the old flow returned 3–8k tokens of
served HTML per verification call, every task, lingering in history. `expect` replaces that with a
~1-line-per-string verdict. That saving is *runtime, per-call* — `eval/context-cost.sh` only measures
the always-on static surface, so it does not capture it. The benchmark (below) will.

---

## §2 — `pal_regression`

Reads `baseline/baseline.json` (schema unchanged — downstream gates still parse it) and runs, in
order: **(1)** freshness — `mapped` vs live marker; server moved → `{stale}`, STOP; **(2)** validate
counts; **(3)** `pal_test` per baseline workflow; **(4)** fetch each page with a `captured:true`
viewport, confirm recorded `h1s` via the §1 `expect` mechanism. Failures split **caused** vs
**inherited** (`known_issues`); `eyeball_only` viewports → `needs_human`, never auto-passed.
pal-loop 7b shrunk to "run pal_regression + act" (kept the cadence-bisect); pal-review arm 4 shrunk
but kept its independent fresh run + screenshot UX diff.

## §3 — `pal_spec_lint`

Parses SPEC.md; checks placeholders, dead §3 links, §8a primary-key/type/size/indexability against
`palbuilder-types.md`, §5 dataset references, §12 floor (+ REGRESSION criterion when a sibling
MAP.md exists). HARD_FLAG / FLAG / NOTE with section/line/fix. Type maps are hardcoded (the reference
calls the constants "serialized in all pals — do not change") and a test re-parses the reference to
assert **zero drift**. `reality-check.md` now says run it first; only the judgment items stay manual.

## §4 — `palsync task` / `checkpoint`

Deterministic EXECUTION.md table edits (weak models corrupt table rows by hand). Tolerant parser
(optional `|---|` separator, columns by header text, `—`/blank depends); on any parse failure it
**changes nothing** and prints a precise error. pal-loop now prefers these commands, hand-edit as
fallback.

## §5 — Injection

**No code change needed.** `bundledSkills()` already auto-discovers `pal-fix` (has SKILL.md) and
carries every skill's `references/*` (verified: pal-spec ships all 5). There is **no `shared/`
directory** — Session 2 deliberately used per-skill `references/` instead (contextInject skips dirs
without SKILL.md). Prune of retired skills unchanged. Existing `contextInject.test.js` already
asserts the every-skill-references invariant.

---

## §6 — Trimmed MCP tool descriptions

**Existing-tool description chars: 4887 → 3715 (−24.0%), zero safety loss.** (A full 30% would have
required cutting safety text or weak-model-essential clarity, which the guardrails forbid — the
remainder is safety/navigation, not CLAUDE.md duplication.) Note the *total* MCP metadata still fell
4887 → 4507 **even after adding two whole new tools**.

Every safety warning verified still present (automated check): drift refusal, credentials-never-
returned, cannot-see-console-render, pull-refuses-not-overwrites, preserves-new-files, recreate
typed-confirm + deletes-all-rows, screenshot never-fake-image, merge never-overwrites-silently,
fetch push-does-not-prove-render, lock override high-friction.

Removed content and why each is safe:
- **pal_validate** — dropped the two enumerations `(object literals, let/const, ES6…)` and
  `(unclosed void tags, undocumented c: attributes, ${} in inline <script>, DOMContentLoaded…)`.
  Safe: every item is a CLAUDE.md GOLDEN RULE (1,2,3,6); the tool still returns each finding's
  file/line/ERROR|WARNING/fix, so the agent never needs the taxonomy up front.
- **pal_test** — dropped `(Offline code check that needs no push: pal_validate.)`. Navigation
  cross-ref; pal_validate's own description states its role. All credential/can't-see safety kept.
- **pal_preview** — dropped `(Pass/fail: pal_test; offline check: pal_validate.)` cross-ref; the
  WEB/HTML sentence was rewritten to `expect` steering (authorized by §1). CONSOLE-you-can't-see and
  LAST-PUSHED safety kept.
- **pal_screenshot** — dropped the `Options: page/viewport/fullPage` sentence (moved verbatim into
  `inputShape` `.describe()` — no info lost) and the filler "in a headless browser". Unavailable-
  signal + never-fake-image safety kept.
- **pal_seo_audit** — compressed the long check enumeration (5 og tags / twitter / H1 / viewport /
  JSON-LD / non-ASCII / robots content-type…) to a short list; dropped "(behind login — not
  crawled)". Safe: the full check detail is owned by the seo-core skill; the tool still names
  coverage and says read seo-core first.
- **pal_sync_datasets** — compressed the DEFINITION-vs-TABLE paragraph into one parenthetical and
  dropped the "New dataset: write …, add a pal.json entry, then call this tool" how-to. Safe:
  procedural and discoverable; the SAFE-default and recreate-DELETES-ALL-ROWS-typed-confirm
  sentences are retained verbatim.
- **pal_merge** — tightened the three-clause both-sides sentence. "Never overwrites your work
  silently" and the `<file>.server` behavior kept verbatim.
- **pal_fetch** — rewritten for `expect` steering (§1); the "a successful push does NOT prove render
  (files missing from pal.json are silently skipped)" safety fact kept.

---

## Context-cost snapshot

`eval/context-cost.sh` re-run; snapshot saved to `eval/context-cost-session3.txt`. The committed
`eval/context-cost-baseline.txt` predates Session 2, so its diff conflates Sessions 2+3:

| metric | committed baseline (pre-S2) | main HEAD (S2, pre-S3) | this branch (S3) |
|---|---|---|---|
| MCP desc total | 4887 | 4887 | **4507** (incl 2 new tools) |
| file chars | 244024 | ~239k | 233376 |
| combined | 258209 | 242139 | 243012 |

Combined vs main HEAD ticks up ~873 chars — I *added* two tool descriptions + CLI-usage doc lines.
That is the wrong lens: each new tool **replaces** a multi-thousand-token prose procedure the model
used to execute by hand, and `expect` removes 3–8k HTML tokens **per verification call** — neither
shows up in a static always-on snapshot. The real proof is the benchmark.

---

## Required next step — benchmark (human-run; I cannot)

The refactor is **not "done" until benchmark scores hold or improve at lower token/tool-call counts.**
That needs live PalBuilder + multiple model tiers, so it is a manual run:

1. Follow `eval/run.md` §5 (model matrix) against the frozen scenarios `eval/specs/01…03`.
2. Set **orch skills = `refactor@014aab7`** (this branch); keep every other pinned variable identical
   to the existing `main@454ecfe` rows so the one-variable rule holds.
3. Append one `RESULTS.md` row per (scenario × model), capturing §12 pass/total, tool calls
   (mcp/read/other), pushes, tokens in/out, time, violations.
4. **Accept criterion:** §12 ≥ the `main@454ecfe` row for the same (scenario, model), with lower
   tool-call and token counts (esp. fewer/cheaper verification calls now that `expect` is the
   default). The cheap-model rows (Haiku 1/10 on 01_crud) are where the code-not-prose move should
   move the needle most.

---

## Assumptions / notes
- Selector shipped dependency-free (see §1) — revisit with `node-html-parser` only if agents hit its
  limits.
- `pal_regression` network calls (marker/`pal_test`/fetch) are injectable via a `deps` arg so tests
  run against fixtures offline; production passes none.
- `known_issues` inherited-vs-caused matching is free-text (a failure is inherited if a known_issues
  line mentions its page/workflow) — by design, since `known_issues` are human sentences.
