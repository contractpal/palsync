# Wizards — Multi-Step Dialog Flows (`workflowType: 2`, transaction only)

A **Wizard** is a multi-dialog (multi-screen), branching data-collection flow that lives inside
a single transaction workflow request/response cycle. Think of it as a mini state machine: each
"dialog" is one screen of form fields; `<if>` rules decide which dialog comes next based on what
the user just entered; when the flow is done, control returns to the workflow with an action
string you handle like any other `c.getAction()` case.

Companion:
- `../SKILL.md` — the `run()`/action-switch pattern the wizard hands back into
- `transaction.md` — wizards are driven from a transaction `Packet`; read this first
- `documents.md` — feeding a wizard's collected `Data` into a document at creation time
- `palbuilder-frontend` — fragments/pages hosting the `c:wizard*` tags
- `palbuilder-core/references/pal-structure.md` — the `wizards/` folder and manifest entry shape
- `palbuilder-core/references/pal-json.md` — `wizards` section in `pal.json`

---

## Wizards are now a pull/push-managed folder

`wizards/` mirrors to real files on disk exactly like `pages/`, `fragments/`, and `workflows/`:
`pal_pull` writes each wizard's `<dialogs>` XML to `wizards/<name>.xml` as plain text, and
`pal_push` reads that file and fills `pal.json` → `wizards.entry[].Wizard.content` from it —
edit the file directly with normal file tools, no base64 hand-decoding needed.

Two things stay different from every other content type:
- **No `palType`/`workflowType` field.** A wizard's manifest entry is just
  `content`/`contentType`/`filename`, the same shape as a `Document`:
  ```json
  { "string": "<name>.xml", "Wizard": { "content": "", "contentType": "text/html",
    "filename": "<name>.xml" } }
  ```
  Leave `content` empty on disk — push fills it in from the file, same as any other new file.
- **`pal_validate`/`pal_push` do NOT validate the `<dialogs>` dialect.** Unlike page/fragment
  XHTML, wizard XML is not client-side checked — the server is authoritative. A clean
  `pal_validate`/`pal_push` proves nothing about dialog names, `goto` targets, or `<if>`
  conditions being correct; only a real run (`pal_screenshot`/`pal_preview` through the wizard's
  flow, or `pal_tunnel_test` if it's reachable that way) proves the branching logic works.

---

## The `<dialogs>` XML dialect (documented, confirmed via API docs)

Root element `<dialogs>`:

| Attribute | Purpose |
|---|---|
| `firstDialog` | Which dialog displays first |
| `styleSheet` | CSS file for wizard styling |
| `id` | Element identifier |
| `validationTarget` | Default location for validation messages |

`<dialog>` — one screen:

| Attribute | Purpose |
|---|---|
| `name` | Required identifier |
| `progress` | 1–100, wizard-completion indicator |
| `goto` | Next dialog's name, or the literal `"endWizard"` to hand control back to the workflow |
| `action` | Action string passed to the workflow's `c.getAction()` when `goto="endWizard"` |
| `id` | Element identifier |
| `validationTarget` | Validation message location for this dialog |

Contains optional `<if>` / `<if_compound>` (evaluated top to bottom) plus a required `<content>`.

`<if>` — single-condition branch:

| Attribute | Purpose |
|---|---|
| `field` | Data field to test |
| `condition` | JEXL operator: `eq`, `neq`, `lt`, `gt`, `ge`, `le`, ... |
| `value` | Comparison value |
| `type` | Field type: `string`, `date`, `number` |
| `target` | Dialog name to jump to, or `"endWizard"` |
| `action` | Action string, used when `target="endWizard"` |

`<if_compound>` — multi-condition branch: contains `<and>` or `<or>`, each holding `<test>`
elements with the same attributes as `<if>` (`field`/`condition`/`value`/`type`); the compound
element itself carries `target`/`action` like `<if>`.

`<content>` — wraps the HTML shown to the user. Any HTML input with a `name` attribute inside it
becomes a wizard data field, readable from the workflow after the wizard ends.

**Field-level validation attributes** (documented names):

| Attribute | Purpose |
|---|---|
| `cp-use` | Requirement level: `R` (required), `roles`, `test` |
| `cp-pattern` | Predefined validation pattern (e.g. email, phone, date) |
| `cp-custompattern` | Custom regex, used when pattern requires it |
| `cp-roles` | Comma-separated roles, paired with `cp-use="roles"` |
| `cp-test` | JEXL expression, paired with `cp-use="test"` |
| `cp-validationTarget` | Where this field's validation message displays |
| `cp-requiredMessage` | Custom message for a missing required field |
| `cp-validationMessage` | Custom message for a pattern failure |
| `cp-message` | Fallback validation message |

**Legacy aliases — seen in real, working pals, not in current docs:** bare `first="..."` instead
of `firstDialog`, and bare `use="R"` / `cp-pattern="pos integer"` (no `cp-` prefix on `use`)
directly on wizard content inputs. These still work but are likely deprecated forms from an
earlier version of the dialect. **Use the documented names above for anything new.** If you're
reading an existing wizard that uses the bare forms, don't "fix" them without asking — they are
working, deployed behavior, not a bug.

---

## The `c:` tags

`c:wizard` — renders the current dialog's `<content>`. **No attributes.** Always bare:
```xml
<c:wizard/>
```

`c:wizard-next` — advances to the next dialog (or, on the last dialog, triggers `goto`):

| Attribute | Notes |
|---|---|
| `value` | Required for a button; optional for a link — if `type="link"` and `value` is omitted, the tag body is wrapped into the link instead |
| `type` | e.g. button vs link rendering |
| `action` | — |
| `validate` | — |
| `title`, `class`, `style`, `id`, `out-class`, `over-class` | standard styling/identification hooks |

`c:wizard-previous` — same attribute set as `c:wizard-next`, except it has `ignore` instead of
`action`: **`ignore`** — if `true` and there is no previous dialog, the button is not drawn.

Example (from the API docs' own sample):
```xml
<table>
    <tr>
        <td colspan="2">
            <c:wizard/>
        </td>
    </tr>
    <tr>
        <td><c:wizard-previous value="Previous" class="wizButton"/></td>
        <td><c:wizard-next value="Next" class="wizButton"/></td>
    </tr>
</table>
```

---

## Workflow-side API

Wizards are driven from a transaction **Packet** (`c.getPacket()`), confirmed only in that
context — the API surface documented is `Packet`/`TransactionPacket`, not `WebController`/
`ConsoleController`. Treat wizards as **transaction-workflow-only** until proven otherwise by an
actual test in console/web.

```
packet.addWizard(String name)          -> Wizard        // create/attach a new wizard instance
packet.getWizard(String name)          -> Wizard         // fetch an existing instance
packet.deleteWizard(String name)                          // clear a prior instance (call before re-adding on restart)
packet.addDuplicateWizard(String, String)                 // (documented; exact semantics not yet exercised)
packet.getCurrentWizard()              -> Wizard
document.addWizard(String, Wizard, String)                 // (documented; not yet exercised)
page.addWizardToPage(Wizard)                                // attach the wizard so c:wizard renders it
```

`Wizard` instance methods:

| Method | Returns | Purpose |
|---|---|---|
| `getCurrentDialog()` | String | Name of the active dialog |
| `getData()` | Data | All collected field values as a `Data` object |
| `getDialogData(String dialog)` | Data | Values scoped to one dialog |
| `getDialogValues(String dialog, String key)` | String[] | Multi-value field within one dialog |
| `getDisplaySettings()` | DisplaySettings | — |
| `getName()` | String | Wizard's name |
| `getValue(String key)` | String | Single value, null if absent |
| `getValues(String key)` | String[] | Multi-select values, empty array if absent |
| `isCurrent()` | boolean | Whether all wizard dialogs match the pal's current dialog definitions |
| `rebuildFromPal(boolean preserve)` | void | Resync wizard against pal dialog defs; `preserve` controls whether data survives |
| `setEndAction(String action)` | void | Override the action passed back on completion |
| `setLinkedValues(boolean link)` | void | Enable/disable field linking across dialogs |
| `showDialog(String dialog, boolean clear)` | void | Jump to a specific dialog programmatically |
| `wasChanged()` | boolean | Whether the wizard was modified this request |
| `wasDialogChanged(String pageName)` | boolean | Whether one specific dialog changed |

`Data.toDataList(String name)` — converts a wizard's collected `Data` into a `DataList`, ready to
`payload.addDataList(...)` for rendering (e.g. a `c:list` summary of every answer).

---

## The end-to-end pattern (ground truth — working example in this pal)

`workflows/tx.js` (transaction, `workflowType: 2`):

```js
function startWizard()
{
    tx.deleteWizard("info");           // clear any stale instance before restarting
    var wiz = tx.addWizard("info");
    page.addWizardToPage(wiz);          // so <c:wizard/> in the fragment renders it
    payload.set("frag", "wizard");      // swap the page's fragment to the one hosting c:wizard
}

function endWizard()
{
    var wiz = tx.getWizard("info");
    var data = wiz.getData();
    var list = data.toDataList("list"); // shape collected answers into a DataList
    payload.addDataList(list);
    payload.set("frag", "summary");     // swap to a fragment that renders that list
}
```

`fragments/wizard.html` — hosts the live wizard:
```xml
<div xmlns:c="contractpal">
    <c:wizard/>
    <br/>
    <c:wizard-previous value="Previous"></c:wizard-previous> <c:wizard-next value="Next"></c:wizard-next>
</div>
```

`fragments/summary.html` — renders the answers after `endWizard`:
```xml
<div xmlns:c="contractpal">
<c:list name="list" id="item">
    <li>${item.name} = ${item.value}</li>
</c:list>
</div>
```

The host page (`pages/tx.html`) starts things off with a plain action link and hosts the
swappable fragment:
```xml
<c:a action="startWizard">Start Wizard</c:a>
<div id="body">
    <c:fragment name="${frag}"/>
</div>
```

Each dialog's `<if>`/`goto` decides where to go next; reaching a dialog with `goto="endWizard"`
(or an `<if target="endWizard">` match) is what routes back into `tx.js`'s `endWizard()` via
`c.getAction()`.

---

## Gotchas

- **Reset before restart.** Call `deleteWizard(name)` before `addWizard(name)` when a user can
  restart the same wizard in one session — unless you need dialog history/data can linger which is typical for a deployed pal.
- **`goto="endWizard"` is the ONLY way control returns to the workflow.** A dialog with no
  `goto` (and no matching `<if target="endWizard">`) just sits there waiting for the next
  `c:wizard-next`/`c:wizard-previous` click — it never reaches your `run()` switch.
- **`type` on `c:wizard-next`/`c:wizard-previous`** governs button vs. link rendering — check the
  live docs page if you need link-style navigation instead of a button; not fully detailed here.
- **No confirmation needed on `startWizard`.** Restarting a demo/data-collection wizard isn't a
  destructive delete in the golden-rule-9 sense (it doesn't destroy persisted user data) — don't
  add `confirm=` reflexively just because `deleteWizard` is called internally.
- **`cp-pattern="date"` on an `input type="date"` field is a mismatch.** `date` expects
  `MM/dd/yyyy` (text-field format), but a native `input type="date"` submits `yyyy-MM-dd` —
  validation fails against real browser input. Use `cp-pattern="dateYearMonthDay"` instead,
  which is the pattern documented to match browser `type="date"` fields. Other date patterns
  (`dateDayMonthYear`, `dateMonthYear`) are for text inputs with region-specific formats, not
  the native date picker. Always check the live patterns table at
  https://secure.cloudpiston.com/cpal/cp-api/transaction/misc.html#patterns before picking a
  `cp-pattern` — don't assume the name matches the format you expect.
