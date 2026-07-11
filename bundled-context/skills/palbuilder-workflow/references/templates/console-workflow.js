// {{PAL_NAME}} — console workflow skeleton (pattern: GiftHub console.js).
// RESTRICTED engine: var only (no let/const), NO object literals
// (use c.createData()/createRecord()), no ES6.
var c;
var pal;
var page;
var request;
var ajax;
var payload;
var frag;

function run(controller) {
    c = controller;
    pal = c.getPal();
    page = c.getPage("console");
    request = c.getRequest();
    payload = c.createPayload();

    switch (c.getAction()) {
        case "getDashboard":
            getDashboard();
            break;
        // Mutating actions re-render their list after the write:
        // case "saveItem":
        //     saveItem();
        //     getDashboard();
        //     break;
        default:
            getDashboard();
            break;
    }

    if (request.isAjax()) {
        if (ajax == null) {
            if (frag) {
                ajax = c.createAjaxResponse(pal.getAjaxFragment(frag), true);
            } else {
                ajax = c.createAjaxResponse("", false);
            }
        }
        // Keep the navbar's active state in sync on every AJAX response.
        ajax.addFragment("nav", pal.getAjaxFragment("navbar"));
        ajax.addPayload(payload);
        return ajax;
    }

    if (frag) {
        payload.set("frag", frag);
    }
    page.addPayload(payload);
    return page;
}

/* Presentation handler: seed the dashboard payload. Replace placeholder values with real
   dataset reads (pal.getDataSet(...).getRecords(filter) — see palbuilder-data). */
function getDashboard() {
    var items = c.createDataList("items", ["name", "value", "updated"]);
    payload.addDataList(items);
    payload.set("active_nav", "dashboard");
    payload.set("statCount", "0");
    payload.set("hasItems", "false");
    frag = "dashboard";
}
