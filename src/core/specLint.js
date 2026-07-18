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
    return { lines, sections };
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

// --- the lint ---
function lintSpec(text, { workspaceDir, hasMap } = {}) {
    const findings = [];
    const add = (severity, section, line, summary, fix) => findings.push({ severity, section, line, summary, fix });
    const { lines, sections } = parseSpec(text);
    const mapPresent = typeof hasMap === "boolean" ? hasMap
        : (workspaceDir ? fs.existsSync(path.join(workspaceDir, "MAP.md")) : false);

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
        if (mapPresent && !/regression/i.test(t12)) {
            add("HARD_FLAG", "§12", s12.start, "A MAP.md exists (brownfield) but §12 has no REGRESSION criterion.", "Add the REGRESSION criterion: the pal-init baseline still passes and untouched UI didn't shift.");
        }
    }

    const counts = {
        HARD_FLAG: findings.filter(f => f.severity === "HARD_FLAG").length,
        FLAG: findings.filter(f => f.severity === "FLAG").length,
        NOTE: findings.filter(f => f.severity === "NOTE").length
    };
    return { findings, counts, mapPresent };
}

function formatSpecLint(result) {
    const { findings, counts, mapPresent } = result;
    const head = (counts.HARD_FLAG > 0 ? "SPEC LINT: HARD FLAGS PRESENT" : findings.length ? "SPEC LINT: soft findings only" : "SPEC LINT: clean") +
        " — " + counts.HARD_FLAG + " HARD_FLAG, " + counts.FLAG + " FLAG, " + counts.NOTE + " NOTE" + (mapPresent ? " (brownfield: MAP.md present)" : "") + ".";
    if (!findings.length) return head + "\nThe mechanical checks pass. Still do the JUDGMENT items in reality-check.md by hand (capability->primitive, components in COMPONENTS.md, scope honesty).";
    const lines = [head, "", "HARD_FLAG keeps the spec draft (reality_check: blocked); FLAG/NOTE can ship as recorded caveats."];
    for (const f of findings) lines.push("   [" + f.severity + "] " + f.section + (f.line ? " (line " + f.line + ")" : "") + ": " + f.summary + "\n      fix: " + f.fix);
    lines.push("", "These are the MECHANICAL checks only — the judgment items in reality-check.md (capability->primitive mapping, component existence in COMPONENTS.md, scope honesty) are still yours to do.");
    return lines.join("\n");
}

module.exports = { lintSpec, formatSpecLint, parseSpec, STORED_TYPES, PICKER_LABEL_TO_STORED, NON_INDEXABLE };
