# Transaction Workflows (`workflowType: 2`)

Transaction workflows are the authenticated, browser-based engine for interacting with
**Transaction Packets** — CloudPiston's structured document/data container designed for
multi-step, audited processes (contracts, forms, agreements, complex records).

Companion:
- `../SKILL.md` — the `run()` pattern, reserved globals (universal to all types)
- `console.md` — console pals typically orchestrate transactions

**Official API:**
- Packet — https://secure.cloudpiston.com/cpal/cp-api/transaction/Packet.html

> **Coverage note.** Transaction packet APIs are extensive and vary by use case. This
> reference covers the recurring patterns and concepts you need for any transaction
> workflow. For specific packet operations not covered here, consult the Packet API doc
> linked above.

---

## What transactions are for

Transactions are **heavily audited**. Every mutation is tracked, signatures are
cryptographically bound to packet state, and the platform preserves a full change history.
That auditing has costs:

- Transactions are **slower** than raw dataset operations.
- They are **not efficient for bulk work** — one packet per transaction, one transaction per
  workflow cycle.
- They shine for **enterprise-grade client applications** — contracts, compliance records,
  audit-required forms — where the audit trail is worth the overhead.

If you don't need auditing and immutability, use pal datasets directly instead.

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

Transaction workflows have an additional reserved global: `tx`, the transaction (packet)
object.

```js
var c;
var pal;
var tx;                                     // ← additional in transaction workflows
var request;
var data;
var action;
var page;
var payload;

function run(controller) {
    c = controller;
    pal = c.getPal();
    tx = c.getPacket();                     // ← Packet is the underlying class name
    // ...
}
```

Historically this variable is called `tx` (short for transaction) — the underlying class is
`Packet` and the accessor is `c.getPacket()`. The naming reflects the platform's transaction
→ packet terminology evolution. The reserved variable name `tx` is what shows up in every
transaction workflow; use it for consistency.

Full API: https://secure.cloudpiston.com/cpal/cp-api/transaction/Packet.html

---

## Transaction Packets

A **transaction packet** is a self-contained unit of work with:

- **Named `DataList`s** — tabular data attached to the packet
- **Named `Data` objects** — structured key/value bundles
- **Documents** — HTML documents that render the packet's content
- **Signatures** — cryptographic signatures binding parties to the packet's state
- **Workflow state** — the packet's stage in a multi-step process

### Reading

```js
var notes = tx.getDataList("notes");        // read a named DataList
var meta  = tx.getData("meta");             // read a named Data
```

Reading a packet DataList or Data that doesn't exist returns `null` — a fresh packet has
none until you create them.

### Writing

Packet writes work just like DataList/Data operations, but the changes attach to the
transaction:

```js
var notes = tx.getDataList("notes");
if (notes == null) {
    notes = c.createDataList("notes", ["createDate", "createdBy", "note"]);
}

var newNote = notes.insertRecord();
newNote.setDate("createDate", dateUtil.createDate());
newNote.set("createdBy", c.getUser().getProfile().getName());
newNote.set("note", request.get("note"));

tx.setDataList(notes);                      // attach the modified list to the packet
```

---

## `tx.commit()` — usually not needed

**Transaction packets commit automatically at the end of the workflow cycle.** You do NOT
need to call `tx.commit()` for normal writes — the platform persists all packet mutations
when `run()` returns.

Call `tx.commit()` only when you need to **commit earlier** — for example, when subsequent
code in the same request depends on the write being visible, or before delegating to a
downstream operation that reads the packet fresh.

```js
tx.setDataList(notes);
tx.commit();                                // only if something below needs the write persisted NOW

// ... more code that assumes the note is committed
```

For 99% of handlers, skip the `commit()` call — the end-of-cycle auto-commit handles it.

---

## Common transaction methods

Verify signatures against the API docs — these are the recurring patterns:

| Call | Purpose |
|---|---|
| `tx.getDataList(name)` | Read a named DataList from the packet |
| `tx.setDataList(list)` | Attach a DataList to the packet (name preserved) |
| `tx.getData(name)` | Read a named `Data` from the packet |
| `tx.setData(name, data)` | Attach a `Data` to the packet |
| `tx.commit()` | Persist changes immediately (usually auto at end of cycle) |
| `tx.getStatus()` / `tx.setStatus(status)` | Read/write the packet's workflow status |

---

## Wizards

**Wizards** are multi-step workflows within a transaction. Each step renders a page or
fragment; the wizard tracks progress and allows navigation between steps.

Wizards are registered in `pal.json`'s `wizards` section (see
`palbuilder-core/references/pal-json.md`). Runtime access is via the controller — check the
API docs for the wizard-specific accessors.

The general pattern:
- Each wizard step is a page or fragment
- Navigation actions (`next`, `back`, `save-and-continue`) live in the action switch
- The wizard's current step is stored in the transaction state
- Final-step completion finalizes the packet (auto-commit at cycle end handles persistence)

---

## Documents in transactions

Documents (HTML files with `palTypeDocument` fragments) are the printable/renderable form of
a packet's data. They read from the packet's DataLists and `Data` objects via `${var}`
template syntax and render as HTML — which can be:

- Displayed inline
- Downloaded via `c.createDownloadResponse().setFileContent(...)` (see `responses.md`)
- Converted to PDF for signature or archival

---

## Common gotchas

- **`tx.commit()` is USUALLY UNNECESSARY.** Packets auto-commit at the end of the workflow
  cycle. Only call `commit()` if you need mid-cycle persistence for a subsequent read.
- **Transactions are slow for bulk work.** If you need to process 10,000 records with
  audit-free efficiency, use pal datasets directly (see `palbuilder-data`). Transactions are
  for high-value, low-volume, audit-required work.
- **Reading a nonexistent packet DataList returns null.** Always null-guard before iterating
  — a fresh packet has no data yet.
- **Transaction system workflows (`workflowType: 3`) are deprecated.** Use console-system
  (`workflowType: 11`) instead, passing the transaction id explicitly. See
  `console-system.md`.
- **Signatures affect what's editable.** Once a party has signed a packet, mutating parts of
  it may invalidate the signature. Design the flow so signing happens after all edits.
- **Transactions rarely make sense as the pal's entry point.** They're usually reached from
  a console workflow via `c.switchToNavigator(...)`. If your pal starts users directly in a
  transaction with no console orchestration, verify that's really the right shape.