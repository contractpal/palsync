"use strict";
// Ported verbatim from the PalBuilder extension's out/utils/xmlParser.js.
// No vscode dependency here — this file was already vscode-free in the extension.
const { XMLBuilder, XMLParser } = require("fast-xml-parser");

function CloudPistonXMLBuilder(prettyPrint, oneListGroup = false) {
    let options = {
        ignoreAttributes: false,
        attributeNamePrefix: "_",
        suppressEmptyNode: true,
        format: prettyPrint,
        indentBy: "  ", // indentBy only used if format=true
        oneListGroup: oneListGroup
    };
    return new XMLBuilder(options);
}

function CloudPistonXMLParser() {
    const alwaysArrayPaths = [
        "com.contractpal.pal.ProfileInfo",
        "com.contractpal.pal.GroupInfo",
        "PalInfoEx",
        "entry",
        "Folder",
        "Pal.datasets.entry.Dataset.indexes.DatasetIndex.columns.string",
        "Pal.dataviews.entry.Dataview.datasets.entry.string",
        "Pal.data.entry.Data.values.entry.string",
        "Pal.datalists.entry.DataList.cols.string",
        "Pal.datalists.entry.DataList.recs.string-array.string",
        "Pal.layout.roles.string",
        "activationKeys"
    ];
    const options = {
        attributeNamePrefix: "_",
        ignoreAttributes: false,
        textNodeName: "_text",
        parseTagValue: true,
        // CloudPiston's own wire format wraps every genuinely-string value in a <string> tag —
        // that tag name IS the type declaration. fast-xml-parser's default parseTagValue still
        // runs numeric/boolean auto-detection on that text (via strnum), which silently turns
        // "01" into 1 and "true" into a boolean, destroying data (e.g. zero-padded DataList cell
        // values). Since the tag already asserts "this is a string", never let content sniffing
        // override that: returning undefined here makes the parser keep the raw, unparsed text
        // for <string> tags while leaving every other tag's default number/boolean handling
        // exactly as before (returning `val` unchanged is what the library's own default
        // tagValueProcessor does, so this is a no-op for non-string tags).
        tagValueProcessor: (tagName, val) => (tagName === "string" ? undefined : val),
        isArray: (name, jpath) => (alwaysArrayPaths.indexOf(jpath) !== -1 || alwaysArrayPaths.indexOf(name) !== -1)
    };
    return new XMLParser(options);
}

// ---- Row/pair reordering fix (DataList recs + Data values) ----
//
// CloudPiston serializes both a DataList row's cells and a Data map's [key, value] pair as a
// sequence of per-cell elements named either <string>value</string> (a real value) or <null/>
// (an empty/null cell) — heterogeneous sibling tag names used purely to mark "has a value" vs
// "empty", NOT to declare position. fast-xml-parser's normal (non-ordered) parse groups children
// BY TAG NAME, so a row with cells in e.g. string,string,null,null,string,string order comes back
// as two separate arrays — { string: [...4 values], null: [...2 empties] } — which silently
// discards the original order: reconstructing "non-null cells first, then nulls" only happens to
// look right when the nulls are already at the end. Same mechanism, same risk, for a Data pair
// whose value is legitimately empty. See bundled-context/../palsync-datalist-serialization-bug.md
// for the real-world DataList corruption this caused (server-verified against pal
// PAL-SE-168E7E4363D-1D28BE9A).
//
// Fix: re-parse the same raw XML with preserveOrder (which keeps each row's/pair's cells as an
// ordered list of {tagName: children} nodes instead of grouping by tag), and use that purely to
// rebuild every DataList's recs.string-array and every Data map's values.entry in true order —
// replacing whatever the primary, order-losing parse produced for those sections. Every other
// part of the primary parse (which the rest of the codebase already expects) is left untouched.

function findKeyDeep(obj, key) {
    if (!obj || typeof obj !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    for (const k of Object.keys(obj)) {
        const found = findKeyDeep(obj[k], key);
        if (found !== undefined) return found;
    }
    return undefined;
}

// Ordered-tree helpers. A preserveOrder node list is an array of single-tag objects, e.g.
// [{ tagName: children, ":@": {...attrs} }, ...]. `children` is itself such a list (or, for a
// leaf, a list containing at most one { "#text": value } node).
function orderedChildrenByTag(nodeList, tagName) {
    if (!Array.isArray(nodeList)) return [];
    const out = [];
    for (const node of nodeList) {
        if (Object.prototype.hasOwnProperty.call(node, tagName)) out.push(node[tagName]);
    }
    return out;
}

// Recursively find the first node list anywhere under `nodeList` tagged `tagName` (used only to
// locate the top-level <datalists> section, wherever it sits relative to the document root).
function findOrderedDeep(nodeList, tagName) {
    if (!Array.isArray(nodeList)) return undefined;
    for (const node of nodeList) {
        for (const key of Object.keys(node)) {
            if (key === ":@") continue;
            if (key === tagName) return node[key];
            const found = findOrderedDeep(node[key], tagName);
            if (found !== undefined) return found;
        }
    }
    return undefined;
}

function orderedLeafText(nodeList) {
    if (!Array.isArray(nodeList) || nodeList.length === 0) return "";
    const first = nodeList[0];
    return (first && typeof first === "object" && "#text" in first) ? String(first["#text"]) : "";
}

function readOrderedTree(xmlString) {
    return new XMLParser({
        ignoreAttributes: false,
        preserveOrder: true,
        parseTagValue: false
    }).parse(xmlString);
}

// A cell node is a single {tagName: children} object (either "string" or "null"). A <null/>
// cell is a genuinely absent/empty value — distinct from a <string></string> holding an actual
// empty string — so it comes back as JS `null`, not "".
function cellText(cellNode) {
    const tag = Object.keys(cellNode).find(k => k !== ":@");
    return tag === "null" ? null : orderedLeafText(cellNode[tag]);
}

// Map<DataList name, (string|null)[][]> — every row's cells, in true document order, with
// <null/> cells kept as JS `null` (not collapsed to "") so they stay distinguishable from a
// legitimately empty string cell.
function readOrderedDataListRows(ordered) {
    const rowsByName = new Map();
    const datalists = findOrderedDeep(ordered, "datalists");
    if (!datalists) return rowsByName;
    for (const entryChildren of orderedChildrenByTag(datalists, "entry")) {
        const dataListChildren = orderedChildrenByTag(entryChildren, "DataList")[0];
        if (!dataListChildren) continue;
        const nameChildren = orderedChildrenByTag(dataListChildren, "name")[0];
        const name = nameChildren ? orderedLeafText(nameChildren) : undefined;
        if (name === undefined) continue;
        const recsChildren = orderedChildrenByTag(dataListChildren, "recs")[0];
        if (!recsChildren) continue;
        const rows = orderedChildrenByTag(recsChildren, "string-array")
            .map(cellNodes => cellNodes.map(cellText));
        rowsByName.set(name, rows);
    }
    return rowsByName;
}

// Map<Data name, [key, value][]> — same heterogeneous-sibling-tag pattern as a DataList row, just
// fixed at exactly 2 cells with no string-array wrapper level: each values.entry element's own
// children ARE the [key, value] cells directly.
function readOrderedDataValuePairs(ordered) {
    const pairsByName = new Map();
    const dataSection = findOrderedDeep(ordered, "data");
    if (!dataSection) return pairsByName;
    for (const entryChildren of orderedChildrenByTag(dataSection, "entry")) {
        const dataChildren = orderedChildrenByTag(entryChildren, "Data")[0];
        if (!dataChildren) continue;
        const nameChildren = orderedChildrenByTag(dataChildren, "name")[0];
        const name = nameChildren ? orderedLeafText(nameChildren) : undefined;
        if (name === undefined) continue;
        const valuesChildren = orderedChildrenByTag(dataChildren, "values")[0];
        if (!valuesChildren) continue;
        const pairs = orderedChildrenByTag(valuesChildren, "entry")
            .map(cellNodes => cellNodes.map(cellText));
        pairsByName.set(name, pairs);
    }
    return pairsByName;
}

// Patch every DataList entry's recs and every Data entry's values in `parsedResult` (the object
// CloudPistonXMLParser().parse() produced) in place, using data reconstructed from the same raw
// XML. No-op (and skips the extra parse entirely) when the response carries neither section.
function fixOrderSensitiveShapes(xmlString, parsedResult) {
    const datalistsSection = findKeyDeep(parsedResult, "datalists");
    const hasDataLists = !!datalistsSection && Array.isArray(datalistsSection.entry) && datalistsSection.entry.length > 0;
    const dataSection = findKeyDeep(parsedResult, "data");
    const hasData = !!dataSection && Array.isArray(dataSection.entry) && dataSection.entry.length > 0;
    if (!hasDataLists && !hasData) return parsedResult;

    const ordered = readOrderedTree(xmlString);

    if (hasDataLists) {
        const rowsByName = readOrderedDataListRows(ordered);
        for (const entry of datalistsSection.entry) {
            const dataList = entry && entry.DataList;
            const rows = dataList && rowsByName.get(dataList.name);
            if (!rows) continue;
            dataList.recs = { "string-array": rows.map(cells => ({ string: cells })) };
        }
    }

    if (hasData) {
        const pairsByName = readOrderedDataValuePairs(ordered);
        for (const entry of dataSection.entry) {
            const data = entry && entry.Data;
            const pairs = data && pairsByName.get(data.name);
            if (!pairs) continue;
            data.values = { entry: pairs.map(cells => ({ string: cells })) };
        }
    }

    return parsedResult;
}

// ---- Row/pair reordering fix, build side (DataList recs + Data values) ----
//
// The read-side fix above works around fast-xml-parser's non-ordered PARSE grouping cells by
// tag name. The same library's BUILD direction has an independent, equally-destructive bug:
// given { string: ["a", "b", null] } (one row, cells in column order), XMLBuilder renders every
// null-valued array entry FIRST, in front of the real values, instead of at its original
// position — e.g. <string/><string>a</string><string>b</string> — silently shifting every real
// cell right by however many nulls preceded it in the row. Verified directly against
// fast-xml-parser: this reordering happens regardless of where in the array the null cells sit.
// Round-tripping a pal through toXml() (see lib/pal.js / apiManager.js savePal) with any
// DataList row or Data pair containing a null cell corrupts that row on save — server-verified
// via serviceTypes.json -> save -> re-pull producing serviceTypes2.json with every row's cells
// shifted right by one and the null cell turned into a leading "".
//
// Fix: build the document as usual, but first swap out every row's/pair's { string: [...] }
// object for a unique placeholder tag. After building, splice in the correctly-ordered fragment
// (built separately with preserveOrder, which — verified above — preserves both cell order and
// the null/string tag distinction) in place of each placeholder. Everything else about the
// document (produced by the normal, non-ordered builder) is untouched.

function orderedCellNode(cell) {
    return (cell === null || cell === undefined) ? { null: [] } : { string: [{ "#text": String(cell) }] };
}

function buildOrderedCellsFragment(cells) {
    return new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: "_",
        suppressEmptyNode: true,
        preserveOrder: true
    }).build(cells.map(orderedCellNode));
}

// Clones only what's needed to safely rewrite rows/pairs without mutating the caller's pal/task
// object (which may still be read afterwards, e.g. to write pal.json back to disk).
function prepareOrderSensitiveShapesForBuild(task) {
    const cloned = structuredClone(task);
    const replacements = new Map(); // placeholder tag name -> raw XML fragment
    let counter = 0;

    // Tag name deliberately has NO leading "_": CloudPistonXMLBuilder is configured with
    // attributeNamePrefix "_", so a leading underscore would make the builder treat this key as
    // an attribute of its parent element instead of a child element.
    const placeholderFor = (cells) => {
        const tag = "palRowPlaceholder" + (counter++);
        replacements.set(tag, buildOrderedCellsFragment(cells));
        return { [tag]: "" };
    };

    const datalistsSection = findKeyDeep(cloned, "datalists");
    if (datalistsSection && Array.isArray(datalistsSection.entry)) {
        for (const entry of datalistsSection.entry) {
            const dataList = entry && entry.DataList;
            const rows = dataList && dataList.recs && dataList.recs["string-array"];
            if (!Array.isArray(rows)) continue;
            dataList.recs["string-array"] = rows.map(row =>
                (row && Array.isArray(row.string)) ? placeholderFor(row.string) : row);
        }
    }

    const dataSection = findKeyDeep(cloned, "data");
    if (dataSection && Array.isArray(dataSection.entry)) {
        for (const entry of dataSection.entry) {
            const data = entry && entry.Data;
            const pairs = data && data.values && data.values.entry;
            if (!Array.isArray(pairs)) continue;
            data.values.entry = pairs.map(pair =>
                (pair && Array.isArray(pair.string)) ? placeholderFor(pair.string) : pair);
        }
    }

    return { cloned, replacements };
}

// Drop-in replacement for `CloudPistonXMLBuilder(prettyPrint, oneListGroup).build(task)` that
// also fixes the DataList-recs / Data-values row-reordering bug described above. No-op transform
// (beyond the clone) when `task` carries neither section.
function buildOrderSensitiveShapes(task, prettyPrint, oneListGroup) {
    const { cloned, replacements } = prepareOrderSensitiveShapesForBuild(task);
    let xml = CloudPistonXMLBuilder(prettyPrint, oneListGroup).build(cloned);
    for (const [tag, fragment] of replacements) {
        const selfClosing = "<" + tag + "/>";
        if (xml.indexOf(selfClosing) !== -1) {
            xml = xml.replace(selfClosing, fragment);
            continue;
        }
        const paired = "<" + tag + "></" + tag + ">";
        xml = xml.replace(paired, fragment);
    }
    return xml;
}

module.exports = {
    CloudPistonXMLBuilder,
    CloudPistonXMLParser,
    fixOrderSensitiveShapes,
    buildOrderSensitiveShapes
};
