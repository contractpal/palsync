"use strict";
// pal_spec_lint core: automate the MECHANICAL half of pal-spec's reality check (references/
// reality-check.md). It does NOT replace judgment — capability→primitive mapping, component-
// exists-in-COMPONENTS.md, and scope honesty stay manual. It catches the deterministic defects:
// placeholders, dead links, §8a key/type/size/indexability, §5 dataset references, §12 floor.
//
// Severity: HARD_FLAG (keeps the spec draft per the gate) | FLAG (soft, ship as a caveat) | NOTE.
const fs = require("fs");
const path = require("path");

// --- PalBuilder dataset types (source of truth: bundled-context/skills/pal-spec/references/
// palbuilder-types.md; the stored-type constants are "serialized in all pals — do not change", so
// this stays stable). specLint.test.js re-parses that reference and asserts these match, so drift
// is caught rather than silently diverging. ---
const STORED_TYPES = new Set([
    "String", "Char", "Text", "Medium text",
    "DateOnly", "Date", "DateTimeMS",
    "Boolean",
    "Tiny integer", "Small integer", "Medium integer", "Number", "Big Number",
    "Tiny unsigned integer", "Small unsigned integer", "Medium unsigned integer", "Unsigned integer", "Big unsigned integer",
    "Decimal", "Encrypted",
    "File", "File Encrypted", "Remote File", "Remote File Encrypted",
    "Primary key", "Pal id", "Pal id auto populate", "Transaction id", "Transaction id auto populate", "Profile id", "Profile id auto populate"
]);
// Picker labels that are NOT themselves valid stored strings -> a spec using one is a picker-label
// error; rewrite to the stored string. ("Date" is omitted deliberately: it is BOTH a picker label
// (->DateOnly) and a valid stored type (date+time), so it passes as stored and is never flagged.)
const PICKER_LABEL_TO_STORED = { "Varchar": "String", "Integer": "Number", "Datetime": "Date", "Datetime ms": "DateTimeMS", "Big integer": "Big Number" };
const NON_INDEXABLE = new Set(["Encrypted", "Text", "Medium text", "File", "File Encrypted", "Remote File", "Remote File Encrypted"]);
const SIZE_TYPES = new Set(["String", "Char", "Decimal"]);

// --- lightweight SPEC.md parser: split into sections by "## N. Title" headings ---
function parseSpec(text) {
    const lines = text.split(/\r?\n/);
    const sections = {}; // num -> { num, title, start, end, body }
    let cur = null;
    lines.forEach((ln, i) => {
        const m = ln.match(/^##\s+(\d+)\.\s*(.*)$/);
        if (m) {
            if (cur) cur.end = i;
            cur = { num: Number(m[1]), title: m[2].trim(), start: i + 1, end: lines.length, bodyLines: [] };
            sections[cur.num] = cur;
        } else if (cur) cur.bodyLines.push({ line: i + 1, text: ln });
    });
    // Addressable subsections: a ### <n><letter> heading inside a numbered
    // section creates an extra entry keyed "n<letter>" (e.g. 8a, 8b) while
    // the parent section keeps its full body unchanged.
    const parents = Object.values(sections);
    for (const parent of parents) {
        const heads = [];
        parent.bodyLines.forEach((b, idx) => {
            const t = b.text.trim();
            const m = t.match(/^###\s*(\d+)([a-zA-Z])\b/);
            if (m) {
                const n = Number(m[1]);
                if (n !== parent.num) return;
                const key = String(n) + m[2].toLowerCase();
                const title = t.replace(/^###\s*\d+[a-zA-Z]\b[\s.]*/, "").trim();
                heads.push({ idx, key, title, line: b.line });
            }
        });
        for (let hi = 0; hi < heads.length; hi++) {
            const head = heads[hi];
            const nextIdx = hi + 1 < heads.length ? heads[hi + 1].idx : parent.bodyLines.length;
            const slice = parent.bodyLines.slice(head.idx + 1, nextIdx);
            sections[head.key] = {
                num: head.key,
                title: head.title,
                start: head.line + 1,
                end: nextIdx < parent.bodyLines.length ? parent.bodyLines[nextIdx].line - 1 : parent.end,
                bodyLines: slice.slice(),
                parent: parent.num
            };
        }
    }
    return { lines, sections };
}

// --- spec ref token handling (resolver exported for taskState) ---
function normalizeSpecRefToken(raw) {
    const s = String(raw).trim();
    if (!s) return null;
    let t = s;
    if (t.charAt(0) === "\u00A7") t = t.slice(1).trim();
    if (!/^\d+[a-zA-Z]?$/.test(t)) return null;
    return t.toLowerCase();
}

function resolveSpecSection(parsed, token) {
    const norm = normalizeSpecRefToken(token);
    if (!norm) return null;
    const secs = parsed && parsed.sections ? parsed.sections : parsed;
    if (!secs) return null;
    if (Object.prototype.hasOwnProperty.call(secs, norm)) return secs[norm];
    const asNum = Number(norm);
    if (!isNaN(asNum) && Object.prototype.hasOwnProperty.call(secs, asNum)) return secs[asNum];
    return null;
}

function resolveSpecRefs(parsed, refString) {
    const input = String(refString == null ? "" : refString);
    const parts = input.split(",");
    const resolved = [];
    for (let raw of parts) {
        const trimmed = raw.trim();
        if (!trimmed) {
            return { ok: false, token: String(refString).trim(), error: `Malformed spec ref "${String(refString).trim()}" \u2014 empty component between commas` };
        }
        const sec = resolveSpecSection(parsed, trimmed);
        if (!sec) return { ok: false, token: trimmed, error: `Unresolvable spec ref "${trimmed}"` };
        resolved.push(sec);
    }
    if (resolved.length === 0) {
        return { ok: false, token: String(refString).trim(), error: `Spec ref "${String(refString).trim()}" does not resolve to any SPEC.md section` };
    }
    return { ok: true, sections: resolved };
}

// Parse markdown table rows in a set of body lines -> [{ line, cells: [...] }] (separator rows dropped).
function tableRows(bodyLines) {
    const out = [];
    for (const b of bodyLines) {
        const t = b.text.trim();
        if (t.charAt(0) !== "|") continue;
        if (/^\|[\s:|-]+\|?\s*$/.test(t)) continue; // |---|---| separator
        const cells = t.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
        out.push({ line: b.line, cells });
    }
    return out;
}

function bodyText(section) { return section ? section.bodyLines.map(b => b.text).join("\n") : ""; }

function parseFrontmatter(text) {
    const fields = {};
    for (const line of String(text).split(/\r?\n/)) {
        if (/^##\s/.test(line)) break;
        const match = line.match(/^([a-z][a-z_ ]*):\s*(.*?)\s*$/i);
        if (match) fields[match[1].toLowerCase()] = match[2];
    }
    return fields;
}

const EXECUTION_STATUSES = new Set(["todo", "in_progress", "done", "blocked", "needs-frontier", "needs-human"]);
const EXECUTION_TIERS = new Set(["cheap", "standard", "frontier"]);

// Task IDs are user-facing labels, but comparisons are case-insensitive throughout the execution
// contract. Keep original spelling for Markdown rewrites and output.
function normalizeExecutionTaskId(id) { return String(id == null ? "" : id).trim().toLowerCase(); }

// --- the lint ---
function lintSpec(text, { workspaceDir, hasBaseline } = {}) {
    const findings = [];
    const add = (severity, section, line, summary, fix) => findings.push({ severity, section, line, summary, fix });
    const { lines, sections } = parseSpec(text);
    const baselinePresent = typeof hasBaseline === "boolean" ? hasBaseline
        : (workspaceDir ? fs.existsSync(path.join(workspaceDir, "baseline", "baseline.json")) : false);

    // A. Placeholders anywhere (TBD / placeholder / decide later / ???).
    lines.forEach((ln, i) => {
        const m = ln.match(/\b(TBD|placeholder|decide later)\b|\?\?\?/i);
        if (m) add("HARD_FLAG", "any", i + 1, "Placeholder text \"" + (m[0]) + "\" — the spec has an unresolved gap.", "Resolve it: fill the real decision/value, or move it to §2 as an OPEN question with the task it blocks.");
    });

    // B. Dead links: single-token §4 destinations ("... → <dest>") must resolve to a §3 row
    //    (file name or workflow action). Multi-word destinations are prose and skipped.
    const s3 = sections[3], s4 = sections[4];
    const routeTokens = new Set();
    if (s3) for (const r of tableRows(s3.bodyLines)) {
        for (const cell of r.cells) {
            for (const f of (cell.match(/[A-Za-z0-9_-]+\.html?/g) || [])) routeTokens.add(f.toLowerCase());
        }
        // workflow action column often holds action names like showForm / list
        const actionCell = r.cells[3] || "";
        for (const a of (actionCell.match(/[A-Za-z][A-Za-z0-9_]*/g) || [])) routeTokens.add(a.toLowerCase());
    }
    if (s4 && s3) {
        for (const b of s4.bodyLines) {
            const dests = b.text.match(/(?:->|→)\s*([^\s,;`]+)/g) || [];
            for (const d of dests) {
                const dest = d.replace(/(?:->|→)\s*/, "").replace(/`/g, "").replace(/[.,;]+$/, "").trim();
                if (!dest || /\s/.test(dest)) continue;         // prose destination — skip
                if (/^https?:\/\//i.test(dest) || dest === "#") continue; // external / placeholder anchor
                const key = dest.toLowerCase().replace(/^\//, "");
                if (!routeTokens.has(key) && !routeTokens.has(key + ".html")) {
                    add("HARD_FLAG", "§4/§3", b.line, "Dead link: CTA destination \"" + dest + "\" has no matching §3 sitemap row (file or workflow action).", "Add a §3 row for \"" + dest + "\", or fix the destination to name an existing page/action.");
                }
            }
        }
    }

    // §8a / §8b dataset parsing.
    const s8 = sections[8];
    const declared = new Set(); // all dataset names (8a + 8b), lowercase
    const created = [];         // 8a datasets: { name, line, fields: [{name,type,size,notes,line}] }
    if (s8) {
        // Split §8 body into 8a vs 8b halves.
        let region = null; // "a" | "b"
        let curDs = null;
        for (const b of s8.bodyLines) {
            const t = b.text.trim();
            if (/^###\s*8a\b/i.test(t)) { region = "a"; curDs = null; continue; }
            if (/^###\s*8b\b/i.test(t)) { region = "b"; curDs = null; continue; }
            const dm = t.match(/^###\s*dataset:\s*([A-Za-z0-9_]+)/i);
            if (dm) {
                const name = dm[1];
                declared.add(name.toLowerCase());
                if (region === "a" || region === null) { curDs = { name, line: b.line, fields: [] }; created.push(curDs); }
                else curDs = null;
                continue;
            }
            // field rows only meaningful inside a created (8a) dataset table
            if (curDs && t.charAt(0) === "|" && !/^\|[\s:|-]+\|?\s*$/.test(t)) {
                const cells = t.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
                if (cells[0].toLowerCase() === "field") continue; // header
                curDs.fields.push({ name: cells[0], type: cells[1] || "", size: cells[2] || "", notes: cells[3] || "", line: b.line });
            }
        }
    }

    // C. §8a: each created dataset has a Primary key field ending in "Id"; type/size/indexability.
    for (const ds of created) {
        const pk = ds.fields.find(f => /primary key/i.test(f.type));
        if (!pk || !/Id$/.test(pk.name)) {
            add("FLAG", "§8a", ds.line, "Dataset \"" + ds.name + "\" has no `<name>Id` primary key field.", "Add a Primary-key field named " + ds.name.replace(/s$/, "") + "Id (singular + Id, per the naming convention).");
        }
        for (const f of ds.fields) {
            if (!f.type) continue;
            if (PICKER_LABEL_TO_STORED[f.type]) {
                add("HARD_FLAG", "§8a", f.line, "Field \"" + f.name + "\" uses picker label \"" + f.type + "\", not the stored type.", "Use the stored string \"" + PICKER_LABEL_TO_STORED[f.type] + "\" (see palbuilder-types.md label->stored map).");
            } else if (!STORED_TYPES.has(f.type)) {
                add("HARD_FLAG", "§8a", f.line, "Field \"" + f.name + "\" type \"" + f.type + "\" is not a verified PalBuilder type.", "Use a stored type from palbuilder-types.md, or move it to §8b if it's a consumed field.");
            } else {
                // Valid stored type — now the size + indexability rules apply (they'd be noise on a
                // field whose type is already wrong, so they only run here).
                if (/\b(sort|sorted|filter|filtered|index|indexed|lookup|look up|search)/i.test(f.notes) && NON_INDEXABLE.has(f.type)) {
                    add("HARD_FLAG", "§8a", f.line, "Field \"" + f.name + "\" is queried on (per its notes) but type \"" + f.type + "\" is NOT indexable.", "Use an indexable type (not " + [...NON_INDEXABLE].join("/") + ") for any field filtered/sorted/looked-up on.");
                }
                const hasSize = !!(f.size && !/^[—-]?$/.test(f.size));
                if (hasSize && !SIZE_TYPES.has(f.type)) {
                    add("FLAG", "§8a", f.line, "Field \"" + f.name + "\" (type " + f.type + ") sets a size, but size applies only to String/Char/Decimal.", "Remove the size for type " + f.type + ".");
                } else if (f.type === "String" && !hasSize) {
                    add("FLAG", "§8a", f.line, "Field \"" + f.name + "\" is a String with no size.", "Give the String a length (e.g. 50 or 255).");
                }
            }
        }
    }

    // D. §5 dataset references exist in §8a/§8b.
    const s5 = sections[5];
    if (s5) {
        const t5 = bodyText(s5);
        const refs = new Set();
        for (const m of t5.matchAll(/get(?:DataSet|DataView|DataList)\(["']([^"']+)["']\)/g)) refs.add(m[1]);
        for (const m of t5.matchAll(/\b(?:insert|update|read|write|delete)\s+(?:a\s+|an\s+|the\s+)?([a-z][A-Za-z0-9_]*)\s+(?:row|record|rows|records)\b/gi)) refs.add(m[1]);
        for (const name of refs) {
            if (!declared.has(name.toLowerCase())) {
                add("FLAG", "§5", s5.start, "§5 references dataset \"" + name + "\" but it is not declared in §8a or §8b.", "Declare \"" + name + "\" in §8a (created) or §8b (consumed), or fix the reference.");
            }
        }
    }

    // E. §12 acceptance-criteria floor.
    const s12 = sections[12];
    if (!s12) {
        add("FLAG", "§12", 0, "No §12 acceptance criteria section found.", "Add §12 with the global floor (pal_validate 0 errors, pal_test VALIDATED, every nav link routes).");
    } else {
        const t12 = bodyText(s12);
        if (!/pal_validate/.test(t12)) add("FLAG", "§12", s12.start, "§12 global floor is missing the pal_validate criterion.", "Add: pal_validate 0 errors.");
        if (!/pal_test/.test(t12)) add("FLAG", "§12", s12.start, "§12 global floor is missing the pal_test criterion.", "Add: pal_test returns ok:true, diagnosticCount:0.");
        if (!/nav link|routes|dead link/i.test(t12)) add("FLAG", "§12", s12.start, "§12 global floor is missing the nav-links-route criterion.", "Add: every §3 nav link routes (no dead links).");
        if (baselinePresent && !/regression/i.test(t12)) {
            add("HARD_FLAG", "§12", s12.start, "A regression baseline exists but §12 has no REGRESSION criterion.", "Add the REGRESSION criterion: baseline/baseline.json still passes and untouched UI didn't shift.");
        }
    }

    // F. Workspace lint is the joint SPEC + EXECUTION approval gate.
    if (workspaceDir) {
        const execPath = path.join(workspaceDir, "EXECUTION.md");
        if (!fs.existsSync(execPath)) {
            add("HARD_FLAG", "EXECUTION.md", 0, "EXECUTION.md is required before the specification can be approved.", "Draft EXECUTION.md against this SPEC.md, then run pal_spec_lint again.");
        } else {
            let execText;
            try { execText = fs.readFileSync(execPath, "utf8"); }
            catch (e) { add("HARD_FLAG", "EXECUTION.md", 0, "EXECUTION.md could not be read.", "Restore a readable EXECUTION.md and re-run pal_spec_lint."); }
            if (execText !== undefined) {
                for (const issue of validateExecutionPlan(execText, { sections, specFrontmatter: parseFrontmatter(text) })) {
                    add("HARD_FLAG", "EXECUTION.md", issue.line, issue.summary, issue.fix);
                }
            }
        }
    }

    const counts = {
        HARD_FLAG: findings.filter(f => f.severity === "HARD_FLAG").length,
        FLAG: findings.filter(f => f.severity === "FLAG").length,
        NOTE: findings.filter(f => f.severity === "NOTE").length
    };
    return { findings, counts, baselinePresent };
}

function parseExecutionTasks(text) {
    const lines = String(text).split(/\r?\n/);
    let inTasks = false;
    let cols = null;
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^##\s+Tasks\b/i.test(t)) { inTasks = true; continue; }
        if (inTasks && /^##\s+/.test(t)) break;
        if (!inTasks || t.charAt(0) !== "|" || /^\|[\s:|-]+\|?\s*$/.test(t)) continue;
        const cells = t.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
        if (!cols) {
            const idx = re => cells.findIndex(c => re.test(c));
            cols = { id: idx(/^id$/i), task: idx(/task/i), tier: idx(/^tier$/i), specRef: idx(/spec\s*ref/i), depends: idx(/depend/i), status: idx(/status/i), success: idx(/success/i) };
            continue;
        }
        const at = n => n >= 0 ? (cells[n] || "") : "";
        const rawDepends = at(cols.depends);
        rows.push({ id: at(cols.id), task: at(cols.task), tier: at(cols.tier), specRefRaw: at(cols.specRef), depends: /^[—\-\s]*$/.test(rawDepends) ? [] : rawDepends.split(/[,\s]+/).filter(Boolean), status: at(cols.status), success: at(cols.success), line: i + 1 });
    }
    if (!inTasks || !cols) return { ok: false, error: "EXECUTION.md needs a ## Tasks table." };
    return { ok: true, cols, rows, frontmatter: parseFrontmatter(text) };
}

function validateExecutionPlan(text, { sections, specFrontmatter } = {}) {
    const exec = parseExecutionTasks(text);
    if (!exec.ok) return [{ line: 0, summary: exec.error, fix: "Add a parseable ## Tasks table from execution-template.md." }];
    const required = ["id", "task", "tier", "specRef", "depends", "status", "success"];
    const missing = required.filter(name => exec.cols[name] < 0);
    if (missing.length) return [{ line: 0, summary: "Tasks table is missing required column(s): " + missing.join(", ") + ".", fix: "Use the Tasks header in execution-template.md." }];
    if (!exec.rows.length) return [{ line: 0, summary: "Tasks table has no task rows.", fix: "Add the standalone foundation task and its dependent tasks." }];
    const issues = []; const ids = new Set();
    for (const row of exec.rows) {
        if (!row.id) issues.push({ line: row.line, summary: "Task ID is empty.", fix: "Give every task a unique nonempty ID." });
        else if (ids.has(normalizeExecutionTaskId(row.id))) issues.push({ line: row.line, summary: "Task ID \"" + row.id + "\" is duplicated.", fix: "Give every task a unique ID." });
        else ids.add(normalizeExecutionTaskId(row.id));
        if (!EXECUTION_STATUSES.has(row.status)) issues.push({ line: row.line, summary: "Task " + row.id + " has invalid status \"" + row.status + "\".", fix: "Use todo, in_progress, done, blocked, needs-frontier, or needs-human." });
        if (!EXECUTION_TIERS.has(row.tier)) issues.push({ line: row.line, summary: "Task " + row.id + " has invalid tier \"" + row.tier + "\".", fix: "Use cheap, standard, or frontier." });
        if (!row.success || /^[—\-\s]*$/.test(row.success)) issues.push({ line: row.line, summary: "Task " + row.id + " has an empty success condition.", fix: "Add a behavioral, tool-checkable success condition." });
        if (!row.specRefRaw || /^[—\-\s]*$/.test(row.specRefRaw)) issues.push({ line: row.line, summary: "Task " + row.id + " has no spec ref.", fix: "Name at least one SPEC.md section." });
        else {
            const refs = resolveSpecRefs({ sections }, row.specRefRaw);
            if (!refs.ok) issues.push({ line: row.line, summary: "Task " + row.id + " spec ref \"" + refs.token + "\" does not resolve to a SPEC.md section.", fix: "Use valid SPEC.md section references." });
        }
    }
    for (const row of exec.rows) for (const dep of row.depends) if (!ids.has(normalizeExecutionTaskId(dep))) issues.push({ line: row.line, summary: "Task " + row.id + " depends on missing task \"" + dep + "\".", fix: "Fix the dependency or add that task." });
    const byId = new Map(exec.rows.map(row => [normalizeExecutionTaskId(row.id), row])); const visiting = new Set(), visited = new Set();
    function visit(id) { if (visiting.has(id)) return true; if (visited.has(id) || !byId.has(id)) return false; visiting.add(id); const cycle = byId.get(id).depends.some(dep => visit(normalizeExecutionTaskId(dep))); visiting.delete(id); visited.add(id); return cycle; }
    if (exec.rows.some(row => visit(normalizeExecutionTaskId(row.id)))) issues.push({ line: 0, summary: "Task dependencies contain a cycle.", fix: "Make dependencies leaf-first and acyclic." });
    const first = exec.rows[0];
    if (first.tier !== "cheap" || first.depends.length) issues.push({ line: first.line, summary: "The first foundation task must be tier cheap with depends: —.", fix: "Make the standalone foundation task first, cheap, and dependency-free." });
    // The template names a new-Pal foundation explicitly. Brownfield first tasks may legitimately
    // be a bounded repair, so only declared foundations need both deterministic verification tools.
    if (/\bfoundation\b/i.test(first.task) && (!/\bpal_validate\b/i.test(first.success) || !/\bpal_test\b/i.test(first.success))) {
        issues.push({ line: first.line, summary: "The foundation task success condition must cover both pal_validate and pal_test.", fix: "State successful pal_validate and pal_test results in the foundation success condition." });
    }
    const specVersion = specFrontmatter && specFrontmatter["spec version"];
    const execVersion = exec.frontmatter["spec version"];
    if (!execVersion) issues.push({ line: 0, summary: "EXECUTION.md is missing its spec version.", fix: "Set spec version to the approved SPEC.md version after reconciling tasks." });
    else if (!/^\d+$/.test(execVersion) || execVersion !== specVersion) issues.push({ line: 0, summary: "EXECUTION.md spec version \"" + execVersion + "\" does not match SPEC.md version \"" + (specVersion || "missing") + "\".", fix: "Reconcile affected tasks, then set EXECUTION.md spec version to the approved SPEC.md version." });
    return issues;
}

function formatSpecLint(result) {
    const { findings, counts, baselinePresent } = result;
    const head = (counts.HARD_FLAG > 0 ? "SPEC LINT: HARD FLAGS PRESENT" : findings.length ? "SPEC LINT: soft findings only" : "SPEC LINT: clean") +
        " — " + counts.HARD_FLAG + " HARD_FLAG, " + counts.FLAG + " FLAG, " + counts.NOTE + " NOTE" + (baselinePresent ? " (regression baseline present)" : "") + ".";
    if (!findings.length) return head + "\nThe mechanical checks pass. Still do the JUDGMENT items in reality-check.md by hand (capability->primitive, components in COMPONENTS.md, scope honesty).";
    const lines = [head, "", "HARD_FLAG keeps the spec draft (reality_check: blocked); FLAG/NOTE can ship as recorded caveats."];
    for (const f of findings) lines.push("   [" + f.severity + "] " + f.section + (f.line ? " (line " + f.line + ")" : "") + ": " + f.summary + "\n      fix: " + f.fix);
    lines.push("", "These are the MECHANICAL checks only — the judgment items in reality-check.md (capability->primitive mapping, component existence in COMPONENTS.md, scope honesty) are still yours to do.");
    return lines.join("\n");
}

module.exports = { lintSpec, formatSpecLint, parseSpec, parseFrontmatter, parseExecutionTasks, validateExecutionPlan, bodyText, normalizeSpecRefToken, normalizeExecutionTaskId, resolveSpecSection, resolveSpecRefs, STORED_TYPES, PICKER_LABEL_TO_STORED, NON_INDEXABLE };
