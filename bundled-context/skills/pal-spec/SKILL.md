---
name: pal-spec
description: "Interview the user and produce SPEC.md + EXECUTION.md — the two files that drive an autonomous pal build. Use this skill when the user says 'spec out', 'plan this pal', 'interview me', 'create a spec', or wants to start a new pal project from a description. Supports two modes: FULL (production) and LITE (prototype/MVP). Produces a gated chain: surfaced assumptions → SPEC.md with real copy, real schemas, real BEHAVIOR, a required-skills + PalBuilder-surface manifest, and constraints → a self-validation REALITY CHECK that confirms the spec is buildable on PalBuilder before approval → a BUILD PLAN with dependency order and risks → tasks with behavioral, tool-checkable success conditions. Never placeholders, never vague direction. Visual design is NOT specified here; it is handed off to DESIGN_SYSTEM.md (run design-system-init first if absent). The companion pal-loop skill executes what this skill produces."
---

# pal-spec — interview → SPEC.md + EXECUTION.md

This skill produces the two files an autonomous build runs on. The thesis: **the spec is the
only artifact that earns its tokens.** A complete spec lets a cheaper model build correctly; a
vague spec makes every model guess. Your job is to remove every guess — in the right place:
copy and behavior here, visual design in DESIGN_SYSTEM.md, nowhere twice — and then to **prove
the spec is buildable on PalBuilder before anyone starts coding.**

The output is a **gated chain** (specify → validate → plan → tasks, human gate at each step):

```
MINE → INTERVIEW → LOCK ASSUMPTIONS → SPEC.md (draft) → REALITY CHECK → approved → BUILD PLAN + TASKS
                         gate                              gate                          gate
```

Do not skip a gate. Each is a cheap place to catch an error that is expensive later.

**Hard rule — REAL CONTENT ONLY.** Every copy field gets real, approved words. Every dataset
field has a real type. Every workflow has real behavior. Unknowns go in **Decisions & open
questions** for the human — never TBD, never "placeholder", never "decide later" inline.

**Hard rule — DESIGN IS A HANDOFF, NOT A SECTION.** No color palettes, fonts, or aesthetic
direction in the spec. Those live in `DESIGN_SYSTEM.md` / `COMPONENTS.md` (from
**design-system-init**). The spec carries only *per-page composition* — section order and which
components go where. No DESIGN_SYSTEM.md → stop and run design-system-init first.

---

## Choose the mode first

Ask, or infer from the user's words, before interviewing:

- **LITE** — prototype, MVP, spike, demo, "quick", "just to test the idea", throwaway, an
  internal tool for one or two people. Optimizes for speed to a working thing.
- **FULL** — production, client-facing, real users, anything that stores real data, anything
  ContractPal ships. Optimizes for correctness and verifiability.

When unsure, ask one question: *"Is this a throwaway prototype, or something that'll go to real
users?"* Record the answer as `mode:` in the spec.

**What LITE keeps (non-negotiable even for a prototype):** the one primary action; real copy on
the primary screen(s); the sitemap; the design handoff (a minimal DESIGN_SYSTEM.md is fine, but
it must exist); the required-skills + PalBuilder-surface manifest; the global acceptance floor;
and the **REALITY CHECK** — a prototype that isn't actually buildable is the worst prototype.

**What LITE relaxes:** behavior is captured **happy-path only**, with edge cases listed under
"deferred (prototype)" instead of fully specified; acceptance is the **global floor + a
happy-path check** per primary action (no exhaustive per-feature criteria); secondary-page copy
may be stubbed-but-marked; protected decisions optional; coarser task granularity allowed.

Sections below tagged **[FULL]** are full-mode only. Everything else applies to both modes.

---

## How to run the interview

1. **Mine before you ask.** Turn what already exists into PROPOSED answers — confirming a
   proposal costs seconds, an open question costs minutes. Mine the pulled pal workspace,
   any live site/doc the user points at, the project DESIGN_SYSTEM.md, and the first
   description. **Record where each fact came from**; a claim with no source is an open
   question, not a spec line. Never invent stats, prices, or testimonials.

2. **Ask in batches of 3–4** (skip what mining answered):

   **Product & audience** — Q1 What is this (one sentence)? Q2 Who for (role, industry)?
   Q3 The ONE primary action? Q4 Web (public) or console (logged-in)?

   **Scope & structure** — Q5 Pages/screens? (propose a sitemap) Q6 Explicitly OUT of scope?

   **Copy** — Q7 Per page, draft H1/subhead/CTA/section copy YOURSELF from mined material,
   present, get it corrected — page by page. Q8 Claims/stats/pricing that must be exact?
   (ask; never invent; record source)

   **Behavior** *(console/app pals + any page with logic)* — Q9 Per action: trigger, INPUT,
   VALIDATION, STATE change (which dataset/field), OUTPUT. Q10 **[FULL]** Edge & error cases:
   empty, invalid, not-found, duplicate, auth-fail. *(LITE: note these as deferred.)*

   **Data** — Q11 Entities, fields, exact PalBuilder types? (propose schemas; confirm)

   **Design handoff** *(not design itself)* — Q12 DESIGN_SYSTEM.md + COMPONENTS.md present?
   No → run design-system-init, return. Yes → per page, propose a layout skeleton: section
   order + which named component (from COMPONENTS.md) fills each slot. No colors/fonts.

   **SEO** *(web only)* — Q13 Domain? Target phrase per page? (propose from approved copy)

   **Constraints & ops** — Q14 Push policy: free or checkpoint? Q15 What must the agent NEVER
   touch? Any non-negotiable decisions to protect, with rationale?

3. **LOCK ASSUMPTIONS (gate).** Before writing, list every assumption and open question in one
   block; ask the user to correct it now:
   ```
   ASSUMPTIONS (correct me now or I build on these):
   1. Console pal, single profile, no multi-tenant.
   2. "Submit" creates a new record; never edits.
   OPEN QUESTIONS (I will not invent answers):
   - Exact Pro-tier price — needs a real number.
   ```

4. **Write SPEC.md** (template below), `status: draft`. Walk the user through copy and behavior,
   apply corrections.

5. **Run the REALITY CHECK (gate)** — see below. Resolve hard flags. Only then `status: approved`.

6. **Write EXECUTION.md**: the **Build Plan** first (dependency order, risks, parallel), then the
   **Tasks**, each with a behavioral, tool-checkable success condition.

---

## SPEC.md template

```markdown
# SPEC — <project name>
status: draft            <!-- pal-loop refuses to run until: approved -->
reality_check: blocked   <!-- reality-check gate sets: pass when all hard flags clear, else blocked -->
mode: full | lite
pal: <pal name> (<web | console>) @ <cloud url>
push policy: free | checkpoint
design system: DESIGN_SYSTEM.md @ <path>
created: <date>   approved: <date or pending>

## 1. Product & audience
<what this is, who it serves, the one primary action.>

## 2. Decisions & open questions
- DECISION: <choice> — rationale: <why> — PROTECTED: <yes = do not change without sign-off>
- OPEN: <unresolved item the human owes> — blocks: <task>
<!-- OPEN items are blockers, never silently resolved by the build -->

## 3. Sitemap & routing
| page/screen | file | workflow action | nav label | purpose |
<!-- every nav link MUST have a row; no dead links -->

## 4. Copy (REAL — these exact words ship)
### <page>
- H1 / Subhead / Primary CTA → <destination> / section copy (written out)
<!-- LITE: primary pages real; secondary may be stubbed-but-marked -->

## 5. Behavior (what the logic DOES — drives acceptance criteria)
### <action / screen>
- Trigger / Input(+types) / Validation (When <cond>, system shall <result, exact msg>) /
  Effect (dataset+field) / Output (next screen)
- [FULL] Edge cases: empty / invalid / not-found / duplicate / auth-fail → behavior each
- [LITE] Deferred edge cases: <bullet list, not specified>
<!-- omit for pure static pages; mandatory for anything with logic -->

## 6. Layout (composition only — NO colors/fonts)
### <page>
- Sections in order: <hero> → <grid> → <CTA> → <footer>
- Each names a COMPONENTS.md component: <hero = Hero/centered, grid = CardRow x3>

## 7. SEO [web only]
| page | title (<=60ch) | meta desc (50-160ch) | og:image (ABSOLUTE url) | schema |
Canonical base: <https://...>

## 8. Data model (omit if none)
### 8a. Datasets to CREATE
### dataset: <name>
| field | type (see references/palbuilder-types.md) | size | notes |
<!-- every created dataset gets a primary key field named <dataset>Id -->

### 8b. Datasets CONSUMED (existing — read-only; the build must NOT create or alter these)
### dataset: <name>  — owner: <who/what owns it>
| field relied on | type | used by (which §5 action / §6 component) |
<!-- declare EXACTLY which existing fields you depend on. A consumed dataset whose fields aren't
     listed is an unverifiable dependency — the reality check will flag it. -->

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build, pal-restraint
- IF server-side logic, validation, or data writes/reads:  palbuilder-backend
  <!-- NOT just "has a workflow" — every pal has a serving workflow. Key off real logic/data. -->
- IF background jobs / external HTTP / long-running work:   palbuilder-jobs-http
- IF real-time / server push:                              palbuilder-websockets
- IF web pal:                                              seo-core
<!-- list only what §5/§7/§8 actually require; this scopes the build's context -->

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell) / Fragments (c:ignore): <which>
- c: tags used: <c:a, c:field, c:list, c:fragment, c:if/c:when, c:set, c:resource, c:debug>
- c:resource libs: <bootstrap 5.3.5, jquery, chartjs, bootstrap-icons — only what's used>
- Workflows: <names> — workflowType <7 console / 11 job|receiver> — hub: <yes/no>
- Data: DataSet <created: list> / DataSet <consumed read-only: list> / DataView <if joins> / DataList <if used>
- Jobs: <jobManager.createJob + Monitor — only if long-running>
- HTTP/parse: <ServiceRequest / JsonParser / Buffer / DownloadResponse — only if used>
- Sockets: <createClientSocket + receiver — only if real-time>
<!-- this manifest feeds the REALITY CHECK and the build plan; every line must be a REAL primitive -->

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: <validate before every push; copy ships verbatim>
- ASK FIRST: <dataset schema change; touching shared fragments>
- NEVER: <out-of-scope pages/datasets the build must not create, edit, or delete>

## 12. Acceptance criteria
GLOBAL FLOOR (both modes):
- [ ] pal_validate: 0 errors   - [ ] pal_test: workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links)
WEB pals add:
- [ ] pal_preview: rendered page contains the exact H1s from §4
- [ ] pal_seo_audit: 0 errors per §3 page
CONSOLE pals add (preview is NOT agent-visible, so verification needs a human gate):
- [ ] HUMAN-EYEBALL GATE: a person opens each §3 screen in the builder/console and confirms it
      renders and the §5 happy path works. This is a required acceptance line, not a hope.
- [ ] data effects are checked indirectly: after a §5 write, a follow-up read action (or a
      builder dataset inspection) shows the new/changed row. State the exact check per action.
PER-FEATURE [FULL] (one block per §5 behavior, as checkable conditions):
- [ ] <action>: When <input>, <observable result> — verify via <tool + exact string/state, or
      human-eyeball gate for console renders>
- [ ] <action> edge: empty → "<exact msg>" — verify via pal_preview/pal_test/eyeball
HAPPY-PATH [LITE] (one per primary action):
- [ ] <action>: When <valid input>, <observable result> — verify via <tool/eyeball + check>

## 13. Reality check
<!-- filled by the self-validation gate below; spec stays draft while hard flags remain -->
```

## EXECUTION.md template

```markdown
# EXECUTION — <project name>
spec: SPEC.md (status: approved)   mode: full | lite

## Build plan
Dependency order (leaf-first — foundations before things that use them):
1. Scaffold + shared fragments (header/footer) + routing skeleton.
2. FIRST page/screen — establishes composition (frontier tier).
3. Remaining pages — CLONE the first's structure (cheap/standard).
4. Datasets, then the workflows that read them (data before UI).
5. SEO heads, then final audit.
Parallel-safe: <tasks with no shared files>.  Sequential: <task → task, why>.
Risks: <e.g. console preview is not agent-visible — human eyeball gate at T-n>.
[if workflow JS present] verify the workflow compiles via pal_test after push (TestConsole.do
  returns fresh validation — not a human builder gate). Console VISUAL render is still
  agent-invisible — keep a human-eyeball gate for it.
Checkpoints: <natural human review points>.

## Tasks
| id | task | tier | depends | status | success condition (behavioral + tool-checkable) |
| T1 | scaffold + shared fragments | cheap | — | todo | pal_validate 0 errors |
| T2 | first page (composition) | frontier | T1 | todo | validate 0; push OK; preview "<H1>" |
| T3 | <action with logic> | standard | T1 | todo | When <input>, <result>; pal_test VALIDATED |
status: todo | in_progress | done | blocked | needs-frontier | needs-human

## Checkpoints (append-only, one line per completed task)
## Blockers (what needs the human — be exact)
```

**Task granularity:** one task = one verify cycle. A page is a task; a workflow action is a
task; a dataset is a task. "Build the site" is not. If the success condition can't be a tool
output plus an exact string/state, split it. *(LITE allows coarser tasks but still one verify
cycle each.)*

**Tier marks:** `cheap` = mechanical edits from exact copy, cloning an established page;
`standard` = pages/fragments from copy + §6 layout, workflow actions from §5, schemas, SEO;
`frontier` = the first composition page, routing, anything where the spec gives direction not
structure, spec changes. Mark honestly.

---

## REALITY CHECK — validate the spec before approving it

After both files exist, **re-read them as if you didn't write them** and run this gate. No tool
validates a markdown spec, so this is a structured review pass — but parts are file-checkable
(read COMPONENTS.md and DESIGN_SYSTEM.md), and the platform checks run against what the
palbuilder-* skills actually attest. The strongest version of this is a **separate session**
reviewing the spec with fresh context; at minimum, do it as a deliberate second pass here.

Write the results into **§13 Reality check** as PASS lines and FLAGs.

**Consistency & completeness (mechanical):**
- [ ] No `TBD` / `placeholder` / `decide later` anywhere in the spec.
- [ ] Every §3 nav link has a page row — no dead links.
- [ ] Every dataset written/read in §5 exists in §8a (created) or §8b (consumed); every §8a
      dataset has a `<name>Id` key.
- [ ] Every §8b CONSUMED dataset lists the exact fields relied on, and each named field is
      verified to exist in the live dataset (read it / confirm with the owner). An undeclared or
      unverified consumed field is a HARD FLAG — it's the most common silent build break.
- [ ] Every component named in §6 exists in COMPONENTS.md (read it; flag any that don't).
- [ ] [FULL] every §5 behavior has a matching §12 criterion; [LITE] every primary action has a
      happy-path criterion. Console screens have a human-eyeball acceptance line.
- [ ] Every acceptance criterion names a real tool, a checkable string/state, or an explicit
      human-eyeball gate (console).

**Platform realism (is this buildable on PalBuilder?):**
- [ ] Every §8a field type matches a creatable type in `references/palbuilder-types.md`. A type
      not in that reference is an unverifiable dependency — a HARD FLAG.
- [ ] Every §8a type is the STORED string, not the picker label. If a type matches a picker
      label (Integer/Varchar/Datetime/Date/Big integer), rewrite it to the stored string per the
      reference's label→stored map. Picker-label types are a HARD FLAG.
- [ ] Every §8a field that any §5 behavior FILTERS, SORTS, or looks up on has an INDEXABLE type.
      Non-indexable per `references/palbuilder-types.md`: Encrypted, Text, Medium text, all File
      types. A query key with a non-indexable type is a HARD FLAG.
- [ ] Size is set ONLY on String / Char / Decimal. Size on any other type, or a String with no
      size, is a flag.
- [ ] Every capability in §5 maps to a real primitive in §10 and the right skill: real-time →
      websockets; background/long-running or external HTTP → jobs-http; joins → DataView.
- [ ] §10 lists only real primitives (page-shell/fragment, the c: tags above, DataSet/DataView/
      DataList, workflowType 7/11, jobManager, ServiceRequest, createClientSocket). Flag invented ones.
- [ ] [workflow JS present] confirm EXECUTION.md verifies the workflow compiles via pal_test
      after push (TestConsole.do returns fresh validation — not a human gate). Note the ES3-style
      limits (no object literals, no let/const/arrow) so §5 behavior doesn't assume modern JS.

**Scope realism:**
- [ ] Task count vs tiers is honest — no single "task" is hiding a whole project.
- [ ] [LITE] scope is genuinely minimal — if it isn't, it's not a prototype; switch to FULL.

**Gate rule:** any **hard flag** — dead link, undeclared/unverified consumed field, uncreatable
or unverified type, a §5 capability with no primitive/skill, invented primitive, missing
pal_test compile-verify for workflow JS, or a console screen with no eyeball gate — keeps
`status: draft` and `reality_check: blocked` until resolved. When all hard flags clear, set
`reality_check: pass` (and `status: approved`). Soft notes can ship as recorded caveats in §13.

---

## What this skill does NOT do
- It does not build anything — **pal-loop** executes EXECUTION.md.
- It does not specify visual design — DESIGN_SYSTEM.md / COMPONENTS.md (design-system-init) own
  that; the spec carries §6 layout only.
- It does not re-teach platform rules — palbuilder-frontend/backend/jobs-http/websockets,
  design-build, and seo-core own those. The spec REFERENCES them via §9/§10.
- It never invents facts: no made-up stats, prices, testimonials, or PalBuilder primitives.
