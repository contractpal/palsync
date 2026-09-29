"use strict";
const z = require("zod/v4-mini");

// JSON-Schema boilerplate that tells a model nothing: the draft URI, the ±MAX_SAFE_INTEGER bounds
// zod attaches to every .int(), and z.record's string propertyNames (JSON keys are always strings).
// Real bounds (min(1), max(100), exclusiveMinimum) stay.
function stripNoise(node) {
    if (Array.isArray(node)) return node.map(stripNoise);
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
        if (key === "$schema") continue;
        if (key === "maximum" && value === Number.MAX_SAFE_INTEGER) continue;
        if (key === "minimum" && value === Number.MIN_SAFE_INTEGER) continue;
        if (key === "propertyNames" && JSON.stringify(value) === '{"type":"string"}') continue;
        out[key] = stripNoise(value);
    }
    return out;
}

// The one tool-definition serialization: the MCP server's tools/list answer, pi-tools.json, the
// schema snapshot, and the context manifest all use it, so measured bytes are advertised bytes.
function serializeToolDefinitions(tools) {
    return tools.map(tool => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: stripNoise(z.toJSONSchema(z.object(tool.inputShape || {}), { target: "draft-7", io: "input" })),
        annotations: tool.annotations
    }));
}

module.exports = { serializeToolDefinitions };
