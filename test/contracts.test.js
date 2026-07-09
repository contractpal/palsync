"use strict";
// lintContracts: cross-file contract checks (c:list name/id, ajax-target, action routing, EL
// syntax, href-action anti-pattern, fabricated API methods, dropped params, ajax transport) plus
// the datasets-manifest addition to lintPalJson. Ground-truthed against real bug corpora in
// /Users/apple/PalBuilder/test-0{1,2,4,5}-*. Pure fs, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { lintContracts } = require("../src/core/validate/contracts");
const { lintPalJson } = require("../src/core/validate/palJson");
const { prunePhantomFolderRegistrations } = require("../src/core/palFolders");
const { tmpWorkspace } = require("./helpers");

function basePalJson(extra) {
    return JSON.stringify(Object.assign({
        pages: { entry: [] }, fragments: { entry: [] }, styles: { entry: [] },
        scripts: { entry: [] }, images: { entry: [] }, emails: { entry: [] },
        attachments: { entry: [] }, datasets: { entry: [] },
    }, extra));
}

test("swapped c:list name/id — errors, message names the swap explicitly", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    var equipment = pal.getDataSet('equipment');",
            "    var filter = equipment.createFilter();",
            "    var rows = equipment.getRecords(filter, 'items');",
            "    payload.addDataList(rows);",
            "}",
        ].join("\n"),
        "fragments/list.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <c:list name=\"item\" id=\"items\">",
            "    <p>${item.name}</p>",
            "  </c:list>",
            "</c:ignore>",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "listNameContract");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /SWAPPED/);
    assert.match(findings[0].message, /items/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("inline pal.getDataSet(...).getRecords(..., name) satisfies c:list name", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    var pal = controller.getPal();",
            "    var filter = pal.getDataSet('equipment').createFilter();",
            "    var rows = pal.getDataSet('equipment').getRecords(filter, 'items');",
            "    payload.addDataList(rows);",
            "}",
        ].join("\n"),
        "fragments/list.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <c:list name=\"items\" id=\"item\">",
            "    <p>${item.name}</p>",
            "  </c:list>",
            "</c:ignore>",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "listNameContract");
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("dead ajax-target — no matching id anywhere", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "pages/console.html": "<html><body><div id=\"body\"></div></body></html>",
        "fragments/form.html": "<c:ignore xmlns:c=\"contractpal\"><c:a action=\"save\" ajax-target=\"content\">Save</c:a></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "ajaxTargetExists");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /no element with id="content"/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unrouted action — no matching case anywhere, no default fallback either", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    switch (controller.getAction()) {",
            "        case 'list': break;",
            "    }",
            "}",
        ].join("\n"),
        "fragments/form.html": "<c:ignore xmlns:c=\"contractpal\"><c:a action=\"saveThing\">Save</c:a></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "actionRouted");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error", "no default: case anywhere — nothing handles it");
    assert.match(findings[0].message, /saveThing/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("default-routed list action is accepted as the conventional return-to-list path", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    switch (controller.getAction()) {",
            "        case 'saveThing': break;",
            "        default: break;",
            "    }",
            "}",
        ].join("\n"),
        "fragments/form.html": "<c:ignore xmlns:c=\"contractpal\"><c:a action=\"list\">Cancel</c:a><c:a action=\"typo\">Typo</c:a></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "actionRouted");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    assert.match(findings[0].message, /typo/);
    assert.doesNotMatch(findings[0].message, /action="list"/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("EL syntax — '==' inside ${...}", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/row.html": "<c:ignore xmlns:c=\"contractpal\"><c:if test=\"${a == b}\">x</c:if></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "elSyntax");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /not an EL operator/);
    assert.match(findings[0].message, /'eq'/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("EL syntax — method-call syntax .count() inside ${...}", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/row.html": "<c:ignore xmlns:c=\"contractpal\"><c:if test=\"${items.count() == 0}\">x</c:if></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "elSyntax");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /method-call syntax/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("EL syntax — bare test with no ${ at all", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/row.html": "<c:ignore xmlns:c=\"contractpal\"><c:if test=\"editMode\">x</c:if></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "elSyntax");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /test must be an EL expression/);
    assert.match(findings[0].message, /\$\{editMode\}/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("href=\"?action=...\" anti-pattern on c:a", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/form.html": "<c:ignore xmlns:c=\"contractpal\"><c:a href=\"?action=save\">Save</c:a></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "hrefAction");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /sends NO form fields/);
    assert.match(findings[0].message, /Do NOT wrap the c:a in a <form>/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("<form> tag in a fragment — server rejects the save", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/form.html": "<c:ignore xmlns:c=\"contractpal\"><form><c:a action=\"save\">Save</c:a></form></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "formTag");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /Tag form is not allowed/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("<form> tag in a page — allowed (server only rejects it in fragments)", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "pages/console.html": "<html><body><form><input type=\"text\" name=\"q\" /></form></body></html>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "formTag");
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fabricated API method setDateValue — suggests setDate", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    var rec = ds.getRecord('1');",
            "    rec.setDateValue('checkedOutAt', new Date());",
            "}",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "unknownApiMethod");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /did you mean \.setDate\(/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fabricated API method with no near match — warns, no suggestion claimed", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) { ds.deleteEverything(); }",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "unknownApiMethod");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("crawler intercept APIs are recognized by the fabricated API check", () => {
    const dir = tmpWorkspace({
        "workflows/web.js": [
            "function run(controller) {",
            "    var href = controller.getHref();",
            "    if (href == '/robots.txt') {",
            "        var robots = controller.createAjaxResponse('User-agent: *', false);",
            "        robots.setContentType('text/plain');",
            "        return robots;",
            "    }",
            "}",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "unknownApiMethod");
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unwired dataset — datasets/foo.json with no pal.json entry (lintPalJson)", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({}),
        "datasets/foo.json": JSON.stringify({ name: "foo", fields: { DatasetField: [] } }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "missingPalJsonEntry" && f.message.includes("datasets/foo.json"));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /never be provisioned/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("wired dataset — datasets/foo.json WITH a matching pal.json entry produces no finding", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ datasets: { entry: [{ string: "foo", Dataset: { name: "foo" } }] } }),
        "datasets/foo.json": JSON.stringify({ name: "foo", fields: { DatasetField: [] } }),
    });
    const findings = lintPalJson(dir).filter(f => f.message.includes("datasets/foo.json"));
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("nested creatable file without pal.json entry is reported", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ fragments: { entry: [] } }),
        "fragments/equipment/list.html": "<c:ignore xmlns:c=\"contractpal\">x</c:ignore>",
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "missingPalJsonEntry" && f.message.includes("fragments/equipment/list.html"));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /string\" and \"filename\" to \"equipment\/list\.html/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("workspace bucket folder registrations warn and are pruned from push payloads", () => {
    const manifest = JSON.parse(basePalJson({
        pages: { entry: [{ string: "console.html", Page: { filename: "console.html" } }] },
        workflows: { entry: [{ string: "defaults/default_console.js", Workflow: { filename: "defaults/default_console.js" } }] },
        folders: { Folder: [
            { name: "pages", folderType: "Pages" },
            { name: "defaults", folderType: "Workflows" },
        ] },
    }));
    const dir = tmpWorkspace({ "pal.json": JSON.stringify(manifest) });
    const findings = lintPalJson(dir).filter(f => f.rule === "unusedFolderRegistration");
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /Pages\/pages/);

    const pruned = prunePhantomFolderRegistrations(manifest);
    assert.deepEqual(pruned.map(f => f.name), ["pages"]);
    assert.deepEqual(manifest.folders.Folder.map(f => f.name), ["defaults"]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("dropped action parameter — handler never reads the request", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    switch (controller.getAction()) {",
            "        case 'showForm':",
            "            getFormData();",
            "            break;",
            "    }",
            "}",
            "function getFormData() {",
            "    payload.set('editMode', false);",
            "}",
        ].join("\n"),
        "fragments/list.html": "<c:ignore xmlns:c=\"contractpal\"><c:a action=\"showForm?equipmentId=${r.id}\">Edit</c:a></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "paramDropped");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    assert.match(findings[0].message, /silently dropped/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("action parameter IS read — no paramDropped finding", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    switch (controller.getAction()) {",
            "        case 'showForm':",
            "            getFormData();",
            "            break;",
            "    }",
            "}",
            "function getFormData() {",
            "    var request = getRequest();",
            "    var id = request.get('equipmentId');",
            "}",
        ].join("\n"),
        "fragments/list.html": "<c:ignore xmlns:c=\"contractpal\"><c:a action=\"showForm?equipmentId=${r.id}\">Edit</c:a></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "paramDropped");
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("createAjaxResponse without isAjax() — warns once per workflow file", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    var ajax = c.createAjaxResponse(pal.getAjaxFragment('list'), true);",
            "    return ajax;",
            "}",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "ajaxTransport");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("createAjaxResponse WITH isAjax() — no ajaxTransport finding", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    if (request.isAjax()) {",
            "        var ajax = c.createAjaxResponse(pal.getAjaxFragment('list'), true);",
            "        return ajax;",
            "    }",
            "}",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "ajaxTransport");
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("crawler file createAjaxResponse intercepts do not need isAjax()", () => {
    const dir = tmpWorkspace({
        "workflows/web.js": [
            "function run(controller) {",
            "    var href = controller.getHref();",
            "    if (href == '/robots.txt') {",
            "        var robots = controller.createAjaxResponse('User-agent: *', false);",
            "        robots.setContentType('text/plain');",
            "        return robots;",
            "    }",
            "    if (href == '/sitemap.xml') {",
            "        var sitemap = controller.createAjaxResponse('<urlset></urlset>', false);",
            "        sitemap.setContentType('application/xml');",
            "        return sitemap;",
            "    }",
            "    if (href == '/llms.txt') {",
            "        var llms = controller.createAjaxResponse('# Product', false);",
            "        llms.setContentType('text/plain');",
            "        return llms;",
            "    }",
            "}",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "ajaxTransport");
    assert.strictEqual(findings.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("staleVendor — <script src> referencing gsap warns, names the rule", () => {
    const dir = tmpWorkspace({
        "pages/console.html": [
            "<html xmlns:c=\"contractpal\">",
            "  <head>",
            "    <script type=\"module\" src=\"../Scripts/vendor/gsap.min.js\"></script>",
            "  </head>",
            "  <body></body>",
            "</html>",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "staleVendor");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    assert.match(findings[0].message, /pb-motion\.js/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("staleVendor — page shell with only pb-motion.js script produces no finding", () => {
    const dir = tmpWorkspace({
        "pages/console.html": [
            "<html xmlns:c=\"contractpal\">",
            "  <head>",
            "    <script type=\"module\" src=\"../Scripts/pb-ui.js\"></script>",
            "    <script type=\"module\" src=\"../Scripts/pb-motion.js\"></script>",
            "  </head>",
            "  <body></body>",
            "</html>",
        ].join("\n"),
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "staleVendor").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

// Modeled on test-01-crud-mimo / c-tags.md's documented examples — must produce ZERO
// contract findings of any severity (a fully clean, well-formed pal).
test("clean fixture (modeled on the passing reference pal) — zero contract findings", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "var c, page, payload, pal, request, data, ds;",
            "function run(controller) {",
            "    c = controller;",
            "    page = c.getPage('console');",
            "    payload = c.createPayload();",
            "    pal = c.getPal();",
            "    request = c.getRequest();",
            "    data = request.getData();",
            "    ds = pal.getDataSet('equipment');",
            "    var frag = null;",
            "    switch (c.getAction()) {",
            "        case 'showForm':",
            "            frag = showForm();",
            "            break;",
            "        case 'saveEquipment':",
            "            frag = saveEquipment();",
            "            break;",
            "        default:",
            "            frag = list();",
            "            break;",
            "    }",
            "    if (request.isAjax()) {",
            "        var ajax = c.createAjaxResponse(pal.getAjaxFragment(frag), true);",
            "        ajax.addPayload(payload);",
            "        return ajax;",
            "    }",
            "    payload.set('frag', frag);",
            "    page.addPayload(payload);",
            "    return page;",
            "}",
            "function list() {",
            "    var filter = ds.createFilter();",
            "    var rows = ds.getRecords(filter);",
            "    payload.addDataList(rows);",
            "    return 'equipmentList';",
            "}",
            "function showForm() {",
            "    var equipmentId = data.get('equipmentId');",
            "    if (equipmentId != null) {",
            "        var rec = ds.getRecord(equipmentId);",
            "        if (rec != null) payload.set('name', rec.get('name'));",
            "    }",
            "    return 'equipmentForm';",
            "}",
            "function saveEquipment() {",
            "    var name = data.get('name');",
            "    var rec = ds.createRecord();",
            "    rec.set('name', name);",
            "    ds.insertRecord(rec);",
            "    return list();",
            "}",
        ].join("\n"),
        "pages/console.html": [
            "<html xmlns:c=\"contractpal\">",
            "  <body>",
            "    <div id=\"body\"><c:fragment name=\"${frag}\" /></div>",
            "  </body>",
            "</html>",
        ].join("\n"),
        "fragments/equipmentList.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <c:a action=\"showForm\" ajax-target=\"body\">Add</c:a>",
            "  <c:choose>",
            "    <c:when test=\"${!empty equipment}\">",
            "      <c:list name=\"equipment\" id=\"r\">",
            "        <p>${r.name}</p>",
            "        <c:a action=\"showForm?equipmentId=${r.equipmentId}\" ajax-target=\"body\">Edit</c:a>",
            "      </c:list>",
            "    </c:when>",
            "    <c:otherwise><p>No equipment yet.</p></c:otherwise>",
            "  </c:choose>",
            "</c:ignore>",
        ].join("\n"),
        "fragments/equipmentForm.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <input type=\"text\" name=\"name\" value=\"${name}\" />",
            "  <c:a action=\"saveEquipment\" ajax-target=\"body\">Save</c:a>",
            "</c:ignore>",
        ].join("\n"),
    });
    const findings = lintContracts(dir);
    assert.deepStrictEqual(findings, [], "clean fixture must be contract-clean: " + JSON.stringify(findings));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fragment binding — page reads ${frag} but workflow sets payload.set('main', frag) (test-02 mimo bug)", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<html xmlns:c="contractpal"><body><div id="body"><c:fragment name="${frag}"/></div></body></html>',
        "workflows/console.js": [
            "function run(controller) {",
            "    var payload = controller.createPayload();",
            "    var frag = 'equipmentList';",
            "    if (frag) { payload.set('main', frag); }",
            "}",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "fragmentBinding");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /payload\.set\("main", frag\)/);
    assert.match(findings[0].message, /payload\.set\("frag", frag\)/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fragment binding — no workflow sets the key at all, no rename candidate", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<html xmlns:c="contractpal"><body><c:fragment name="${frag}"/></body></html>',
        "workflows/console.js": "function run(controller) { var payload = controller.createPayload(); payload.set('title', 'x'); }",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "fragmentBinding");
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /keys that are set: title/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fragment binding — matching payload.set key produces no finding", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<html xmlns:c="contractpal"><body><c:fragment name="${frag}"/></body></html>',
        "workflows/console.js": "function run(controller) { var payload = controller.createPayload(); payload.set('frag', 'list'); }",
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "fragmentBinding").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fragment binding — static c:fragment name is not this check's contract", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<html xmlns:c="contractpal"><body><c:fragment name="header"/></body></html>',
        "workflows/console.js": "function run(controller) {}",
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "fragmentBinding").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("destructiveConfirm — delete action with no confirm= is an error naming the fix", () => {
    const dir = tmpWorkspace({
        "fragments/list.html": '<c:ignore xmlns:c="contractpal"><c:a action="deleteEquipment?equipmentId=${row.equipmentId}" ajax-target="body">Delete</c:a></c:ignore>',
    });
    const findings = lintContracts(dir).filter(f => f.rule === "destructiveConfirm");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /confirm=/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("destructiveConfirm — delete action WITH confirm= produces no finding", () => {
    const dir = tmpWorkspace({
        "fragments/list.html": '<c:ignore xmlns:c="contractpal"><c:a action="deleteEquipment?equipmentId=${row.equipmentId}" ajax-target="body" confirm="Delete this item? This cannot be undone.">Delete</c:a></c:ignore>',
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "destructiveConfirm").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("destructiveConfirm — ambiguous remove* action warns, does not block", () => {
    const dir = tmpWorkspace({
        "fragments/list.html": '<c:ignore xmlns:c="contractpal"><c:a action="removeFilter" ajax-target="body">Clear</c:a></c:ignore>',
    });
    const findings = lintContracts(dir).filter(f => f.rule === "destructiveConfirm");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("destructiveConfirm — unrelated action produces no finding", () => {
    const dir = tmpWorkspace({
        "fragments/form.html": '<c:ignore xmlns:c="contractpal"><c:a action="saveEquipment" ajax-target="body">Save</c:a></c:ignore>',
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "destructiveConfirm").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — top-level typo suggests the real key", () => {
    const dir = tmpWorkspace({ "pal.json": basePalJson({ worfklows: { entry: [] } }) });
    const findings = lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /Did you mean "workflows"/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — layout typo suggests the real field", () => {
    const dir = tmpWorkspace({ "pal.json": basePalJson({ layout: { consoleWorkflw: "console.js" } }) });
    const findings = lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /Did you mean "consoleWorkflow"/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — layout.consoleDesktopImage/Label points to desktopBindings, not a suggestion", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ layout: { consoleWorkflow: "console.js", consoleDesktopImage: "bi-box-seam", consoleDesktopLabel: "Equipment" } }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey");
    assert.strictEqual(findings.length, 2);
    assert.ok(findings.every(f => f.severity === "error"));
    assert.ok(findings.every(f => /desktopBindings/.test(f.message)));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — desktopBindings as an object (invented shape) is an error", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ desktopBindings: { DesktopBinding: [{ DesktopLabel: "Equipment" }] } }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /must be an ARRAY/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — desktopBindings entry with invented field names suggests the real ones", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            desktopBindings: [{ string: "equipment", DesktopBinding: { DesktopLabel: "Equipment", DesktopImage: "bi-box-seam" } }],
        }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey");
    assert.strictEqual(findings.length, 2);
    assert.ok(findings.every(f => f.severity === "error"));
    assert.ok(findings.some(f => /Did you mean "name"/.test(f.message)));
    assert.ok(findings.some(f => /Did you mean "icon"/.test(f.message)));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — desktopBindings entry with the real fields produces no finding", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            desktopBindings: [{ string: "equipment", DesktopBinding: { name: "Equipment", icon: "bi-box-seam" } }],
        }),
    });
    assert.strictEqual(lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — no near match warns, never claims a false suggestion", () => {
    const dir = tmpWorkspace({ "pal.json": basePalJson({ zzzznotarealkey: [] }) });
    const findings = lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("unknownPalJsonKey — a clean real-shaped manifest produces no finding", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            layout: { name: "Test", consoleWorkflow: "console.js", inheritanceEnabled: false },
        }),
    });
    assert.strictEqual(lintPalJson(dir).filter(f => f.rule === "unknownPalJsonKey").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});
