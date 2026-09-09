"use strict";
// Backing logic for the per-pal ribbon's Web/Console/System/Transaction buttons. Reuses
// palsync's own Test<Kind>.do call end to end (session bootstrap, lock handling, authenticated
// preview-URL construction) rather than reimplementing any of it — same reuse pattern as
// cloudWizard.js. "System" maps to kind "console-system" — palsync's runTest already treats it
// identically to "console" (see src/core/test.js's TYPE_NUM/KIND_ENDPOINT), so no special-casing
// is needed here despite the Java PalBuilder IDE's own System button working differently (it
// fires an async server job instead of opening a link — its own source flags that path as
// unfinished; palsync's TestSystem.do integration is the verified-working one).
const { runTest } = require("palsync/src/core/test");
const { sessionForFolder } = require("./palSession");
const { resolvePal } = require("./resolveCached");

// kind: "web" | "console" | "console-system" | "transaction". workflowName picks which of that
// kind's workflow files to target when a pal has more than one (optional — runTest defaults to
// the first). Returns runTest()'s result (never the credential-bearing _previewUrl to the
// renderer — the caller in index.js strips it).
async function testWorkflow(workspaceDir, kind, workflowName, chipSessionId) {
    const { session, record } = await sessionForFolder(workspaceDir, chipSessionId);
    // See resolveCached.js — avoids walking the whole account on every ribbon click.
    const resolved = await resolvePal(session, workspaceDir, record.palGuid);
    return runTest(session, record.palGuid, { kind, workflowName, resolved });
}

module.exports = { testWorkflow };
