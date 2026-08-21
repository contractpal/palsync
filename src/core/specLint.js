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

    // F. EXECUTION.md spec ref tokens must resolve to a real SPEC.md section.
    // EXECUTION.md does not exist when the linter runs in pal-spec Step 5
    // (written in Step 6), so its absence is not a finding.
    if (workspaceDir) {
        const execPath = path.join(workspaceDir, "EXECUTION.md");
        let execText = null;
        try {
            if (fs.existsSync(execPath)) execText = fs.readFileSync(execPath, "utf8");
        } catch (e) { /* ignore */ }
        if (execText !== null) {
            const exec = parseExecutionTasks(execText);
            if (exec.ok) {
                for (const row of exec.rows) {
                    const raw = row.specRefRaw;
                    if (!raw || /^[\u2014\-\s]*$/.test(raw)) continue;
                    const parts = raw.split(",");
                    for (let tokRaw of parts) {
                        const tok = tokRaw.trim();
                        if (!tok) {
                            // bundled-context/skills/pal-spec/references/execution-template.md:15-17 — every task names at least one spec ref
                            add("HARD_FLAG", "EXECUTION.md", row.line,
                                `Task ${row.id} spec ref "${raw.trim()}" has an empty component between commas.`,
                                `Fix the spec ref list \u2014 remove the empty component (e.g. "\u00A74,,\u00A76" -> "\u00A74,\u00A76").`);
                            break;
                        }
                        const sec = resolveSpecSection({ sections }, tok);
                        if (!sec) {
                            // bundled-context/skills/pal-spec/references/execution-template.md:15-17 — every task names at least one spec ref
                            add("HARD_FLAG", "EXECUTION.md", row.line,
                                `Task ${row.id} spec ref "${tok}" does not resolve to a SPEC.md section.`,
                                `Fix the spec ref to a valid section (e.g. \u00A74, \u00A78b) or add the missing SPEC.md section.`);
                        }
                    }
                }
            }
        }
    }

    const counts = {
        HARD_FLAG: findings.filter(f => f.severity === "HARD_FLAG").length,
        FLAG: findings.filter(f => f.severity === "FLAG").length,
        NOTE: findings.filter(f => f.severity === "NOTE").length
    };
    return { findings, counts, mapPresent };
}

function parseExecutionTasks(text) {
    const lines = text.split(/\r?\n/);
    let inTasks = false;
    let cols = null;
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^##\s+Tasks\b/i.test(t)) { inTasks = true; continue; }
        if (inTasks && /^##\s+/.test(t)) break;
        if (!inTasks) continue;
        if (t.charAt(0) !== "|") continue;
        if (/^\|[\s:|-]+\|?\s*$/.test(t)) continue;
        const cells = t.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
        if (!cols) {
            const idx = re => cells.findIndex(c => re.test(c));
            cols = { id: idx(/^id$/i), specRef: idx(/spec\s*ref/i) };
            if (cols.id === -1) return { ok: false };
            continue;
        }
        const id = cells[cols.id] || "";
        if (!id) continue;
        const specRefRaw = cols.specRef >= 0 ? (cells[cols.specRef] || "") : "";
        rows.push({ id, specRefRaw, line: i + 1 });
    }
    if (!cols) return { ok: false };
    return { ok: true, rows };
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

module.exports = { lintSpec, formatSpecLint, parseSpec, bodyText, normalizeSpecRefToken, resolveSpecSection, resolveSpecRefs, STORED_TYPES, PICKER_LABEL_TO_STORED, NON_INDEXABLE };
