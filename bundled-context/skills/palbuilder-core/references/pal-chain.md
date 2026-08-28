# Pal Chains, Resources, and Modules

A pal is rarely alone. The platform lets one pal reach into another's code through three
relationships — **Pal Resources**, **Pal Chains**, and **Pal Modules** — all fetched by the same
underlying mechanism and shaped identically once retrieved: a list of pals, each with its full
content (pages, fragments, workflows, scripts, styles, everything `pal-structure.md` describes).
This reference covers what a chain contains and how to reason about it. For the platform's own
bundled library that lives inside one specific chain member (CloudPiston Resource's `lib-ui`
workflow), see `palbuilder-frontend/references/cpresource.md`.

**Everything in the chain is dynamic — none of it is a fixed API.** Every pal returned by
`GET_CHAIN`, CloudPiston Resource included, is an ordinary pal living on the server: any of them
can gain, lose, or change files, functions, or fragments at any time, independent of this
repository's docs or release cycle. `cpresource.md` documents `lib-ui`/`lib-paging` as they stood
when last verified — a snapshot, not a contract. Treat any specific function name, fragment path,
or file this reference or `cpresource.md` names as **likely but not guaranteed** to still be
there. Before depending on one:
- Check it actually exists in the current `.resources/<slug>/` extraction — read the real file,
  don't rely on memory of the doc.
- If it's missing, changed, or `.resources/` looks stale, refresh with `pal_resources` before
  concluding it's gone.
- If a chain pal has genuinely changed shape (new library, removed function, renamed fragment),
  that's real drift, not a bug in your extraction — work from what's actually there and flag the
  doc as outdated so it can be refreshed, rather than silently working around the mismatch.

## The three relationships

- **Pal Resources** — a pal explicitly attached to the current pal as a source of shared code
  (fragments, workflow libraries, styles) to include from.
- **Pal Chains** — the general dependency graph: any pal reachable from the current one, for
  whatever reason it was linked.
- **Pal Modules** — a module pal is **bolted onto** a runtime (host) pal. The dependency runs one
  way: the module depends on the runtime pal, never the reverse. When you are working on a
  module pal, its runtime/parent pal shows up in the chain so you can see what it's attached to
  — but you are still only editing the module.

In practice these three blur together in day-to-day work: any pal in the chain — a resource, a
chain member, or a module's runtime pal — can be included in and used by the pal you're editing.
A page can `<c:fragment>` a resource pal's fragment; a workflow can `//@include` a chain pal's
library; a module can call into its runtime pal's tunnel. Treat the distinction as informational
(it tells you *why* something is reachable), not as a rule about what you're allowed to use.

## The CloudPiston Resource system pal

One chain member is special: **CloudPiston Resource**, a system pal available globally to every
pal on the platform (not something a developer attaches — it's just always in the chain). All of
its content lives under a root `cloudpiston` folder. It carries:

- **Sample pages** demonstrating various JS/CSS libraries and frameworks for building common pal
  elements.
- **Standard fragments** for recurring UI needs — paging, image upload, and more.
- **Workflow libraries** for common server-side patterns — dataset paging, showing AJAX
  fragments, and more.

`cpresource.md` documents one library inside it in depth (`lib-ui`/`lib-paging` — modals, toasts,
alerts, form validation, the CR Datalist widget). Everything else under `cloudpiston/` (the demo
pages, other fragments/libraries) is discoverable the same way: read it directly out of
`.resources/` once extracted (see below) rather than assuming this reference or `cpresource.md`
is exhaustive.

## Treat the chain as part of the same pal

Any pal in the chain can be treated as if its content were part of the current pal — reference
its fragments, include its workflow libraries, reuse its datasets — even though **you cannot edit
it**. It is read-only in this session: no push, no lock, no local changes. If you find storage
you need (e.g. a dataset) already defined in a chained pal, use it as-is rather than recreating
it locally; if you need to change it, that requires opening that pal in its own session.

## Getting the chain onto disk: `.resources/`

The chain is fetched via the server's `GET_CHAIN` operation and extracted to
`<workspace>/.resources/<slug>/` — one folder per chain pal, in the same shape as a normal pulled
pal (`pages/`, `fragments/`, `workflows/`, etc.), so it reads exactly like any other pal source.
`.resources/index.json` lists what's there: each entry's slug, name, category, guid, and whether
it's a module.

- **This happens automatically** at the start of every session — you don't need to ask for it.
  By the time you're working, `.resources/` already holds everything currently in scope.
- **`.resources/` is never part of the pal being edited.** It is not pull-managed, not pushed, and
  gets wiped and rewritten on every refresh — never edit files there, and never expect local
  changes under `.resources/` to survive.
- Refresh on demand with the `pal_resources` MCP tool if a chain pal may have changed server-side
  (e.g. CloudPiston Resource was updated) or the chain itself changed (a module was attached or
  detached) — mid-session, `.resources/` can otherwise go stale.

## Deciding whether to use CloudPiston Resource

- **New pal:** always ask the developer whether to use CloudPiston Resource before building UI
  elements it already covers (modals, toasts, paging, image upload, etc.) — most projects do, but
  it's a decision to confirm, not assume.
- **Existing pal:** don't ask — infer it. If the pal's workflows already `//@include` a
  `cloudpiston/...` library, or its pages already load `lib-ui.js`/`lib-ui.css`, it's in use;
  match that. If nothing under `cloudpiston/` is referenced anywhere in the pal, it isn't in use;
  don't introduce it in passing as part of an unrelated change. (`pal-init`'s MAP.md "Loaded
  libraries" inventory step is where this gets recorded.)
