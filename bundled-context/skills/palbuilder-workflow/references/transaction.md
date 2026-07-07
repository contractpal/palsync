# Transaction Workflows (`workflowType: 2`)

Transaction workflows are the authenticated, browser-based engine for interacting with
**Transaction Packets** — CloudPiston's structured document/data container designed for
multi-step processes with a legally-defensible audit trail (contracts, agreements,
compliance forms, signed records).

Companion:
- `../SKILL.md` — the `run()` pattern, reserved globals (universal to all types)
- `console.md` — console pals typically orchestrate transactions

**Official APIs:**
- Transaction controller — https://secure.cloudpiston.com/cpal/cp-api/transaction/index.html
- Packet — https://secure.cloudpiston.com/cpal/cp-api/transaction/Packet.html

> **Coverage note.** Transaction packet APIs are extensive; documents (the primary auditing
> surface) will get their own reference later. This file covers the recurring workflow
> patterns and the packet-mutation model you need for any transaction workflow.

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

If you don't need documents or signatures, use pal datasets directly instead.

---

## Orchestration — transactions don't operate alone

**A transaction workflow rarely runs in isolation.** The typical pattern:

- A **console workflow** (see `console.md`) lists, filters, and creates transaction packets
- The user selects or creates a packet from the console UI
- The console workflow delegates to the transaction workflow via
  `c.switchToNavigator(txId, action, anon)` — see `console.md`

Console workflows can also **read transaction packet data without switching workflows** — to
list packets, show summaries, extract completed values, etc. The transaction workflow itself
is entered only when the user is actively working within a specific packet.

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
the record of what was agreed to at signing time. A future reference will cover documents
in depth (rendering, versioning, PDF conversion, print styles).

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

Document + signature details will be covered in the forthcoming documents reference.

---

## Wizards

**Wizards** are multi-step workflows within a transaction. Each step renders a page or
fragment; the wizard tracks progress and allows navigation between steps.

Wizards are registered in `pal.json`'s `wizards` section (see
`palbuilder-core/references/pal-json.md`). Runtime access is via the controller — check the
controller API docs for the wizard-specific accessors:
https://secure.cloudpiston.com/cpal/cp-api/transaction/index.html

The general pattern:
- Each wizard step is a page or fragment
- Navigation actions (`next`, `back`, `save-and-continue`) live in the action switch
- The wizard's current step is stored in the packet state
- Final-step completion finalizes the packet (auto-commit at cycle end handles persistence)

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
- **Transactions rarely make sense as the pal's entry point.** They're usually reached from
  a console workflow via `c.switchToNavigator(...)`. If your pal starts users directly in a
  transaction with no console orchestration, verify that's really the right shape.
