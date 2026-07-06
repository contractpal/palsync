"use strict";
// normalizeMessages extracts resp.messages (server-level failures like "Pal is not a Web Pal")
// — the field the CLI used to drop, printing "No validation notes" over the real cause.
const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeMessages } = require("../src/core/test");
const { formatValidation, isBenignServerNote } = require("../src/mcp/tools");

test("normalizeMessages: single message object", () => {
    const resp = { messages: { "com.contractpal.Message": { message: "Pal is not a Web Pal", type: "error" } } };
    assert.deepEqual(normalizeMessages(resp), [{ message: "Pal is not a Web Pal", type: "error" }]);
});

test("normalizeMessages: array of messages", () => {
    const resp = { messages: { "com.contractpal.Message": [{ message: "a", type: "error" }, { message: "b", type: "warn" }] } };
    assert.equal(normalizeMessages(resp).length, 2);
    assert.deepEqual(normalizeMessages(resp).map(m => m.message), ["a", "b"]);
});

test("normalizeMessages: empty / missing -> []", () => {
    assert.deepEqual(normalizeMessages({ messages: "" }), []);
    assert.deepEqual(normalizeMessages({}), []);
    assert.deepEqual(normalizeMessages(undefined), []);
});

test("formatValidation: classifies known server noise as informational", () => {
    const notes = [
        { group: "workflow", object: "Validation", message: "vCPU: 2, batchSize: 1" },
        { group: "console", object: "", message: "Console Desktop Image required." },
        { group: "console", object: "", message: "Console Desktop Label required." },
        { group: "workflow", object: "equipment", message: "Missing case delete" }
    ];
    assert.equal(isBenignServerNote(notes[0]), true);
    assert.equal(isBenignServerNote(notes[3]), false);
    const out = formatValidation(notes);
    assert.match(out, /Server validation notes \(1\)/);
    assert.match(out, /workflow\/equipment: Missing case delete/);
    assert.match(out, /Server informational notes \(non-blocking\) \(3\)/);
    assert.match(out, /vCPU: 2, batchSize: 1/);
    assert.match(out, /Console Desktop Image required/);
});

test("formatValidation: benign-only notes do not read as blockers", () => {
    const out = formatValidation([{ group: "workflow", object: "Validation", message: "vCPU: 1, batchSize: 1" }]);
    assert.match(out, /No blocking server validation notes/);
    assert.match(out, /Server informational notes \(non-blocking\) \(1\)/);
});
