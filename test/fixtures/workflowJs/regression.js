function run(controller) {
    var view = controller.getPal().getDataView("items");
    var filter = view.createFilter();
    filter.selectColumns(["id"]);
    var record = view.findRecord(filter);
    var name = record.get("name");
    var s = controller.getName();
    return name + s.trim() + s.length();
}
