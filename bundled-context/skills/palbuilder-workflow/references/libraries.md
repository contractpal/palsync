# Library Workflows (`workflowType: 4`)

Library workflows are reusable function repositories included into other workflows via the
`@include` directive. They have no `run()` — they're never invoked directly. The compiler
inlines them at the top of the including workflow.

Companion:
- `palbuilder-core/references/pal-json.md` — full workflowType table, library `workflowContext` values

---

## The `@include` directive

Include libraries at the very top of a workflow file, above global declarations:

```js
//@include("libs/data/lists");
//@include("libs/data/users");
//@include("libs/dashboard");

var c;
var pal;
var page;
// ...

function run(controller) {
    c = controller;
    // ...
}
```

**Rules:**

- **Path is relative to the workflow root** and matches the library's registered `filename`
  in `pal.json` (without the `.js` extension).
- **Syntax is a line comment.** `//@include("path");` — the compiler picks it up despite
  being a comment. Regular JS parsers ignore it, which is fine — this file only runs through
  the CloudPiston compiler.
- **One include per line.** Don't try to combine multiple paths.
- **Order matters if libraries depend on each other.** Include the base library first, the
  dependent one after.

---

## `workflowContext` — declared, but loose in practice

Every library declares a `workflowContext` field in `pal.json` (values: `transaction`,
`console`, `web`, `transaction system`, `transaction webservice`, `console system`,
`console webservice`, `user`, `tunnel`). The context field exists **primarily for
code-assist tooling** in the palbuilder editor — it hints which controller API is available
so autocomplete works.

**At runtime, cross-context includes are allowed.** You *can* include a `web`-context
library into a `console` workflow. What you **cannot** do is call methods inside that
library that don't exist in the calling workflow's controller.

The practical rule:
- **Context-neutral libraries** (pure helper functions, `Data` / `DataList` manipulation,
  dataset reads that use only `pal.` methods) are safe to include anywhere.
- **Context-specific libraries** (calling `c.getUser()`, `c.exitToWeb`, `tx.commit()`, or
  other methods available only in specific workflow types) must only be included where those
  methods exist.

Match the context to the caller when in doubt — that's the safest default and matches what
the tooling expects. But don't panic if a shared utility library uses a `web` context and
gets included in console workflows: as long as its methods work in both contexts, it's
fine.

---

## Library-function conventions

A library file has functions and (rarely) file-level constants. It does **not** have `run()`
or declare globals — the including workflow's globals are in scope after inclusion.

```js
// libs/dashboard.js

function prepareDashboard(userId) {
    if (userId == null) { return null; }

    var out = c.createPayload();
    out.set("dashboardTitle", "Home");
    out.addDataList(fetchLists(userId));           // fetchLists is in libs/data/lists.js
    return out;
}

function summarizeLists(lists) {
    var summary = c.createData();
    for (var i = 0; i < lists.getRecordCount(); i++) {
        // ...
    }
    return summary;
}
```

### Take non-standard state as arguments

Library functions **may rely on the standard globals** (`c`, `pal`, `formatter`, `validator`,
`dateUtil`, `cm`) since those exist in any workflow. They **must not** depend on any other
globals — anything workflow-specific (dataset ids, user objects, action parameters) must be
passed in explicitly:

```js
// ✗ WRONG — implicit dependence on a global that may or may not exist
function loadUserLists() {
    return fetchLists(currentUser.userId);       // where does currentUser come from?
}

// ✓ RIGHT — everything workflow-specific is a parameter
function loadUserLists(userId) {
    return fetchLists(userId);                    // and fetchLists uses pal (standard global) internally
}
```

The library may be included in multiple workflows with different global setups — hidden
coupling breaks reuse.

### Libraries don't build responses

Libraries return `Data`, `DataList`, `Payload`, or scalars — never construct `page` / `ajax`
responses. The presentation layer (the workflow's `run()`) owns response construction. This
lets the same library work whether it's called from a page-first workflow, an ajax handler,
a job, or a webservice.

---

## Splitting service and data layers

A common convention: library workflows sit in `libs/` grouped by concern:

```
workflows/
├── defaults/default_console.js         (presentation)
├── others/…                            (specialized presentation)
└── libs/
    ├── dashboard.js                    (service layer)
    ├── console/blogs.js                (service layer)
    ├── data/lists.js                   (data layer)
    ├── data/users.js                   (data layer)
    └── data/exchanges.js               (data layer)
```

Service-layer functions call data-layer functions; data-layer functions do all dataset
reads/writes and return DataLists/Data. See the SKILL.md for the three-layer discussion.

---

## Common gotchas

- **`//@include` is a magic comment.** It looks like a comment to any JS tooling, but the
  compiler treats it specially. Don't reformat or remove these lines.
- **Include paths must exist in `pal.json`.** A path that isn't registered as a library
  workflow will fail at compile time. Verify the file is registered with `workflowType: 4`.
- **Libraries cannot include other libraries.** There is no library dependency chain — an
  `@include` line in a library workflow won't do anything useful. If library A needs a
  function from library B, either merge them or have both included by the workflow that
  needs them.
- **`workflowContext` mismatch is a tooling concern, not a runtime one.** A context mismatch
  breaks editor autocomplete but doesn't fail at runtime — the runtime failure comes from
  calling methods that don't exist in the current workflow's controller.
- **Function name collisions across included libraries are silent.** Two libraries both
  defining `formatDate` — the later include wins, the earlier is overwritten. Namespace with
  descriptive names (`formatUserDate`, `formatOrderDate`) if this is a real risk.
