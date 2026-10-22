# Pal Chains, Resources, and Modules

A pal is rarely alone. The platform lets one pal reach into another's code through three
relationships — **Pal Resources**, **Pal Chains**, and **Pal Modules** — all fetched by the same
underlying mechanism and shaped identically once retrieved: a list of pals, each listing every
file (pages, fragments, workflows, scripts, styles, everything `pal-structure.md` describes).
**Only workflows are guaranteed to arrive with their content** (the CloudPiston Resource pals are the
exception and arrive complete); every other file of a chain pal may be just a name with an empty
placeholder on disk until you read it (see "Empty files in `.resources/`" below). Check the file: if
it has content, it is already there.
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

**CloudPiston Resource** is not part of any pal chain. It is a normal pal owned by the system
enterprise and visible to every pal on the platform (not something a developer attaches). There
are two copies, "(Cloud)" and "(Root)"; the server delivers them in the same `GET_CHAIN` response
as the pal's own chain, so they land in `.resources/` beside it. A pal chain is a different thing
from a module, shadow, repository or skin (a repository can be a member of a chain). All of
CloudPiston Resource's content lives under a root `cloudpiston` folder. It carries:

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
  By the time you're working, `.resources/` lists everything currently in scope: every file's
  **name** is on disk, but only workflows are guaranteed to carry content.
- **`.resources/` is never part of the pal being edited.** It is not pull-managed, not pushed, and
  gets wiped and rewritten on every refresh — never edit files there, and never expect local
  changes under `.resources/` to survive.
- **Don't write under `.resources/`**: the Edit/Write guard hook refuses it. To change behavior, put a file at the same path in the current pal — the
  local file takes precedence over the chain pal's copy.
- **Validation sees the chain.** `pal_validate` and the push gate count `.resources/` workflows and
  fragments when checking what exists, is set, or is routed (payload keys, list names, action cases,
  static fragments, ajax-target ids), so a variable set by a chain pal's workflow is not reported as
  missing. Chain files are never linted themselves, and a local file at the same path shadows the
  chain copy.
- Refresh on demand with the `pal_resources` MCP tool if a chain pal may have changed server-side
  (e.g. CloudPiston Resource was updated) or the chain itself changed (a module was attached or
  detached) — mid-session, `.resources/` can otherwise go stale.

## Empty files in `.resources/`

A 0-byte page, fragment, script, style, image or attachment under `.resources/` is a **placeholder
for a file that exists but was not downloaded** — not a file that is empty. The server only ships
names for those types (PalBuilder loads their content lazily), so you fetch what you need — and how
depends on the kind of pal:

- **Existence needs no content.** The placeholder is the proof the file exists; a `<c:fragment>`
  or reference to it validates without reading it.
- **An ordinary pal — fetch it whole.** Call `pal_resources` with `pal` (the folder name under
  `.resources/`, or its guid); adding `type` and `file` just names what you're after. One full
  `GetPal` replaces that pal's placeholders with real content for **every** file, because ordinary
  pals are small. Type names are singular (`fragment`) or the folder name (`fragments`).
- **A repository pal — one file at a time.** Repositories can be huge, so name `pal`, `type` and
  `file`; only that file is written. Never fetch one whole, and ask the developer before fetching
  many files (see `repository-pal.md`). A shadow pal is read one file at a time as well.
- **CloudPiston Resource (Cloud and Root), and an enterprise resource pal if the cloud has one,
  arrive complete** — every file with its content — so there is nothing to fetch: read them straight
  from `.resources/` (`pal_resources` answers "already present" without a request). A "(Cloud)" copy
  is not required, so some clouds have only Root. If a file of one of these is ever empty, request
  just that file with `pal_resources` (one file at a time); never ask for the whole pal, which the
  server refuses for a system-owned pal.
- Checks that need content (such as `ajax-target` ids) can't see unfetched files and will say
  "could not verify" rather than "missing".
- A pal you cannot open (another enterprise's, for example) refuses the read ("not a development
  Pal"); work from the names and workflows the chain gave you.

## `.resources/` is sample code, never documentation

Everything under `.resources/` — CloudPiston Resource's demo pages included — is **code you may
reuse by inclusion/reference, not a source of platform rules.** It demonstrates one working
pattern for one narrow purpose; it does not define what's correct or incorrect elsewhere. Never
generalize a call you see there into a claim about API correctness (e.g. "`pal.getPage(...)` must
be right because a resource pal calls it" — that resource may be using it for something
unrelated, like feeding a page into `createDownloadResponse()` for a PDF, not returning it from
`run()`). Platform rules — what a method returns, what's valid to return from `run()`, what's
deprecated — live in the `palbuilder-*` skills, not in `.resources/`. If a resource file's usage
seems to contradict a skill, verify against the server's own compiler (`pal_test`) before trusting
either one, and flag the skill for a fix if it's genuinely wrong — don't treat the resource sample
as the tiebreaker.

## Deciding whether to use CloudPiston Resource

- **New pal:** always ask the developer whether to use CloudPiston Resource before building UI
  elements it already covers (modals, toasts, paging, image upload, etc.) — most projects do, but
  it's a decision to confirm, not assume.
- **Existing pal:** don't ask — infer it. If the pal's workflows already `//@include` a
  `cloudpiston/...` library, or its pages already load `lib-ui.js`/`lib-ui.css`, it's in use;
  match that. If nothing under `cloudpiston/` is referenced anywhere in the pal, it isn't in use;
  don't introduce it in passing as part of an unrelated change.
