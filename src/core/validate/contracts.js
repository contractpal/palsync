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
const acorn = require("acorn");
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

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ---------------------------------------------------------------------------------------------
// Small string-distance helper for Check 6 (fabricated API methods).
// ---------------------------------------------------------------------------------------------

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
        let prev = dp[0]; dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = dp[j];
            dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
            prev = tmp;
        }
    }
    return dp[n];
}

// "Near match" is deliberately broader than raw edit-distance-2: the confirmed real bug
// (setDateValue for setDate) is a trailing-word EXTENSION of the real method name — edit
// distance 5, but an obvious typo once you see it's a prefix relationship. Catch both shapes.
function isNearMatch(m, candidate) {
    if (m === candidate) return false;
    if (Math.abs(m.length - candidate.length) > 8) return false;
    if (levenshtein(m, candidate) <= 2) return true;
    if (m.startsWith(candidate) || candidate.startsWith(m)) return true;
    return false;
}

function findSuggestion(m, allowlist) {
    const prefixCat = /^[a-z]+/.exec(m)[0];
    const sameCategory = allowlist.filter(c => c.startsWith(prefixCat));
    const pool = sameCategory.length ? sameCategory : allowlist;
    let best = null, bestScore = Infinity;
    for (const c of pool) {
        if (!isNearMatch(m, c)) continue;
        const score = levenshtein(m, c);
        if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
}

// ---------------------------------------------------------------------------------------------
// Check 6 allowlist — MANUALLY extracted from palbuilder-workflow/references/*.md +
// palbuilder-data/references/{datasets,payloads}.md (2026-07-06).
// If those docs gain/rename methods, update this list too — it is NOT generated.
// ---------------------------------------------------------------------------------------------
const KNOWN_API_METHODS = [
    // DataSet / DataView / filter / record read
    "getRecords", "getRecord", "getRecordCount", "getDataSet", "getDataView", "getDataList",
    "getData", "getUpload", "getDefaultValue", "getPersonalProfile", "getFullName",
    "getInt", "getBoolean", "getValue", "getId", "getUser", "getPal", "getPage", "getRequest",
    "getAction", "getTransaction", "getEnterprise", "getDateUtil", "getFormatter", "getValidator",
    "getAjaxFragment", "getHref",
    // create
    "createFilter", "createRecord", "createPayload", "createDataList", "createData",
    "createAjaxResponse", "createServiceRequest", "createGUID", "createBuffer",
    // add
    "addEqual", "addNotEqual", "addNotNull", "addNull", "addAnd", "addOr", "addColumn",
    "addDataList", "addDataMap", "addPayload",
    // set
    "setInt", "setBoolean", "setDate", "setColumnValue", "setContentType",
    // insert / update / delete / remove / find / sort / select
    "insertRecord", "updateRecord", "deleteRecord", "deleteRecords", "removeColumn",
    "findRecord", "sortAscending", "sortDescending", "selectColumns",
];
const KNOWN_API_SET = new Set(KNOWN_API_METHODS);

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
            if (hasAttr(tag, "list")) return; // string-split mode — different contract, not this check
            const name = attr(tag, "name");
            const id = attr(tag, "id");
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

            findings.push({ file: rel, line: lineAt(src, tag.end), column: 0, severity: "error", rule: "listNameContract", message });
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
            if (target == null || ids.has(target)) return;
            findings.push({
                file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "ajaxTargetExists",
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
            if (!name || name.includes("${")) return; // dynamic action name — can't check statically
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
// Check 4 — EL syntax in test="..." attributes.
// ---------------------------------------------------------------------------------------------

const EL_OP_MAP = [
    [/==/, "eq"], [/!=/, "ne"], [/>=/, "ge"], [/<=/, "le"], [/&gt;=/, "ge"], [/&lt;=/, "le"],
    [/&gt;/, "gt"], [/&lt;/, "lt"], [/>/, "gt"], [/</, "lt"],
];

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
                    "Fix: wrap the whole expression in ${...} and use the documented operators (eq ne gt lt ge le empty ! and or).") +
                " See the palbuilder-frontend skill, \"EL operators\"."
        });
        return;
    }

    const inner = /\$\{([^}]*)\}/.exec(value);
    const body = inner ? inner[1] : value;

    if (/\.\w+\(/.test(body)) {
        const bareEquiv = mechanicalBareFix(body.replace(/^\$\{|\}$/g, ""));
        findings.push({
            file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "elSyntax",
            message: "test=\"" + value + "\" — method-call syntax ('" + /\.\w+\(/.exec(body)[0].slice(1) +
                "...') is not available in PalBuilder's EL; there is no ternary/arithmetic/method-call support. " +
                (bareEquiv ? "Fix: test=\"" + bareEquiv + "\"." :
                    "Fix: compute the value in the workflow and bind a plain value, or use the `empty` operator.") +
                " See the palbuilder-frontend skill, \"EL operators\"."
        });
        return;
    }

    for (const [re, elOp] of EL_OP_MAP) {
        if (re.test(body)) {
            findings.push({
                file: rel, line: lineAt(src, pos), column: 0, severity: "error", rule: "elSyntax",
                message: "test=\"" + value + "\" — '" + re.source.replace(/\\/g, "") + "' is not an EL operator. " +
                    "PalBuilder's EL only supports eq/ne/gt/lt/ge/le/empty/!/and/or (string compare). " +
                    "Fix: replace it with '" + elOp + "' (e.g. test=\"${" + body.replace(re, " " + elOp + " ").replace(/\s+/g, " ").trim() + "}\"). " +
                    "See the palbuilder-frontend skill, \"EL operators\"."
            });
            return;
        }
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
        severity: destructive ? "error" : "warn",
        rule: "destructiveConfirm",
        message: msg,
    });
}

// ---------------------------------------------------------------------------------------------
// Check 6 — fabricated API methods in workflow JS.
// ---------------------------------------------------------------------------------------------

function walkAst(node, parent, visit) {
    if (!node || typeof node.type !== "string") return;
    visit(node, parent);
    for (const k of Object.keys(node)) {
        if (k === "loc" || k === "start" || k === "end" || k === "range") continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const c of v) walkAst(c, node, visit); }
        else if (v && typeof v.type === "string") walkAst(v, node, visit);
    }
}

const API_METHOD_RE = /^(get|set|add|create|insert|update|delete|remove|find|sort|select)[A-Z]/;

function checkUnknownApiMethod(rel, src, findings) {
    let ast;
    try { ast = acorn.parse(src, { ecmaVersion: "latest", locations: true, allowReturnOutsideFunction: true }); }
    catch (e) { return; } // workflowJs.js already reports syntax errors — don't double-report here.

    const localFunctionNames = new Set();
    walkAst(ast, null, (node) => {
        if (node.type === "FunctionDeclaration" && node.id) localFunctionNames.add(node.id.name);
    });

    walkAst(ast, null, (node) => {
        if (node.type !== "CallExpression") return;
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
        const prop = callee.property;
        if (!prop || prop.type !== "Identifier") return;
        const m = prop.name;
        if (!API_METHOD_RE.test(m)) return;
        if (KNOWN_API_SET.has(m) || localFunctionNames.has(m)) return;

        const line = prop.loc ? prop.loc.start.line : 0;
        const column = prop.loc ? prop.loc.start.column + 1 : 0;
        const suggestion = findSuggestion(m, KNOWN_API_METHODS);
        if (suggestion) {
            findings.push({
                file: rel, line, column, severity: "error", rule: "unknownApiMethod",
                message: "." + m + "(...) is not a documented PalBuilder API method — did you mean ." + suggestion +
                    "(...)? This will fail at runtime (or fail to compile) even though the file saves successfully. " +
                    "Fix: use ." + suggestion + "(...) instead. See the palbuilder-workflow/palbuilder-data API references."
            });
        } else {
            findings.push({
                file: rel, line, column, severity: "warn", rule: "unknownApiMethod",
                message: "." + m + "(...) is not in PalBuilder's documented API method set. It may be a fabricated " +
                    "method that will fail even though the file saves successfully. Verify it exists in the " +
                    "palbuilder-workflow/references/*.md or palbuilder-data/{datasets,payloads}.md before shipping."
            });
        }
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

// ---------------------------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------------------------

function lintContracts(workspaceDir) {
    const findings = [];
    const markupFiles = collectMarkupFiles(workspaceDir);
    const workflowFiles = collectWorkflowFiles(workspaceDir);

    const listNames = collectListNames(workflowFiles);
    checkListNameContract(markupFiles, listNames, findings);

    checkAjaxTargetExists(markupFiles, findings);

    const actions = collectRoutedActions(workflowFiles);
    checkActionRouted(markupFiles, workflowFiles, actions, findings);

    for (const { rel, src } of markupFiles) {
        scanTags(src, (tag, pos) => {
            checkElSyntax(tag, rel, src, pos, findings);
            checkHrefAction(tag, rel, src, pos, findings);
            checkFormTag(tag, rel, src, pos, findings);
            checkDestructiveConfirm(tag, rel, src, pos, findings);
        });
    }

    for (const { rel, src } of workflowFiles) {
        checkUnknownApiMethod(rel, src, findings);
        checkAjaxTransport(rel, src, findings);
    }

    checkParamDropped(markupFiles, workflowFiles, findings);

    checkFragmentBinding(markupFiles, workflowFiles, findings);

    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return findings;
}

module.exports = { lintContracts };
