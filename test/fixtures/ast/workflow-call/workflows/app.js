function run(controller) {
    var data = controller.getDataSet("orders");
    var record = data.createRecord();
    record.set("amount", 12.5);
    var callback = function(e) { return e; };
    saveRecord("x", payload, callbackStyle);
    saveRecord("y", data);
    saveRecord("z", 1, 2, 3, 4, 5);
    return record;
}
