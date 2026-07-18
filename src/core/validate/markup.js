"use strict";
// Lint a PalBuilder page/fragment for the markup mistakes that the server rejects (or that
// silently break at render). Source of truth: bundled-context/skills/palbuilder-frontend
// SKILL.md + CLAUDE.md, all empirically verified against live pals.
//
// This is a TARGETED scanner, deliberately NOT a full XML parser: a real XML parse chokes on
// the c: namespace and on raw <script>/<style> content, and would drown the agent in noise.
// We find the specific, confirmed mistakes and skip everything else. Raw-text regions
// (<script>/<style> bodies) are handled specially — XHTML escaping rules do NOT apply there.
//
// Every finding is a full sentence with the fix and a skill pointer — built for the least
// capable agent that will read it.
const { WHITELIST, REQUIRED, ALWAYS_ALLOWED, VOID_ELEMENTS } = require("./cTagSpec");
const { lintTagBalance } = require("./tagBalance");

// Precompute newline offsets → O(log n) line lookup.
function lineIndexer(src) {
    const nl = [];
    for (let i = 0; i < src.length; i++) if (src[i] === "\n") nl.push(i);
    return (pos) => {
        let lo = 0, hi = nl.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < pos) lo = mid + 1; else hi = mid; }
        return lo + 1; // 1-based line
    };
}

// Parse one opening tag starting at `<` (index lt). Respects quotes so `>` inside an EL
// attribute value (test="${a > b}") doesn't end the tag early. Returns
// { name, attrs:[{name,value,raw}], selfClosed, end } or null.
function parseTag(src, lt) {
    const n = src.length;
    let i = lt + 1;
    let name = "";
    while (i < n && /[A-Za-z0-9:_-]/.test(src[i])) { name += src[i]; i++; }
    if (!name) return null;
    const attrs = [];
    while (i < n) {
        while (i < n && /\s/.test(src[i])) i++;
        if (i >= n) break;
        if (src[i] === ">") return { name, attrs, selfClosed: false, end: i + 1 };
        if (src[i] === "/" && src[i + 1] === ">") return { name, attrs, selfClosed: true, end: i + 2 };
        // attribute name
        let an = "";
        while (i < n && /[^\s=/>]/.test(src[i])) { an += src[i]; i++; }
        if (!an) { i++; continue; } // stray char — skip
        while (i < n && /\s/.test(src[i])) i++;
        let av = null;
        if (src[i] === "=") {
            i++;
            while (i < n && /\s/.test(src[i])) i++;
            const q = src[i];
            if (q === '"' || q === "'") {
                i++; let v = "";
                while (i < n && src[i] !== q) { v += src[i]; i++; }
                i++; av = v;
            } else {
                let v = "";
                while (i < n && !/[\s>]/.test(src[i]) && !(src[i] === "/" && src[i + 1] === ">")) { v += src[i]; i++; }
                av = v;
            }
        }
        attrs.push({ name: an, value: av });
    }
    return { name, attrs, selfClosed: false, end: n };
}

// Is this file a fragment (so AJAX-loaded → DOMContentLoaded won't fire)? Signals: path under
// fragments/, or a c:ignore wrapper with no full <html> document shell.
function looksLikeFragment(rel, src) {
    if (/(^|\/)fragments\//.test(rel)) return true;
    if (/<c:ignore\b/.test(src) && !/<html\b/i.test(src)) return true;
    return false;
}

const VALID_ENTITY = /^&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

function lintMarkup(rel, src, opts) {
    // Fragments marked parseable:false in pal.json skip server tag-processing entirely —
    // inline <script> and ${} are FINE there (seen live: a non-parseable google-analytics
    // fragment on Major League Coatings). opts.nonParseable = Set of "fragments/<file>" rels.
    const nonParseable = (opts && opts.nonParseable) || null;
    const skipScriptChecks = !!(nonParseable && nonParseable.has(rel));
    const designSystemPresent = !!(opts && opts.designSystemPresent);
    const findings = [];
    const lineAt = lineIndexer(src);
    const isFragment = looksLikeFragment(rel, src);
    const n = src.length;
    let i = 0;

    const add = (pos, severity, rule, message) =>
        findings.push({ file: rel, line: lineAt(pos), column: 0, severity, rule, message });

    // Bare-& check over a text run [from, to) (element content only — never script/style/attrs).
    const checkText = (from, to) => {
        for (let p = from; p < to; p++) {
            if (src[p] !== "&") continue;
            if (VALID_ENTITY.test(src.slice(p, p + 12))) continue;
            add(p, "warn", "bareAmpersand",
                "Bare '&' in element text — strict XHTML needs it written as '&amp;' (a lone '&' can cause a parse error). " +
                "Fix: replace '&' with '&amp;' here. (This rule does NOT apply inside <script>/<style> — that content is raw text.)");
        }
    };

    while (i < n) {
        const lt = src.indexOf("<", i);
        if (lt === -1) { checkText(i, n); break; }
        checkText(i, lt);
        if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e === -1 ? n : e + 3; continue; }
        if (src[lt + 1] === "!" || src[lt + 1] === "?") { const e = src.indexOf(">", lt + 2); i = e === -1 ? n : e + 1; continue; }
        if (src[lt + 1] === "/") { const e = src.indexOf(">", lt); i = e === -1 ? n : e + 1; continue; }

        const tag = parseTag(src, lt);
        if (!tag) { i = lt + 1; continue; }
        checkTag(tag, lt);
        i = tag.end;

        const lname = tag.name.toLowerCase();
        if ((lname === "script" || lname === "style") && !tag.selfClosed) {
            const close = new RegExp("</" + lname + "\\b", "i").exec(src.slice(i));
            const rawEnd = close ? i + close.index : n;
            if (lname === "script") checkInlineScript(src.slice(i, rawEnd), i, tag);
            i = rawEnd;
        }
    }

    function checkTag(tag, lt) {
        const lname = tag.name.toLowerCase();

        if (lname === "c:debug") {
            add(lt, "error", "debugTagShipped",
                "<c:debug/> must not ship in a page or fragment: it renders headerless platform tables that fail designAudit tableHeaders. Remove the debug tag before pushing. See the palbuilder-frontend skill debug guidance.");
        }

        if (designSystemPresent) {
            const requiredClass = {
                button: "pb-btn",
                input: "pb-input",
                select: "pb-select",
                textarea: "pb-textarea",
                table: "pb-table"
            }[lname];
            // pb-input is the text-field recipe. Checkbox/radio/toggle/range/file/color and the
            // button-like or hidden input types carry their own recipes (or none) — the component
            // library ships them without pb-input, so requiring it here would be a false error.
            const nonInputClass = lname === "input" && [
                "hidden", "checkbox", "radio", "range", "submit", "button", "reset", "image", "file", "color"
            ].includes((tag.attrs.find(a => a.name.toLowerCase() === "type")?.value || "").toLowerCase());
            // Owner-approved policy gate (Sam, 2026-07-18): not a server rejection; blocks because
            // a declared design system must own core controls consistently across the pal.
            if (requiredClass && !nonInputClass && !new RegExp("(^|\\s)" + requiredClass + "(?:\\s|$)").test(
                tag.attrs.find(a => a.name.toLowerCase() === "class")?.value || "")) {
                add(lt, "error", "designClassRequired",
                    "<" + tag.name + "> is missing the required ." + requiredClass + " class while a workspace design system is present. " +
                    "Fix: add class=\"" + requiredClass + "\" and use the corresponding component recipe from component-library.md; " +
                    "core-control classes are validation errors, not suggestions.");
            }
        }

        // (1) HTML void element must self-close — UNLESS it is immediately closed with an
        // explicit paired end-tag (<source ...></source>), which is balanced XML and accepted
        // by the server (seen on live pals: Major League Coatings, 2026-06).
        const pairClosed = VOID_ELEMENTS.has(lname) && !tag.selfClosed &&
            src.slice(tag.end, tag.end + lname.length + 3).toLowerCase() === "</" + lname + ">";
        if (VOID_ELEMENTS.has(lname) && !tag.selfClosed && !pairClosed) {
            add(lt, "error", "voidNotClosed",
                "<" + lname + "> is a void HTML element and MUST be explicitly self-closed in PalBuilder's strict XHTML. " +
                "An unclosed void tag is a hard parse error, not a warning. Fix: write <" + lname + " ... /> (add the ' /' before '>'). " +
                "See the palbuilder-frontend skill, \"XHTML Rules\".");
        }

        // (2)/(3) c: attribute whitelist + required attributes (only for closed-set tags).
        if (Object.prototype.hasOwnProperty.call(WHITELIST, lname)) {
            const allowed = WHITELIST[lname];
            for (const a of tag.attrs) {
                const an = a.name.toLowerCase();
                if (ALWAYS_ALLOWED(an)) continue;
                if (!allowed.has(an)) {
                    add(lt, "error", "unknownCAttr",
                        "<" + tag.name + "> has attribute '" + a.name + "', which is NOT in PalBuilder's documented attribute set for this tag. " +
                        "Undocumented c: attributes throw a validation error at save. Fix: remove '" + a.name + "' or use a documented attribute" +
                        (allowed.size ? " (valid here: " + [...allowed].join(", ") + ")" : "") + ". See the palbuilder-frontend skill tag reference.");
                }
            }
            const req = (lname === "c:list" && tag.attrs.some(a => a.name.toLowerCase() === "list"))
                ? (REQUIRED[lname] || []).filter(r => r !== "name")
                : (REQUIRED[lname] || []);
            for (const r of req) {
                if (!tag.attrs.some(a => a.name.toLowerCase() === r)) {
                    add(lt, "error", "missingRequiredCAttr",
                        "<" + tag.name + "> is missing the required '" + r + "' attribute. Fix: add " + r + "=\"…\". " +
                        "See the palbuilder-frontend skill tag reference.");
                }
            }
        }

        // (4) aria-* on c:field specifically.
        if (lname === "c:field") {
            for (const a of tag.attrs) {
                if (a.name.toLowerCase().startsWith("aria-")) {
                    add(lt, "warn", "ariaOnCField",
                        "<c:field> has '" + a.name + "'. ARIA attributes on c:field are NOT supported (tested) — they don't pass through and produce validation notes. " +
                        "Fix: wrap the field in a <label> and use a sibling element with role=\"alert\" for messages, instead of aria-* on c:field. " +
                        "See the palbuilder-frontend skill (the label + role=alert pattern).");
                }
            }
        }
    }

    function checkInlineScript(body, offset, tag) {
        if (skipScriptChecks) return; // parseable:false fragment — server never processes it
        const isExternal = tag.attrs.some(a => a.name.toLowerCase() === "src");
        if (isExternal) return; // <script src=...> has no inline body to collide

        // (0) An inline <script> inside a FRAGMENT is HARD-REJECTED by the PalBuilder server
        // ("Tag script is not allowed"). This is an ERROR, not a warning: it fails the save
        // outright (confirmed live AND in two independent cold tests — both a Sonnet and a Haiku
        // agent wrote an inline <script> in a fragment; the server rejected the whole push). As a
        // blocking error the pre-push gate stops it here, with the fix, BEFORE the failed push —
        // instead of letting it through to a server rejection the agent then has to diagnose.
        if (isFragment && !skipScriptChecks && body.trim().length) {
            add(offset, "error", "scriptInFragment",
                "This fragment contains an inline <script>. PalBuilder REJECTS a <script> tag inside a fragment at save time " +
                "(\"Tag script is not allowed\") — the push will fail. Fix: move this JavaScript into an external file under scripts/ " +
                "(e.g. scripts/your-module.js), add a scripts.entry for it in pal.json, and load it from the PAGE that includes this " +
                "fragment with <script src=\"../Scripts/your-module.js\"></script>; call its functions from the fragment via onclick. " +
                "See the palbuilder-frontend skill (fragment JavaScript goes in external scripts).");
        }

        // (5) ${...} inside an inline <script> collides with server-side EL at render.
        const el = body.indexOf("${");
        if (el !== -1) {
            add(offset + el, "error", "elInInlineScript",
                "An inline <script> contains '${...}', which collides with PalBuilder's server-side EL and is evaluated (and usually blanked) at render — breaking the JavaScript. " +
                "Fix: move this JavaScript to an external .js file (static .js bypasses EL), or use string concatenation instead of ${}. " +
                "See the palbuilder-frontend skill, \"two caveats\".");
        }

        // (6) DOMContentLoaded in a fragment script never fires (AJAX-loaded — DOM already present).
        if (isFragment) {
            const dom = body.indexOf("DOMContentLoaded");
            if (dom !== -1) {
                add(offset + dom, "warn", "domContentLoadedInFragment",
                    "This fragment's <script> uses DOMContentLoaded, which does NOT fire for AJAX-loaded fragments (the DOM is already present). The code inside will never run. " +
                    "Fix: remove the DOMContentLoaded wrapper and run the init code directly at the bottom of the fragment. " +
                    "See the palbuilder-frontend skill, \"JavaScript Rules\".");
            }
        }
    }

    // Tag-balance check (Check 1 — esign orphan-div incident).
    findings.push(...lintTagBalance(rel, src));

    findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
    return findings;
}

module.exports = { lintMarkup, parseTag, looksLikeFragment };
