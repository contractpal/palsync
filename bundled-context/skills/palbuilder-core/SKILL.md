---
name: palbuilder-core
description: Reference for CloudPiston pal.json, workflowType/palType values, folder registration, workspace structure, and the supported ES3 subset. Load when editing manifests or checking platform structure and syntax constraints.
---

# CloudPiston Pal — Reference Library

This skill is a **reference library**, not a task skill. CLAUDE.md holds the always-on
contract for every pal edit; other `palbuilder-*` skills teach how to do each kind of work.
This SKILL.md is a router — the depth lives in the references below.

Nothing here duplicates CLAUDE.md. If a rule seems missing from this skill, check CLAUDE.md
first.

---

## When to read what

### `references/pal-json.md` — the pal manifest

Read when:

- Editing the `layout` block or a workflow registration
- Looking up a `workflowType` value (the full 10-entry table lives here)
- Adding or renaming a folder — every subfolder must be registered in the `folders` array
- Creating a new file entry (base64 content, digest, `workflowContext`, per-category fields)
- Choosing between workflow types for a given task

### `references/es3-cheatsheet.md` — restricted workflow JS

Read when you are writing workflow code and would normally reach for:

- Object literals `{ }` (banned — use `c.createData()` for maps, `c.createDataList()` or
  `ds.createRecord()` for rows)
- `let` / `const` (not available — use `var`)
- Arrow functions `=>` (not available — use `function`)
- Template literals `` `${ }` `` (not available — use string concat or `c.createBuffer()`)
- Destructuring, `for…of` / `for…in`, `.map` / `.filter` / `.forEach` / `.reduce`
- `JSON.parse` into an object (banned — use `c.createJsonParser()`)

Also read when you're not sure whether a JS construct is safe. There is no external validator
for workflow JS — treat anything not on the "confirmed safe" list as unsupported.

### `references/pal-structure.md` — how a pal is organized

Read when:

- You need to understand where a file type belongs (workflow, page, fragment, script, style,
  attachment, etc.)
- Deciding which `palType` a page, fragment, script, or style should carry
- Understanding how console and web workflows differ at the access-mode level
- Working out subfolder conventions within `workflows/` (`defaults/`, `others/`, `libs/`)
- Interpreting whether a file's `workflowType` matches its filename and folder (they can lie)

---

## If none of these fit

Check a task-specific skill:

- Writing workflow JS → `palbuilder-workflow`
- Reading or writing data → `palbuilder-data`
- Pages, fragments, `c:` tags → `palbuilder-frontend`
- Background jobs, websockets → `palbuilder-realtime`
- Email templates → `palbuilder-email`
- Store settings or server-side HTTP → `palbuilder-data`

Or the official API docs at https://secure.cloudpiston.com/cpal/cp-api/index.html.
