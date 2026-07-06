# CloudPiston Pal Structure

How a pal is organized on disk and in `pal.json`. Read this when you need to reason about
where a file type belongs, which `palType` a UI resource should carry, or how console and web
workflows differ at the access-mode level.

Companion references:
- `pal-json.md` — the manifest structure that registers everything below
- `es3-cheatsheet.md` — the workflow JS subset

---

## Typed Categories, Not a Filesystem

A pal is **not** a traditional filesystem. It is organized into **typed categories** — each
category holds files of one kind, with its own independent subfolder tree. On disk (and in
`pal.json`), each category is a top-level array or object.

```
pal-root/
├── pal.json               ← the manifest — see pal-json.md
│
├── layout                 ← (section in pal.json) default workflow registrations,
│                              error page, robots page, inheritance flags
│
├── workflows/             ← server-side JS (Workflow type)
│   ├── defaults/          ← the default workflow for each type (registered in layout)
│   ├── others/            ← additional workflows for specialized handlers
│   └── libs/              ← library workflows (workflowType 4), included via @include
│
├── scripts/               ← CLIENT-side JS (Script type) — one per palType (Web/Console/Tx/Common)
│
├── pages/                 ← page shells (Page type) — one or more per palType
│
├── fragments/             ← partial HTML (Fragment type) — organized by feature
│
├── documents/             ← Document HTML files (Document type)
│
├── emails/                ← Email templates (Email type)
│
├── styles/                ← CSS files (Style type)
│
├── images/                ← image resources
│
├── datasets/              ← persistent storage schemas
├── dataviews/             ← read-model joins over datasets
├── data/                  ← named key-value config bundles (e.g., "someData", "moreData")
├── datalists/             ← static tabular data
│
├── attachments/           ← arbitrary binary files (PDFs, CSVs, XLSX, XML, etc.)
├── wizards/               ← wizard definitions
│
└── folders                ← (array in pal.json) — registers every subfolder above,
                              each entry has { name, folderType }
```

**Every subfolder must be registered** in the manifest's `folders` array with a `name` (which
can be nested, e.g., `doc_folder/level2`) and a `folderType` matching the category
(`Workflows`, `Documents`, `Pages`, `Emails`, `Styles`, `Fragments`, etc.). A folder that isn't
registered doesn't exist to the runtime — even if files at that path do.

---

## Common Workflow Subfolder Conventions

Within `workflows/`, three subfolders show up in most non-trivial pals:

- **`defaults/`** — the default workflow for each type. The `layout` section of `pal.json`
  points to these (e.g., `transactionWorkflow: defaults/default_tx.js`, `consoleWorkflow:
  defaults/default_console.js`).
- **`others/`** — additional workflows for specialized handlers (system, webservice, tunnel
  variants that aren't the pal's primary flow).
- **`libs/`** — library workflows (`workflowType: 4`), included at the top of other workflows
  with `//@include("libs/<name>");`.

---

## `palType` — Which Workflow Context a UI Resource Belongs To

Pages, fragments, scripts, and styles carry a `palType` field that tells the runtime which
workflow context owns them. Values:

| palType | Context | Notes |
|---|---|---|
| `palTypeWeb` | Public-web workflow (type 9) | Assets rendered for anonymous web users |
| `palTypeConsole` | Console workflow (type 7) | Assets for the authenticated console UI |
| `palTypeTransaction` | Transaction workflow (type 2) | Assets tied to transaction packet interaction |
| `palTypeCommon` | Shared across contexts | Common assets loaded regardless of context |
| `palTypeStore` | Store fragments | Specialized fragment class |
| `palTypeServiceRequest` | Service-request fragments | Specialized fragment class |
| `palTypeHead` | Head fragments | Content injected into `<head>` |
| `palTypeExport` | Export fragments | Specialized fragment class |
| `palTypeChart` | Chart fragments | Specialized fragment class |
| `palTypeDocument` | Document fragments | Fragments used inside documents |
| `palTypeRobots` | Pages | The `robots.txt` page carries this palType |

The same page filename can exist in multiple contexts if it carries a different `palType` per
entry — the runtime treats them as distinct resources. This is how a pal serves separate UIs
for its console app and its public web front-end from a single codebase.

---

## Where Pals Run — Console vs Web

The two most common workflow types differ mainly in **where users access them:**

- **Console workflows** (`workflowType: 7`) run inside the **CloudPiston platform UI** (e.g.,
  `secure.nimblewire.com/cpal/GetConsole.do`). Console pals appear as apps in the platform's
  left-side application menu; users are authenticated CloudPiston profiles.
- **Web workflows** (`workflowType: 9`) run at **the pal's own domain** (e.g., `app.gifthub.me`),
  reachable like any normal website. Users may be anonymous.

**A single pal can have both.** GiftHub, for example, has a console app inside the platform
*and* a public web front-end at its own domain — the same pal serves both, with different
workflows handling each context. Pages, fragments, scripts, and styles are separated by
`palType` (`palTypeConsole` vs `palTypeWeb`) so each context renders its own UI.

The same "runs on the platform vs runs on its own endpoint" distinction extends to the other
workflow types (transaction, console-webservice, tunnel, etc.). For details on each workflow
type's access mode and entry-point contract, see `palbuilder-workflow` when working with that
skill.

---

## `workflowType` Is Authoritative — Not the Filename or Folder

Every workflow entry in `pal.json` has a `workflowType` number. **That number is truth** — the
file's name and folder are conventions, but the type is what determines behavior.

In the example pal, `libs/tx_sys_lib.js` is registered as `workflowType: 3` (transaction
system) — despite living in `libs/` with a `_lib` suffix, it is **not** a library. It is a
transaction-system workflow. When judging any file's role, read the type field, not the name.

For the full 10-entry `workflowType` table with descriptions, see `pal-json.md`.
