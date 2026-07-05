---
name: palbuilder-core
description: Use this skill whenever working on any aspect of a CloudPiston pal. Foundation skill covering platform basics that apply across every file type — what a pal is, the file/folder layout, naming conventions (camelCase variables, UPPER_SNAKE_CASE constants, plural dataset names), the three-layer architecture (presentation/service/data), the restricted ES3-style workflow JS subset (no object literals, no let/const, no arrow functions), DRY and cleanliness rules, and the ClientPal security baseline. Trigger when writing any pal file — workflow code, pages, fragments, or pal.json — and as a companion to any other palbuilder-* skill. Examples are verbatim from production pals.
---

# CloudPiston Pal — Core Foundations

Read this file when working on **any** CloudPiston pal — front-end, back-end,
configuration, or anything in between. The other `palbuilder-*` skills assume this skill is in
context and do not restate its rules.

API docs:
- Console: https://secure.cloudpiston.com/cpal/cp-api/console/index.html
- Web: https://secure.cloudpiston.com/cpal/cp-api/web/index.html

---

## What a Pal Is

A **pal** is a CloudPiston application — the application component built on top of the CloudPiston
platform. A pal contains:

- **Workflow files** (server-side JavaScript) that run on every request, handle business logic, and
  return a response
- **Pages and fragments** (XHTML markup with `c:` tags) that render the UI
- **Client-side scripts** (browser JavaScript) that handle page interactions
- **Datasets and dataviews** for persistent storage
- **Resources** (CSS, JS libraries, images) bundled with the pal
- **A `pal.json` manifest** that registers everything

On the developer's machine, a pal exists as a `pal.json` file (parsed from the `.pal` XML export)
plus the file entries it registers. Workflow JS is validated by CloudPiston at compile / run time,
**not** at save — a change to the JSON that saves without complaint can still contain broken
workflow code that fails when CloudPiston loads it. Stick to the confirmed-safe syntax rules
below; there is no way to compile-check workflow JS from outside CloudPiston.

For the `pal.json` manifest structure and workflowType values, see `references/pal-json.md`.
A console pal's home-screen tile label/icon is NOT a `layout` field — there is no
`consoleDesktopLabel`/`consoleDesktopImage`/`consoleTemplate`; a console pal works without a
tile at all via `layout.consoleWorkflow` alone. It's nonblocking — don't add one unless the
spec asks for it, and never guess the field name if it does (see `desktopBindings` in
`references/pal-json.md`).

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
workflow types (transaction, console-webservice, tunnel, etc.) — details in `palbuilder-workflow`
when it's built.

---

## Pal Structure — Typed Categories, Not a Filesystem

A pal is **not** a traditional filesystem. It is organized into **typed categories** — each
category holds files of one kind, with its own independent subfolder tree. On the developer's
local machine, an exported pal is represented in JSON (parsed from the `.pal` XML); each category
is a top-level array or object in that JSON.

```
pal-root/
├── pal.json               ← the manifest — see references/pal-json.md
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

### Common workflow subfolder conventions

Within `workflows/`, three subfolders show up in most non-trivial pals:

- **`defaults/`** — the default workflow for each type. The `layout` section of `pal.json` points
  to these (`transactionWorkflow: defaults/default_tx.js`, `consoleWorkflow: defaults/default_console.js`,
  etc.).
- **`others/`** — additional workflows for specialized handlers (system, webservice, tunnel
  variants that aren't the pal's primary flow).
- **`libs/`** — library workflows (`workflowType: 4`), included at the top of other workflows
  with `//@include("libs/<name>");`. Libraries are how the service and data layers of the
  three-layer architecture are implemented — see below.

### `palType` — which workflow context a UI resource belongs to

Pages, fragments, scripts, and styles carry a `palType` field that tells the runtime which
workflow context owns them. Values seen:

| palType | Context |
|---|---|
| `palTypeWeb` | Public-web workflow (type 9) |
| `palTypeConsole` | Console workflow (type 7) |
| `palTypeTransaction` | Transaction workflow (type 2) |
| `palTypeCommon` | Shared across contexts |
| `palTypeStore` | Store fragments (specialized) |
| `palTypeServiceRequest` | Service-request fragments |
| `palTypeHead` | Head fragments |
| `palTypeExport` | Export fragments |
| `palTypeChart` | Chart fragments |
| `palTypeDocument` | Document fragments |
| `palTypeRobots` | The `robots.txt` page |

### Two rules that follow from this structure

1. **`workflowType` is authoritative — not the filename, not the folder.** A file at
   `libs/tx_sys_lib.js` with `workflowType: 3` is a transaction-system workflow, NOT a library,
   despite the name and location. Judge a workflow by its registered type. (This case is in the
   example pal — the name misleads; the type is what matters.)
2. **Fragments may not contain inline `<script>`.** The push API rejects it with "Tag script is
   not allowed." Client-side JS for a fragment loads from the page that hosts the fragment via
   `<script src="…">` referencing a file in the `scripts/` category. (Details in
   `palbuilder-frontend`.)

---

## Naming Conventions

These apply everywhere — workflow JS, page JS, dataset definitions, file names.

- **Variables:** `camelCase` — `inviterId`, `campaignName`, `isOpen`
- **Constants:** `UPPER_SNAKE_CASE` — `var DAY_IN_MINUTES = 60 * 24;`
  (`const` is not available in workflow JS, so the casing is how a reader knows the value
  shouldn't change.)
- **Strings:** double quotes (`"foo"`, not `'foo'`). Some legacy data-layer code uses single
  quotes for column names — prefer double quotes in new code.
- **Be descriptive.** `inviterId`, not `id`. `userEmail`, not `e`. Avoid single-character names
  unless the meaning is unmistakable (loop counter `i`).
- **Long names are fine.** Descriptive is better than terse.

### Dataset naming

- **Names:** `camelCase`, plural — `users`, `inquiries`, `emailTemplates`
- **Primary key:** singular dataset name + `"Id"` — `users` → `userId`, `inquiries` → `inquiryId`
- **Column names:** `camelCase` — `firstName`, `createDate`, `assessmentId`

### Reserved global variable names (workflow JS)

Workflow files use a fixed set of names for shared objects. Use these names **only** for the
values described — never repurpose them:

| Variable | Value |
|---|---|
| `c` | `controller` (the entry-point parameter) |
| `pal` | `c.getPal()` — this pal |
| `tx` | Transaction |
| `request` | `c.getRequest()` |
| `data` | `request.getData()` |
| `page` | `c.getPage("")` — the page to be returned |
| `ajax` | `c.createAjaxResponse()` — the ajax response to be returned |
| `resp` | Any response other than a page or ajax |
| `formatter` | `c.getFormatter()` |
| `validator` | `c.getValidator()` |
| `cm` | `pal.getCacheManager()` |
| `dateUtil` | `c.getDateUtil()` |
| `payload` | `c.createPayload()` — main payload attached to the final response |
| `action` | `c.getAction()` (optional — many files use `c.getAction()` inline) |

Other pals referenced from this one use **the other pal's name** as the variable, not `pal`.

---

## Three-Layer Architecture

As a pal grows, split code into three layers; each calls only the layer below. Small pals
(a handful of actions) legitimately stay flat in one file — don't over-split.

### Presentation Layer
The workflow files that own `run()` — the default workflows registered in `pal.json`'s `layout`
section (e.g., `defaults/default_console.js`). Routes actions, prepares responses (page, ajax,
payload). Calls the service layer.

### Service Layer
Business logic — number crunching, external requests, data shaping. Implemented as
**library workflows** (`workflowType: 4`) in `workflows/libs/`, included at the top of
presentation workflows with `//@include("libs/<name>");`. Grouped by feature or by pal
concern (`libs/dashboard`, `libs/console/blogs`).

### Data Layer
All dataset/dataview reads and writes. Also implemented as library workflows, kept separate
from service-layer libs — commonly named `libs/data/…` or an equivalent convention chosen by
the pal. The distinction is by responsibility (data access vs business logic), not by whether
the file is technically a library.

### Library workflows — context and rules

Every library (`workflowType: 4`) has a `workflowContext` string that declares which workflow
type it's intended for. Values seen in the example pal: `transaction`, `console`, `web`,
`transaction system`, `transaction webservice`, `console system`, `console webservice`, `user`,
`tunnel`. A library is included only into a presentation workflow whose type matches its
context (`libs/console_lib.js` with context `console` is included by the `console` workflow).

Shared functions in a library **take everything they need as arguments** — no hidden dependence
on globals. The presentation layer owns the global state (`c`, `pal`, `payload`, …); deeper
layers must be callable from anywhere.

### Splitting into multiple workflows (a scaling pattern, not a default)

A single default workflow per type is correct for a focused pal — don't split for its own sake.
When a pal grows to many distinct feature areas, split into **per-feature workflow files**
alongside the defaults, each with its own `run(controller)` + globals + action switch, plus a
hub workflow that owns shared actions. Feature workflows delegate unknown actions back to the
hub with `c.switchToWorkflow("<hub>", c.getAction())`.

The three-layer split applies **within** each workflow file — feature-splitting is orthogonal.

---

## Workflow JS — restricted ES3-style subset

Workflow `.js` files run through CloudPiston's **restricted server-side compile engine** — not a
browser, not Node. Page `<script>` is permissive (raw browser JS), but workflow JS rejects most
modern syntax.

> **Validation is compile-time, not save-time.** An edit to the pal that saves cleanly can still
> throw compile errors when CloudPiston loads the workflow. There is no way to compile-check
> workflow JS externally — the rules below must be followed on faith. When in doubt, stay strictly
> within the confirmed-safe subset.

### The headline rules

- **❌ No object literals.** `{ key: value }` throws `Objects not supported`, plus a
  cascading `Variable <propName> not declared` for every property name. Use `c.createData()` for
  maps and `c.createDataList()` or `DataSet.createRecord()` for rows.
- **❌ No `let` / `const`.** Use `var`. Signal constants with `UPPER_SNAKE_CASE`.
- **❌ No arrow functions, template literals, destructuring, `for…of`, `.map`/`.filter`/`.forEach`,
  or function expressions.** Stick to function declarations and classic `for` loops.

**For each banned construct and its workflow-native replacement, see
`references/es3-cheatsheet.md`.** Read it before writing any workflow file.

### These rules do NOT apply to:

- **Page and fragment JavaScript** (browser-side, in `scripts/` or inline page `<script>`). That
  code runs in the browser and uses normal modern JS.
- **`pal.json`** — that's JSON, not workflow JS, and uses normal JSON object syntax.

If you're working on a page script, the ES3 rules are irrelevant. If you're working on workflow
code, they are absolute.

---

## DRY and Cleanliness

### DRY (Don't Repeat Yourself) — with judgment

Reduce duplication with functions and loops, but don't over-apply it. **Good DRY** consolidates
related logic and reduces complexity. **Bad DRY** ("rearchitecting the platform") builds a custom
abstraction over what CloudPiston already does cleanly — if it deviates from the native API and
adds complexity, it's the wrong call.

A useful test: if your wrapper accepts a deeply nested array or string-encoded DSL just to do
what `filter.addEqual("col", val)` already does, you're rearchitecting the platform. Use the
native API directly; if it's genuinely lacking, raise it with the platform devs.

### Cleanliness

- **Remove commented-out code.** If a comment doesn't aid understanding, delete it.
- **Delete unused files entirely** and remove all references to them. Don't leave future
  developers guessing whether a file is live.
- **Strip debug output** (`c.debug`, `c.debugData`, `c.debugList`, `console.log`) before
  finishing. Debug calls are dev-only.

---

## Security Baseline

**Do NOT use ClientPal (or browser `fetch`) to call the server unless there is genuinely no other
way.** `c:` elements are server-rendered: the action and querystring are encrypted before HTML
is returned to the browser. ClientPal and `fetch` requests are fully visible in devtools — every
parameter, every action name.

If you must use ClientPal, you are responsible for never exposing values that shouldn't be
visible to a user inspecting the page. The default and the preference is always a `c:a` (or other
server-rendered `c:` element) that hits a workflow action.

---

## Companion Skills — When to Reach for What

This skill is foundation only. For task-specific patterns, look to:

- **`palbuilder-workflow`** — writing server-side workflow JS files (run() function, action
  handlers, response patterns, workflow types: web, console, transaction, console-system,
  console-webservice, tunnel)
- **`palbuilder-data`** — dataset/dataview/cube queries, payloads/datalists, cache, files,
  server-side HTTP client
- **`palbuilder-frontend`** — pages, fragments, c: tags, XHTML, modals, page JS
- **`palbuilder-realtime`** — background jobs, websockets, progress UI
- **`palbuilder-config`** — store settings, resources, PWA, pal-level configuration

Multiple may apply to one task. Load whichever match.

---

*Console API: https://secure.cloudpiston.com/cpal/cp-api/console/index.html*
*Web API: https://secure.cloudpiston.com/cpal/cp-api/web/index.html*
