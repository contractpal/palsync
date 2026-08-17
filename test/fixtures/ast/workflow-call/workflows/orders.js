function run(controller) {
    var order = controller.getDataSet("orders").createRecord();
    order.set("total", 42);
    saveRecord("orders", order, handleResult);
    saveRecord("orders", order);
    saveRecord("a", 1, 2, 3 + 4, "five");
    return order;
}
