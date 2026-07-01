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

**Brownfield (a MAP.md is present — handoff from pal-init):** don't re-interview the whole pal.
Consume MAP.md as ground truth for what already exists and scope the interview + spec to the
CHANGE pal-init already scoped. This modifies four places below — §6 layout, §8b consumed
datasets, §11 NEVER, §12 acceptance (each is marked "Brownfield (MAP.md present):" inline) — plus
one added REALITY CHECK item. No MAP.md → this branch doesn't apply; proceed greenfield as below.

1. **Mine before you ask.** Turn what already exists into PROPOSED answers — confirming a
   proposal costs seconds, an open question costs minutes. Mine the pulled pal workspace,
   any live site/doc the user points at, the project DESIGN_SYSTEM.md, and the first
   description. **Record where each fact came from**; a claim with no source is an open
   question, not a spec line. Never invent stats, prices, or testimonials.

2. **Ask in batches of 3–4** (skip what mining answered):

   **Product & audience** — Q1 What is this (one sentence)? Q2 Who for (role, industry)?
   Q3 The ONE primary action? Q4 Web (public), console (logged-in), or both? A pal can mix —
   e.g. a public marketing site plus a logged-in dashboard in the same pal. If both, get the
   split now: which pages/screens are web, which are console.

   **Integration surface** *(most pals: none — skip)* — Q5 Does anything OTHER than a browser
   need to call this pal? Two PalBuilder workflow types cover that, and a pal can add either
   alongside its web/console pages:
   - **webservice** (`workflowType: 12`, console webservice) — a REST/SOAP endpoint for an
     external system to call into this pal.
   - **tunnel** (`workflowType: 15`) — pal-to-pal, enterprise-to-enterprise, or cross-cloud
     communication.
   If either applies: which external caller, which action(s), request/response shape. These
   are non-page-serving workflows — no sitemap row, no layout — capture them as §5 Behavior
   entries same as any action, and list the workflow + type in §9/§10.

   **Scope & structure** — Q6 Pages/screens? (propose a sitemap, tag each row web or console)
   Q7 Explicitly OUT of scope?

   **Copy** — Q8 Per page, draft H1/subhead/CTA/section copy YOURSELF from mined material,
   present, get it corrected — page by page. Q9 Claims/stats/pricing that must be exact?
   (ask; never invent; record source)

   **Behavior** *(console/app pals, any page with logic, and any Q5 webservice/tunnel action)*
   — Q10 Per action: trigger, INPUT, VALIDATION, STATE change (which dataset/field), OUTPUT.
   Q11 **[FULL]** Edge & error cases: empty, invalid, not-found, duplicate, auth-fail.
   *(LITE: note these as deferred.)*

   **Data** — Q12 Entities, fields, exact PalBuilder types? (propose schemas; confirm)

   **Design handoff** *(not design itself)* — Q13 DESIGN_SYSTEM.md + COMPONENTS.md present?
   No → run design-system-init, return. Yes → per page, propose a layout skeleton: section
   order + which named component (from COMPONENTS.md) fills each slot. No colors/fonts.

   **SEO** *(usually web pages; a console page can need it too — e.g. a logged-out
   landing/login screen that's still publicly indexed; never a webservice/tunnel action —
   nothing to index)* — Q14 Domain? Per §3 page, is it publicly indexable? Target phrase for
   each one that is (propose from approved copy). Don't gate purely on the page's web/console
   tag — ask.

   **Constraints & ops** — Q15 Push policy: free or checkpoint? Q16 Review cadence: pause for
   your review after **each task**, after **every N tasks** (pick N), or **end** — full-auto,
   review only once the build's done (default, today's behavior if you don't ask)? Q17 What must
   the agent NEVER touch? Any non-negotiable decisions to protect, with rationale?

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
spec version: 1          <!-- bumped on each human-approved amendment; see §14 amendment log -->
mode: full | lite
pal: <pal name> (<web | console | web+console>) @ <cloud url>
<!-- web+console: pal mixes public and logged-in pages — §3 tags each page's type -->
push policy: free | checkpoint
review cadence: each-task | every-<N> | end   <!-- default: end (pal-loop pauses for human review
  only at build completion, today's behavior); each-task/every-N add earlier pauses mid-build -->
design system: DESIGN_SYSTEM.md @ <path>
created: <date>   approved: <date or pending>

## 1. Product & audience
<what this is, who it serves, the one primary action.>

## 2. Decisions & open questions
- DECISION: <choice> — rationale: <why> — PROTECTED: <yes = do not change without sign-off>
- OPEN: <unresolved item the human owes> — blocks: <task>
<!-- OPEN items are blockers, never silently resolved by the build -->

## 3. Sitemap & routing
| page/screen | type (web/console) | file | workflow action | nav label | purpose |
<!-- every nav link MUST have a row; no dead links. `type` matters for hybrid (web+console)
     pals — it decides which §7/§12 rules apply to that specific row; for a pure web or pure
     console pal every row shares the pal-level type. -->

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
<!-- Brownfield (MAP.md present): new UI MUST match the conventions + design reality recorded in
     MAP.md — reuse before building. No DESIGN_SYSTEM.md yet? Run design-system-init in EXTRACT
     mode against the map (extract mode doesn't exist yet — reference only, not built here). -->

## 7. SEO [publicly indexable pages only — mark which §3 rows apply; usually `web`-tagged,
but a `console` row can qualify too (e.g. logged-out landing/login screen)]
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
<!-- Brownfield (MAP.md present): populate this table from MAP.md's Dataset inventory row for
     each dataset — existing datasets the change reads are §8b, sourced from the map, NEVER §8a.
     Map-sourced fields count as verified (satisfies the reality check's "verified to exist" rule
     below) only while `pal_status` shows no server drift since MAP.md's `mapped` date; if it
     drifted, re-verify against the live dataset before relying on the map's row. -->

## 9. Required skills (which palsync skills this build loads)
- ALWAYS: palbuilder-frontend, design-build, pal-restraint
- IF server-side logic, validation, or data writes/reads:  palbuilder-backend
  <!-- NOT just "has a workflow" — every pal has a serving workflow. Key off real logic/data. -->
- IF background jobs / external HTTP / long-running work:   palbuilder-jobs-http
- IF real-time / server push:                              palbuilder-websockets
- IF sending email (OTP, notifications, transactional):     palbuilder-email
- IF any §3 page is publicly indexable (§7 non-empty):      seo-core
- IF a webservice or tunnel action (Q5): palbuilder-backend (same ES3 workflow rules) — no
  dedicated skill covers the ConsoleWebServiceController/TunnelController API yet, so look up
  the exact methods at https://secure.cloudpiston.com/cpal/cp-api/console_webservice/index.html
  or .../tunnel/index.html before writing the action. Never guess a method name.
<!-- list only what §5/§7/§8 actually require; this scopes the build's context -->

## 10. PalBuilder surface (the platform primitives this build touches)
- Pages (page-shell) / Fragments (c:ignore): <which>
- c: tags used: <c:a, c:field, c:list, c:fragment, c:if/c:when, c:set, c:resource, c:debug>
- c:resource libs: <bootstrap 5.3.5, jquery, chartjs, bootstrap-icons — only what's used>
- Workflows: <names> — workflowType <7 console / 9 web / 11 job|receiver / 12 webservice /
  15 tunnel> — hub: <yes/no>
- Data: DataSet <created: list> / DataSet <consumed read-only: list> / DataView <if joins> / DataList <if used>
- Jobs: <jobManager.createJob + Monitor — only if long-running>
- HTTP/parse: <ServiceRequest / JsonParser / Buffer / DownloadResponse — only if used>
- Sockets: <createClientSocket + receiver — only if real-time>
<!-- this manifest feeds the REALITY CHECK and the build plan; every line must be a REAL primitive -->

## 11. Constraints (Always / Ask-first / Never)
- ALWAYS: <validate before every push; copy ships verbatim>
- ASK FIRST: <dataset schema change; touching shared fragments>
- NEVER: <out-of-scope pages/datasets the build must not create, edit, or delete>
<!-- Brownfield (MAP.md present): seed NEVER from the map's Load-bearing/shared/high-blast-radius
     section, plus the user's "must not change" answers from the pal-init interview. -->

## 12. Acceptance criteria
GLOBAL FLOOR (both modes):
- [ ] pal_validate: 0 errors   - [ ] pal_test: workflow VALIDATED, 0 notes
- [ ] every §3 nav link routes (no dead links)
- [ ] [brownfield/MAP.md present — mandatory when a MAP.md exists] REGRESSION: MAP.md's Step-3
      baseline still passes (pal_validate/pal_test at least as clean as the baseline) and
      untouched UI didn't visually shift (pal_screenshot before/after the map's saved references).
WEB pages add (every §3 row tagged `web` — for a hybrid pal this is a subset, not all pages):
- [ ] pal_preview: rendered page contains the exact H1s from §4
- [ ] VISUAL (one per visually-significant web-tagged §3 page): the hero/key screen renders per
      DESIGN_SYSTEM.md with no anti-slop fingerprints — verify via pal_screenshot (pal-review's
      visual arm). State the exact thing to see (e.g. "hero: real headline + single primary CTA,
      no centered-everything, no emoji bullets").
INDEXABLE pages add (every §3 row listed in §7 — usually the web-tagged rows, but a
publicly-indexable console row qualifies too):
- [ ] pal_seo_audit: 0 errors per §7-listed page
CONSOLE pages add (every §3 row tagged `console` — for a hybrid pal this is a subset, not all
pages; pal_preview only opens the render for the user, never the agent — but pal_screenshot CAN
drive an authenticated console screen via auth replay when Chromium is installed and the replay
succeeds; see pal-review's visual arm):
- [ ] VISUAL (one per visually-significant §3 screen): try pal_screenshot first — `captured:true`
      → judge it like a web VISUAL criterion (DESIGN_SYSTEM.md, no anti-slop fingerprints).
- [ ] HUMAN-EYEBALL GATE (fallback — required whenever pal_screenshot returns `captured:false`,
      e.g. no Chromium or a failed auth replay): a person opens that screen in the builder/console
      and confirms it renders and the §5 happy path works. Never skip this silently when the
      screenshot didn't land.
- [ ] data effects are checked indirectly: after a §5 write, a follow-up read action (or a
      builder dataset inspection) shows the new/changed row. State the exact check per action.
PER-FEATURE [FULL] (one block per §5 behavior, as checkable conditions):
- [ ] <action>: When <input>, <observable result> — verify via <tool + exact string/state, or
      pal_screenshot / human-eyeball gate (fallback) for console renders>
- [ ] <action> edge: empty → "<exact msg>" — verify via pal_preview/pal_test/eyeball
HAPPY-PATH [LITE] (one per primary action):
- [ ] <action>: When <valid input>, <observable result> — verify via <tool/eyeball + check>

## 13. Reality check
<!-- filled by the self-validation gate below; spec stays draft while hard flags remain -->

## 14. Amendment log (append-only; empty until the first approved amendment)
<!-- One block per human-approved amendment. pal-loop NEVER edits the spec silently — when reality
     forces a change mid-build (e.g. an uncreatable type), it STOPS and proposes; the human approves
     here. Format per entry:
     - v<n> (<date>, approved by <human>): <which §> — <what changed> — reality forced it because:
       <the build-time fact, e.g. "type X isn't creatable in PalBuilder">. Re-gate: reality_check
       re-run for <§> → pass. -->
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
Risks: <e.g. pal_preview never renders console for the agent — pair every console VISUAL task with
  its human-eyeball fallback at T-n in case pal_screenshot can't capture it (no Chromium / failed
  auth replay)>.
[if workflow JS present] verify the workflow compiles via pal_test after push (TestConsole.do
  returns fresh validation — not a human builder gate). Console VISUAL render: try pal_screenshot
  first, keep the human-eyeball gate only as the fallback when it returns `captured:false`.
Checkpoints: <natural human review points — pal-loop also pauses per SPEC.md's `review cadence`>.

## Tasks
| id | task | tier | spec ref | depends | status | success condition (behavioral + tool-checkable) |
| T1 | scaffold + shared fragments | cheap | §3, §6 | — | todo | pal_validate 0 errors |
| T2 | first page (composition) | frontier | §4, §6 | T1 | todo | validate 0; push OK; preview "<H1>" |
| T3 | <action with logic> | standard | §5 | T1 | todo | When <input>, <result>; pal_test VALIDATED |
status: todo | in_progress | done | blocked | needs-frontier | needs-human
<!-- spec ref = which SPEC.md section(s) this task implements (e.g. §5, §8a) — lets pal-review and
     a resuming session trace a task back to its requirement. Every task names at least one. -->>

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
      happy-path criterion. Console screens have a pal_screenshot VISUAL line plus its
      human-eyeball fallback (see §12).
- [ ] [brownfield/MAP.md present] §12 GLOBAL FLOOR includes the REGRESSION criterion (baseline
      still passes, untouched UI didn't shift). Missing it when a MAP.md exists is a HARD FLAG.
- [ ] Every acceptance criterion names a real tool, a checkable string/state, or an explicit
      human-eyeball gate (console fallback only — not the default).
- [ ] [visually-significant, web or console] §12 includes at least one VISUAL criterion verifiable
      via pal_screenshot (pal-review's visual arm) — the hero/key screen renders per
      DESIGN_SYSTEM.md with no anti-slop fingerprints. Console auth replay (`captured:true`) is
      live-verified, but it's a capability, not a guarantee — Chromium may be absent or the replay
      may fail, so every console VISUAL line still needs its human-eyeball fallback paired with it.

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
      websockets; background/long-running or external HTTP → jobs-http; joins → DataView;
      external-caller/REST-SOAP → webservice (workflowType 12); pal-to-pal/cross-cloud → tunnel
      (workflowType 15).
- [ ] §10 lists only real primitives (page-shell/fragment, the c: tags above, DataSet/DataView/
      DataList, workflowType 7/9/11/12/15, jobManager, ServiceRequest, createClientSocket). Flag
      invented ones.
- [ ] [workflow JS present] confirm EXECUTION.md verifies the workflow compiles via pal_test
      after push (TestConsole.do returns fresh validation — not a human gate). Note the ES3-style
      limits (no object literals, no let/const/arrow) so §5 behavior doesn't assume modern JS.

**Scope realism:**
- [ ] Task count vs tiers is honest — no single "task" is hiding a whole project.
- [ ] [LITE] scope is genuinely minimal — if it isn't, it's not a prototype; switch to FULL.

**Gate rule:** any **hard flag** — dead link, undeclared/unverified consumed field, uncreatable
or unverified type, a §5 capability with no primitive/skill, invented primitive, missing
pal_test compile-verify for workflow JS, a console screen with no eyeball gate, or (brownfield)
a missing §12 REGRESSION criterion when a MAP.md exists — keeps
`status: draft` and `reality_check: blocked` until resolved. When all hard flags clear, set
`reality_check: pass` (and `status: approved`). Soft notes can ship as recorded caveats in §13.

---

## Amendments — controlled spec changes mid-build

An approved spec is the contract, but reality can contradict it after the build starts (a type that
isn't creatable in PalBuilder, a consumed field that doesn't exist, a behavior the platform can't
express). The spec must be able to change **without ever being silently self-amended.** The
controlled path:

1. **Propose (pal-loop).** pal-loop never edits SPEC.md to fix a problem. When reality forces a
   change, it STOPS the affected task, sets it `blocked`, and writes an **amendment proposal** in
   EXECUTION.md Blockers: which SPEC.md § is wrong, the exact build-time fact that forces it (tool
   output / platform limit), and the **minimal** proposed change.
2. **Human approves.** A person reviews the proposal and approves it (or redirects). No approval →
   no change; the task stays blocked. This is the guardrail — the agent proposes, the human decides.
3. **Apply + audit (pal-spec).** On approval, apply the minimal edit to the affected §, **bump
   `spec version`**, and append a **§14 amendment log** entry (version, date, approver, which §,
   what changed, the forcing fact). Append-only — never rewrite history.
4. **Re-gate that section.** Re-run the REALITY CHECK for the amended § only (set `reality_check:
   blocked`, clear the section's flags, then back to `pass` when they clear). Other sections keep
   their state. The spec is re-approved at the new version.
5. **Continue.** pal-loop re-reads the amended § (via the task's `spec ref`) and resumes the task.

The invariant: **the agent never silently self-amends.** Every spec change is an explicit,
human-approved, versioned, logged amendment that re-passes the gate for what it touched.

---

## What this skill does NOT do
- It does not build anything — **pal-loop** executes EXECUTION.md.
- It does not specify visual design — DESIGN_SYSTEM.md / COMPONENTS.md (design-system-init) own
  that; the spec carries §6 layout only.
- It does not re-teach platform rules — palbuilder-frontend/backend/jobs-http/websockets,
  design-build, and seo-core own those. The spec REFERENCES them via §9/§10.
- It never invents facts: no made-up stats, prices, testimonials, or PalBuilder primitives.
