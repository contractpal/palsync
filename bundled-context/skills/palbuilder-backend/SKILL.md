---
name: palbuilder-backend
description: Compatibility skill for older palsync guidance that asks for "backend" work. For new server-side workflow code, prefer palbuilder-workflow. For datasets, dataviews, payloads, and request/data shaping, prefer palbuilder-data. Keep this skill only when you need its older CRUD worked example or API reference.
---

# PalBuilder Backend — Compatibility Router

This skill is retained for older prompts, specs, and examples that say "backend".
The canonical workflow guidance now lives in **`palbuilder-workflow`**, and the
canonical data guidance lives in **`palbuilder-data`**.

Use this skill only as a router:

- Writing or editing workflow `.js` files → read **`palbuilder-workflow`**.
- Reading/writing datasets, dataviews, payloads, DataLists, request data, cache, files,
  or server-side HTTP → read **`palbuilder-data`**.
- Background jobs or WebSockets → read **`palbuilder-realtime`**.

Legacy references kept here:

- **`references/worked-example-crud.md`** — older end-to-end CRUD walkthrough.
- **`references/api-reference.md`** — older method-level API notes for controller,
  payload, request, DataSet, DataView, and DataList calls.

Do not copy workflow rules from this compatibility skill into new docs. Put shared
workflow guidance in `palbuilder-workflow`; put shared data guidance in `palbuilder-data`.
