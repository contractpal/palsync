"use strict";
// Unit tests for ensureWebRegistration: a web workflow (workflowType 9) only makes the pal a
// "Web Pal" if layout.webWorkflow names it. Pure, no network. Run: npm test.
const { test } = require("node:test");
const assert = require("node:assert");
const { ensureWebRegistration } = require("../src/core/push");

const palWith = (layout, workflows) => ({ layout, allWorkflows: workflows });
const webWf = (string) => ({ string, Workflow: { workflowType: 9 } });
const otherWf = (string, t) => ({ string, Workflow: { workflowType: t } });

test("registers the single web workflow when the pointer is unset", () => {
    const pal = palWith({}, [webWf("web.js")]);
    assert.equal(ensureWebRegistration(pal), "web.js");
    assert.equal(pal.layout.webWorkflow, "web.js");
});

test("respects an already-set webWorkflow pointer", () => {
    const pal = palWith({ webWorkflow: "existing.js" }, [webWf("web.js")]);
    assert.equal(ensureWebRegistration(pal), null);
    assert.equal(pal.layout.webWorkflow, "existing.js");
});

test("does nothing when there is no web workflow", () => {
    const pal = palWith({}, [otherWf("console.js", 7)]);
    assert.equal(ensureWebRegistration(pal), null);
    assert.ok(!("webWorkflow" in pal.layout));
});

test("picks the first one when multiple web workflows exist (not ambiguous)", () => {
    const pal = palWith({}, [webWf("a.js"), webWf("b.js")]);
    assert.equal(ensureWebRegistration(pal), "a.js");
    assert.equal(pal.layout.webWorkflow, "a.js");
});

test("no layout -> null (nothing to register on)", () => {
    assert.equal(ensureWebRegistration({ allWorkflows: [webWf("web.js")] }), null);
});
