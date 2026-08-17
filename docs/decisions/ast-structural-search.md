# pal_ast — pinned ast-grep structural search + conservative rewrite

Status: accepted (2026-08-15)

Decisions, rationale, and evidence for the §D `pal_ast` capability (spec `plans/2026-08-15_code-intelligence.spec.md`,
slices 3–4) and its §V1 deterministic gate. Model-free facts are frozen in `test/astGate.test.js` against the
pinned binary and verified in this record.

## D1 — Pinned `@ast-grep/cli@0.45.1`, one binary

Use exactly `@ast-grep/cli@0.45.1` as the single ast-grep delivery. Rationale: `@ast-grep/cli` ships prebuilt
platform binaries as optional platform dependencies and exposes the same `ast-grep` binary the `ast-grep`
npm meta-package would install — one non-native dependency instead of two, no download from ast-grep.net, no
version drift between the meta-package and the CLI. Evidence: `node_modules/@ast-grep/cli/package.json`
version is `0.45.1`; `require.resolve("@ast-grep/cli/ast-grep")` resolves to the repo-local binary and
`--version` reports `0.45.1` (this machine also has Homebrew `ast-grep 0.44.0` on PATH — resolution must and
does prefer the pinned dependency, and the gate tests would catch a drift).

## D2 — optionalDependencies delivery + the three recovery messages

`@ast-grep/cli` is declared as an optional dependency; npm/pnpm will not fail the install when its
postinstall is blocked. `palAst.resolveAstGrep()` therefore refuses with a `binary-missing` result carrying
one recovery message per cause (asserted verbatim in the gate and unit tests):

- pnpm lifecycle policy blocked the postinstall → `pnpm approve-builds` (or allow build scripts for
  `@ast-grep/cli`) then reinstall;
- npm skipped optional dependencies (npm/cli#4828) → `npm install --force @ast-grep/cli`;
- Linux glibc-only binary on musl/Alpine → install Node + run on a glibc distro, or place an ast-grep
  binary on PATH named `ast-grep` or `sg` verified via `--version`.

A missing binary never breaks PalSync: every call returns the refused result with `serverChecked:false`.

## D3 — PATH `sg` identity check (Linux shadow-utils caveat)

A PATH fallback to `sg` is accepted only when `--version` output names ast-grep AND looks like a version
(`/ast-grep/i` + `/\d+\.\d+\.\d+/`). On Linux, `sg` is shadow-utils' setgid binary — presence alone proves
nothing. Evidence: the unit test boots a fake `sg` printing "setgid (shadow-utils) 4.4.1" and asserts
refusal, then a fake `sg` printing "ast-grep 0.45.1" and asserts acceptance.

## D4 — Codegraph withdrawal is not re-litigated

The plan's §B/§C (evidence families, verified-relationships map) and the earlier codegraph-binary proposal
were withdrawn by owner decision before this build; `pal_ast` is the replacement "code shape" tool and ships
no code-graph binary, no index, no daemon. Facts recorded in the spec ("Codegraph withdrawal", out of scope
- stop conditions). `eval/impact/` and pilot machinery are untouched.

## D5 — Lazy registration + the four pins moved together (25 → 26)

`pal_ast` registers lazily (claude/pi-minimal/pi-standard) with zero eager bytes and through existing
generator groups only + explicit KEYWORDS (`ast`, `refactor`, `rename`, `pattern`, `structural`, `codemod`,
`search`, `rewrite` — the default derivation yields only `["ast"]`, which the `[a-z0-9_]+` tokenizer makes
unreachable), and the tool count moves 25 → 26. All four pins move in one commit (ae64a18):

- tool-schema test count + bytes: schema bytes 19,858 → **21,967** (`test/toolSchema.test.js` asserts the
  21,967-byte literal; `bench/efficiency-baseline.json` `toolSchemaBytes: 21,967`);
- efficiency baseline `toolSchemaBytes` (same literal, generator-regenerated — `scripts/generate-pi-tools.js`);
- `docs/context-architecture.md` byte pin (regenerated via its generator, never hand-edited);
- profile-membership tests (`toolProfiles.test.js`).

  Budget note: the plan's "≤1,500 B added" story was authored pre-split (one tool + CLAUDE.md rule). The
  owner-approved spec split `pal_impact` out (§G first, +504 B) and set `pal_ast`'s full 8-input surface
  (§D); the approved spec/tickets then fixed the exact four-pin values (count 26, bytes 21,967). Final
  measured add for `pal_ast` is 21,967 − 19,858 = 2,109 B, including its 8 described inputs; the tool
  description was trimmed to ~740 B on review (from ~1,040) — refusing to hide the verified input surface
  to chase the older estimate. Landed with the four pins in one commit (ae64a18 + the review-fix commit).

## D6 — Write-safety contract

`apply:true` refuses — with nothing written — when: any matched path falls outside the 14 manifest folders,
any matched path is `pal.json` or `.palsync.json` (denied unconditionally: pal.json carries registration
identity and the PreToolUse guard cannot see MCP writes), or the change set exceeds `maxFiles` (default 25,
override up to 500). Containment is asserted by **whole-workspace `hashWorkspace()` before/after** in the
gate (load-bearing), including the case where ast-grep's cwd scan matches `pal.json` or an out-of-scope file
(`notes/scratch.json`) — refused with the file names listed, zero bytes changed. Stateless apply: nothing is ever persisted — the preview-drift memo is in-process only
(keyed by workspace+inputs, including workspaceDir so one process serving two workspaces never
cross-contaminates) and the write recomputes the preview from current disk, refusing on drift
(`preview-drift`), so a second apply on an already-rewritten tree refuses instead of double-editing (gate
test: `confirm="1"` count stays at 2). `apply:true` implies rewrite intent (with or without an explicit
`mode:"rewrite"` the write path is taken; the tool description says so explicitly). After
writing, ONLY the written files are linted via `lintContent`; findings are inline, errors-first, advisory —
never `isError`, never rollback (gate test: a `var` → `let` rewrite returns the `letConst` error inline while
the write stands).

## D7 — Live `c:` markup parse result

Real pulled-Pal-style `c:` markup parses under `lang: html` (tree-sitter HTML namespaces the `c:` tags).
Pattern surface verified on the pinned binary: exact strings plus `$VAR`/`$$$` metavariables only — no
regex, no absence operator (absence selection is encoded by fixture construction, e.g. the no-confirm gate
fixture; recorded honestly — pal_ast cannot express "anchor WITHOUT confirm"). Attribute matching is
presence-only exact-attr: `<c:a href="$H">$A</c:a>` matches only elements whose attribute set is exactly
`{href}`; extra attributes (`confirm=`, `class=`) block the match, and `$$$` in attribute position is the
only way to widen the set. A bare `<c:a>$A</c:a>` (no attributes at all) silently matches nothing — the
pattern's attribute set deterministically fails to equal `{href}` — a silence trap the tool description
guards against by example.

## D8 — Value-interior result

Bare patterns reach element TEXT (`<c:a href="$H">$A</c:a>` binds `$A` to the text child) but never
attribute interiors: tree-sitter's `quoted_attribute_value` is a leaf node, so an attribute-value edit is a
whole-element rewrite (the rewrite string replaces the entire matched element). No transform support;
attribute-value edits ship as whole-element rewrites only.

## D9 — JSON surface quirks (frozen to what 0.45.1 actually does)

- Bare string key patterns (`"role"`) match every occurrence of that string node — keys AND array values.
- Object patterns match only objects with the EXACT key set (`{"role": "site"}` matches `{"role":"site"}`
  but not `{"role":"admin","name":"ada"}`).
- Bare pair patterns (`"role": "site"`) do not parse — ast-grep reports "Multiple AST nodes"; pal_ast
  wraps that as an `invalid-pattern` refusal.
- A single metavar in pair-VALUE position (`{"role": $V}`) parses and DOES match when an exact key-set
  object exists; a single metavar as pair KEY (`{$K: "site"}`) likewise.
- Metavar + `$$$` in pair positions (`{"role": $V, $$$}`) and metavars in array VALUE positions
  (`["admin", $A]`, `[$A]`) parse but **silently match nothing** — no error, no match. These silences are
  frozen in the gate test and documented here so no future version flip goes unnoticed.

## D10 — §V1 gate + token bench (slice 4)

Five frozen shape fixtures under `test/fixtures/ast/` (no-confirm, workflow-call, json-keys, css-selector,
regex-decoy), each a complete workspace, with frozen `file:line` match sets, unified diffs, post-apply
bytes, and `dry-run == apply` byte-identical assertions — all re-verified against the pinned binary before
freezing. Refusals (mode/input mismatch; regex-shaped patterns naming grep/read; missing binary with all
three recovery messages, package-hidden; apply outside folders / on pal.json / on .palsync.json; maxFiles;
preview drift), containment via whole-workspace hash, determinism (second apply = `preview-drift` refusal,
never double-edit), inline `letConst` findings scoped to written files, eval hygiene (file set unchanged;
no dotdirs/caches), and latency p95 ≤ 500 ms on the largest fixture all pass in `npm test`.

`bench/ast-context.js` writes `bench/ast-context.json` (schema `palsync/ast-context-bench/1`): per-task
pal_ast search+preview result bytes vs the grep/read/edit path (simulated `grep -Hn` output + full hit-file
reads + minimal unified diff), tokens = `ceil(bytes/4)`. Ship criterion: median ratio ≤ 1.10. **Result:
median 0.964, criterion met** (no-confirm 0.858, workflow-call 0.964, css-selector 1.005). The json-keys
task **missed** (1.81: a one-file, one-line rewrite where the grep path is cheapest) and was **removed from
the bench** — the criterion is never weakened; the miss and its rationale are recorded in the bench JSON
and in this record. At representative multi-file scale pal_ast wins (measured 0.09–0.59 at 5–50 files).

## D11 — Review-driven hardening (merged before the final commit)

A fresh-context review of the slice found four engine-level defects; all fixed and re-gated before commit:

1. **Search is scope-honest.** `paths` now actually narrows the scan: the validated roots (existing ones
   only — ast-grep exits 1 on a nonexistent path) are passed to the engine positionally, so the matches,
   the coverage block, and the containment surface all agree. Root-level files (pal.json, scratch notes)
   are never searched by default — the containment guard stays load-bearing via injected-match tests.
2. **Rewrite is byte-safe.** Edits splice on `Buffer`s, not UTF-16 strings — multibyte content can no
   longer shift byte offsets and corrupt a write.
3. **Failures never read as no-match.** A non-zero exit or spawn error refuses with `binary-error` +
   guidance; empty stdout is a failure signal (a legit zero-match run always prints `[]`); unparseable
   output refuses as `unparseable-output`. Documented pinned-binary quirk: ast-grep exits 1 on a rewrite
   with zero matches under `--json=compact` while still emitting valid `[]` — handled as a result, not an
   error. `invalid-rewrite` (apply/rewrite without material) is a distinct refusal.
4. **Refusal guidance reaches the model.** The envelope projection carries a refused call as a single
   `error` diagnostic with the FULL guidance (all three recovery messages included), never an opaque
   `ok:false` pointer; dry-run previews surface `filesChanged/matches/unchanged` plus a capped diff head
   in the returned message. Plus: strict mode, exact `0.45.1` pin (no caret), 15 s spawn timeout, and a
   lazy-registration assertion for `pal_ast` pinning zero eager bytes.

## D12 — Sunset

§F.3 sunset **2026-10-15**: if no real-run adoption follows, removal is the default and is designed to be a
one-session job (one dependency, one module, one tool entry, one generator pair, four pins — slice 5
rollback rehearsal is a separate ticket in this build). A §V1 miss removes the capability outright.
