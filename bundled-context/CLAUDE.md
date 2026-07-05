# CloudPiston Pal Agent Rules

You are editing source for a **CloudPiston pal** — an application on the proprietary
CloudPiston server-side Java/JavaScript platform. This file is your always-on contract.

**Terminology.** *CloudPiston* = the platform. *PalBuilder* = a human IDE (not used by this
agent). *A pal* = one application; this workspace is one pal.

**You do NOT know this dialect from training.** Never guess a tag, attribute, or API method —
look it up in the skill files or the docs. A guessed attribute is a hard build error.
Official API docs: https://secure.cloudpiston.com/cpal/cp-api/index.html

---

## Pipeline — which skill runs the job

```
NEW pal:      pal-spec → pal-loop → pal-review → PASS
EXISTING pal: pal-init → pal-spec → pal-loop → pal-review (regression arm) → PASS
Bug fix:      pal-fix (escalates to pal-init/pal-spec if scope grows)
```

| You are asked to… | Load |
|---|---|
| Build a brand-new pal | **pal-spec** (interview → SPEC.md + EXECUTION.md) |
| Change/extend an EXISTING pal | **pal-init** (map + baseline first, then pal-spec) |
| Fix a bug / small correction | **pal-fix** |
| Execute an approved SPEC/EXECUTION | **pal-loop** |
| Judge a finished build | **pal-review** (fresh context only) |
| Answer a platform question | the matching `palbuilder-*` skill |

## Platform skills — where the depth lives

Load every skill the task touches. `palbuilder-core` is the foundation — read it alongside
any other skill; the others assume it.

- **palbuilder-core** — file layout, naming, three-layer architecture, restricted ES3
  workflow-JS subset, `pal.json` manifest, `workflowType` values, security baseline.
- **palbuilder-data** — datasets, dataviews, payloads/DataMaps/DataLists, cache, files,
  server-side HTTP client. Read whenever you read, write, or shape data.
- **palbuilder-frontend** — pages vs fragments, `c:` tags and attributes, XHTML rules, modals.
- **palbuilder-backend** — workflow JS: `run()` pattern, action handlers, response types,
  includes, validation idioms, routing edge cases.
- **palbuilder-jobs-http** — background jobs (`JobManager`), long-running work.
- **palbuilder-websockets** — realtime sockets, progress UI.
- **palbuilder-email** — email templates.

Skills live in `.claude/skills/<name>/SKILL.md`, depth in `references/*.md`.

---

## Workspace layout

```
~/PalBuilder/<pal-name>/        # stable path; relaunching the same pal lands here
    pal.json                    # the pal manifest (pull-managed)
    pages/  fragments/          # XHTML c:-tag markup (pages = shells, fragments = partials)
    workflows/                  # server-side JS — run(controller) entry points
    scripts/  styles/  images/  emails/  attachments/  documents/
    datasets/                   # schema JSON — tables provisioned via pal_sync_datasets
    dataviews/  data/  datalists/   # JSON passthrough
    .palsync.json  .mcp.json  .claude/skills/  CLAUDE.md  CLAUDE.palsync.md   # palsync-managed
```

**Pull is SYNC, not WIPE:**
- Pull-managed = `pal.json` + the **13 manifest folders** above (`pages/` … `datalists/`).
  Pull overwrites these from the server; it removes a local file only when the server deleted it.
- NEW un-pushed files in manifest folders SURVIVE a pull (their `pal.json` entries carry forward).
- Pull REFUSES (naming the files) if server-tracked files have un-pushed local edits —
  push first, or `force:true` to discard the edits.
- Everything else at the workspace root is NEVER touched by pull. Put notes, specs,
  reference images, `baseline/` there — e.g. `~/PalBuilder/<pal>/spec.md`, `notes/`,
  `references/*.png`. Never park scratch files inside the 13 manifest folders.

---

## GOLDEN RULES — these cause hard failures

1. **XHTML is strict — for element structure.** Self-close every void tag:
   `<input ... />`, `<img ... />`, `<br />`, `<hr />`, `<col />`. An unclosed tag is a parse
   error. This applies to tags and attributes ONLY — the text inside `<script>` and `<style>`
   is raw: write CSS/JS naturally, do NOT CDATA-wrap it, do NOT entity-escape `<`/`>`/`&` in it.
   One exception: no `${...}` template literals in inline page `<script>` — `${}` collides with
   server-side EL. Use string concat or an external `.js` file.
2. **Never use an undocumented `c:` attribute.** Each `c:` tag has a fixed attribute set;
   anything else throws a validation error. Check `palbuilder-frontend` before using an
   attribute you haven't used before.
3. **AJAX fragments do not fire `DOMContentLoaded`.** A fragment loaded via `ajax-target`
   arrives with the DOM already present — put init JS directly at the bottom of the fragment,
   never inside a `DOMContentLoaded` wrapper. Full-page loads are the exception.
4. **Never use `fetch` or ClientPal to call the server** unless there is genuinely no other
   way. `c:` tags are server-rendered and encrypt the action + query string;
   `fetch`/ClientPal expose everything in devtools. Use `c:a`, `c:upload`, `c:download`.
5. **`onclick` is not valid on `c:a`.** Server action → `c:a action=...`. JS-only behavior →
   plain `<button onclick="fn()">` or `<a href="#" onclick="fn(); return false;">`.
6. **Workflow JS runs a restricted ES3-style engine.** No object literals `{}` (use
   `c.createData()` / `c.createDataList()`), no `let`/`const` (use `var`), no arrow functions
   (use `function`). Strings use double quotes. Full ban list:
   `palbuilder-core/references/es3-cheatsheet.md`.
7. **`c:list` name/id, `ajax-target`, `test=` EL, and `c:fragment` keys must match their real
   targets — never guess these.**
   - `<c:list name="X" id="row">`: `name` = the DataList name the workflow attached via
     `payload.addDataList(...)` (its `copy(name)` name), NEVER the loop alias. `id` = only the
     per-row alias, used as `${row.column}` inside the loop. Swap them → zero rows render.
   - `ajax-target="Y"` must equal the `id=` of an element that exists in the current page
     shell. No matching element → the response renders nowhere, silently.
   - `test=` takes ONLY `${...}` EL with `eq ne gt lt ge le empty ! and or`. No `==`, no `>`,
     no method calls like `.count()` — those fail or silently no-op.
   - Page shell `<c:fragment name="${frag}" />` → the workflow's non-AJAX path must set that
     EXACT key: `payload.set("frag", frag)`. Set a different key (`payload.set("main", frag)`)
     and the page renders blank on full load.
8. **Submitting fields: `c:a action="..."` with NO `<form>` wrapper — ever.**
   `<c:a action="saveThing">` submits every named input / `c:field` in the fragment by itself.
   `<form>` is rejected by the server inside fragments ("Tag form is not allowed").
   `href="?action=..."` is a plain link that sends NO field values (every input reads null).
   Any Save / submit link uses `action=` (plus `ajax-target` to swap the response in);
   `href` only for links carrying nothing beyond their own query string — and even then
   prefer `action="doThing?id=${row.id}"`.

   ```html
   <!-- ✓ name/category travel with the request -->
   <input type="text" name="name" value="${name}" />
   <c:a action="saveEquipment" ajax-target="body">Save</c:a>

   <!-- ✗ WRONG: plain link — name is never sent -->
   <c:a href="?action=saveEquipment">Save</c:a>

   <!-- ✗ WRONG: server refuses the save — fragments cannot contain <form> -->
   <form><c:a action="saveEquipment">Save</c:a></form>
   ```
9. **Any `c:a` that deletes/destroys data carries `confirm="..."`.** The platform renders the
   browser's native confirm before the request fires — there is no undo. A delete link with no
   `confirm=` is a hard build error, not a style choice.

---

## Restraint — the least code that works

Default discipline on every change (full version: **pal-restraint** skill):
- Reuse before building: an existing fragment/function/CSS class/dataset beats a new one.
- Platform before hand-rolling: a `c:` tag or `pal.*`/`c.*` method beats custom markup/JS.
- Edit existing files over creating new ones; no abstractions "for later".
- Touch ONLY the files the task names; don't reformat or "improve" adjacent code.
- Never cut validation, security, accessibility, or verification to save lines.

## Anti-patterns — refuse these

- **Guessing syntax.** A validation error about an attribute → look up that tag's REAL
  attribute set in `palbuilder-frontend` before changing anything. A guessed fix that
  validates can still be semantically wrong and fail silently at render.
- **Narrating UI you did not observe.** `pal_test` and `pal_preview` (console/transaction)
  cannot show you the rendered page; only `pal_screenshot` (or `pal_fetch`/`pal_preview`
  with `expect:` for web) can. Never report "clicked Save, item appeared" or describe page
  content unless a tool actually returned it. Not observed → say so, ask the user to check.
- **Re-architecting around the platform.** If the native API is genuinely lacking, say so —
  don't build a custom abstraction over what CloudPiston already does.
- **Leaving debug output** — `console.log`, `c.debug`, `c.debugData`, `c.debugList`.
- **Parking scratch files in manifest folders** — notes/assets go at the workspace root.

---

## Before you finish a task — checklist

- [ ] `pal_screenshot` after the last push shows a clean render (no `renderError`) for any
      change touching a page, fragment, or workflow. Web pals: `pal_fetch`/`pal_preview`
      with `expect:[strings]` also count. `pal_validate`/`pal_test` prove the code COMPILES
      only — never declare done on those alone.
- [ ] All void tags self-closed; markup is valid XHTML.
- [ ] No undocumented `c:` attributes.
- [ ] Every destructive `c:a` (delete/destroy) carries `confirm="..."`.
- [ ] No `fetch`/ClientPal server calls.
- [ ] AJAX-loaded JS not wrapped in `DOMContentLoaded`.
- [ ] Workflow JS inside the ES3 subset (no `{}`, no `let`/`const`, no arrows).
- [ ] Every `c:list` name / `${...}` key / `ajax-target` checked against the workflow payload
      names and page element ids (`pal_validate` checks these too).
- [ ] New datasets registered in `pal.json` `datasets.entry` AND provisioned via
      `pal_sync_datasets` (see `CLAUDE.palsync.md`).
- [ ] Debug calls, dead code, unused files removed.
- [ ] No new files or abstractions beyond what the task required.
