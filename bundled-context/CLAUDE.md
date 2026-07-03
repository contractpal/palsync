# CloudPiston Pal Agent Rules

You are editing source for a **CloudPiston pal** — an application built on top of
the CloudPiston server-side Java/JavaScript platform. This file is your always-on
contract. Read it before every task.

**Terminology.** *CloudPiston* is the platform. *PalBuilder* is an IDE (used by
humans for manual review; not by this agent). *A pal* is an application built on
CloudPiston — the codebase in this workspace is one pal.

**CloudPiston is proprietary. You do not know this dialect from training.** When
unsure about a tag, attribute, or API method, look it up in the skill files or
the docs — never guess. A guessed attribute is a hard build error, not a warning.

Official API docs: https://secure.cloudpiston.com/cpal/cp-api/index.html

---

## Which skill to load first (orchestration)

palsync ships workflow skills that drive HOW you build. Pick the one that matches the job:

- Brand-new pal from scratch → **pal-spec** (interviews, produces SPEC.md + EXECUTION.md)
- Feature/change in an EXISTING pal → **pal-init** (map the pal first, then pal-spec)
- Bug fix / small correction → **pal-fix**
- Executing an approved SPEC/EXECUTION → **pal-loop** (task-by-task with on-disk checkpoints)
- Build finished, needs a verdict → **pal-review** (fresh context)
- Platform question only → the relevant `palbuilder-*` skill below

---

## Skills — where the platform depth lives

Load the skill(s) matching the task. Multiple often apply; load all of them.

- **`palbuilder-core`** — foundation, read alongside any other skill. What a pal is, the
  file/folder layout, naming conventions, three-layer architecture, the restricted ES3-style
  workflow-JS subset, the `pal.json` manifest and all `workflowType` values, security baseline.
  Other skills assume this one is in context.
- **`palbuilder-data`** — datasets, dataviews, payloads / DataMaps / DataLists, cache, files,
  and the server-side HTTP client. Read whenever you read, write, or shape data.
- **`palbuilder-frontend`** — pages vs fragments, `c:` tags and attributes, XHTML rules,
  modals, page and fragment JavaScript.
- **`palbuilder-backend`** — server-side workflow JS: the `run()` pattern, action handlers,
  response types, includes, error/validation idioms, and platform routing edge cases.
- **`palbuilder-jobs-http`** — background jobs (`JobManager`) and long-running work.
- **`palbuilder-websockets`** — realtime sockets and progress UI patterns.
- **`palbuilder-email`** — email templates.

Skill files live in `.claude/skills/<skill-name>/SKILL.md`, with deeper material
in `.claude/skills/<skill-name>/references/*.md`.

---

## Workspace layout

```
~/PalBuilder/<pal-name>/        # stable path; relaunching the same pal lands here
    pal.json                    # the pal manifest (pull-managed)
    pages/                      # XHTML fragments — the c:-tag markup
    fragments/                  # reusable fragments (modals, partials)
    workflows/                  # server-side JS — run(controller) entry points
    scripts/                    # client-side JS
    styles/                     # CSS
    images/  emails/  attachments/  documents/
    datasets/                   # schema JSON — create/update tables via the dataset-sync step
    dataviews/  data/  datalists/    # JSON passthrough
    .palsync.json               # palsync sync state (lock holder, drift marker, etc.)
    .claude/skills/             # palsync-injected skills (palbuilder-core, palbuilder-data, …)
    CLAUDE.md  CLAUDE.palsync.md
    .mcp.json                   # MCP server config (palsync-managed)
```

**Pull is SYNC, not WIPE — what survives a `pal_pull`:**

- **Pull-managed (server-tracked)** — `pal.json` + everything inside the **13 manifest folders**
  above (`pages/`, `fragments/`, `scripts/`, `styles/`, `images/`, `emails/`, `attachments/`,
  `documents/`, `workflows/`, `datasets/`, `dataviews/`, `data/`, `datalists/`). Pull overwrites
  these from the server, and removes a local file only when the **server deleted it** (it was
  server-tracked at your last pull and is gone now).
- **NEW un-pushed files inside the manifest folders are PRESERVED.** A file you created (plus
  its `pal.json` entry) that hasn't been pushed yet survives a pull — the entry is carried
  forward into the refreshed `pal.json` so the next push still ships it. Still, don't park
  notes or scratch files in these folders; they belong at the workspace root.
- **Pull refuses rather than overwrites.** If server-tracked files have un-pushed local edits,
  `pal_pull` refuses and names the files (push first, or `force:true` to discard the edits —
  new local files are preserved even under force).
- **Untouched by pull** — anything at the workspace root that isn't `pal.json`, and any
  user-created subdir that isn't one of the 13 above. Project notes, specs, reference images,
  design assets, etc. go HERE:
  ```
  ~/PalBuilder/<pal-name>/spec.md             # ← safe; pull never touches this
  ~/PalBuilder/<pal-name>/references/*.png    # ← safe; pull never touches this
  ~/PalBuilder/<pal-name>/notes/              # ← safe; pull never touches this
  ```
  palsync-managed files (`.palsync.json`, `.mcp.json`, `.claude/`, `CLAUDE.md`,
  `CLAUDE.palsync.md`) are also untouched by pull — they are refreshed only when the launcher
  re-runs setup.

**Bottom line:** the workspace is a stable project directory. Edit pal code in place inside
the 13 folders, and keep project notes / references / assets at the root or in your own
subfolders. Pull refreshes the former; the latter survive forever.

---

## GOLDEN RULES — these cause hard failures

1. **XHTML is strict — for element structure.** Every void tag must be explicitly
   self-closed: `<input ... />`, `<img ... />`, `<br />`, `<hr />`, `<col />`. An
   unclosed tag is a parse error, not a lint warning. This strictness covers
   **tags and attributes only** — it does NOT apply to the **text content of
   `<script>` and `<style>`**, which is raw text. Write CSS and JS naturally
   there. Do **not** CDATA-wrap script/style (the XML layer corrupts them) and
   do **not** entity-escape `<`/`>`/`&` inside them. One caveat: avoid `${...}`
   template literals in inline page `<script>` — `${}` collides with server-side
   EL at render time; use string concat or an external `.js` file.
2. **Never use an undocumented `c:` attribute.** Each `c:` tag has a fixed
   attribute set. Using any attribute not in the reference throws a validation
   error. Check `palbuilder-frontend` before using an attribute you haven't used
   before.
3. **AJAX fragments do not fire `DOMContentLoaded`.** Fragments loaded via
   `ajax-target` run with the DOM already present — run init JS directly at the
   bottom of the fragment, never inside a `DOMContentLoaded` wrapper. Full-page
   reloads are the exception.
4. **Never use `fetch` or ClientPal to call the server** unless there is
   genuinely no other way. `c:` tags are server-rendered and encrypt the action
   and query string before HTML reaches the browser; `fetch`/ClientPal expose
   everything in devtools. Use `c:a`, `c:upload`, `c:download`, etc.
5. **`onclick` is not valid on `c:a`.** For a server action use `c:a action=...`.
   For JS-only behavior use a plain `<button onclick="fn()">` or
   `<a href="#" onclick="fn(); return false;">`.
6. **Workflow JS runs a restricted ES3-style engine.** No object literals `{}`
   (use `c.createData()` for maps, `c.createDataList()` for rows), no `let`/
   `const` (use `var`), no arrow functions (use `function`). Strings use double
   quotes. Full ban list and workarounds:
   `palbuilder-core/references/es3-cheatsheet.md`.

---

## Restraint — write the least code that works

Write the least code that solves the task.

- Prefer editing an existing file over creating a new one.
- Don't add abstractions, helpers, or wrappers "in case they're needed later."
- Every new workflow, fragment, library, or dataset field must earn its keep.
- Use the native CloudPiston API directly. If the platform already provides
  something cleanly, don't wrap it or reinvent it.

Applies by default to every change.

---

## Anti-patterns to refuse

- **Re-architecting around the platform** — building custom abstractions over
  what CloudPiston already does cleanly. If the native API is genuinely lacking,
  say so rather than working around it.
- **Guessing syntax** — inventing tag attributes or API methods instead of
  looking them up in the skill references or the docs.
- **Leaving debug output** — `console.log`, `c.debug`, `c.debugData`,
  `c.debugList` in finished code.
- **Parking scratch files in manifest folders** — spec notes, references, and
  assets go at the workspace root, not inside `pages/`, `workflows/`, etc.

---

## Before you finish a task

- [ ] All void tags self-closed; markup is valid XHTML.
- [ ] No undocumented `c:` attributes (verified against `palbuilder-frontend`).
- [ ] No `fetch`/ClientPal for server calls.
- [ ] AJAX-loaded JS not wrapped in `DOMContentLoaded`.
- [ ] Workflow JS stays inside the confirmed-safe ES3 subset (no `{}`, no
      `let`/`const`, no arrow functions).
- [ ] Reserved globals used only for their defined meaning (see
      `palbuilder-core`).
- [ ] Any new dataset is registered inline in `pal.json` `datasets.entry` AND its
      table provisioned via the dataset-sync step (see `CLAUDE.palsync.md`).
- [ ] Debug calls, dead code, and unused files removed.
- [ ] No new files or abstractions beyond what the task actually required.
