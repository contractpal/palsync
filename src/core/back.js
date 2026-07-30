"use strict";
// Shared sentinel meaning "go back one screen" — used by both the login step machine
// (src/auth/credentials.js) and the pal-selection step machine (src/launcher/selection.js),
// which is why it lives here rather than under either layer.
const BACK = "__back__";

module.exports = { BACK };
