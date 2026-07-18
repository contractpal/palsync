"use strict";
// Cross-file CONTRACT checks for a PalBuilder pal workspace — invariants that only make sense
// when reading MULTIPLE files together (a fragment's <c:list>/action/ajax-target against the
// workflow that must satisfy it). This is why these checks live apart from lintWorkflowJs and
// lintMarkup (both single-file lint) and are wired into validateWorkspace OUTSIDE the `only`
// filter — a fragment can reference a workflow contract that changed in a DIFFERENT file than
// the one currently being edited, so scoping to "just the changed files" would miss it.
//
// Source of truth: bundled-context/skills/palbuilder-frontend/references/c-tags.md,
// palbuilder-workflow/references/responses.md, palbuilder-data/references/{datasets,payloads}.md.
// Ground-truthed against real bug corpora in /Users/apple/PalBuilder/test-0{1,2,4,5}-*.
const fs = require("fs");
const path = require("path");
const { parseTag } = require("./markup");

const MARKUP_EXT = new Set([".html", ".htm", ".xhtml"]);

// ---------------------------------------------------------------------------------------------
// File collection (contracts.js reads the workspace itself — it is not fed content by index.js).
// ---------------------------------------------------------------------------------------------

function walkFiles(absDir, relBase, out) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch (e) { if (e.code === "ENOENT") return; throw e; }
    for (const e of entries) {
        const abs = path.join(absDir, e.name);
        const rel = relBase + "/" + e.name;
        if (e.isDirectory()) walkFiles(abs, rel, out);
        else out.push({ abs, rel });
    }
}

function readUtf8(abs) {
    try { return fs.readFileSync(abs, "utf8"); } catch (e) { return null; }
}

function collectMarkupFiles(workspaceDir) {
    const files = [];
    for (const folder of ["pages", "fragments"]) {
        const found = [];
        walkFiles(path.join(workspaceDir, folder), folder, found);
        for (const f of found) {
            if (!MARKUP_EXT.has(path.extname(f.rel).toLowerCase())) continue;
            const src = readUtf8(f.abs);
            if (src == null) continue;
            files.push({ rel: f.rel, src });
        }
    }
    return files;
}

function collectWorkflowFiles(workspaceDir) {
    const found = [];
    walkFiles(path.join(workspaceDir, "workflows"), "workflows", found);
    const files = [];
    for (const f of found) {
        if (!f.rel.endsWith(".js")) continue;
        const src = readUtf8(f.abs);
        if (src == null) continue;
        files.push({ rel: f.rel, src });
    }
    return files;
}

function collectStylesheetFiles(workspaceDir) {
    const files = [];
    const seen = new Set();
    for (const folder of ["styles", "Styles"]) {
        const found = [];
        walkFiles(path.join(workspaceDir, folder), folder, found);
        for (const f of found) {
            if (path.extname(f.rel).toLowerCase() !== ".css") continue;
            let identity = f.abs;
            try { const st = fs.statSync(f.abs); identity = st.dev + ":" + st.ino; } catch (e) { /* keep path */ }
            if (seen.has(identity)) continue;
            seen.add(identity);
            const src = readUtf8(f.abs);
            if (src != null) files.push({ rel: f.rel, src });
        }
    }
    return files;
}

// Line number for a char offset. Files here are small (pal apps), so a plain scan is fine —
// no need for markup.js's binary-search indexer (that file isn't exported from here anyway).
function lineAt(src, pos) {
    let line = 1;
    const end = Math.min(pos, src.length);
    for (let i = 0; i < end; i++) if (src[i] === "\n") line++;
    return line;
}

// Walk every <tag> in src (skipping comments, doctype/PI, close tags, and script/style raw
// bodies), calling cb(tag, pos) for each opening/self-closing tag. Reuses markup.js's parseTag
// (already handles EL '>' inside quoted attribute values) instead of re-deriving a tag scanner.
function scanTags(src, cb) {
    const n = src.length;
    let i = 0;
    while (i < n) {
        const lt = src.indexOf("<", i);
        if (lt === -1) break;
        if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e === -1 ? n : e + 3; continue; }
        if (src[lt + 1] === "!" || src[lt + 1] === "?") { const e = src.indexOf(">", lt + 2); i = e === -1 ? n : e + 1; continue; }
        if (src[lt + 1] === "/") { const e = src.indexOf(">", lt); i = e === -1 ? n : e + 1; continue; }
        const tag = parseTag(src, lt);
        if (!tag) { i = lt + 1; continue; }
        cb(tag, lt);
        i = tag.end;
        const lname = tag.name.toLowerCase();
        if ((lname === "script" || lname === "style") && !tag.selfClosed) {
            const close = new RegExp("</" + lname + "\\b", "i").exec(src.slice(i));
            i = close ? i + close.index + close[0].length : n;
        }
    }
}

function attr(tag, name) {
    const a = tag.attrs.find(a => a.name.toLowerCase() === name);
    return a ? a.value : null;
}
function hasAttr(tag, name) {
    return tag.attrs.some(a => a.name.toLowerCase() === name);
}

const RESERVED_EL_WORDS = new Set(["eq", "ne", "gt", "lt", "ge", "le", "and", "or", "not", "empty", "true", "false", "null", "div", "mod", "instanceof"]);

function checkReservedElName(tag, rel, src, pos, tagName, attrName, value, findings) {
    if (value == null || !RESERVED_EL_WORDS.has(String(value).trim())) return;
    const id = String(value).trim();
    const isList = tagName === "c:list";
    findings.push({
        file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "reservedElWord",
        message: "<" + tagName + " " + attrName + "=\"" + id + "\"> — \"" + id +
            "\" is a reserved EL operator and cannot be a " + tagName + " " + (isList ? "id / loop variable" : "name") +
            "; every ${" + id + ".x} becomes ambiguous. Fix: use a short non-reserved name (e, r, row, item). " +
            "See the palbuilder-frontend skill, \"EL operators\"."
    });
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ---------------------------------------------------------------------------------------------
// Check 1 — c:list name/id contract.
// ---------------------------------------------------------------------------------------------

function splitTopLevelArgs(text) {
    const parts = [];
    let depth = 0, cur = "", inStr = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inStr) { cur += ch; if (ch === inStr && text[i - 1] !== "\\") inStr = null; continue; }
        if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        if (ch === ")" || ch === "]" || ch === "}") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
        cur += ch;
    }
    if (cur.trim() !== "" || parts.length) parts.push(cur);
    return parts;
}

function callArgsFrom(src, argsStart) {
    let i = argsStart, depth = 1, inStr = null;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (inStr) {
            if (ch === inStr && src[i - 1] !== "\\") inStr = null;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; i++; continue; }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        i++;
    }
    return { args: splitTopLevelArgs(src.slice(argsStart, i - 1)), end: i };
}

function namedListFromGetRecords(src, argsStart, defaultName) {
    const call = callArgsFrom(src, argsStart);
    let produced = null;
    if (call.args.length >= 2) {
        const strMatch = /^\s*["']([^"']+)["']\s*$/.exec(call.args[1]);
        if (strMatch) produced = strMatch[1];
    }
    // chained .copy("name") right after the call overrides the default name.
    const after = /^\s*\.copy\(\s*["']([^"']+)["']\s*\)/.exec(src.slice(call.end, call.end + 80));
    if (after) produced = after[1];
    if (!produced && call.args.length <= 1) produced = defaultName;
    return produced;
}

// Collect DataList names a workflow file can PRODUCE, per datasets.md / payloads.md:
//   ds.getRecords(filter)             -> DataList named after the DataSet ("ds" must trace to
//                                         a pal.getDataSet("<name>") assignment; no rename).
//   ds.getRecords(filter, "custom")   -> DataList named "custom".
//   pal.getDataSet("name").getRecords(filter, "custom") -> DataList named "custom".
//   <anything>.copy("custom")         -> renames/produces a DataList named "custom".
//   c.createDataList("custom", [...])  -> DataList named "custom".
function collectListNames(workflowFiles) {
    const names = new Set();
    for (const { src } of workflowFiles) {
        const varToDataset = {};
        const dsRe = /(\w+)\s*=\s*pal\.getDataSet\(\s*(["'])([^"']+)\2\s*\)/g;
        let m;
        while ((m = dsRe.exec(src))) varToDataset[m[1]] = m[3];

        const createRe = /createDataList\(\s*["']([^"']+)["']/g;
        while ((m = createRe.exec(src))) names.add(m[1]);

        const copyRe = /\.copy\(\s*["']([^"']+)["']\s*\)/g;
        while ((m = copyRe.exec(src))) names.add(m[1]);

        const inlineRecordsRe = /pal\.getDataSet\(\s*(["'])([^"']+)\1\s*\)\.getRecords\(/g;
        while ((m = inlineRecordsRe.exec(src))) {
            const produced = namedListFromGetRecords(src, m.index + m[0].length, m[2]);
            if (produced) names.add(produced);
        }

        const getRecordsRe = /(\w+)\.getRecords\(/g;
        while ((m = getRecordsRe.exec(src))) {
            const receiver = m[1];
            const produced = namedListFromGetRecords(src, m.index + m[0].length, varToDataset[receiver] || null);
            if (produced) names.add(produced);
        }
    }
    return names;
}

function checkListNameContract(markupFiles, listNames, findings) {
    const namesList = listNames.size ? [...listNames].sort().join(", ") : "(none — no workflow produces a DataList)";
    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            if (tag.name.toLowerCase() !== "c:list") return;
            const name = attr(tag, "name");
            const id = attr(tag, "id");
            checkReservedElName(tag, rel, src, pos, "c:list", "id", id, findings);
            if (hasAttr(tag, "list")) return; // string-split mode — different contract, not this check
            if (name == null || listNames.has(name)) return;

            const closeMatch = /<\/c:list>/i.exec(src.slice(tag.end));
            const body = closeMatch ? src.slice(tag.end, tag.end + closeMatch.index) : src.slice(tag.end, tag.end + 2000);
            const swapped = id != null && listNames.has(id) && body.includes("${" + name + ".");

            const message = swapped
                ? "<c:list name=\"" + name + "\" id=\"" + id + "\"> — name and id appear SWAPPED: name must be the " +
                  "DataList name from the workflow payload, id is the per-row loop variable. \"" + id + "\" IS a known " +
                  "DataList name and the body reads \"${" + name + ".\", which is exactly this swap. " +
                  "Fix: <c:list name=\"" + id + "\" id=\"" + name + "\">. Known DataList names: " + namesList + ". " +
                  "See the palbuilder-frontend skill tag reference, \"c:list\"."
                : "<c:list name=\"" + name + "\"> — \"" + name + "\" is not a DataList name produced by any workflow " +
                  "(known DataList names: " + namesList + "). With no matching DataList this <c:list> renders zero rows. " +
                  "Fix: use the exact name the workflow attached via payload.addDataList(...)/getRecords(filter, \"name\"). " +
                  "See the palbuilder-frontend skill tag reference, \"c:list\".";

            findings.push({ file: rel, line: lineAt(src, tag.end), column: 0, severity: "warn", rule: "listNameContract", message });
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Check 2 — ajax-target must resolve to a real id=.
// ---------------------------------------------------------------------------------------------

function checkAjaxTargetExists(markupFiles, findings) {
    const ids = new Set();
    for (const { src } of markupFiles) scanTags(src, tag => { const v = attr(tag, "id"); if (v != null) ids.add(v); });

    const idsList = ids.size ? [...ids].sort().join(", ") : "(no element in this workspace has an id= attribute)";
    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            const target = attr(tag, "ajax-target");
            if (target == null || target === "ignore" || ids.has(target)) return;
            findings.push({
                file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "ajaxTargetExists",
                message: "ajax-target=\"" + target + "\" — no element with id=\"" + target + "\" exists in any page or " +
                    "fragment — the AJAX response has nowhere to render. ids that do exist: " + idsList + ". " +
                    "Fix: add id=\"" + target + "\" to the wrapper you want the response swapped into, or point " +
                    "ajax-target at one of the existing ids above. See the palbuilder-frontend skill tag reference, \"c:a\"."
            });
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Check 3 — action=".." must be routed by some workflow's case.
// ---------------------------------------------------------------------------------------------

function collectRoutedActions(workflowFiles) {
    const actions = new Set();
    for (const { src } of workflowFiles) {
        const re = /case\s*["']([^"']+)["']\s*:/g;
        let m;
        while ((m = re.exec(src))) actions.add(m[1]);
    }
    return actions;
}

function checkActionRouted(markupFiles, workflowFiles, actions, findings) {
    const actionsList = actions.size ? [...actions].sort().join(", ") : "(no workflow has any case label)";
    // A workflow's `default:` case is a legitimate catch-all (real pattern: the implicit
    // "list"/landing action, plus truly unknown actions) — a real pal (test-01-crud-mimo)
    // routes its "list" action this way with NO explicit `case "list":`. An action with no
    // matching case still reaches code (the default branch), so it's a WARN, not a hard error,
    // when some workflow has a default: label; only escalate to error when there's no fallback
    // at all (nothing will handle the action).
    const hasDefault = workflowFiles.some(({ src }) => /default\s*:/.test(src));
    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            if (!tag.name.toLowerCase().startsWith("c:")) return;
            const raw = attr(tag, "action");
            if (raw == null) return;
            const name = raw.split("?")[0];
            if (!name) {
                findings.push({
                    file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "emptyAction",
                    message: "c:a with empty action never routes at runtime; give it a real action (e.g. action=\"list\") or href"
                });
                return;
            }
            if (name.includes("${")) return; // dynamic action name — can't check statically
            if (actions.has(name)) return;
            // Conventional console/web return-to-list links often rely on the workflow default:
            // branch, which is the actual landing/list behavior. Warn on other unknown actions
            // with a default, but do not make the common "Cancel" -> list pattern noisy.
            if (hasDefault && name === "list") return;
            findings.push({
                file: rel, line: lineAt(src, pos), column: 0, severity: hasDefault ? "warn" : "error", rule: "actionRouted",
                message: "action=\"" + raw + "\" — \"" + name + "\" is not routed by any workflow (no `case \"" + name +
                    "\":` found). The action " + (hasDefault
                        ? "falls through to the workflow's default: case — verify that default actually handles it correctly."
                        : "has NO handler at all (no default: case either) — nothing will process it.") + " " +
                    "Known routed actions: " + actionsList + ". " +
                    "Fix: add `case \"" + name + "\":` to the switch in the workflow that should handle it, or correct the typo."
            });
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Check 4 — EL wrapping in test="..." attributes.
// ---------------------------------------------------------------------------------------------

function mechanicalBareFix(value) {
    let m;
    if ((m = /^([\w.]+)\.count\(\)\s*==\s*0$/.exec(value))) return "${empty " + m[1] + "}";
    if ((m = /^([\w.]+)\.count\(\)\s*>\s*0$/.exec(value))) return "${!empty " + m[1] + "}";
    if ((m = /^([\w.]+)\s*==\s*'([^']*)'$/.exec(value))) return "${" + m[1] + " eq '" + m[2] + "'}";
    if ((m = /^([\w.]+)\s*!=\s*'([^']*)'$/.exec(value))) return "${" + m[1] + " ne '" + m[2] + "'}";
    if ((m = /^!\s*([\w.]+)$/.exec(value))) return "${!" + m[1] + "}";
    if (/^[\w.]+$/.test(value)) return "${" + value + "}";
    return null;
}

function checkElSyntax(tag, rel, src, pos, findings) {
    const value = attr(tag, "test");
    if (value == null) return;

    if (!value.includes("${")) {
        const fixed = mechanicalBareFix(value.trim());
        findings.push({
            file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "elSyntax",
            message: "test=\"" + value + "\" — test must be an EL expression: test=\"${...}\". A bare (non-${}) value is " +
                "never evaluated as EL and renders as a literal string, which is always truthy. " +
                (fixed ? "Fix: test=\"" + fixed + "\"." :
                    "Fix: wrap the whole expression in ${...}.") +
                " See the palbuilder-frontend skill, \"EL operators\"."
        });
    }
}

function checkReservedElNames(markupFiles, findings) {
    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            const tagName = tag.name.toLowerCase();
            if (tagName === "c:set" || tagName === "c:fragment") {
                checkReservedElName(tag, rel, src, pos, tagName, "name", attr(tag, "name"), findings);
            }
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Check 5 — href="?action=..." anti-pattern on c:a.
// ---------------------------------------------------------------------------------------------

function checkHrefAction(tag, rel, src, pos, findings) {
    if (tag.name.toLowerCase() !== "c:a") return;
    const href = attr(tag, "href");
    if (href == null || !/\?action=/.test(href)) return;
    findings.push({
        file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "hrefAction",
        message: "href=\"" + href + "\" on <c:a> — a plain navigation link sends NO form fields; the workflow sees " +
            "every input as null. Fix: use action=\"...\" instead of href=\"?action=...\" so submitted fields travel " +
            "with the request. Do NOT wrap the c:a in a <form> — the server rejects <form> in fragments, and none " +
            "is needed: c:a action=\"...\" submits every named input/c:field in the fragment by itself. " +
            "See the palbuilder-frontend skill tag reference, \"c:a\" (the documented ✗ example)."
    });
}

// ---------------------------------------------------------------------------------------------
// Check 5b — <form> tag in a fragment. The server refuses the save outright ("Tag form is not
// allowed"), but the offline validator used to pass it — seen in the test-06 haiku run, where a
// <form>-wrapped c:a action passed pal_validate and then died at pal_push, sending the agent back
// to the broken href pattern. Fragments never need <form>: c:a action= submits the fields itself.
// ---------------------------------------------------------------------------------------------

function checkFormTag(tag, rel, src, pos, findings) {
    if (tag.name.toLowerCase() !== "form") return;
    if (!rel.startsWith("fragments/")) return;
    findings.push({
        file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "formTag",
        message: "<form> is not allowed in a fragment — the server refuses the save (\"Tag form is not allowed\"). " +
            "You do not need it: <c:a action=\"...\"> submits every named input/c:field in the fragment by itself, " +
            "with no wrapper. Delete the <form>/</form> tags and keep the fields + <c:a action=\"...\">."
    });
}

// ---------------------------------------------------------------------------------------------
// Check 5c — destructive c:a action with no confirm= guard. The platform renders a native
// browser confirm for any c:a carrying confirm="..." — a one-click delete with no undo is a
// UX defect the offline validator can catch deterministically (a weak model won't add this
// unprompted; it lives only in an on-demand skill reference, never in loaded text otherwise).
// remove*/clear* are demoted to warn — real actions use that prefix for non-destructive things
// (e.g. "removeFilter").
// ---------------------------------------------------------------------------------------------

const DESTRUCTIVE_ACTION_RE = /^(delete|destroy|purge)/i;
const AMBIGUOUS_ACTION_RE = /^(remove|clear)/i;

function checkDestructiveConfirm(tag, rel, src, pos, findings) {
    if (tag.name.toLowerCase() !== "c:a") return;
    const action = attr(tag, "action");
    if (action == null) return;
    if (hasAttr(tag, "confirm")) return;
    const name = action.split("?")[0];
    const destructive = DESTRUCTIVE_ACTION_RE.test(name);
    const ambiguous = !destructive && AMBIGUOUS_ACTION_RE.test(name);
    if (!destructive && !ambiguous) return;
    const msg = destructive
        ? "<c:a action=\"" + action + "\"> deletes data with NO confirmation — one stray click destroys a " +
          "record with no undo (the platform has no cascade or restore). Fix: add confirm= — " +
          "<c:a action=\"" + action + "\" ajax-target=\"body\" confirm=\"Delete this item? This cannot be undone.\">" +
          "Delete</c:a>. See the palbuilder-frontend skill tag reference, \"c:a\"."
        : "<c:a action=\"" + action + "\"> has no confirm= — harmless if this only clears a filter/selection, " +
          "but if it deletes or discards data, add confirm=\"...\" (the platform renders a native confirm " +
          "prompt for you). See the palbuilder-frontend skill tag reference, \"c:a\".";
    findings.push({
        file: rel, line: lineAt(src, pos), column: 0,
        severity: "warn",
        rule: "destructiveConfirm",
        message: msg,
    });
}

// ---------------------------------------------------------------------------------------------
// Check 8 — action parameter passed by a fragment but never read by the workflow.
// ---------------------------------------------------------------------------------------------

function extractFunctionBodies(src) {
    const map = {};
    const re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
        const braceIdx = src.indexOf("{", re.lastIndex);
        if (braceIdx === -1) continue;
        let depth = 0, i = braceIdx;
        for (; i < src.length; i++) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
        }
        map[m[1]] = src.slice(braceIdx, i);
    }
    return map;
}

// Extract the source of `case "A": ... ` up to the next case/default at the same brace depth,
// or a `break;`, whichever comes first. Deliberately simple (this repo's workflows are flat
// switch statements, not nested state machines) — see the "conservative" note in the spec.
function extractCaseBlock(src, actionName) {
    const re = new RegExp("case\\s*[\"']" + escapeRegExp(actionName) + "[\"']\\s*:");
    const m = re.exec(src);
    if (!m) return null;
    const start = m.index + m[0].length;
    let i = start, depth = 0;
    const n = src.length;
    while (i < n) {
        const ch = src[i];
        if (ch === "{") { depth++; i++; continue; }
        if (ch === "}") { if (depth === 0) break; depth--; i++; continue; }
        if (depth === 0) {
            const rest = src.slice(i, i + 400);
            if (/^case\s*["'`]/.test(rest) || /^default\s*:/.test(rest)) break;
            const brk = /^break\s*;/.exec(rest);
            if (brk) { i += brk[0].length; break; }
        }
        i++;
    }
    return { text: src.slice(start, i), line: lineAt(src, m.index) };
}

const REQUEST_READ_RE = /getRequest\s*\(\)|request\.get\s*\(|\.getData\s*\(\)|data\.get\s*\(/;

function reachableHasRequestRead(caseText, functionBodies) {
    if (REQUEST_READ_RE.test(caseText)) return true;
    const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    const called = new Set();
    while ((m = callRe.exec(caseText))) called.add(m[1]);
    for (const name of called) {
        const body = functionBodies[name];
        if (body && REQUEST_READ_RE.test(body)) return true;
    }
    return false;
}

function collectActionParamUses(markupFiles) {
    const uses = []; // { action, query, rel, line }
    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            if (!tag.name.toLowerCase().startsWith("c:")) return;
            const raw = attr(tag, "action");
            if (raw == null) return;
            const qIdx = raw.indexOf("?");
            if (qIdx === -1) return;
            const action = raw.slice(0, qIdx);
            const query = raw.slice(qIdx);
            if (!action || query === "?") return;
            uses.push({ action, query, rel, line: lineAt(src, pos) });
        });
    }
    return uses;
}

function checkParamDropped(markupFiles, workflowFiles, findings) {
    const uses = collectActionParamUses(markupFiles);
    if (!uses.length) return;
    const byAction = new Map();
    for (const u of uses) { if (!byAction.has(u.action)) byAction.set(u.action, []); byAction.get(u.action).push(u); }

    for (const [action, occurrences] of byAction) {
        let anyRead = false;
        for (const { src } of workflowFiles) {
            const block = extractCaseBlock(src, action);
            if (!block) continue;
            const bodies = extractFunctionBodies(src);
            if (reachableHasRequestRead(block.text, bodies)) { anyRead = true; break; }
        }
        if (anyRead) continue;
        const first = occurrences[0];
        findings.push({
            file: first.rel, line: first.line, column: 0, severity: "warn", rule: "paramDropped",
            message: "action=\"" + action + first.query + "\" is passed " + first.query + " by " + first.rel +
                " but its handler never reads the request — the parameter is silently dropped. " +
                "Fix: read it inside case \"" + action + "\" (or a function it calls) with getRequest().getData().get(...) " +
                "or the file's existing request/data accessor."
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Check 9 — createAjaxResponse without isAjax() (hardcoded transport instead of following the
// request's transport).
// ---------------------------------------------------------------------------------------------

function checkAjaxTransport(rel, src, findings) {
    const idx = src.indexOf("createAjaxResponse");
    if (idx === -1) return;
    if (/isAjax\s*\(\)/.test(src)) return;
    if (/robots\.txt/.test(src) && /sitemap\.xml/.test(src) && /llms\.txt/.test(src) && /setContentType\s*\(/.test(src)) return;
    findings.push({
        file: rel, line: lineAt(src, idx), column: 0, severity: "warn", rule: "ajaxTransport",
        message: "createAjaxResponse(...) is used but this file never calls isAjax() — the response type is " +
            "hardcoded per action instead of following the request's actual transport. Canonical pattern: " +
            "if (request.isAjax()) { ...; return ajax; } ...; return page;. See " +
            "palbuilder-workflow/references/responses.md (common tail)."
    });
}

// ---------------------------------------------------------------------------------------------
// Check 9a — page response taken from pal.getPage(...) instead of c.getPage(...).
// pal.getPage returns the DESIGN-MODEL page (a PalFile, metadata only); it is NOT a returnable
// workflow response. Returning it fails server validation with "Expected WorkflowResponse, found
// Render" and throws "Invalid return type" at runtime. The controller's c.getPage(...) returns
// the runtime page (a WorkflowReturn) that run() can return. This trap has burned entire build
// sessions (the server errors are opaque and only surface after a push+test round trip), so flag
// it offline. See palbuilder-workflow/references/{responses.md, console.md}.
// ---------------------------------------------------------------------------------------------

function checkPageResponseSource(rel, src, findings) {
    const re = /\bpal\.getPage\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
        findings.push({
            file: rel, line: lineAt(src, m.index), column: 0, severity: "error", rule: "pageResponseSource",
            message: "pal.getPage(...) returns the design-model page (metadata only), NOT a returnable response. " +
                "Returning it fails validation with \"Expected WorkflowResponse, found Render\" and throws " +
                "\"Invalid return type\" at runtime. Fix: use c.getPage(\"<name>\") — the controller method that " +
                "returns the runtime page (a WorkflowReturn) run() can return. See " +
                "palbuilder-workflow/references/responses.md and console.md (console response pattern)."
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Check 10a — lingering GSAP vendor <script src> after the design-system-v2 drop-GSAP migration
// (scripts/pb-motion.js replaces it: data-animate/data-ticker/data-typewriter/data-tilt/
// data-spotlight). A pal's own markup should never reference a gsap bundle.
// ---------------------------------------------------------------------------------------------

function checkStaleVendor(rel, src, findings) {
    scanTags(src, (tag, pos) => {
        if (tag.name.toLowerCase() !== "script") return;
        const srcAttr = attr(tag, "src");
        if (!srcAttr || !/gsap/i.test(srcAttr)) return;
        findings.push({
            file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "staleVendor",
            message: "<script src=\"" + srcAttr + "\"> references a GSAP vendor file — GSAP was dropped in favor of " +
                "scripts/pb-motion.js (data-animate/data-ticker/data-typewriter/data-tilt/data-spotlight). Remove the " +
                "GSAP script tag and any GSAP calls; use the pb-motion.js data attributes instead. See " +
                "design-system-init/references/marketing-library.md section 15 (Motion Recipes)."
        });
    });
}

// ---------------------------------------------------------------------------------------------
// Check 10 — <c:fragment name="${var}"> placeholder must be bound by a payload.set("var", ...).
// Real bug (test-02-crud-mimo): page read ${frag} but the workflow ran payload.set("main", frag)
// — the EL variable resolves empty, <c:fragment name=""> renders nothing, and the whole UI is
// blank on full page load even though every file compiles and saves cleanly.
// ---------------------------------------------------------------------------------------------

function checkFragmentBinding(markupFiles, workflowFiles, findings) {
    // Every payload key any workflow sets, plus key -> identifier for .set("key", someVar) calls
    // (used for the rename suggestion when the page var matches the VALUE variable, not the key).
    const keys = new Set();
    const keyToIdent = new Map();
    for (const { src } of workflowFiles) {
        const re = /\.set\(\s*["']([^"']+)["']\s*(?:,\s*([A-Za-z_$][\w$]*)\s*\))?/g;
        let m;
        while ((m = re.exec(src))) {
            keys.add(m[1]);
            if (m[2]) keyToIdent.set(m[1], m[2]);
        }
    }

    const keysList = keys.size ? [...keys].sort().join(", ") : "(no workflow sets any payload key)";
    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            if (tag.name.toLowerCase() !== "c:fragment") return;
            const name = attr(tag, "name");
            if (name == null) return;
            const el = /^\$\{\s*([\w]+)\s*\}$/.exec(name);
            if (!el) return; // static fragment name — different contract, not this check
            const v = el[1];
            if (keys.has(v)) return;

            // Strong case: some payload.set("otherKey", v) passes the SAME variable the page
            // reads — the key and the EL variable were meant to match but drifted apart.
            let renamed = null;
            for (const [key, ident] of keyToIdent) {
                if (ident === v) { renamed = key; break; }
            }

            const message = renamed
                ? "<c:fragment name=\"${" + v + "}\"> — the page reads payload key \"" + v + "\", but the workflow " +
                  "sets payload.set(\"" + renamed + "\", " + v + ") — the key is \"" + renamed + "\", not \"" + v + "\". " +
                  "The EL variable resolves empty, so the fragment placeholder renders NOTHING and the page is blank " +
                  "on full page load. Fix: change the workflow to payload.set(\"" + v + "\", " + v + ") (or change the " +
                  "page to ${" + renamed + "}) — the payload KEY and the page's ${...} variable must be identical. " +
                  "See the palbuilder-frontend skill tag reference, \"c:fragment\"."
                : "<c:fragment name=\"${" + v + "}\"> — no workflow ever sets payload key \"" + v + "\" " +
                  "(keys that are set: " + keysList + "). The EL variable resolves empty, so the fragment placeholder " +
                  "renders NOTHING and the page is blank on full page load. Fix: in the workflow's non-AJAX path, " +
                  "payload.set(\"" + v + "\", <fragmentName>) before page.addPayload(payload). " +
                  "See the palbuilder-frontend skill tag reference, \"c:fragment\".";

            findings.push({ file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "fragmentBinding", message });
        });
    }
}

// Static c:fragment names are extensionless paths into the shipped fragments/ tree. Dynamic
// names are handled by checkFragmentBinding because their target is supplied through payload.
function checkStaticFragmentExists(markupFiles, findings) {
    const shipped = new Set(markupFiles.map(({ rel }) => rel.replace(/\.(?:html?|xhtml)$/i, "")));
    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            if (tag.name.toLowerCase() !== "c:fragment") return;
            const name = attr(tag, "name");
            if (name == null || /^\$\{\s*[\w]+\s*\}$/.test(name)) return;
            const target = "fragments/" + String(name).replace(/^\/+|\/+$/g, "");
            if (shipped.has(target)) return;
            // Trailing ".html" in name= is the most common cause (resolves to <name>.html.html):
            // lead with the exact corrected markup instead of the generic add-a-file advice.
            const extIncluded = /\.(?:html?|xhtml)$/i.test(String(name));
            findings.push({
                file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "missingFragment",
                message: extIncluded
                    ? "<c:fragment name=\"" + name + "\"/> — fragment names are EXTENSIONLESS; this resolves to " +
                      target + ".html. Fix: <c:fragment name=\"" + String(name).replace(/\.(?:html?|xhtml)$/i, "") + "\"/>."
                    : "<c:fragment name=\"" + name + "\"/> references " + target + ".html, but that static fragment is not shipped. " +
                      "Fix: add fragments/" + name + ".html (or change name= to an existing fragment path). See the palbuilder-frontend skill, \"c:fragment\"."
            });
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Check 11 — low-noise pb-* quality hints. These activate when markup uses the pb-* vocabulary,
// regardless of which pal-owned stylesheet defines the selected recipes. The canonical
// design-system.css is a reference catalog, not a runtime asset.
// They are warnings: rendered designAudit + screenshot review is the authority, while these catch
// the exact weak-model failure mode (browser-default controls/actions) before the first push.
// ---------------------------------------------------------------------------------------------

function checkPbQualityHints(workspaceDir, markupFiles, findings) {
    const usedInMarkup = markupFiles.some(({ src }) => /class\s*=\s*["'][^"']*\bpb-/.test(src));
    if (!usedInMarkup) return;

    const actionWords = /^(add|create|save|cancel|edit|delete|remove|check out|check in|submit|send|email|book|get started|try again)\b/i;

    // Resolve the vocabulary from the pal's real stylesheets instead of hard-coding a second
    // component list here. This catches the common weak-model move of inventing a plausible
    // modifier (for example `.pb-btn-sm`) that silently renders as if the class were absent.
    const definedPbClasses = new Set();
    for (const folder of ["styles", "Styles"]) {
        const cssFiles = [];
        walkFiles(path.join(workspaceDir, folder), folder, cssFiles);
        for (const f of cssFiles) {
            if (path.extname(f.rel).toLowerCase() !== ".css") continue;
            const css = readUtf8(f.abs);
            if (css == null) continue;
            const re = /\.((?:pb-)[A-Za-z0-9_-]+)/g;
            let m;
            while ((m = re.exec(css))) definedPbClasses.add(m[1]);
        }
    }

    for (const { rel, src } of markupFiles) {
        let fieldGroups = 0;
        const undefinedReported = new Set();
        scanTags(src, (tag, pos) => {
            const name = tag.name.toLowerCase();
            const cls = attr(tag, "class") || "";
            if (/(^|\s)pb-field-group(?:\s|$)/.test(cls)) fieldGroups++;

            const type = String(attr(tag, "type") || "").toLowerCase();
            const textControl = name === "textarea" || name === "select" || name === "c:select" ||
                ((name === "input" || name === "c:field") && !["hidden", "button", "submit", "reset", "image", "checkbox", "radio", "option"].includes(type));
            if (textControl && !/\bpb-(?:input|select|textarea)\b/.test(cls)) {
                const expected = (name === "select" || name === "c:select") ? "pb-select" : name === "textarea" ? "pb-textarea" : "pb-input";
                findings.push({
                    file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "pbControlClass",
                    message: "<" + tag.name + "> uses the canonical pb-* design system but has no ." + expected +
                        " class, so it can render like a browser-default control. Add class=\"" + expected +
                        "\" inside a .pb-field-group with a visible label; see component-library.md Fields."
                });
            }

            if (name === "h1" && !/\bpb-(?:title|hero-title)\b/.test(cls)) {
                findings.push({
                    file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "pbHeadingClass",
                    message: "This H1 bypasses the archetype type scale. Use .pb-title for product/CRUD screens or .pb-hero-title inside a marketing hero."
                });
            }

            if (name === "table" && !/\bpb-table\b/.test(cls)) {
                findings.push({
                    file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "pbTableClass",
                    message: "This table bypasses the responsive data-table recipe. Add .pb-table inside .pb-table-wrap and data-label on each td."
                });
            }

            if (name === "c:a" && attr(tag, "action") != null && !/\bpb-btn\b/.test(cls)) {
                const close = /<\/c:a\s*>/i.exec(src.slice(tag.end, tag.end + 500));
                const body = close ? src.slice(tag.end, tag.end + close.index).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
                if (actionWords.test(body)) {
                    findings.push({
                        file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "pbActionAffordance",
                        message: "Action \"" + body.slice(0, 60) + "\" has no .pb-btn variant and can render as an undifferentiated text link. Use primary/secondary/ghost/danger per action hierarchy; destructive actions come last and stay visually separate."
                    });
                }
            }

            if (name === "a" && /^#/.test(attr(tag, "href") || "")) {
                const close = /<\/a\s*>/i.exec(src.slice(tag.end, tag.end + 200));
                const body = close ? src.slice(tag.end, tag.end + close.index).replace(/<[^>]+>/g, " ").trim() : "";
                if (/skip.+content/i.test(body) && !/\bpb-skip-link\b/.test(cls)) {
                    findings.push({
                        file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "pbSkipLink",
                        message: "Skip link has no .pb-skip-link class and will be visible at rest. Add the class so it appears only on keyboard focus."
                    });
                }
            }

            for (const token of cls.split(/\s+/).filter(Boolean)) {
                if (!definedPbClasses.size || !/^pb-[A-Za-z0-9_-]+$/.test(token) || definedPbClasses.has(token) || undefinedReported.has(token)) continue;
                undefinedReported.add(token);
                findings.push({
                    file: rel, line: lineAt(src, pos), column: 0, severity: "warn", rule: "pbUndefinedClass",
                    message: "." + token + " is used in markup but no workspace stylesheet defines it. Invented pb-* names do nothing at render time; use the exact class from component-library.md/design-system.css or define an approved PAL OVERRIDES component."
                });
            }
        });

        // Table actions are a composition contract, not just a button-color contract. Without
        // `.pb-row-actions`, several otherwise styled buttons touch, drift, and overflow during
        // the shipped mobile table collapse. Also catch mutually exclusive state transitions
        // rendered at the same time (the exact equipment-checkout failure this rule generalizes).
        const actionCellRe = /<td\b[^>]*data-label\s*=\s*["']Actions["'][^>]*>[\s\S]*?<\/td\s*>/gi;
        let cell;
        while ((cell = actionCellRe.exec(src))) {
            const body = cell[0];
            const links = [...body.matchAll(/<c:a\b[^>]*>[\s\S]*?<\/c:a\s*>/gi)];
            if (links.length >= 2 && !/\bpb-row-actions\b/.test(body)) {
                findings.push({
                    file: rel, line: lineAt(src, cell.index), column: 0, severity: "warn", rule: "pbRowActionGroup",
                    message: "This Actions cell renders " + links.length + " action links without a .pb-row-actions wrapper. Wrap the links in <div class=\"pb-row-actions\"> so spacing, wrapping, destructive separation, and mobile reflow use the shipped component recipe."
                });
            }

            const labels = links.map(m => m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase());
            const hasCheckout = labels.includes("check out");
            const hasCheckin = labels.includes("check in");
            const conditional = /<c:(?:if|choose|when)\b/i.test(body) ||
                links.some(m => /\btest\s*=/.test(m[0]));
            if (hasCheckout && hasCheckin && !conditional) {
                findings.push({
                    file: rel, line: lineAt(src, cell.index), column: 0, severity: "warn", rule: "pbConflictingStateActions",
                    message: "\"Check out\" and \"Check in\" are both always visible for the same row. They are mutually exclusive state transitions: render only the action valid for the row's current status with c:if/c:choose or test=, then exercise both states."
                });
            }
        }

        if (fieldGroups >= 2 && !/\bpb-(?:stack|form-grid)\b/.test(src)) {
            findings.push({
                file: rel, line: 1, column: 0, severity: "warn", rule: "pbFormRhythm",
                message: "This fragment has " + fieldGroups + " .pb-field-group blocks but no .pb-stack or .pb-form-grid wrapper. Related fields will have no reliable vertical rhythm; wrap them and use .pb-form-card for a bounded operational form."
            });
        }
    }
}

// design-system.css is deliberately bundled as a recipe catalog for agents to consult. Loading or
// registering the whole file bloats small pals and couples them to dozens of unused components.
// Runtime CSS belongs in styles.css and contains only the tokens/base/component rules the pal uses.
function checkReferenceStylesheetNotShipped(workspaceDir, markupFiles, findings) {
    const reportedFiles = new Set();
    for (const folder of ["styles", "Styles"]) {
        const abs = path.join(workspaceDir, folder, "design-system.css");
        if (!fs.existsSync(abs)) continue;
        let identity = abs;
        try { const st = fs.statSync(abs); identity = st.dev + ":" + st.ino; } catch (e) { /* keep lexical path */ }
        if (reportedFiles.has(identity)) continue; // macOS case-insensitive styles/Styles alias
        reportedFiles.add(identity);
        findings.push({
            file: folder + "/design-system.css", line: 1, column: 0, severity: "error",
            rule: "referenceStylesheetShipped",
            message: "design-system.css is reference material, not a pal runtime asset. Remove it from the pal and copy only the tokens, base rules, and component recipes this pal actually uses into styles/styles.css (or Styles/styles.css)."
        });
    }

    for (const { rel, src } of markupFiles) {
        const re = /(?:href|src)\s*=\s*["'][^"']*design-system\.css(?:[?#][^"']*)?["']/ig;
        let m;
        while ((m = re.exec(src))) {
            findings.push({
                file: rel, line: lineAt(src, m.index), column: 0, severity: "error",
                rule: "referenceStylesheetShipped",
                message: "This page loads design-system.css, which is a reference catalog only. Link styles.css instead; it must contain the selected rules needed by this pal."
            });
        }
    }

    const manifestPath = path.join(workspaceDir, "pal.json");
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (e) { /* optional */ }
    const entries = manifest && manifest.styles && Array.isArray(manifest.styles.entry)
        ? manifest.styles.entry : [];
    for (const entry of entries) {
        const names = [entry && entry.string, entry && entry.Style && entry.Style.filename];
        if (!names.some(name => /(^|\/)design-system\.css$/i.test(String(name || "")))) continue;
        findings.push({
            file: "pal.json", line: 1, column: 0, severity: "error",
            rule: "referenceStylesheetShipped",
            message: "pal.json registers design-system.css. Remove that Style entry and register styles.css containing only the selected rules the pal uses."
        });
    }
}

const SYSTEM_FONT_FAMILIES = new Set([
    "systemui", "applesystem", "blinkmacsystemfont", "segoeui", "roboto", "sansserif",
    "uisansserif", "uimonospace", "sfmonoregular", "menlo", "monaco", "consolas",
    "liberationmono", "couriernew", "monospace", "serif", "uiserif", "georgia",
    "timesnewroman", "arial", "helvetica", "cursive", "fantasy", "math", "emoji"
]);

function normalizedFontName(value) {
    return String(value || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function declaredFontFamilies(value) {
    const families = [];
    for (const part of String(value || "").split(",")) {
        const raw = part.trim().replace(/\s*!important\s*$/i, "");
        if (!raw || /(?:var|calc|min|max|clamp)\s*\(/i.test(raw) || /[\d/]/.test(raw)) continue;
        const normalized = normalizedFontName(raw);
        if (!normalized || /^(?:inherit|initial|unset|revert|revertlayer|normal|bold|bolder|lighter)$/.test(normalized)) continue;
        families.push({ raw: raw.replace(/^['"]|['"]$/g, ""), normalized });
    }
    return families;
}

// Evidence: the 2026-07-16 equipment_checkout-cc-haiku-fe2ebbb-01 run declared Satoshi at
// styles/styles.css:26 without an import and silently fell back. The sanctioned loader is the
// line-1 Fontshare import documented at design-system-init/references/design-system.css:1-7.
function checkFontDeclaredNotLoaded(stylesheetFiles, findings) {
    for (const { rel, src } of stylesheetFiles) {
        const uncommented = src.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, " "));
        const imports = (uncommented.match(/@import\s+[^;]+;/gi) || []).join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
        const declaration = /(?:font-family|--ds-font-[\w-]+)\s*:\s*([^;}]+)/gi;
        const reported = new Set();
        let m;
        while ((m = declaration.exec(uncommented))) {
            for (const family of declaredFontFamilies(m[1])) {
                if (SYSTEM_FONT_FAMILIES.has(family.normalized) || imports.includes(family.normalized) || reported.has(family.normalized)) continue;
                reported.add(family.normalized);
                findings.push({
                    file: rel, line: lineAt(uncommented, m.index), column: 0, severity: "warn",
                    rule: "fontDeclaredNotLoaded",
                    message: "Font family \"" + family.raw + "\" is declared but no @import in this stylesheet loads it. Add the matching line-1 Fontshare import or use the system font stack."
                });
            }
        }
    }
}

// Evidence: the 2026-07-16 pi equipment-checkout eval shipped pb-motion.js and pb-ui.js with no
// consuming attributes. This is already prohibited by design-system-init/SKILL.md:19,304,359 and
// design-build/SKILL.md:168; this advisory automates that existing invariant.
function checkScriptWithoutConsumer(workspaceDir, markupFiles, findings) {
    const manifest = readUtf8(path.join(workspaceDir, "pal.json")) || "";
    const markup = markupFiles.map(f => f.src).join("\n");
    const scripts = [
        { name: "pb-motion.js", consumer: /\b(?:data-animate|data-ticker|data-typewriter|data-tilt|data-spotlight)\s*=/i },
        { name: "pb-ui.js", consumer: /\bdata-pb-theme-toggle(?:\s*=|\b)/i }
    ];
    for (const script of scripts) {
        const escaped = script.name.replace(".", "\\.");
        const linked = markupFiles.find(f => f.rel.startsWith("pages/") && new RegExp("(?:src|href)\\s*=\\s*['\"][^'\"]*" + escaped, "i").test(f.src));
        const registered = new RegExp(escaped, "i").test(manifest);
        if ((!registered && !linked) || script.consumer.test(markup)) continue;
        findings.push({
            file: registered ? "pal.json" : linked.rel,
            line: registered ? 1 : lineAt(linked.src, linked.src.search(new RegExp(escaped, "i"))),
            column: 0, severity: "warn", rule: "scriptWithoutConsumer",
            message: script.name + " is registered or linked but no markup uses its consuming attribute. Remove the unused script from pal.json/page links, or add the intended documented behavior."
        });
    }
}

// A pal-owned stylesheet must consume the design-system catalog, not quietly replace its
// control recipes with bespoke selectors or raw palette values.
function checkDesignSystemBypass(workspaceDir, findings) {
    const hasDesignSystem = fs.existsSync(path.join(workspaceDir, "DESIGN_SYSTEM.md")) ||
        fs.existsSync(path.join(workspaceDir, "styles", "design-system.css")) ||
        fs.existsSync(path.join(workspaceDir, "Styles", "design-system.css"));
    if (!hasDesignSystem) return;
    const reported = new Set();
    for (const folder of ["styles", "Styles"]) {
        const files = [];
        walkFiles(path.join(workspaceDir, folder), folder, files);
        for (const f of files) {
            if (path.extname(f.rel).toLowerCase() !== ".css" || /(^|\/)(?:design-system|spacing|styles)\.css$/i.test(f.rel)) continue;
            const css = readUtf8(f.abs);
            if (css == null) continue;
            const coreSelector = /(?:^|[}\s])(?:button|input\s*\[|select\b|textarea\b|\.pb-(?:btn|input|select|textarea|table))[^{}]*\{/im.test(css);
            const controlBlock = /(?:button|input\s*\[|select\b|textarea\b|\.pb-(?:btn|input|select|textarea|table))[^{}]*\{[^}]*#[0-9a-f]{3,8}\b/i.test(css);
            let identity = f.abs;
            try {
                const st = fs.statSync(f.abs);
                identity = st.dev + ":" + st.ino;
            } catch (e) { /* keep lexical path */ }
            if ((coreSelector || controlBlock) && !reported.has(identity)) {
                reported.add(identity);
                findings.push({
                    file: f.rel, line: 1, column: 0, severity: "warn", rule: "designSystemBypass",
                    message: f.rel + " redefines core control styling alongside the workspace design system. spacing.css and styles.css are exempt convention files; other stylesheets must prefer selected component recipes and semantic tokens from design-build. Remove bespoke control selectors/raw hex palette values or record an explicit override in the design brief."
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Structural design-system contracts.
// ---------------------------------------------------------------------------------------------

function checkStructuralClasses(markupFiles, findings) {
    for (const { rel, src } of markupFiles) {
        if (rel.startsWith("pages/")) {
            let hasPbMain = false;
            scanTags(src, tag => {
                const classes = attr(tag, "class");
                if (classes && classes.split(/\s+/).includes("pb-main")) hasPbMain = true;
            });
            if (!hasPbMain) findings.push({
                file: rel, line: 1, column: 0, severity: "warn", rule: "pbMain",
                message: "Page shell is missing pb-main; the shell must own the pb-main content region."
            });
            continue;
        }

        let hasPbSection = false;
        scanTags(src, tag => {
            const classes = attr(tag, "class");
            if (classes && classes.split(/\s+/).includes("pb-section")) hasPbSection = true;
        });
        if (!hasPbSection) findings.push({
            file: rel, line: 1, column: 0, severity: "warn", rule: "pbSection",
            message: "Fragment root is missing pb-section; every fragment root must include class pb-section."
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------------------------

function lintFileContracts(rel, src) {
    const findings = [];
    scanTags(src, (tag, pos) => {
        checkElSyntax(tag, rel, src, pos, findings);
        checkHrefAction(tag, rel, src, pos, findings);
        checkFormTag(tag, rel, src, pos, findings);
    });
    return findings;
}

function lintContracts(workspaceDir) {
    const findings = [];
    const markupFiles = collectMarkupFiles(workspaceDir);
    const workflowFiles = collectWorkflowFiles(workspaceDir);
    const stylesheetFiles = collectStylesheetFiles(workspaceDir);

    const listNames = collectListNames(workflowFiles);
    checkListNameContract(markupFiles, listNames, findings);
    checkReservedElNames(markupFiles, findings);

    checkAjaxTargetExists(markupFiles, findings);

    const actions = collectRoutedActions(workflowFiles);
    checkActionRouted(markupFiles, workflowFiles, actions, findings);
    checkStructuralClasses(markupFiles, findings);

    for (const { rel, src } of markupFiles) {
        findings.push(...lintFileContracts(rel, src));
        scanTags(src, (tag, pos) => {
            checkDestructiveConfirm(tag, rel, src, pos, findings);
        });
        checkStaleVendor(rel, src, findings);
    }

    for (const { rel, src } of workflowFiles) {
        checkAjaxTransport(rel, src, findings);
        checkPageResponseSource(rel, src, findings);
    }

    checkParamDropped(markupFiles, workflowFiles, findings);

    checkFragmentBinding(markupFiles, workflowFiles, findings);

    checkStaticFragmentExists(markupFiles, findings);

    checkReferenceStylesheetNotShipped(workspaceDir, markupFiles, findings);

    checkFontDeclaredNotLoaded(stylesheetFiles, findings);

    checkScriptWithoutConsumer(workspaceDir, markupFiles, findings);

    checkDesignSystemBypass(workspaceDir, findings);

    checkPbQualityHints(workspaceDir, markupFiles, findings);

    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return findings;
}

module.exports = { lintContracts, lintFileContracts };
