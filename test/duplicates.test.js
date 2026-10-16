const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { findDuplicateSpans } = require("../src/core/duplicates");

function tmpWorkspace(files) {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-dup-"));
    for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
        fs.writeFileSync(path.join(ws, rel), text);
    }
    return ws;
}

function fn(name, label, pad) {
    const body = [
        "const record = await getRecord(id);",
        "const current = record.fields.status;",
        "record.fields.status = '" + label + "';",
        "await updateRecord(record);",
        "await writeAuditEntry(record, 'status');",
        "await refreshListView(record.listId);",
        "return notifyOwner(record.ownerId);"
    ];
    return "// " + pad + "\n" + ["async function " + name + "(id) {"].concat(body.map(l => "    " + l), ["}"]).join("\n") + "\n";
}

test("copy-pasted functions differing in a string literal yield one span", () => {
    const ws = tmpWorkspace({
        "workflows/a.js": "// header\n" + fn("retire", "retired", "a"),
        "workflows/b.js": "// h\n// h2\n" + fn("restore", "active", "b")
    });
    const spans = findDuplicateSpans(ws);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].lines, 7);
    assert.equal(spans[0].a, "workflows/a.js:4-10");
    assert.equal(spans[0].b, "workflows/b.js:5-11");
    fs.rmSync(ws, { recursive: true, force: true });
});

test("a shared 4-line match is below the span threshold", () => {
    const shared = "const alpha = computeAlpha(input);\nconst beta = computeBeta(alpha);\nconst gamma = computeGamma(beta);\nconst delta = computeDelta(gamma);\n";
    const ws = tmpWorkspace({
        "fragments/a.html": shared + "const onlyInA = doSomethingElse(delta);\n",
        "fragments/b.html": "const onlyInB = somethingUnrelated(1);\n" + shared
    });
    assert.deepEqual(findDuplicateSpans(ws), []);
    fs.rmSync(ws, { recursive: true, force: true });
});

test("spans are capped and sorted largest first; pages and missing dirs are ignored", () => {
    const block = n => Array.from({ length: n }, (_, i) => "const value" + n + "x" + i + " = compute(" + n + ", input);").join("\n") + "\n";
    const files = { "pages/p.html": block(9) + block(9) };
    for (const n of [6, 7, 8]) {
        files["workflows/a" + n + ".js"] = block(n);
        files["fragments/b" + n + ".html"] = block(n);
    }
    const ws = tmpWorkspace(files);
    const spans = findDuplicateSpans(ws, { cap: 2 });
    assert.deepEqual(spans.map(s => s.lines), [8, 7]);
    assert.equal(findDuplicateSpans(ws).length, 3);
    assert.deepEqual(findDuplicateSpans(path.join(ws, "nope")), []);
    fs.rmSync(ws, { recursive: true, force: true });
});
