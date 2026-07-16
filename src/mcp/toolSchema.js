"use strict";
const z = require("zod/v4-mini");

function serializeToolDefinitions(tools) {
    return tools.map(tool => {
        const schema = z.toJSONSchema(z.object(tool.inputShape || {}), { target: "draft-7", io: "input" });
        const { $schema, ...body } = schema;
        return {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: Object.assign(body, { $schema }),
            annotations: tool.annotations
        };
    });
}

module.exports = { serializeToolDefinitions };
