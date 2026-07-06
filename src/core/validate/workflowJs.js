"use strict";
// Lint a PalBuilder workflow .js file against the RESTRICTED server-side compile engine.
// Source of truth: bundled-context/skills/palbuilder-backend/SKILL.md ("Workflow JS engine —
// supported syntax"). These constructs SAVE fine over the API but FAIL TO COMPILE in the
// builder — the exact silent-failure class pal_validate exists to catch before a push.
//
// Severity:
//   "error" = CONFIRMED rejected by the engine (object literals, let/const). Blocks push.
//   "warn"  = strongly-suspected rejected / unverified ES6 the skill says to avoid (arrow fns,
//             template literals, destructuring, for-of/in, array HOFs, function expressions).
//             Reported but does NOT block a push (the agent decides) — calibrated so the lint
//             never cries wolf on something that turns out to work.
//
// Every finding carries a full-sentence message a literal-minded agent can act on, the fix,
// and a skill pointer — never a bare code.
const acorn = require("acorn");

// Messages are written for the least capable agent: state the problem, why it fails, and the
// exact PalBuilder-native replacement. No jargon-only codes.
const RULES = {
    // CONFIRMED unsupported (platform team, June 2026): object literals are not used in
    // PalBuilder workflows — the compile engine rejects them. Note the failure is INVISIBLE to
    // the save API (a file full of object literals saves "successfully"; the live ISR pal's
    // main.js carries 63 of them), which is exactly why this must block a push here.
    objectLiteral: {
        severity: "error",
        msg: "Object literal { ... } — PalBuilder's workflow compile engine does NOT support object literals. " +
            "The save will succeed but the workflow will FAIL TO COMPILE in the builder (\"Objects not supported\" plus " +
            "\"Variable <name> not declared\" for each property). Fix: for a key→value map use c.createData() with .get()/.set(); " +
            "for a record use pal.getDataSet(name).createRecord() then .set(col, value); for a fixed list use " +
            "c.createDataList(name, [cols]). See the palbuilder-backend skill, \"NEVER use object literals\"."
    },
    letConst: {
        severity: "error",
        msg: "'let'/'const' — PalBuilder's workflow engine does NOT support them (pre-ES6). " +
            "Fix: use 'var'. Signal a constant with an UPPER_SNAKE_CASE name (var MAX_ROWS = 100;). " +
            "See the palbuilder-backend skill, \"let / const are not available\"."
    },
    arrow: {
        severity: "warn",
        msg: "Arrow function (=>) — not confirmed supported by the workflow engine; the skill says to avoid it. " +
            "Fix: use a function declaration, function name(args) { ... }. Verify in the PalBuilder builder if unsure. " +
            "See the palbuilder-backend skill, \"Unsupported until verified\"."
    },
    template: {
        severity: "warn",
        msg: "Template literal (backtick `${ }` string) — not confirmed supported by the workflow engine, and ${ } " +
            "also collides with PalBuilder's server-side EL. Fix: use string concatenation with + (\"x \" + y). " +
            "See the palbuilder-backend skill, \"Unsupported until verified\"."
    },
    destructuring: {
        severity: "warn",
        msg: "Destructuring (var {a} = obj / var [a,b] = arr) — not confirmed supported by the workflow engine. " +
            "Fix: assign each variable explicitly (var a = obj.a;). See the palbuilder-backend skill."
    },
    forOf: {
        severity: "warn",
        msg: "for...of loop — not confirmed supported by the workflow engine. " +
            "Fix: use a classic indexed loop, for (var i = 0; i < arr.length; i++). See the palbuilder-backend skill."
    },
    forIn: {
        severity: "warn",
        msg: "for...in loop — not confirmed supported by the workflow engine. " +
            "Fix: iterate a DataList/DataSet with the platform API, or a classic indexed loop over an array. " +
            "See the palbuilder-backend skill."
    },
    hof: {
        severity: "warn",
        msg: "Array higher-order method (.map/.filter/.forEach/.reduce) — not confirmed supported by the workflow " +
            "engine. Fix: use a classic for loop, or the DataSet/DataList API for row work. See the palbuilder-backend skill."
    },
    funcExpr: {
        severity: "warn",
        msg: "Function expression (var f = function(){}) — not confirmed supported by the workflow engine. " +
            "Fix: use a function declaration, function f(args) { ... }. See the palbuilder-backend skill."
    },
    duplicateCase: {
        severity: "error",
        msg: "Duplicate switch case label — this action branch is defined more than once in the same switch. " +
            "PalBuilder may compile it, but only one branch can be the intended handler and reviewers have already " +
            "missed duplicate action code in passing builds. Fix: keep one case, merge any needed statements into it, " +
            "and delete the duplicate branch."
    }
};

const HOF_NAMES = new Set(["map", "filter", "forEach", "reduce", "reduceRight", "some", "every", "find", "findIndex", "flatMap"]);

function finding(rel, node, ruleKey, extra) {
    const r = RULES[ruleKey];
    const line = node && node.loc ? node.loc.start.line : 0;
    const col = node && node.loc ? node.loc.start.column + 1 : 0;
    return { file: rel, line, column: col, severity: r.severity, rule: ruleKey, message: r.msg + (extra ? " " + extra : "") };
}

// Walk every AST node, invoking visit(node, parent, key). Plain recursion (no acorn-walk dep).
function walk(node, parent, key, visit) {
    if (!node || typeof node.type !== "string") return;
    visit(node, parent, key);
    for (const k of Object.keys(node)) {
        if (k === "loc" || k === "start" || k === "end" || k === "range") continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const c of v) walk(c, node, k, visit); }
        else if (v && typeof v.type === "string") walk(v, node, k, visit);
    }
}

// Lint one workflow file's source. rel is the display path (e.g. "workflows/main.js").
function lintWorkflowJs(rel, source) {
    const findings = [];
    let ast;
    try {
        ast = acorn.parse(source, { ecmaVersion: "latest", locations: true, allowReturnOutsideFunction: true });
    } catch (e) {
        // A genuine syntax error the engine would also reject. Report with the parser's location.
        const line = e && e.loc ? e.loc.line : 0;
        const col = e && e.loc ? e.loc.column + 1 : 0;
        return [{
            file: rel, line, column: col, severity: "error", rule: "parseError",
            message: "JavaScript syntax error: " + (e && e.message ? e.message.replace(/\s*\(\d+:\d+\)\s*$/, "") : String(e)) +
                ". This file will not compile. Fix the syntax (the PalBuilder builder will report the same error)."
        }];
    }

    walk(ast, null, null, (node, parent, key) => {
        switch (node.type) {
            case "ObjectExpression":
                // Ignore an empty object used purely as an arg sentinel? No — even {} is rejected.
                findings.push(finding(rel, node, "objectLiteral"));
                break;
            case "VariableDeclaration":
                if (node.kind === "let" || node.kind === "const") findings.push(finding(rel, node, "letConst", "(found '" + node.kind + "')"));
                break;
            case "ArrowFunctionExpression":
                findings.push(finding(rel, node, "arrow"));
                break;
            case "TemplateLiteral":
                // Skip tagged-template edge; still flag — engine support is unconfirmed either way.
                findings.push(finding(rel, node, "template"));
                break;
            case "ObjectPattern":
                findings.push(finding(rel, node, "destructuring"));
                break;
            case "ArrayPattern":
                // Only flag array destructuring in declarations/params, not e.g. catch—rare anyway.
                findings.push(finding(rel, node, "destructuring"));
                break;
            case "ForOfStatement":
                findings.push(finding(rel, node, "forOf"));
                break;
            case "ForInStatement":
                findings.push(finding(rel, node, "forIn"));
                break;
            case "FunctionExpression":
                // A function EXPRESSION assigned to a var/property. Declarations are FunctionDeclaration
                // (fine) and aren't matched here. Method shorthand lives in objects (already flagged).
                if (parent && (parent.type === "VariableDeclarator" || parent.type === "AssignmentExpression")) {
                    findings.push(finding(rel, node, "funcExpr"));
                }
                break;
            case "CallExpression":
                if (node.callee && node.callee.type === "MemberExpression" && !node.callee.computed &&
                    node.callee.property && HOF_NAMES.has(node.callee.property.name)) {
                    findings.push(finding(rel, node.callee.property, "hof", "(.'" + node.callee.property.name + "')"));
                }
                break;
            case "SwitchStatement": {
                const seen = {};
                for (const c of node.cases || []) {
                    if (!c.test) continue;
                    if (c.test.type !== "Literal" || typeof c.test.value !== "string") continue;
                    const label = c.test.value;
                    if (seen[label]) {
                        findings.push(finding(rel, c, "duplicateCase", "(duplicate case \"" + label +
                            "\"; first defined on line " + seen[label] + ")"));
                    } else {
                        seen[label] = c.loc ? c.loc.start.line : 0;
                    }
                }
                break;
            }
            default: break;
        }
    });
    // Stable order: by line, then column.
    findings.sort((a, b) => a.line - b.line || a.column - b.column);
    return findings;
}

module.exports = { lintWorkflowJs, RULES };
