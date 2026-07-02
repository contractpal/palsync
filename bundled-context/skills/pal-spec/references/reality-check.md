# REALITY CHECK — validate the spec before approving it

Runs once per spec, after both SPEC.md and EXECUTION.md exist. Re-read them **as if you didn't
write them** — no tool validates a markdown spec, so this is a structured review pass. Parts are
file-checkable (read COMPONENTS.md / DESIGN_SYSTEM.md); platform checks run against what the
palbuilder-* skills attest. Strongest form: a **separate session** reviewing with fresh context;
minimum, a deliberate second pass here. Write the results into **§13 Reality check** as PASS lines
and FLAGs.

## Consistency & completeness (mechanical)
1. No `TBD` / `placeholder` / `decide later` anywhere in the spec.
2. Every §3 nav link has a page row — no dead links.
3. Every dataset written/read in §5 exists in §8a (created) or §8b (consumed); every §8a dataset
   has a `<name>Id` key.
4. Every §8b CONSUMED dataset lists the exact fields relied on, and each named field is verified to
   exist in the live dataset (read it / confirm with the owner) — an undeclared or unverified
   consumed field is a **HARD FLAG** (the most common silent build break).
5. Every component named in §6 exists in COMPONENTS.md (read it; flag any that don't).
6. [FULL] every §5 behavior has a matching §12 criterion; [LITE] every primary action has a
   happy-path criterion. Console screens have a pal_screenshot VISUAL line plus its human-eyeball
   fallback.
7. [brownfield/MAP.md present] §12 GLOBAL FLOOR includes the REGRESSION criterion (baseline still
   passes, untouched UI didn't shift) — missing it when a MAP.md exists is a **HARD FLAG**.
8. Every acceptance criterion names a real tool, a checkable string/state, or an explicit
   human-eyeball gate (console fallback only — not the default).
9. [visually-significant, web or console] §12 includes at least one VISUAL criterion verifiable via
   pal_screenshot — the hero/key screen renders per DESIGN_SYSTEM.md with no anti-slop fingerprints.
   Console auth replay (`captured:true`) is a capability, not a guarantee, so every console VISUAL
   line still needs its human-eyeball fallback paired with it (see shared/console-render-verification.md).

## Platform realism (is this buildable on PalBuilder?)
1. Every §8a field type matches a creatable type in `references/palbuilder-types.md` — a type not in
   that reference is an unverifiable dependency, a **HARD FLAG**.
2. Every §8a type is the STORED string, not the picker label. If a type matches a picker label
   (Integer/Varchar/Datetime/Date/Big integer), rewrite it to the stored string per the reference's
   label→stored map. Picker-label types are a **HARD FLAG**.
3. Every §8a field that any §5 behavior FILTERS, SORTS, or looks up on has an INDEXABLE type.
   Non-indexable per `references/palbuilder-types.md`: Encrypted, Text, Medium text, all File types.
   A query key with a non-indexable type is a **HARD FLAG**.
4. Size is set ONLY on String / Char / Decimal. Size on any other type, or a String with no size, is
   a flag.
5. Every capability in §5 maps to a real primitive in §10 and the right skill: real-time →
   websockets; background/long-running or external HTTP → jobs-http; joins → DataView;
   external-caller/REST-SOAP → webservice (workflowType 12); pal-to-pal/cross-cloud → tunnel
   (workflowType 15).
6. §10 lists only real primitives (page-shell/fragment, the documented c: tags, DataSet/DataView/
   DataList, workflowType 7/9/11/12/15, jobManager, ServiceRequest, createClientSocket). Flag
   invented ones.
7. [workflow JS present] confirm EXECUTION.md verifies the workflow compiles via pal_test after push
   (TestConsole.do returns fresh validation — not a human gate). Note the ES3-style limits (no object
   literals, no let/const/arrow) so §5 behavior doesn't assume modern JS.

## Scope realism
1. Task count vs tiers is honest — no single "task" is hiding a whole project.
2. [LITE] scope is genuinely minimal — if it isn't, it's not a prototype; switch to FULL.

## Gate rule
Any **hard flag** — dead link, undeclared/unverified consumed field, uncreatable or unverified type,
picker-label type, non-indexable query key, a §5 capability with no primitive/skill, invented
primitive, missing pal_test compile-verify for workflow JS, a console screen with no eyeball gate,
or (brownfield) a missing §12 REGRESSION criterion when a MAP.md exists — keeps `status: draft` and
`reality_check: blocked` until resolved. When all hard flags clear, set `reality_check: pass` (and
`status: approved`). Soft notes can ship as recorded caveats in §13.
