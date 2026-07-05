# pal.json — The Pal Manifest

`pal.json` is the manifest of every pal — the JSON representation of the `.pal` XML export.
It registers workflows, pages, fragments, resources, folders, and pal-level configuration.
It is JSON, not workflow JS — normal object/array literals are fine here.

> **What's in this reference:** the structure of `pal.json`, the `layout` block that registers
> default workflows, the full `workflowType` table (all 10 values), library `workflowContext`
> values, and the `folders` registration pattern.
>
> Configuration areas (store settings, resources, PWA) have their own references in
> `palbuilder-config`. Specific workflow-type usage patterns (writing a job, writing a
> transaction handler) live in `palbuilder-workflow`.

---

## Overall Shape

`pal.json` is a single object with these top-level keys (present in the example pal):

```
{
  "layout":         { ...pal-level config and default workflow registrations... },
  "documents":      [ ...Document entries... ],
  "emails":         [ ...Email entries... ],
  "images":         [ ...Image entries... ],
  "pages":          [ ...Page entries... ],
  "fragments":      [ ...Fragment entries... ],
  "styles":         [ ...Style (CSS) entries... ],
  "wizards":        [ ... ],
  "workflows":      [ ...Workflow entries (server-side JS)... ],
  "scripts":        [ ...Script entries (client-side JS)... ],
  "fonts":          [ ... ],
  "datasets":       [ ...dataset schemas... ],
  "dataviews":      [ ...dataview definitions... ],
  "data":           [ ...named key/value data bundles... ],
  "datalists":      [ ...static tabular data... ],
  "attachments":    [ ...binary attachments... ],
  "automatedScripts":     [ ... ],
  "mobileConfigurations": [ ... ],
  "desktopBindings":      [ ...console home-screen tile entries, see below... ],
  "folders":        [ ...folder registrations... ],
  "trashCan":       [ ... ],
  "releaseNotes":   [ ... ],
  "secureFields":   [ ... ]
}
```

Empty sections may serialize as `""` rather than `[]` — that's a serialization artifact of the
XML → JSON conversion, not a bug.

Each entry (except in `layout` and `folders`) follows the pattern
`{ "string": "<filename>", "<Type>": { ...fields... } }`, where `string` is the entry's
identifier (typically the filename) and `<Type>` matches the section (`Workflow`, `Page`,
`Fragment`, `Document`, `Email`, `Style`, `Dataset`, `Dataview`, `Data`, `DataList`,
`Attachment`, `Image`).

---

## The `layout` Block

`layout` is the pal-level config header. Key fields:

| Field | Purpose |
|---|---|
| `name`, `category`, `description` | Pal identity metadata |
| `exportDate` | Timestamp of the export |
| `transactionWorkflow` | Path to the default `workflowType: 2` workflow |
| `systemWorkflow` | Path to the default `workflowType: 3` (transaction system) workflow |
| `webServiceWorkflow` | Path to the default `workflowType: 5` (transaction webservice) workflow |
| `consoleWorkflow` | Path to the default `workflowType: 7` (console) workflow |
| `webWorkflow` | Path to the default `workflowType: 9` (web) workflow |
| `consoleSystemWorkflow` | Path to the default `workflowType: 11` (console system) workflow |
| `consoleWebServiceWorkflow` | Path to the default `workflowType: 12` (console webservice) workflow |
| `userWebServiceWorkflow` | Path to the default `workflowType: 14` (user webservice) workflow |
| `tunnelServiceWorkflow` | Path to the default `workflowType: 15` (tunnel) workflow |
| `errorPage` | Path to the page that renders on error (e.g., `other/error.html`) |
| `robotsPage` | Path to the `robots.txt` page (`palType: palTypeRobots`) |
| `inheritanceEnabled` | Whether this pal inherits from a parent pal |
| `inheritConsole`, `inheritWeb`, `inheritTransaction`, `inheritUser` | Per-context inheritance flags |
| `properties`, `roles` | Pal-level metadata (often empty) |
| `auditDocumentView` | Auditing flag |
| `workflowVersion` | Workflow schema version |
| `consoleControlled` | Whether the pal is controlled from a console |
| `mobileAccessType`, `groupAccessOnly` | Access-control flags |
| `loginPage`, `mobileLoginPage` | Path to the login page (default / mobile-specific) |

**There is no `layout` field for a console pal's home-screen tile label or icon.** A pal works
in the console with none of these set — `consoleWorkflow` alone makes it reachable. Don't invent
one (`consoleTemplate`, `consoleDesktopLabel`, etc. are not real fields); if a spec asks for a
tile, see `desktopBindings` below.

---

## `desktopBindings` — console home-screen tile (rarely needed)

Registers an optional tile a pal shows on the console home screen. **Most pals don't have one and
don't need one** — omit this section unless the spec explicitly asks for a tile.

```json
"desktopBindings": [
  { "string": "<name>", "DesktopBinding": { "name": "Equipment", "icon": "bi-box-seam" } }
]
```

Same `{ "string", "<Type>" }` wrapper as every other section. `DesktopBinding` has exactly two
fields worth setting: `name` (tile label) and `icon`. There is no `DesktopLabel`/`DesktopImage`/
`consoleLabel`/`consoleImage` — those are guesses, not real fields.

**Every entry in `layout` that names a workflow file is a *default* registration** — the
platform's fallback for that workflow type. Other workflow files of the same type can exist and
be called explicitly (e.g., `c.switchToWorkflow("<name>", <action>)`) without appearing here.

---

## `workflowType` — The Full Table

Every workflow entry has a `workflowType` number. This number is **authoritative** — the file's
name and folder are conventions; the type is truth.

| Type | Name | Description | Entry point / trigger |
|---|---|---|---|
| **2** | **transaction** | Authenticated user/profile, browser-based. Primary use is accessing and interacting with a **Transaction Packet**. | Browser request; `run(controller)` |
| **3** | **transaction system** | **AVOID.** Developers should not use this engine. Use console system (11) instead, and pass the transaction ID to it. | (deprecated in practice) |
| **4** | **library** | A repository of functions included into other workflows via `//@include("path/to/lib");`. Has a `workflowContext` declaring which workflow type it targets. Not directly invoked. | Included, not invoked |
| **5** | **transaction webservice** | Non-user, web-service based. Accessed through a webservice account and the REST or SOAP API. Works with a specific Transaction Packet. | REST / SOAP API call |
| **7** | **console** | Authenticated user/profile, browser-based. The default engine for logged-in pal UIs. | Browser request; `run(controller)` |
| **9** | **web** | Exposed to the **open internet**, usually browser-based. The user, if any, is **non-authenticated**. | Public browser request; `run(controller)` |
| **11** | **console system** | Non-user, daemon-based. Accessed through `JobManager` — jobs are created and scheduled, not user-triggered. | `pal.getJobManager().createJob(...)`; entry reads `c.getJob()` |
| **12** | **console webservice** | Non-user, web-service based. Accessed through a webservice account and the REST or SOAP API. | REST / SOAP API call |
| **14** | **user webservice** | Non-browser, web-service based. Authentication is tied to a specific profile. | REST / SOAP API call with profile auth |
| **15** | **tunnel** | Web-service based communication **between pals, enterprises, or clouds**. | Cross-pal / cross-enterprise call |

**Numbers 1, 6, 8, 10, and 13 are not currently defined** — do not use them.

### Which type is the default for what

- Interactive UI, logged-in → **7 (console)**
- Interactive UI, public / open web → **9 (web)**
- Transaction packet interaction, logged-in → **2 (transaction)**
- Background job / scheduled work → **11 (console system)** (also the recommended replacement for anything you'd have used 3 for)
- External API endpoint, no user → **12 (console webservice)** or **14 (user webservice)** if per-profile auth is required
- Cross-pal integration → **15 (tunnel)**
- Shared code across any of the above → **4 (library)**

---

## Library `workflowContext` Values

A library (`workflowType: 4`) declares which workflow context it targets via `workflowContext`.
The library is then included only into workflows of that type. Valid values:

| Context | Included by workflowType |
|---|---|
| `transaction` | 2 |
| `console` | 7 |
| `web` | 9 |
| `transaction system` | 3 |
| `transaction webservice` | 5 |
| `console system` | 11 |
| `console webservice` | 12 |
| `user` | 14 |
| `tunnel` | 15 |

Non-library workflows (types 2, 3, 5, 7, 9, 11, 12, 14, 15) may leave `workflowContext` empty
(`""`).

---

## Workflow Entries

Each workflow is registered like this:

```json
{
  "string": "libs/console_lib.js",
  "Workflow": {
    "filename": "libs/console_lib.js",
    "content": "<base64-encoded JS>",
    "contentType": "text/javascript",
    "digest": "<sha1 checksum>",
    "workflowContext": "console",
    "workflowType": 4
  }
}
```

Optional fields:

- **`palType`** — Some workflows carry a `palType` (e.g., `palTypeTransaction` on
  `defaults/default_tx.js` in the example pal). This associates the workflow with a UI context
  but does **not** override `workflowType`.
- **`workflowContext`** — Only meaningful for `workflowType: 4` (libraries). Empty string on
  non-library workflows.

---

## `folders` — Every Subfolder Must Be Registered

The `folders` array registers each subfolder in the pal. Every entry has a `name` and a
`folderType` matching the category.

```json
"folders": [
  { "name": "defaults",             "folderType": "Workflows" },
  { "name": "others",               "folderType": "Workflows" },
  { "name": "libs",                 "folderType": "Workflows" },
  { "name": "doc_folder",           "folderType": "Documents" },
  { "name": "doc_folder/level2",    "folderType": "Documents" },
  { "name": "other",                "folderType": "Pages" },
  { "name": "important",            "folderType": "Emails" },
  { "name": "themes",               "folderType": "Styles" },
  { "name": "moreFrags",            "folderType": "Fragments" }
]
```

Rules:

- **Nested folders are declared explicitly.** `doc_folder/level2` is a separate entry from
  `doc_folder` — declaring the parent does NOT auto-register children.
- **A file at `libs/console_lib.js` requires the `libs` folder to exist in `folders`** with
  `folderType: Workflows`. Otherwise the runtime treats the folder as unregistered.
- **`folderType` values** track category names, but **use singular Pascal-case**:
  `Workflows`, `Documents`, `Pages`, `Fragments`, `Emails`, `Styles`. Match the casing exactly.

---

## Page / Fragment / Script / Style Entries — the `palType` field

Pages, fragments, scripts, and styles carry a `palType` field mapping the resource to a workflow
context. Full list of values in `SKILL.md`. Sample entry:

```json
{
  "string": "web.html",
  "Page": {
    "filename": "web.html",
    "content": "<base64>",
    "contentType": "text/html",
    "palType": "palTypeWeb",
    "hideConsoleMenu": false
  }
}
```

Additional notes:

- **`hideConsoleMenu`** (pages) — if true, hides the console menu when this page renders.
- **`parseable`** (fragments) — whether the fragment content is server-parsed for `c:` tags.
- **`text`** (emails) — `true` for `text/plain` emails, `false` for HTML.

---

## Editing Rules

- **JSON syntax is strict.** Trailing commas, comments, or unquoted keys break the file.
- **The `content` field on every file entry is base64-encoded.** Decode it to read the file's
  actual source; re-encode it after any edit. Never hand-write base64 directly.
- **The `digest` field is a checksum** of the encoded content. If `content` changes, `digest`
  must be regenerated to match, or the manifest will be inconsistent.
- **Order in arrays is preserved** but rarely load-bearing. Resources with load-order
  dependencies (e.g., certain scripts or styles) are the exception.
- **Don't remove a registered file's entry without removing all references** (workflow
  registrations in `layout`, `@include` calls, `<c:fragment name="…"/>` uses).
- **The `pal.json` on disk represents the pal.** Every entry in it exists in the running pal;
  every file in the running pal has a corresponding entry. Keep them in sync — an entry
  without content, or content without an entry, is a broken state.

---

## Common Pitfalls

- **Registering a new workflow requires a matching manifest entry AND file content.** Adding an
  entry without content, or content without an entry, produces a broken pal. Both go into
  `pal.json` in the same edit.
- **Saving `pal.json` does not validate workflow JS.** The manifest only registers files;
  broken workflow code still saves. Compile errors surface only when CloudPiston loads the
  workflow at runtime.
- **`workflowType` must match the file's entry point contract.** A file with a
  `run(controller)` function registered as `workflowType: 11` (console system) will not work —
  type 11 expects the JobManager to invoke it and to read `c.getJob()`, not a `run()` action
  switch.
- **`workflowContext` matters only for libraries.** Setting it on a non-library workflow is
  either ignored or causes confusion — leave it empty (`""`) on types 2, 3, 5, 7, 9, 11, 12,
  14, 15.
- **A misnamed library isn't a library.** In the example pal, `libs/tx_sys_lib.js` is registered
  as `workflowType: 3` — that makes it a transaction-system workflow, not a library, no matter
  what its name or folder suggests. When judging a file's role, read the type field.
