# Worked example — full CRUD console (list / add / edit / save)

A minimal end-to-end console workflow: list, open-form-for-add, open-form-for-edit, save
(insert-or-update), all swapping the same list fragment back in. Read this when building any
list+form CRUD feature — the primitives (`c:list`, `addDataList`, `isAjax`) exist elsewhere in
isolation; this shows them wired together correctly.

Page shell (`pages/console/equipment.html`, relevant part):

```html
<div id="body">
    <c:fragment name="${frag}" />
</div>
```

Workflow (`workflows/equipment.js`):

```js
function run(controller) {
    c       = controller;
    page    = c.getPage("console");
    payload = c.createPayload();
    pal     = c.getPal();
    request = c.getRequest();

    switch (c.getAction()) {
        case "getEquipment":
            frag = "console/equipment/list";
            loadList();
            break;
        case "showForm":
            frag = "console/equipment/form";
            showForm();
            break;
        case "saveEquipment":
            saveEquipment();
            frag = "console/equipment/list";   // ← rule f: fall through to the list fragment,
            loadList();                        //   not the form, so the save is actually visible
            break;
        case "deleteEquipment":
            deleteEquipment();
            frag = "console/equipment/list";
            loadList();
            break;
        default:
            break;
    }

    // rule d: transport-following response, not a per-action hardcode
    if (request.isAjax()) {
        ajax = frag ? c.createAjaxResponse(pal.getAjaxFragment(frag), true)
                    : c.createAjaxResponse("ignore", false);
        ajax.addPayload(payload);
        return ajax;
    }
    // key MUST match the page's ${frag} placeholder — a different key (e.g. "main")
    // resolves empty and the page renders blank on full load
    if (frag) { payload.set("frag", frag); }
    page.addPayload(payload);
    return page;
}

function loadList() {
    var ds     = pal.getDataSet("equipment");
    var filter = ds.createFilter();
    filter.selectColumns(["equipmentId", "name", "status"]);
    var items = ds.getRecords(filter).copy("items");   // copy("items") IS the c:list name
    payload.addDataList(items);                        // <c:list name="items" id="item">
}

function showForm() {
    // ← reads the id the Edit link passed as ajax-target/query string; forgetting this makes
    //   every "edit" open a blank form and every save a duplicate insert instead of an update
    var equipmentId = request.get("equipmentId");
    if (equipmentId == null) {
        payload.set("equipmentId", "");
        payload.set("name", "");
        payload.set("status", "available");
        return;
    }
    var record = pal.getDataSet("equipment").findRecord("equipmentId", equipmentId);
    payload.set("equipmentId", equipmentId);
    payload.set("name", record.get("name"));
    payload.set("status", record.get("status"));
}

function saveEquipment() {
    var ds = pal.getDataSet("equipment");
    var equipmentId = request.get("equipmentId");   // hidden field carries "" for add, id for edit
    var record = null;
    if (equipmentId != null && equipmentId != "") {
        record = ds.findRecord("equipmentId", equipmentId);   // ← branch on the hidden id, else
    }                                                         //   every edit duplicates the row
    var isNew = (record == null);
    if (isNew) { record = ds.createRecord(); }
    record.set("name", request.get("name"));
    record.set("status", request.get("status"));
    if (isNew) { ds.insertRecord(record); }         // createRecord → set → insertRecord(rec)
    else       { ds.updateRecord(record); }         // never ds.commit() — that's the packet API
}

function deleteEquipment() {
    var equipmentId = request.get("equipmentId");
    pal.getDataSet("equipment").deleteRecord(equipmentId.toString());   // String id, NOT a record object
}
```

List fragment (`fragments/console/equipment/list.html`):

```html
<c:ignore xmlns:c="contractpal">
<div id="listArea">
    <c:list name="items" id="item">
        <div>
            ${item.name} — ${item.status}
            <!-- ajax-target="body" matches the id="body" div in the page shell above -->
            <c:a action="showForm?equipmentId=${item.equipmentId}" ajax-target="body">Edit</c:a>
            <!-- confirm= is required on any action that deletes/destroys data — no undo on this platform -->
            <c:a action="deleteEquipment?equipmentId=${item.equipmentId}" ajax-target="body" confirm="Delete this item? This cannot be undone.">Delete</c:a>
        </div>
    </c:list>
    <c:a action="showForm" ajax-target="body">Add New</c:a>
</div>
</c:ignore>
```

Form fragment (`fragments/console/equipment/form.html`):

```html
<c:ignore xmlns:c="contractpal">
<div id="formArea">
    <input type="hidden" name="equipmentId" value="${equipmentId}" />
    <c:field type="text" name="name" value="${name}" />
    <c:field type="text" name="status" value="${status}" />
    <c:a action="saveEquipment" ajax-target="body">Save</c:a>
</div>
</c:ignore>
```

Traps this example is deliberately guarding against — see `bundled-context/CLAUDE.md` GOLDEN
RULE 7 and the anti-patterns list:
- `c:list name="items"` matches the workflow's `copy("items")`, not the loop alias `item`.
- Every `ajax-target="body"` matches the `id="body"` element in the actual page shell.
- `showForm` reads `request.get("equipmentId")` — the missing piece that makes Edit load real
  data instead of a blank form, and makes Save update instead of duplicate-insert.
- `saveEquipment` falls through to `loadList()` and re-renders the list fragment — a write that
  persists but returns the form (or nothing) never shows the change in the UI.
- `deleteEquipment` calls `ds.deleteRecord(equipmentId.toString())` — a String id, never the record
  object — and its `c:a` carries `confirm="..."` so a stray click can't destroy data with no undo.
