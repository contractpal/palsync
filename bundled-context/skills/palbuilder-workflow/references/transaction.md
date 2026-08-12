# Transaction Workflows (`workflowType: 2`)

Transaction workflows are the authenticated, browser-based engine for interacting with
**Transaction Packets** — CloudPiston's structured document/data container designed for
multi-step processes with a legally-defensible audit trail (contracts, agreements,
compliance forms, signed records).

Companion:
- `../SKILL.md` — the `run()` pattern, reserved globals (universal to all types)
- `console.md` — one common way to reach a transaction workflow, not the only way
- `wizards.md` — multi-dialog data-collection flows within a transaction
- `documents.md` — HTML/PDF documents, fields, and the click-signature flow in depth

**Official APIs:**
- Transaction controller — https://secure.cloudpiston.com/cpal/cp-api/transaction/index.html
- Packet — https://secure.cloudpiston.com/cpal/cp-api/transaction/Packet.html
- ProfileTxManager - https://secure.cloudpiston.com/cpal/cp-api/transaction/ProfileTxManager.html
- ZoneAccess - https://secure.cloudpiston.com/cpal/cp-api/transaction/ZoneAccess.html
- NavigatorResponse - https://secure.cloudpiston.com/cpal/cp-api/web/NavigatorResponse.html

> **Coverage note.** Transaction packet APIs are extensive. This file covers the recurring
> workflow patterns and the packet-mutation model you need for any transaction workflow;
> `documents.md` covers documents and signatures in depth.

---

## What transactions are for

Transactions are the pattern to use when the packet needs to be **signed**. Most of the
auditing that transactions are famous for happens at the **document** level via
**signatures** — see the Documents section below. Outside of documents, "signatures" have
no meaning in a transaction workflow.

Tradeoffs:

- Transactions are **slower** than raw dataset operations — the packet model, document
  rendering, and signature checks all add overhead.
- They are **not efficient for bulk work** — one packet per transaction, one transaction per
  workflow cycle.
- They shine for **enterprise-grade client applications** — contracts, compliance records,
  audit-required forms — where the legal weight of the document + signature trail is the
  point.

Use ProfileTxManager for searching for existing transactions based on role or group permissions.
You almost never need to use datasets or cubes for this purpose.

---

## Orchestration — two valid shapes, not one required pattern

**A pal is not one workflow type.** `layout` registers a *default* workflow per type
independently — a single pal can have a console workflow, a transaction workflow, a web
workflow, etc., any subset of them, and none is required to route through another. Don't assume
a transaction workflow needs a console workflow in front of it; check `layout.consoleControlled`
and which default workflows are actually registered before describing how a specific pal is
entered.

**Console-orchestrated** — common for back-office/admin work where a user manages *many*
packets (list, filter, create, resume):
- A **console workflow** (see `console.md`) lists, filters, and creates transaction packets
- The user selects or creates a packet from the console UI
- The console workflow delegates to the transaction workflow via
  `c.switchToNavigator(txId, action, anon)` — see `console.md`
- Console workflows can also **read transaction packet data without switching workflows** — to
  list packets, show summaries, extract completed values, etc.

**Transaction-only** — a complete, valid shape for a pal whose entire purpose is one packet
flow (a signing flow, a single data-collection form, etc.), with no console app at all:
- `layout.consoleControlled = false`
- `layout.transactionWorkflow` set to the entry workflow
- No `consoleWorkflow` registered — the transaction workflow's `run()` is reached directly

Pick the shape the pal actually needs — don't add a console workflow "to orchestrate" a
transaction that doesn't need one, and don't assume an existing transaction-only pal is
missing something.

Although a TransactionPacket is exposed in the web pal API, avoid as much as possible using it there unless explicitly needed.
You can direct access to a specific transaction or a new transaction from a web pal using the NavigatorResponse API.

To access a transaction packet without the user having a role or group access, use ZoneAccess.

---

## The `tx` global

Transaction workflows have an additional reserved global for the current packet:

```js
var c;
var pal;
var tx;
var request;
var data;
var action;
var page;
var payload;

function run(controller) {
    c = controller;
    pal = c.getPal();
    tx = c.getPacket();
    // ...
}
```

- **`tx`** is the current standard name for the packet global.
- **`packet`** is the older name and may appear in existing pals — same thing, same
  underlying object. Prefer `tx` in new code; when editing an older pal, follow the local
  convention rather than mixing both names in one file.

Full Packet API: https://secure.cloudpiston.com/cpal/cp-api/transaction/Packet.html

---

## Transaction Packets

A **transaction packet** is a self-contained unit of work carrying:

- **Named `DataList`s** — tabular data attached to the packet
- **Named `Data` objects** — structured key/value bundles
- **Documents** — HTML documents that render the packet's data (see below)
- **Signatures** — signed attestations bound to a specific document, tied to the user/profile
  that signed
- **Workflow state** — the packet's stage in a multi-step process

### Reading data from a packet

```js
var notes = tx.getDataList("notes");        // read a named DataList (null if none yet)
var meta  = tx.getData("meta");             // read a named Data
```

Reading a name that doesn't exist yet returns `null` — a fresh packet has none until you
create them. Always null-guard before iterating.

### Writing data — mutations persist automatically

**Changes to DataLists and Data objects attached to a packet are saved automatically.**
There is no "re-insert" or "attach back" step — get the list or data, mutate it, and the
mutation persists at the end of the workflow cycle.

```js
var notes = tx.getDataList("notes");        // existing list on the packet
if (notes == null) {
    notes = c.createDataList("notes", ["createDate", "createdBy", "note"]);
}

var newNote = notes.insertRecord();
newNote.setDate("createDate", dateUtil.createDate());
newNote.set("createdBy", c.getUser().getProfile().getName());
newNote.set("note", request.get("note"));

// That's it — no tx.setDataList(notes) call. The change persists on its own.
```

Same for `Data`:

```js
var meta = tx.getData("meta");
if (meta != null) {
    meta.set("lastEditedBy", c.getUser().getProfile().getName());
    meta.setDate("lastEditedAt", dateUtil.createDate());
    // No save call. Persists at end of cycle.
}
```

For newly-created DataLists/Data on a fresh packet, verify against the Packet API docs
whether a one-time attach is needed to bind the new object to the packet — the auto-persist
guarantee applies to objects already known to the packet.

---

## `tx.commit()` — 0 or 1 times per workflow cycle

Packets **auto-commit at the end of the workflow cycle**. `tx.commit()` should be called
**zero times** in a normal handler.

Call it **once** — never more — if you need to persist changes mid-cycle before subsequent
code depends on them being visible (e.g., before delegating to a downstream workflow that
re-reads the packet fresh):

```js
// ... mutate the packet ...
tx.commit();                                // early commit — one time only

// ... downstream code that assumes the writes are persisted ...
```

**Never call `tx.commit()` more than once per cycle.** Multiple commits in one workflow are
a code smell — the mutation model doesn't require them, and the audit machinery treats each
commit as a discrete step.

---

## Common Packet methods

See the Packet API doc for the full surface. Recurring calls:

| Call | Purpose |
|---|---|
| `tx.getDataList(name)` | Read a named DataList from the packet (null if absent) |
| `tx.getData(name)` | Read a named `Data` from the packet (null if absent) |
| `tx.commit()` | Persist mid-cycle (0 or 1 times per cycle — usually 0) |

Mutations to existing DataLists and Data auto-persist — no explicit set/save call needed.

---

## Documents

Documents are **first-class pal objects** — same category level as pages, fragments,
workflows, styles, and scripts. They live under `documents/` and are registered in
`pal.json` as `Document` entries (see `palbuilder-core/references/pal-json.md`).

Documents are HTML files with `palTypeDocument` fragments; they read from the packet's
DataLists and Data via `${var}` template syntax and render to HTML that can be:

- Displayed inline
- Downloaded via `c.createDownloadResponse().setFileContent(...)` (see `responses.md`)
- Converted to PDF for signature or archival

**Documents are the primary auditing surface** in a transaction — the rendered document is
the record of what was agreed to at signing time. Rendering, fields, the click-signature flow,
and the `c:document` tag: `documents.md`.

### Signatures

**Signatures are a function applied on documents** — an electronic signature captured when
a specific user/profile clicks a sign button on a rendered document. The signature is
cryptographically tied to:

- The **user and profile** that performed the signing
- The **document content** at signing time (so post-sign edits are detectable)

Signatures **have no meaning outside of documents**. There is no way to "sign a DataList"
or "sign a packet" abstractly — the artifact being signed is always a specific document.

Design flow:
- User works with the packet (edits DataLists, fills forms, etc.)
- When ready, the workflow presents a document rendered from the packet's data
- The user clicks the sign button; the signature is captured against that document
- Post-signature edits to the underlying data may invalidate the signature (verify against
  the API for the specific invalidation rules)

Full document + signature API, the `fields.Field`/`signatures.Signature` manifest shape, and a
working end-to-end example: `documents.md`.

---

## Wizards

A **Wizard** is a multi-dialog, branching data-collection flow driven from the transaction
`Packet` (`packet.addWizard`/`getWizard`/`deleteWizard`) and rendered via the `c:wizard`/
`c:wizard-next`/`c:wizard-previous` tags — not a series of separate pages/fragments navigated
through the action switch. Full dialect, API, and a working end-to-end example: `wizards.md`.

---

## Common gotchas

- **Do NOT call `tx.setDataList(...)` or `tx.setData(...)` after mutating an existing
  attached DataList/Data.** Changes auto-persist; the "re-attach modified list" pattern is
  wrong and unnecessary.
- **`tx.commit()` runs 0 or 1 times per cycle.** Never more. Zero is the norm — auto-commit
  handles it. One is for mid-cycle persistence before downstream code re-reads.
- **Transactions are slow for bulk work.** If you need to process 10,000 records with
  audit-free efficiency, use pal datasets directly (see `palbuilder-data`). Transactions are
  for high-value, low-volume, audit-required work.
- **Reading a nonexistent packet DataList/Data returns null.** Always null-guard before
  iterating — a fresh packet has no data yet.
- **Transaction system workflows (`workflowType: 3`) are deprecated.** Use console-system
  (`workflowType: 11`) instead, passing the transaction id explicitly. See
  `console-system.md`.
- **Signatures are document-bound, not packet-bound.** There's no way to "sign the packet"
  in the abstract — signing always targets a specific document. Once signed, modifying the
  underlying data may invalidate the signature.
- **`packet` vs `tx`** — older pals may use `packet` as the global; new code should use
  `tx`. Don't mix the two names in one file.
- **A transaction workflow as the pal's sole entry point is a valid, complete shape** —
  `consoleControlled: false` + `transactionWorkflow` set, no console workflow at all. Reaching
  it via a console workflow's `c.switchToNavigator(...)` is one common pattern for multi-packet
  admin UIs, not a requirement. Don't assume a transaction-only pal is missing a console layer.
