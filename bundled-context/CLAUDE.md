# CloudPiston Pal Agent Rules

You are editing a **CloudPiston pal**, a proprietary server-side Java/JavaScript dialect you do not know from training. **Never invent PalBuilder syntax, tags, attributes, manifest shapes, or API methods.** Load the owning skill/reference before editing.

## Route before you edit

Load every skill the task touches.

- New pal → `pal-spec`; existing-pal feature/change → `pal-init`; bug/small correction → `pal-fix`.
- Existing `SPEC.md` / `EXECUTION.md` work → `pal-loop`; independent finished-build review → `pal-review`.
- Markup/browser UI → `palbuilder-frontend`; workflow code → `palbuilder-workflow`; data/datasets → `palbuilder-data`.
- Visible UI also requires `design-build`; if no real design system exists, load `design-system-init` first.
- Manifest/structure/restricted workflow-JS questions → `palbuilder-core`. Load other matching `palbuilder-*` skills when relevant.

## GOLDEN RULES

These are routing-level reminders; details and examples live in the owning skills and PalSync validators.

1. **Frontend markup is strict XHTML.** Self-close void elements. Keep raw script/style bodies unescaped, and do not put `${...}` template syntax in inline page scripts.
2. **Use only documented `c:` attributes.** Check `palbuilder-frontend` / its tag reference before using an unfamiliar attribute.
3. **Fragments cannot contain `<script>`.** Put client JS in `scripts/*.js`, load it from the page, and do not rely on `DOMContentLoaded` for AJAX-loaded fragments.
4. **Prefer PalBuilder `c:` actions for server calls.** Do not use `fetch`/ClientPal unless the platform-native route genuinely cannot do the job.
5. **`c:a` is for PalBuilder actions, not `onclick`.** Use `action=` for server behavior and plain HTML elements for JS-only behavior.
6. **Workflow JS uses a restricted engine.** Read `palbuilder-core/references/es3-cheatsheet.md`; `pal_validate` catches confirmed breakers, not every unsupported construct.
7. **Cross-file contracts must match exactly.** `c:list` names, payload keys, actions, fragment keys, EL, and `ajax-target` values must agree with their real producers/targets; use the owning skill and validator findings.
8. **Fragment field submission uses `c:a action=...`, not `<form>` or `href="?action=..."`.**
9. **Destructive `c:a` actions should carry `confirm="..."`.** The validator warns on likely destructive actions; verify ambiguous cases instead of treating every `remove*` action as destructive.

## Work narrowly

Make the smallest change that satisfies the request. Reuse existing Pal code and platform capabilities before adding abstractions. Do not reformat or improve unrelated code. Genuine ambiguity is a reason to ask, not to guess.

## Verify claims

Use PalSync's deterministic/server/runtime checks for the behavior you changed. Compile/validation success is not runtime/render evidence. Do not claim UI state, saved data, or completed behavior that a tool did not actually observe.

Detailed sync, file-creation, dataset, and completion behavior is provided by PalSync's managed/on-demand context.
