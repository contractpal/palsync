"use strict";
// The GUI's view of the two PalSync preferences. All labels, help text, allowed values, defaults,
// and persistence come from palsync's policy module, so the GUI and `palsync settings` cannot
// drift apart: both end up in ~/.palsync/config.json.
const policy = require("palsync/src/core/policy");

function options(keys, label, help) {
    return keys.map(value => ({ value, label: label[value], help: help[value] }));
}

function describe() {
    return {
        current: policy.resolve(),
        defaults: policy.DEFAULTS,
        verification: options(policy.VERIFICATION_LEVELS, policy.VERIFICATION_LABEL, policy.VERIFICATION_HELP),
        review: options(policy.REVIEW_MODES, policy.REVIEW_LABEL, policy.REVIEW_HELP)
    };
}

function update(key, value) {
    try {
        policy.set(key, value);
        return { ok: true, current: policy.resolve() };
    } catch (e) {
        return { ok: false, error: e.message, current: policy.resolve() };
    }
}

module.exports = { describe, update };
