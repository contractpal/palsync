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

test("swapped c:list name/id — warns, message names the swap explicitly", () => {
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
    assert.strictEqual(findings[0].severity, "warn");
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

test("dead ajax-target — no matching id anywhere is a warning", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "pages/console.html": "<html><body><div id=\"body\"></div></body></html>",
        "fragments/form.html": "<c:ignore xmlns:c=\"contractpal\"><c:a action=\"save\" ajax-target=\"content\">Save</c:a></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "ajaxTargetExists");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
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

test("EL expression bodies use JEXL and platform extensions without local syntax checks", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/row.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <c:if test=\"${opt.get('col0') eq 'Other'}\">delimited row</c:if>",
            "  <c:if test=\"${info.get('first-name')}\">hyphenated key</c:if>",
            "  <c:if test=\"${a == 'b'}\">symbolic operator</c:if>",
            "  <div class=\"${active ? 'active' : ''}\">${label ? 'yes' : 'no'}</div>",
            "</c:ignore>",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "elSyntax");
    assert.deepStrictEqual(findings, []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("EL syntax — bare test with no ${ at all", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/row.html": "<c:ignore xmlns:c=\"contractpal\"><c:if test=\"foo == 'bar'\">x</c:if></c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "elSyntax");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /test must be an EL expression/);
    assert.match(findings[0].message, /\$\{foo eq 'bar'\}/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("reserved EL words cannot be c:list ids, c:set names, or c:fragment names", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": "function run(controller) {}",
        "fragments/row.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <c:list name=\"items\" id=\"eq\"><p>${eq.name}</p></c:list>",
            "  <c:set name=\"empty\" test=\"${ok}\" true=\"x\" false=\"\" />",
            "  <c:fragment name=\"or\" />",
            "</c:ignore>",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "reservedElWord");
    assert.equal(findings.length, 3);
    assert.ok(findings.every(f => f.severity === "error"));
    assert.match(findings[0].message, /reserved EL operator/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("custom control CSS alongside the design system is a bypass warning", () => {
    const dir = tmpWorkspace({
        "DESIGN_SYSTEM.md": "# system",
        "styles/design-system.css": ".pb-btn { color: var(--primary); }",
        "styles/custom.css": "button { background: #123456; }"
    });
    const findings = lintContracts(dir).filter(f => f.rule === "designSystemBypass");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.match(findings[0].message, /spacing\.css and styles\.css are exempt/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("design-system convention files are exempt from bypass warnings", () => {
    const dir = tmpWorkspace({
        "DESIGN_SYSTEM.md": "# system",
        "styles/design-system.css": ".pb-btn { color: var(--primary); }",
        "styles/spacing.css": "input[type=text] { padding: #123; }",
        "styles/styles.css": "button { background: #123456; }",
        "styles/other.css": ".feature { color: #123456; }"
    });
    assert.deepStrictEqual(lintContracts(dir).filter(f => f.rule === "designSystemBypass"), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("clean EL attributes and text produce no EL syntax findings", () => {
    const dir = tmpWorkspace({
        "fragments/row.html": "<c:ignore xmlns:c=\"contractpal\"><p class=\"${active}\">${name}</p></c:ignore>",
    });
    assert.equal(lintContracts(dir).filter(f => f.rule === "elSyntax").length, 0);
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

test("unknown API methods do not produce contract findings", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "function run(controller) {",
            "    var rec = ds.getRecord('1');",
            "    rec.setDateValue('checkedOutAt', new Date());",
            "}",
        ].join("\n"),
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "unknownApiMethod").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("ajax-target ignore sentinel produces no finding", () => {
    const dir = tmpWorkspace({
        "fragments/form.html": '<c:ignore xmlns:c="contractpal"><c:a action="save" ajax-target="ignore">Save</c:a></c:ignore>',
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "ajaxTargetExists").length, 0);
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
        "styles/styles.css": ".pb-main {} .pb-section {} .pb-btn {} .pb-btn-primary {} .pb-input {} .pb-field-group {}",
        "pages/console.html": [
            "<html xmlns:c=\"contractpal\">",
            "  <body>",
            "    <div id=\"body\" class=\"pb-main\"><c:fragment name=\"${frag}\" /></div>",
            "  </body>",
            "</html>",
        ].join("\n"),
        "fragments/equipmentList.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <div class=\"pb-section\"><c:a action=\"showForm\" ajax-target=\"body\" class=\"pb-btn pb-btn-primary\">Add</c:a>",
            "  <c:choose>",
            "    <c:when test=\"${!empty equipment}\">",
            "      <c:list name=\"equipment\" id=\"r\">",
            "        <p>${r.name}</p>",
            "        <c:a action=\"showForm?equipmentId=${r.equipmentId}\" ajax-target=\"body\" class=\"pb-btn\">Edit</c:a>",
            "      </c:list>",
            "    </c:when>",
            "    <c:otherwise><p>No equipment yet.</p></c:otherwise>",
            "  </c:choose></div>",
            "</c:ignore>",
        ].join("\n"),
        "fragments/equipmentForm.html": [
            "<c:ignore xmlns:c=\"contractpal\">",
            "  <div class=\"pb-section\"><label class=\"pb-field-group\">Name<input type=\"text\" name=\"name\" value=\"${name}\" class=\"pb-input\" /></label>",
            "  <c:a action=\"saveEquipment\" ajax-target=\"body\" class=\"pb-btn pb-btn-primary\">Save</c:a></div>",
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

test("static c:fragment names must resolve to shipped fragments", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<html><body><c:fragment name="navbar" /></body></html>'
    });
    const findings = lintContracts(dir).filter(f => f.rule === "missingFragment");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    assert.match(findings[0].message, /fragments\/navbar\.html/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("static c:fragment resolves extensionless nested path", () => {
    const dir = tmpWorkspace({
        "pages/console.html": '<html><body><c:fragment name="console/navbar" /></body></html>',
        "fragments/console/navbar.html": "<nav>Nav</nav>"
    });
    assert.equal(lintContracts(dir).filter(f => f.rule === "missingFragment").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("reserved EL words are checked before string-split c:list early return", () => {
    const dir = tmpWorkspace({
        "fragments/list.html": '<c:ignore xmlns:c="contractpal"><c:list list="${x}" id="eq">row</c:list></c:ignore>'
    });
    const findings = lintContracts(dir).filter(f => f.rule === "reservedElWord");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "error");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("destructiveConfirm — delete action with no confirm= is a warning naming the fix", () => {
    const dir = tmpWorkspace({
        "fragments/list.html": '<c:ignore xmlns:c="contractpal"><c:a action="deleteEquipment?equipmentId=${row.equipmentId}" ajax-target="body">Delete</c:a></c:ignore>',
    });
    const findings = lintContracts(dir).filter(f => f.rule === "destructiveConfirm");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
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

test("selective pb-* styles warn on browser-default controls, headings, tables, actions, form rhythm, visible skip link, and invented classes", () => {
    const dir = tmpWorkspace({
        "styles/styles.css": ":root { --ds-space-1: 4px; } .pb-btn {}",
        "fragments/screen.html": [
            '<c:ignore xmlns:c="contractpal">',
            '  <a href="#main">Skip to content</a>',
            '  <h1>Equipment</h1>',
            '  <div class="pb-field-group"><label>Name<c:field type="text" name="name" /></label></div>',
            '  <div class="pb-field-group"><label>Notes<textarea name="notes"></textarea></label></div>',
            '  <table><tr><th>Name</th></tr></table>',
            '  <c:a action="saveEquipment" class="pb-btn pb-btn-sm">Save</c:a>',
            '  <c:a action="cancel">Cancel</c:a>',
            '</c:ignore>',
        ].join("\n"),
    });
    const rules = new Set(lintContracts(dir).map(f => f.rule));
    for (const rule of ["pbControlClass", "pbHeadingClass", "pbTableClass", "pbActionAffordance", "pbFormRhythm", "pbSkipLink", "pbUndefinedClass"]) {
        assert.ok(rules.has(rule), "expected " + rule + " warning");
    }
    assert.ok(lintContracts(dir).filter(f => /^pb/.test(f.rule)).every(f => f.severity === "warn"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("selective pb-* workspace warns when row actions are ungrouped or conflicting", () => {
    const dir = tmpWorkspace({
        "styles/styles.css": [
            ".pb-table {}", ".pb-btn {}", ".pb-btn-secondary {}", ".pb-btn-danger {}", ".pb-row-actions {}"
        ].join("\n"),
        "fragments/list.html": [
            '<c:ignore xmlns:c="contractpal">',
            '  <table class="pb-table"><tbody><tr><td data-label="Actions">',
            '    <c:a action="showCheckout?id=${row.id}" class="pb-btn pb-btn-secondary">Check out</c:a>',
            '    <c:a action="checkin?id=${row.id}" class="pb-btn pb-btn-secondary">Check in</c:a>',
            '    <c:a action="delete?id=${row.id}" confirm="Delete?" class="pb-btn pb-btn-danger">Delete</c:a>',
            '  </td></tr></tbody></table>',
            '</c:ignore>',
        ].join("\n"),
    });
    const rules = new Set(lintContracts(dir).map(f => f.rule));
    assert.ok(rules.has("pbRowActionGroup"));
    assert.ok(rules.has("pbConflictingStateActions"));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("selective grouped and status-conditional row actions produce no row-action warnings", () => {
    const dir = tmpWorkspace({
        "styles/styles.css": [
            ".pb-table {}", ".pb-btn {}", ".pb-btn-secondary {}", ".pb-btn-danger {}", ".pb-row-actions {}"
        ].join("\n"),
        "fragments/list.html": [
            '<c:ignore xmlns:c="contractpal">',
            '  <table class="pb-table"><tbody><tr><td data-label="Actions"><div class="pb-row-actions">',
            '    <c:a action="showCheckout?id=${row.id}" test="${row.status eq \'available\'}" class="pb-btn pb-btn-secondary">Check out</c:a>',
            '    <c:a action="checkin?id=${row.id}" test="${row.status eq \'checkedOut\'}" class="pb-btn pb-btn-secondary">Check in</c:a>',
            '    <c:a action="delete?id=${row.id}" confirm="Delete?" class="pb-btn pb-btn-danger">Delete</c:a>',
            '  </div></td></tr></tbody></table>',
            '</c:ignore>',
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => ["pbRowActionGroup", "pbConflictingStateActions", "pbUndefinedClass"].includes(f.rule));
    assert.deepStrictEqual(findings, []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("selected pb-* recipes in styles.css produce no design-hint warnings", () => {
    const dir = tmpWorkspace({
        "styles/styles.css": [
            ".pb-skip-link {}", ".pb-section {}", ".pb-title {}", ".pb-card {}", ".pb-form-card {}",
            ".pb-stack {}", ".pb-field-group {}", ".pb-input {}", ".pb-textarea {}", ".pb-btn {}",
            ".pb-btn-primary {}", ".pb-table-wrap {}", ".pb-table {}"
        ].join("\n"),
        "fragments/screen.html": [
            '<c:ignore xmlns:c="contractpal">',
            '  <a href="#main" class="pb-skip-link">Skip to content</a>',
            '  <div class="pb-section"><h1 class="pb-title">Equipment</h1>',
            '  <div class="pb-card pb-form-card"><div class="pb-stack">',
            '    <div class="pb-field-group"><label>Name<c:field type="text" name="name" class="pb-input" /></label></div>',
            '    <div class="pb-field-group"><label>Notes<textarea name="notes" class="pb-textarea"></textarea></label></div>',
            '    <c:a action="saveEquipment" class="pb-btn pb-btn-primary">Save</c:a>',
            '  </div></div>',
            '  <div class="pb-table-wrap"><table class="pb-table"><tr><th>Name</th></tr></table></div></div>',
            '</c:ignore>',
        ].join("\n"),
    });
    assert.deepStrictEqual(lintContracts(dir).filter(f => /^pb/.test(f.rule)), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("design-system.css is rejected as a runtime file, page link, or manifest style", () => {
    const dir = tmpWorkspace({
        "styles/design-system.css": ".pb-card {}",
        "pages/console.html": '<html><head><link rel="STYLESHEET" href="../Styles/design-system.css" /></head><body></body></html>',
        "pal.json": basePalJson({ styles: { entry: [
            { string: "design-system.css", Style: { filename: "design-system.css" } }
        ] } }),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "referenceStylesheetShipped");
    assert.strictEqual(findings.length, 3);
    assert.ok(findings.every(f => f.severity === "error"));
    assert.ok(findings.some(f => f.file === "styles/design-system.css"));
    assert.ok(findings.some(f => f.file === "pages/console.html"));
    assert.ok(findings.some(f => f.file === "pal.json"));
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

test("invalidPalJsonShape — verified Data and DataList serialized forms pass", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            data: { entry: [{
                string: "siteConfig",
                Data: { name: "siteConfig", values: { entry: [
                    { string: ["companyName", "Acme Rentals"] },
                    { string: ["directoryPageSize", "25"] },
                ] } },
            }] },
            datalists: { entry: [{
                string: "offices",
                DataList: {
                    name: "offices",
                    cols: { string: ["officeCode", "city"] },
                    recs: { "string-array": [
                        { string: ["SLC", "Salt Lake City"] },
                        { string: ["DEN", "Denver"] },
                    ] },
                },
            }] },
        }),
    });
    assert.deepStrictEqual(lintPalJson(dir).filter(f => f.rule === "invalidPalJsonShape"), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("invalidPalJsonShape — Data rejects guessed newline data field and mismatched name", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            data: { entry: [{
                string: "siteConfig",
                Data: { name: "settings", data: "companyName=Acme\npageSize=25" },
            }] },
        }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "invalidPalJsonShape");
    assert.ok(findings.some(f => /must match Data\.name/.test(f.message)));
    assert.ok(findings.some(f => /not a serialized Data field/.test(f.message)));
    fs.rmSync(dir, { recursive: true, force: true });
});

test("invalidPalJsonShape — Data values are two-item key/value arrays", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            data: { entry: [{
                string: "siteConfig",
                Data: { name: "siteConfig", values: { entry: [{ string: ["onlyKey"] }] } },
            }] },
        }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "invalidPalJsonShape");
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /two-item \[key, value\]/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("invalidPalJsonShape — DataList requires cols/recs serialized names and aligned rows", () => {
    const guessed = tmpWorkspace({
        "pal.json": basePalJson({
            datalists: { entry: [{
                string: "offices",
                DataList: { name: "offices", columns: ["code", "city"], records: [] },
            }] },
        }),
    });
    const guessedFindings = lintPalJson(guessed).filter(f => f.rule === "invalidPalJsonShape");
    assert.ok(guessedFindings.some(f => /serialized DataList field/.test(f.message)));
    assert.ok(guessedFindings.some(f => /cols\.string must be/.test(f.message)));
    fs.rmSync(guessed, { recursive: true, force: true });

    const uneven = tmpWorkspace({
        "pal.json": basePalJson({
            datalists: { entry: [{
                string: "offices",
                DataList: {
                    name: "offices",
                    cols: { string: ["code", "city"] },
                    recs: { "string-array": [{ string: ["SLC"] }] },
                },
            }] },
        }),
    });
    const unevenFindings = lintPalJson(uneven).filter(f => f.rule === "invalidPalJsonShape");
    assert.strictEqual(unevenFindings.length, 1);
    assert.match(unevenFindings[0].message, /must contain 2 cell/);
    fs.rmSync(uneven, { recursive: true, force: true });
});

test("invalidPalJsonShape — DesktopBinding requires wrapper, label, and icon", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            desktopBindings: [
                { string: "missing-wrapper" },
                { string: "missing-fields", DesktopBinding: { name: "", icon: "" } },
            ],
        }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "invalidPalJsonShape");
    assert.strictEqual(findings.length, 3);
    assert.ok(findings.some(f => /contain a DesktopBinding object/.test(f.message)));
    assert.ok(findings.some(f => /name must be/.test(f.message)));
    assert.ok(findings.some(f => /icon must be/.test(f.message)));
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

test("pageResponseSource — pal.getPage(...) as a page response is a hard error", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "var c, pal, page;",
            "function run(controller) {",
            "    c = controller; pal = c.getPal();",
            "    page = pal.getPage('console');",
            "    page.addPayload(c.createPayload());",
            "    return page;",
            "}",
        ].join("\n"),
    });
    const findings = lintContracts(dir).filter(f => f.rule === "pageResponseSource");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /c\.getPage/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("empty c:a action is an error; dynamic actions remain unchecked", () => {
    const dir = tmpWorkspace({
        "fragments/actions.html": '<c:ignore xmlns:c="contractpal"><div class="pb-section"><c:a action="">Cancel</c:a><c:a action="${nextAction}">Next</c:a></div></c:ignore>',
    });
    const findings = lintContracts(dir).filter(f => f.rule === "emptyAction");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /never routes at runtime/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fragment root missing pb-section warns; compliant root passes", () => {
    const missing = tmpWorkspace({ "fragments/list.html": '<c:ignore xmlns:c="contractpal"><div class="pb-card">List</div></c:ignore>' });
    const compliant = tmpWorkspace({ "fragments/list.html": '<c:ignore xmlns:c="contractpal"><section class="pb-section console-chrome">List</section></c:ignore>' });
    const findings = lintContracts(missing).filter(f => f.rule === "pbSection");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    assert.strictEqual(lintContracts(compliant).filter(f => f.rule === "pbSection").length, 0);
    fs.rmSync(missing, { recursive: true, force: true });
    fs.rmSync(compliant, { recursive: true, force: true });
});

test("page shell missing pb-main warns; compliant shell passes", () => {
    const missing = tmpWorkspace({ "pages/console.html": '<html><body><main id="body"></main></body></html>' });
    const compliant = tmpWorkspace({ "pages/console.html": '<html><body><main id="body" class="pb-main console-chrome"></main></body></html>' });
    const findings = lintContracts(missing).filter(f => f.rule === "pbMain");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    assert.strictEqual(lintContracts(compliant).filter(f => f.rule === "pbMain").length, 0);
    fs.rmSync(missing, { recursive: true, force: true });
    fs.rmSync(compliant, { recursive: true, force: true });
});

test("pageResponseSource — c.getPage(...) is the correct source, no finding", () => {
    const dir = tmpWorkspace({
        "workflows/console.js": [
            "var c, page;",
            "function run(controller) {",
            "    c = controller;",
            "    page = c.getPage('console');",
            "    page.addPayload(c.createPayload());",
            "    return page;",
            "}",
        ].join("\n"),
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "pageResponseSource").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("fontDeclaredNotLoaded warns for an unimported web font and accepts system/imported fonts", () => {
    const missing = tmpWorkspace({
        "styles/styles.css": ':root { --ds-font-ui: "Satoshi", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }'
    });
    const loaded = tmpWorkspace({
        "styles/styles.css": '@import url("https://api.fontshare.com/v2/css?f[]=satoshi@400,700&display=swap");\n:root { --ds-font-ui: "Satoshi", system-ui, sans-serif; }'
    });
    const system = tmpWorkspace({
        "styles/styles.css": ':root { --ds-font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }'
    });
    const findings = lintContracts(missing).filter(f => f.rule === "fontDeclaredNotLoaded");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    assert.match(findings[0].message, /Satoshi/);
    assert.strictEqual(lintContracts(loaded).filter(f => f.rule === "fontDeclaredNotLoaded").length, 0);
    assert.strictEqual(lintContracts(system).filter(f => f.rule === "fontDeclaredNotLoaded").length, 0);
    fs.rmSync(missing, { recursive: true, force: true });
    fs.rmSync(loaded, { recursive: true, force: true });
    fs.rmSync(system, { recursive: true, force: true });
});

test("scriptWithoutConsumer warns for registered pb-motion without a consumer", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ scripts: { entry: [{ string: "pb-motion.js" }] } }),
        "pages/console.html": '<html><body><main class="pb-main"></main><script src="../scripts/pb-motion.js"></script></body></html>'
    });
    const findings = lintContracts(dir).filter(f => f.rule === "scriptWithoutConsumer");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "warn");
    assert.strictEqual(findings[0].file, "pal.json");
    assert.strictEqual(lintContracts(dir).filter(f => f.severity === "error" && f.rule === "scriptWithoutConsumer").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("scriptWithoutConsumer accepts pb-motion with data-animate markup", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ scripts: { entry: [{ string: "pb-motion.js" }] } }),
        "pages/console.html": '<html><body><main class="pb-main"><section data-animate="fade-in"></section></main><script src="../scripts/pb-motion.js"></script></body></html>'
    });
    assert.strictEqual(lintContracts(dir).filter(f => f.rule === "scriptWithoutConsumer").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- filename-resolution conventions (reports/2026-07-18 equipment_checkout runs) ---------------

test("bannedFilenamePrefix — workflows/fragments filename repeating its category folder errors", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            workflows: { entry: [{ string: "console.js", Workflow: { name: "console.js", filename: "workflows/console.js" } }] },
            fragments: { entry: [{ string: "list.html", Fragment: { name: "list.html", filename: "fragments/list.html" } }] },
        }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "bannedFilenamePrefix");
    assert.strictEqual(findings.length, 2);
    assert.ok(findings.every(f => f.severity === "error"));
    assert.match(findings[0].message, /"console\.js"/);
    assert.match(findings[1].message, /"list\.html"/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("bannedFilenamePrefix — layout.consoleWorkflow with workflows/ prefix errors; clean layout passes", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({ layout: { consoleWorkflow: "workflows/console.js", webWorkflow: "web.js" } }),
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "bannedFilenamePrefix");
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /layout\.consoleWorkflow/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("bannedFilenamePrefix — legit subfolder paths and prefixed styles/scripts produce no finding", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            workflows: { entry: [{ string: "defaults/default_console.js", Workflow: { name: "defaults/default_console.js", filename: "defaults/default_console.js" } }] },
            styles: { entry: [{ string: "styles.css", Style: { name: "styles.css", filename: "styles/styles.css" } }] },
        }),
    });
    assert.strictEqual(lintPalJson(dir).filter(f => f.rule === "bannedFilenamePrefix").length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("missingManifestFilename — fragment entry without Fragment.filename errors with the exact entry shape", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({
            fragments: { entry: [{ string: "navbar.html", Fragment: { name: "navbar.html" } }] },
        }),
        "fragments/navbar.html": "<c:ignore xmlns:c=\"contractpal\">x</c:ignore>",
    });
    const findings = lintPalJson(dir).filter(f => f.rule === "missingManifestFilename");
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].severity, "error");
    assert.match(findings[0].message, /"filename": "navbar\.html"/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("missingFragment — name= with .html extension leads with the corrected extensionless markup", () => {
    const dir = tmpWorkspace({
        "pal.json": basePalJson({}),
        "pages/console.html": '<html xmlns:c="contractpal"><body><c:fragment name="navbar.html"/></body></html>',
        "fragments/navbar.html": "<c:ignore xmlns:c=\"contractpal\">x</c:ignore>",
    });
    const findings = lintContracts(dir).filter(f => f.rule === "missingFragment");
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /EXTENSIONLESS/);
    assert.match(findings[0].message, /<c:fragment name="navbar"\/>/);
    fs.rmSync(dir, { recursive: true, force: true });
});
