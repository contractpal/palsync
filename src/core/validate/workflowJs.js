"use strict";
// Lint a PalBuilder workflow .js file against the RESTRICTED server-side compile engine.
// Source of truth: bundled-context/skills/palbuilder-core/references/es3-cheatsheet.md.
// These constructs SAVE fine over the API but FAIL TO COMPILE in the
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
            "c.createDataList(name, [cols]). See palbuilder-core/references/es3-cheatsheet.md."
    },
    letConst: {
        severity: "error",
        msg: "'let'/'const' — PalBuilder's workflow engine does NOT support them (pre-ES6). " +
            "Fix: use 'var'. Signal a constant with an UPPER_SNAKE_CASE name (var MAX_ROWS = 100;). " +
            "See palbuilder-core/references/es3-cheatsheet.md."
    },
    arrow: {
        severity: "warn",
        msg: "Arrow function (=>) — not confirmed supported by the workflow engine; the skill says to avoid it. " +
            "Fix: use a function declaration, function name(args) { ... }. Verify in the PalBuilder builder if unsure. " +
            "See palbuilder-core/references/es3-cheatsheet.md."
    },
    template: {
        severity: "warn",
        msg: "Template literal (backtick `${ }` string) — not confirmed supported by the workflow engine, and ${ } " +
            "also collides with PalBuilder's server-side EL. Fix: use string concatenation with + (\"x \" + y). " +
            "See palbuilder-core/references/es3-cheatsheet.md."
    },
    destructuring: {
        severity: "warn",
        msg: "Destructuring (var {a} = obj / var [a,b] = arr) — not confirmed supported by the workflow engine. " +
            "Fix: assign each variable explicitly (var a = obj.a;). See palbuilder-core/references/es3-cheatsheet.md."
    },
    forOf: {
        severity: "warn",
        msg: "for...of loop — not confirmed supported by the workflow engine. " +
            "Fix: use a classic indexed loop, for (var i = 0; i < arr.length; i++). See palbuilder-core/references/es3-cheatsheet.md."
    },
    forIn: {
        severity: "warn",
        msg: "for...in loop — not confirmed supported by the workflow engine. " +
            "Fix: iterate a DataList/DataSet with the platform API, or a classic indexed loop over an array. " +
            "See palbuilder-core/references/es3-cheatsheet.md."
    },
    hof: {
        severity: "warn",
        msg: "Array higher-order method (.map/.filter/.forEach/.reduce) — not confirmed supported by the workflow " +
            "engine. Fix: use a classic for loop, or the DataSet/DataList API for row work. See palbuilder-core/references/es3-cheatsheet.md."
    },
    bannedMethod: {
        severity: "error",
        msg: "Unsupported ES5+/ES6 String/Array method — PalBuilder's workflow engine does NOT support this method. " +
            "Fix: use an ES3 equivalent such as indexOf/substring, or write a classic loop for the operation. " +
            "See palbuilder-core/references/es3-cheatsheet.md (unsupported String/Array methods)."
    },
    // Evidence: palbuilder-core/references/es3-cheatsheet.md documents `.length` as a
    // property in its supported syntax, loops, and replacement examples (lines 21, 119, 288).
    lengthCall: {
        severity: "warn",
        msg: "`.length()` calls length as a function, but length is a property; this throws at runtime. " +
            "Fix: drop the parentheses and use `.length`. See palbuilder-core/references/es3-cheatsheet.md."
    },
    // Evidence: palbuilder-workflow/references/legacy-api-reference.md documents filter-based
    // findRecord(filter), findRecord(column, value), and getRecords(filter) as distinct valid paths.
    findRecordSelectColumns: {
        severity: "warn",
        msg: "This record column was excluded by the filter's selectColumns(), so get() cannot read it from " +
            "findRecord(filter). Fix: add the column to selectColumns(), or remove the projection when the full " +
            "record is required. See palbuilder-workflow/references/legacy-api-reference.md."
    },
    funcExpr: {
        severity: "warn",
        msg: "Function expression (var f = function(){}) — not confirmed supported by the workflow engine. " +
            "Fix: use a function declaration, function f(args) { ... }. See palbuilder-core/references/es3-cheatsheet.md."
    },
    implicitGlobal: {
        severity: "error",
        msg: "Assignment to an undeclared workflow variable — PalBuilder's workflow compiler treats implicit globals as " +
            "\"Variable <name> not declared\" and can then report the misleading \"Function run doesn't return value\". " +
            "Fix: declare the variable with 'var' before assigning it. For run(controller), put the standard globals at " +
            "the top of the file (for example: var c; var pal; var page; var request; var payload; var ajax; var frag;) " +
            "then assign them at the top of run(). See palbuilder-core/references/es3-cheatsheet.md."
    },
    duplicateCase: {
        severity: "warn",
        msg: "Duplicate switch case label — PalBuilder may compile this, but one branch is unreachable and the intended " +
            "handler is ambiguous. Review the branches; normally keep one case, merge any needed statements into it, " +
            "and delete the duplicate branch."
    },
    fragClobber: {
        severity: "error",
        msg: "frag clobber: the handler sets `frag` to more than one fragment before returning, so an unconditional " +
            "follow-up render call overwrites the validation-selected fragment."
    }
};

const HOF_NAMES = new Set(["map", "filter", "forEach", "reduce", "reduceRight", "some", "every", "find", "findIndex", "flatMap"]);
const BANNED_METHODS = new Set(["trim", "trimStart", "trimEnd", "includes", "startsWith", "endsWith", "repeat", "padStart", "padEnd"]);

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

function createScope(parent) {
    return { parent, names: new Set() };
}

function addPatternName(scope, node) {
    if (!scope || !node) return;
    if (node.type === "Identifier") {
        scope.names.add(node.name);
    } else if (node.type === "RestElement") {
        addPatternName(scope, node.argument);
    } else if (node.type === "AssignmentPattern") {
        addPatternName(scope, node.left);
    } else if (node.type === "ArrayPattern") {
        for (const e of node.elements || []) addPatternName(scope, e);
    } else if (node.type === "ObjectPattern") {
        for (const p of node.properties || []) {
            if (!p) continue;
            addPatternName(scope, p.type === "Property" ? p.value : p.argument);
        }
    }
}

function isDeclared(scope, name) {
    for (let s = scope; s; s = s.parent) {
        if (s.names.has(name)) return true;
    }
    return false;
}

function collectScopeDeclarations(node, scope) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "FunctionDeclaration") {
        if (node.id) scope.names.add(node.id.name);
        return; // declarations inside the function belong to that function's own scope
    }
    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
        return; // declarations inside the function expression are not visible here
    }
    if (node.type === "VariableDeclarator") {
        addPatternName(scope, node.id);
    }
    for (const k of Object.keys(node)) {
        if (k === "loc" || k === "start" || k === "end" || k === "range") continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const c of v) collectScopeDeclarations(c, scope); }
        else if (v && typeof v.type === "string") collectScopeDeclarations(v, scope);
    }
}

function scanImplicitGlobals(rel, node, scope, findings) {
    if (!node || typeof node.type !== "string") return;

    if (node.type === "Program") {
        const childScope = createScope(scope);
        for (const stmt of node.body || []) collectScopeDeclarations(stmt, childScope);
        for (const stmt of node.body || []) scanImplicitGlobals(rel, stmt, childScope, findings);
        return;
    }

    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
        const childScope = createScope(scope);
        if (node.type !== "ArrowFunctionExpression" && node.id) childScope.names.add(node.id.name);
        for (const p of node.params || []) addPatternName(childScope, p);
        collectScopeDeclarations(node.body, childScope);
        scanImplicitGlobals(rel, node.body, childScope, findings);
        return;
    }

    if (node.type === "AssignmentExpression" && node.left && node.left.type === "Identifier" && !isDeclared(scope, node.left.name)) {
        findings.push(finding(rel, node.left, "implicitGlobal", "(\"" + node.left.name + "\" is assigned but never declared)"));
    }

    for (const k of Object.keys(node)) {
        if (k === "loc" || k === "start" || k === "end" || k === "range") continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const c of v) scanImplicitGlobals(rel, c, scope, findings); }
        else if (v && typeof v.type === "string") scanImplicitGlobals(rel, v, scope, findings);
    }
}

// Collect every distinct string literal assigned to `frag` directly inside a function body
// (not nested inner functions). Multi-value assignments are the signature of a handler that
// validates, sets `frag` on failure, and returns success/failure.
function collectFragLiteralAssignments(funcNode) {
    const literals = new Set();
    function visit(node) {
        if (!node || typeof node.type !== "string") return;
        if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") return;
        if (node.type === "AssignmentExpression" && node.left && node.left.type === "Identifier" && node.left.name === "frag" &&
            node.right && node.right.type === "Literal" && typeof node.right.value === "string") {
            literals.add(node.right.value);
        }
        for (const k of Object.keys(node)) {
            if (k === "loc" || k === "start" || k === "end" || k === "range") continue;
            const v = node[k];
            if (Array.isArray(v)) { for (const c of v) visit(c); }
            else if (v && typeof v.type === "string") visit(v);
        }
    }
    if (funcNode.body) visit(funcNode.body);
    return literals;
}

function flattenStatements(stmts) {
    const out = [];
    for (const s of stmts || []) {
        if (s && s.type === "BlockStatement") out.push(...flattenStatements(s.body));
        else out.push(s);
    }
    return out;
}

function getTopLevelCallName(stmt) {
    if (!stmt) return null;
    if (stmt.type === "ExpressionStatement" && stmt.expression && stmt.expression.type === "CallExpression" &&
        stmt.expression.callee && stmt.expression.callee.type === "Identifier") {
        return stmt.expression.callee;
    }
    if (stmt.type === "VariableDeclaration") {
        for (const d of stmt.declarations || []) {
            if (d.init && d.init.type === "CallExpression" && d.init.callee && d.init.callee.type === "Identifier") {
                return d.init.callee;
            }
        }
    }
    if (stmt.type === "ReturnStatement" && stmt.argument && stmt.argument.type === "CallExpression" &&
        stmt.argument.callee && stmt.argument.callee.type === "Identifier") {
        return stmt.argument.callee;
    }
    return null;
}

function checkFragClobber(rel, ast, findings) {
    const validators = new Set();
    const fragAssigners = new Set();

    walk(ast, null, null, (node) => {
        if (node.type === "FunctionDeclaration" && node.id && node.id.name) {
            const literals = collectFragLiteralAssignments(node);
            const name = node.id.name;
            if (literals.size > 1) validators.add(name);
            if (literals.size > 0) fragAssigners.add(name);
        }
    });

    walk(ast, null, null, (node) => {
        if (node.type !== "SwitchStatement") return;
        for (const c of node.cases || []) {
            const stmts = flattenStatements(c.consequent);
            let triggerName = null;
            let triggerIdx = -1;
            for (let i = 0; i < stmts.length; i++) {
                const s = stmts[i];
                if (s.type === "BreakStatement" || s.type === "ReturnStatement") break;
                const callee = getTopLevelCallName(s);
                if (callee && validators.has(callee.name)) {
                    triggerName = callee.name;
                    triggerIdx = i;
                    break;
                }
            }
            if (triggerIdx === -1) continue;
            for (let j = triggerIdx + 1; j < stmts.length; j++) {
                const s = stmts[j];
                if (s.type === "BreakStatement" || s.type === "ReturnStatement") break;
                const callee = getTopLevelCallName(s);
                if (!callee) continue;
                const name = callee.name;
                if (name !== triggerName && fragAssigners.has(name)) {
                    findings.push(finding(rel, callee, "fragClobber",
                        "Wrap the follow-up render in the handler's success return: `if (" + triggerName + "()) { " + name + "(); }`."));
                }
            }
        }
    });
}

function walkFunctionBody(node, visit) {
    if (!node || typeof node.type !== "string") return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) {
                if (child && /^Function/.test(child.type)) continue;
                walkFunctionBody(child, visit);
            }
        } else if (value && typeof value.type === "string" && !/^Function/.test(value.type)) {
            walkFunctionBody(value, visit);
        }
    }
}

function memberCall(node, name) {
    return node && node.type === "CallExpression" && node.callee &&
        node.callee.type === "MemberExpression" && !node.callee.computed &&
        node.callee.property && node.callee.property.name === name;
}

function checkFindRecordSelectColumns(rel, ast, findings) {
    walk(ast, null, null, (func) => {
        if (!/^Function/.test(func.type) || !func.body) return;
        const filters = new Map();
        const records = new Map();
        const gets = [];

        walkFunctionBody(func.body, (node) => {
            if (node.type === "VariableDeclarator" && node.id && node.id.type === "Identifier") {
                const name = node.id.name;
                if (memberCall(node.init, "createFilter")) {
                    if (filters.has(name)) filters.get(name).invalid = true;
                    else filters.set(name, { columns: null, invalid: false, selectedAt: null });
                } else if (filters.has(name)) {
                    filters.get(name).invalid = true;
                }

                if (memberCall(node.init, "findRecord") && node.init.arguments.length === 1 &&
                    node.init.arguments[0].type === "Identifier") {
                    const filter = filters.get(node.init.arguments[0].name);
                    if (filter) {
                        const duplicate = records.has(name);
                        if (duplicate) records.get(name).invalid = true;
                        records.set(name, { filter, invalid: duplicate, start: node.init.end, queryStart: node.init.start });
                    }
                } else if (records.has(name)) {
                    records.get(name).invalid = true;
                }
            }

            if (node.type === "AssignmentExpression" && node.left && node.left.type === "Identifier") {
                if (filters.has(node.left.name)) filters.get(node.left.name).invalid = true;
                if (records.has(node.left.name)) records.get(node.left.name).invalid = true;
            }

            if (node.type !== "CallExpression" || !node.callee || node.callee.type !== "MemberExpression") return;
            const member = node.callee;
            const objectName = member.object && member.object.type === "Identifier" ? member.object.name : null;
            if (member.computed) {
                if (filters.has(objectName)) filters.get(objectName).invalid = true;
                if (records.has(objectName)) records.get(objectName).invalid = true;
                if (node.arguments.length === 1 && node.arguments[0].type === "Identifier" && filters.has(node.arguments[0].name)) {
                    filters.get(node.arguments[0].name).invalid = true;
                }
                return;
            }

            if (member.property.name === "selectColumns" && filters.has(objectName)) {
                const filter = filters.get(objectName);
                const arg = node.arguments.length === 1 ? node.arguments[0] : null;
                if (filter.columns || !arg || arg.type !== "ArrayExpression" ||
                    arg.elements.some(e => !e || e.type !== "Literal" || typeof e.value !== "string")) {
                    filter.invalid = true;
                } else {
                    filter.columns = new Set(arg.elements.map(e => e.value));
                    filter.selectedAt = node.end;
                }
            }

            if (member.property.name === "get" && records.has(objectName)) {
                const record = records.get(objectName);
                const arg = node.arguments.length === 1 ? node.arguments[0] : null;
                if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") {
                    record.invalid = true;
                } else if (node.start > record.start) {
                    gets.push({ record, arg });
                }
            }
        });

        for (const item of gets) {
            const record = item.record;
            if (!record.invalid && !record.filter.invalid && record.filter.columns &&
                record.filter.selectedAt < record.queryStart &&
                !record.filter.columns.has(item.arg.value)) {
                findings.push(finding(rel, item.arg, "findRecordSelectColumns", "(missing column '" + item.arg.value + "')"));
            }
        }
    });
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

    scanImplicitGlobals(rel, ast, null, findings);

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
                if (node.callee && node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.property) {
                    if (HOF_NAMES.has(node.callee.property.name)) {
                        findings.push(finding(rel, node.callee.property, "hof", "(.'" + node.callee.property.name + "')"));
                    } else if (BANNED_METHODS.has(node.callee.property.name)) {
                        findings.push(finding(rel, node.callee.property, "bannedMethod", "(.'" + node.callee.property.name + "()')"));
                    } else if (node.callee.property.name === "length") {
                        findings.push(finding(rel, node.callee.property, "lengthCall"));
                    }
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

    checkFragClobber(rel, ast, findings);
    checkFindRecordSelectColumns(rel, ast, findings);

    // Stable order: by line, then column.
    findings.sort((a, b) => a.line - b.line || a.column - b.column);
    return findings;
}

module.exports = { lintWorkflowJs, RULES };
