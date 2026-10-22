"use strict";
// The Repository-Payload encoder. Wire format verified live against secure.cloudpiston.com
// (2026-10-21): INSERT, UPDATE and DELETE items written this way changed the repository rows.
const { test } = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");
const { ACTION, buildPayloadXml, encodePayloadHeader } = require("../src/core/repoPayload");

test("builds the RepositoryPayload / RepositoryItem XML the server's XStream reads", () => {
    assert.equal(
        buildPayloadXml([{ action: ACTION.UPDATE, type: "page", name: "console.html" }]),
        "<RepositoryPayload><changes><RepositoryItem><type>page</type><name>console.html</name><action>2</action></RepositoryItem></changes></RepositoryPayload>"
    );
});

test("rename carries oldName; names are XML-escaped; items keep their order", () => {
    const xml = buildPayloadXml([
        { action: ACTION.RENAME, type: "fragment", name: "a/new&.html", oldName: "a/old.html" },
        { action: ACTION.DELETE, type: "script", name: "x.js" }
    ]);
    assert.match(xml, /<name>a\/new&amp;\.html<\/name><oldName>a\/old\.html<\/oldName><action>4<\/action>/);
    assert.ok(xml.indexOf("fragment") < xml.indexOf("script"));
});

test("header is base64 of gzip of the XML", () => {
    const items = [{ action: ACTION.INSERT, type: "page", name: "p.html" }];
    const header = encodePayloadHeader(items);
    assert.equal(zlib.gunzipSync(Buffer.from(header, "base64")).toString("utf8"), buildPayloadXml(items));
});

test("an empty change list is a valid empty payload", () => {
    assert.equal(buildPayloadXml([]), "<RepositoryPayload><changes></changes></RepositoryPayload>");
});

test("rejects malformed items instead of sending a payload the server would swallow", () => {
    assert.throws(() => buildPayloadXml([{ action: 9, type: "page", name: "x" }]), /bad repository action/);
    assert.throws(() => buildPayloadXml([{ action: ACTION.UPDATE, name: "x" }]), /type and name/);
    assert.throws(() => buildPayloadXml([{ action: ACTION.RENAME, type: "page", name: "x" }]), /oldName/);
});
