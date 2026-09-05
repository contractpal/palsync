---
name: palbuilder-core
description: Reference for CloudPiston pal.json, workflowType/palType values, folder registration, workspace structure, and the supported ES3 subset. Load when editing manifests or checking platform structure and syntax constraints.
---

# CloudPiston Pal — Reference Library

This skill owns the detailed reference knowledge for `pal.json`, workspace structure, and
restricted workflow JS. Other `palbuilder-*` skills teach how to do each kind of work; this
reference supplies the platform facts they share.

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

- Object literals `{ }` (confirmed blocker — use `c.createData()` for maps,
  `c.createDataList()` or `ds.createRecord()` for rows)
- `let` / `const` (confirmed blocker — use `var`)
- Arrow functions `=>`, template literals, destructuring, `for…of` / `for…in`,
  `.map` / `.filter` / `.forEach` / `.reduce`, or `JSON.parse` into an object

Also read when you're not sure whether a JS construct is safe. `pal_validate` catches many
confirmed workflow-JS breakers, but passing validation is not proof that every unrecognized
construct is supported. Follow the evidence level recorded in this reference and the validator
rather than treating every unfamiliar construct as a confirmed hard failure.

### `references/pal-structure.md` — how a pal is organized

Read when:

- You need to understand where a file type belongs (workflow, page, fragment, script, style,
  attachment, etc.)
- Deciding which `palType` a page, fragment, script, or style should carry
- Understanding how console and web workflows differ at the access-mode level
- Working out subfolder conventions within `workflows/` (`defaults/`, `others/`, `libs/`)
- Interpreting whether a file's `workflowType` matches its filename and folder (they can lie)

### `references/pal-chain.md` — pal resources, chains, and modules

Read when:

- You need to know what's reachable from the current pal beyond its own files — chained
  resource pals, the cloud-wide CloudPiston Resource system pal, or (for a module pal) its
  runtime/parent pal
- Deciding whether to use CloudPiston Resource on a new pal (always ask) vs an existing one
  (infer from what's already referenced)
- Working out what `.resources/` is, why it's read-only, and when to refresh it (`pal_resources`)

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
