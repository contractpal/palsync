// {{PAL_NAME}} — console workflow (console-app starter skeleton).
// Pattern per the palbuilder-workflow skill: one run(controller), declare only the globals you
// use, action switch with one thin handler per case, the `frag` variable carries the fragment
// to render (AJAX or full page). RESTRICTED engine: var only (no let/const), NO object literals
// (use c.createData()/createRecord()), no ES6.
var c, page, payload, request, frag;

function run(controller)
{
    c = controller;
    page = c.getPage("console");
    payload = c.createPayload();
    request = c.getRequest();

    switch (c.getAction()) {
        case "getDashboard":
            getDashboard();
            break;
        default:
            getDashboard();
            break;
    }

    if (request.isAjax()) {
        var ajax = frag ? c.createAjaxResponse(c.getPal().getAjaxFragment(frag), true)
                        : c.createAjaxResponse("ignore", false);
        ajax.addPayload(payload);
        return ajax;
    }
    if (frag) { payload.set("frag", frag); }
    page.addPayload(payload);
    return page;
}

/* Presentation handler: seed the dashboard payload. Replace the placeholder values with real
   dataset reads (pal.getDataSet(...).getRecords(filter) — see the palbuilder-data skill). */
function getDashboard()
{
    var items = c.createDataList("items", ["name", "value", "updated"]);
    payload.addDataList(items);
    payload.set("active", "dashboard");
    payload.set("statCount", "0");
    payload.set("statWeek", "0");
    payload.set("statStatus", "OK");
    payload.set("hasItems", "false");
    frag = "dashboard";
}
