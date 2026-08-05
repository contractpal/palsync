function run(controller) {
    var page = controller.getPage("report");
    var payload = controller.createPayload();
    payload.set("panel", "components/dynamic/summary");
    page.addPayload(payload);
    return page;
}
