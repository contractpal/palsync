"use strict";
// Default interactive menus for the selection flow. Profile/group/pal use `prompts` autocomplete
// (filter-as-you-type) because pal lists can run to hundreds. `prompts` is CJS and supports Node
// >=6, so it works on the team's Node range (18+) and doesn't touch the @clack pin. Returns the
// chosen object, the BACK sentinel, or null on cancel — kept UI-agnostic from selection.js.
const promptsLib = require("prompts");
const { BACK } = require("../core/back");
const { loadClack } = require("../platform/uiPrompts");
const { describeDiff } = require("../core/localDrift");

// Monkey-patch `prompts`' AutocompletePrompt so Esc and the left arrow reliably resolve BACK
// (when back-enabled), instead of the library's default behavior: Esc (`exit()`) RESOLVES
// (doesn't reject/cancel) with whatever item is currently highlighted — so without this, Esc
// after moving the cursor silently accepts the wrong item rather than going back — and left
// arrow just moves the filter-text cursor. `prompts/lib/elements` is the exact object
// `prompts/lib/prompts.js` reads `AutocompletePrompt` from (same require-cache entry, plain
// CJS — no ESM live-binding issues), so reassigning it here is visible everywhere the package
// constructs one.
const elements = require("prompts/lib/elements");
const OriginalAutocompletePrompt = elements.AutocompletePrompt;
class BackableAutocompletePrompt extends OriginalAutocompletePrompt {
    constructor(opts) {
        super(opts);
        this._backEnabled = !!opts.back;
    }
    exit() { this._backEnabled ? this._resolveBack() : super.exit(); }   // Esc
    left() { this._backEnabled ? this._resolveBack() : super.left(); }  // left arrow
    _resolveBack() {
        this.value = BACK;
        this.done = this.exited = true;
        this.aborted = false;
        this.fire();
        this.render();
        this.out.write("\n");
        this.close();
    }
}
elements.AutocompletePrompt = BackableAutocompletePrompt;

// Case-insensitive SUBSTRING filter (more forgiving than prompts' default prefix match), so
// typing "tracker" matches "Project Tracker", not just leading text.
function suggest(input, choices) {
    const q = (input || "").toLowerCase();
    return Promise.resolve(choices.filter(c => String(c.title).toLowerCase().includes(q)));
}

async function autocompletePick(message, items, { back = false } = {}) {
    const choices = [];
    if (back) choices.push({ title: "← Back", value: BACK });
    for (const it of items) choices.push(it);

    // onCancel only fires on a real Ctrl+C/Ctrl+D (abort() rejects); Esc is handled by the
    // BackableAutocompletePrompt patch above and never reaches here.
    const res = await promptsLib(
        { type: "autocomplete", name: "value", message, choices, suggest, limit: 12, back },
        { onCancel: () => false }
    );
    if (res.value === undefined) return null;
    return res.value;
}

const selectionPrompts = {
    // Esc/left back out to the login flow's last step (see launcher/index.js's orchestration).
    async pickProfile(profiles) {
        return autocompletePick(
            "Select profile (type to filter)",
            profiles.map(p => ({ title: p.profileName, value: p })),
            { back: true }
        );
    },
    // Open an existing pal, or create a new one. Esc goes back to the profile step.
    async pickMode() {
        const clack = await loadClack();
        const v = await clack.select({
            message: "What do you want to do?",
            options: [
                { value: "open", label: "Open an existing Pal" },
                { value: "create", label: "Create a new Pal" }
            ]
        });
        return clack.isCancel(v) ? BACK : v;
    },
    async pickGroup(groups) {
        return autocompletePick(
            "Select group (type to filter)",
            groups.map(g => ({ title: g.name, description: g.description || undefined, value: g })),
            { back: true }
        );
    },
    // Create flow: one or more groups. clack multiselect has no in-list back affordance, so
    // Esc/cancel maps to BACK (returns to the mode step), consistent with the other steps.
    async pickGroups(groups) {
        const clack = await loadClack();
        const v = await clack.multiselect({
            message: "Select one or more groups for the new pal (space to toggle, enter to confirm)",
            options: groups.map(g => ({ value: g, label: g.name, hint: g.description || undefined })),
            required: true
        });
        return clack.isCancel(v) ? BACK : v;
    },
    // Create flow: name (required) + description/category (blank defaults to the name). An
    // eval-harness run passes defaultName so the pal name matches the spec's `pal:` line.
    async pickNewPalDetails(defaultName) {
        const clack = await loadClack();
        const name = await clack.text({
            message: "New pal name",
            initialValue: defaultName || undefined,
            validate: (x) => (x && x.trim() ? undefined : "Name is required")
        });
        if (clack.isCancel(name)) return BACK;
        const description = await clack.text({ message: "Description (blank = use the name)", placeholder: name });
        if (clack.isCancel(description)) return BACK;
        const category = await clack.text({ message: "Category (blank = use the name)", placeholder: name });
        if (clack.isCancel(category)) return BACK;
        const nm = name.trim();
        return {
            name: nm,
            description: (description && description.trim()) || nm,
            category: (category && category.trim()) || nm
        };
    },
    // Create flow: choose the activation key. Entitlements vary per key (Developer keys lack the
    // Web/Marketing workflow) and the keys API doesn't expose them, so the human picks. The cursor
    // defaults to the first non-Developer key, since that's the one that can run web pals.
    async pickActivationKey(keys) {
        const clack = await loadClack();
        const recommended = keys.find(k => k && k.name && !/developer/i.test(k.name)) || keys[0];
        const v = await clack.select({
            message: "Select the activation key (Developer keys can't run Web/Marketing workflows)",
            initialValue: recommended.value,
            options: keys.map(k => ({
                value: k.value,
                label: k.name + (k === recommended ? "  (recommended)" : "")
            }))
        });
        return clack.isCancel(v) ? BACK : v;
    },
    async pickPal(pals) {
        return autocompletePick(
            "Select pal (type to filter)",
            pals.map(p => ({
                title: p.name + (p.branchName ? " (" + p.branchName + ")" : ""),
                description: p.description || undefined,
                value: p
            })),
            { back: true }
        );
    }
};

// The launcher's un-pushed-changes prompt (the data-loss guard UI). Called by
// workspace.setup() via the injectable onDrift hook; returns one of
// "push" | "force-push" | "overwrite" | "skip" | "abort".
async function driftPrompt(info) {
    const clack = await loadClack();
    if (info.phase === "push-refused") {
        const r = info.refusal || {};
        if (r.refused === "drift") {
            clack.log.warn(
                "The push was refused: the SERVER also changed since your last pull (saved by " +
                (r.lastEditUser || "unknown") + (r.lastEditDate ? " at " + r.lastEditDate : "") + ").\n" +
                "Local and server have BOTH moved — force-pushing overwrites their save; pulling overwrites yours."
            );
            const v = await clack.select({
                message: "Both sides changed — how do you want to resolve it?",
                options: [
                    { value: "merge", label: "Merge — keep BOTH sides' changes where they don't collide (recommended)" },
                    { value: "skip", label: "Skip the pull — keep my local state, decide later" },
                    { value: "force-push", label: "Force-push MY local changes (overwrites their server save)" },
                    { value: "overwrite", label: "Pull THEIR server state (overwrites my local changes)" },
                    { value: "abort", label: "Quit palsync" }
                ]
            });
            return clack.isCancel(v) ? "abort" : v;
        }
        clack.log.warn("The push was refused (" + (r.refused || "unknown") + ")" +
            (r.holder ? " — the pal is locked by " + r.holder : "") + ".");
        const v = await clack.select({
            message: "Couldn't push your local changes — what now?",
            options: [
                { value: "skip", label: "Skip the pull — keep my local state (safest)" },
                { value: "overwrite", label: "Pull anyway — overwrite my local changes" },
                { value: "abort", label: "Quit palsync" }
            ]
        });
        return clack.isCancel(v) ? "abort" : v;
    }
    clack.log.warn(
        "This workspace has UN-PUSHED local changes (the last session likely ended before a push):\n" +
        describeDiff(info.diff) +
        "\nPulling now would overwrite the modified/deleted files listed above. New local files are safe either way."
    );
    const v = await clack.select({
        message: "Un-pushed local changes in " + (info.palName || "this pal") + " — what do you want to do?",
        options: [
            { value: "push", label: "Push my local changes to the server first, then pull (recommended)" },
            { value: "merge", label: "Merge — combine my changes with the server's where they don't collide" },
            { value: "skip", label: "Skip the pull — work on the local state as-is" },
            { value: "overwrite", label: "Pull anyway — OVERWRITE the local changes listed above" },
            { value: "abort", label: "Quit palsync" }
        ]
    });
    return clack.isCancel(v) ? "abort" : v;
}

// Eval-harness flow: choose which benchmark spec to run (see eval/specs/README.md). No
// "recommended" concept — just list them in folder order. No BACK — this is the very first
// step of the whole launcher, so cancel means quit.
async function pickEvalSpec(specs) {
    const clack = await loadClack();
    const v = await clack.select({
        message: "Pick a benchmark spec to run",
        options: specs.map(s => ({ value: s.key, label: s.key + " — " + s.description }))
    });
    return clack.isCancel(v) ? null : v;
}

module.exports = { selectionPrompts, suggest, autocompletePick, driftPrompt, pickEvalSpec };
