"use strict";
// The documented attribute sets for PalBuilder c: tags, transcribed from
// bundled-context/skills/palbuilder-frontend/SKILL.md (which is itself empirically verified
// against live pals). Using ANY attribute not in a tag's documented set throws a PalBuilder
// validation error at save time — that is what the whitelist check prevents.
//
// IMPORTANT FALSE-POSITIVE RULE: a whitelist is enforced ONLY for tags whose attribute set the
// skill enumerates as closed ("Valid attributes: …"). Tags documented with an open set
// (c:field says "…and others") or not enumerated at all (c:div, c:get, c:image, c:button,
// c:select, c:resource, c:debug) get NO whitelist — only their targeted rules. A lint that
// cries wolf on valid code teaches agents to ignore it.

// Closed attribute sets. `test` appears in each because the skill states test= works broadly.
const WHITELIST = {
    "c:a": new Set(["action", "href", "name", "id", "class", "style", "ajax-target", "validate",
        "confirm", "test", "show", "ajax-handler", "over-class", "out-class", "title",
        "plainurl", "media", "type", "workflow"]),
    "c:upload": new Set(["action", "ajax-handler", "limit", "allow", "style", "class", "test",
        "silent", "stylesheet", "uploadtext", "ajax-target", "multiple", "fragment", "script",
        "validate", "cancelaction", "canceltext", "provider", "providersettings", "head", "workflow"]),
    "c:list": new Set(["name", "id", "odd", "even", "toggle", "list", "query", "row-delim", "col-delim"]),
    "c:set": new Set(["name", "value", "test", "true", "false", "map"]),
    "c:if": new Set(["test"]),
    "c:fragment": new Set(["name", "test"]),
    "c:download": new Set(["action", "test", "id", "style", "class", "title", "value", "workflow", "validate"]),
    "c:when": new Set(["test"]),
    "c:choose": new Set([]),
    "c:otherwise": new Set([])
};

// Attributes a tag REQUIRES (missing one is a server validation error).
const REQUIRED = {
    "c:upload": ["allow"],
    "c:list": ["name", "id"],
    "c:set": ["name"],
    "c:if": ["test"],
    "c:fragment": ["name"],
    "c:when": ["test"]
};

// Allowed everywhere, never flagged (XML namespace declarations live on any element).
const ALWAYS_ALLOWED = (attr) => attr === "xmlns:c" || attr.startsWith("xmlns");

// HTML void elements — must be explicitly self-closed in PalBuilder's strict XHTML.
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr"]);

module.exports = { WHITELIST, REQUIRED, ALWAYS_ALLOWED, VOID_ELEMENTS };
