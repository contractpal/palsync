"use strict";

// Central operational metadata for every emitted validator rule. Gate membership is derived from
// this table so a severity-bimodal finding cannot disappear between validation and push.
const RULE_REGISTRY = {
    objectLiteral: { severity: "error", category: "workflow", gate: "per-file", evidence: "Platform team confirmation (June 2026); workflowJs.js rule comment." },
    letConst: { severity: "error", category: "workflow", gate: "per-file", evidence: "palbuilder-core/references/es3-cheatsheet.md." },
    arrow: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Unverified workflow-engine compatibility advisory." },
    template: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Unverified workflow-engine compatibility advisory." },
    destructuring: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Unverified workflow-engine compatibility advisory." },
    forOf: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Unverified workflow-engine compatibility advisory." },
    forIn: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Unverified workflow-engine compatibility advisory." },
    hof: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Unverified workflow-engine compatibility advisory." },
    bannedMethod: { severity: "error", category: "workflow", gate: "per-file", evidence: "palbuilder-core/references/es3-cheatsheet.md unsupported-method table." },
    lengthCall: { severity: "warn", category: "workflow", gate: "per-file", evidence: "palbuilder-core/references/es3-cheatsheet.md documents length as a property." },
    findRecordSelectColumns: { severity: "warn", category: "workflow", gate: "per-file", evidence: "palbuilder-workflow/references/legacy-api-reference.md." },
    funcExpr: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Unverified workflow-engine compatibility advisory." },
    implicitGlobal: { severity: "error", category: "workflow", gate: "per-file", evidence: "Live compiler error documented beside the workflowJs.js rule." },
    duplicateCase: { severity: "warn", category: "workflow", gate: "per-file", evidence: "Advisory: duplicate labels compile but leave an unreachable branch." },
    fragClobber: { severity: "error", category: "workflow", gate: "per-file", evidence: "Live fragment-render regression documented beside the workflowJs.js rule." },
    parseError: { severity: "error", category: "workflow", gate: "per-file", evidence: "Acorn parse failure under the validator's documented ES3 grammar." },

    bareAmpersand: { severity: "warn", category: "markup", gate: "per-file", evidence: "XHTML entity syntax advisory." },
    debugTagShipped: { severity: "warn", category: "markup", gate: "per-file", evidence: "Valid c-tag; advisory because rendered debug tables can degrade design audits." },
    designClassRequired: { severity: "warn", category: "markup", gate: "per-file", evidence: "Owner reversal (Sam, 2026-07-18): valid markup with no server rejection; advisory until live evidence exists." },
    voidNotClosed: { severity: "error", category: "markup", gate: "per-file", evidence: "PalBuilder XHTML save contract documented in c-tags.md." },
    unknownCAttr: { severity: "error", category: "markup", gate: "per-file", evidence: "bundled palbuilder-frontend/references/c-tags.md attribute whitelist." },
    missingRequiredCAttr: { severity: "error", category: "markup", gate: "per-file", evidence: "bundled palbuilder-frontend/references/c-tags.md required attributes." },
    ariaOnCField: { severity: "warn", category: "markup", gate: "per-file", evidence: "c:field rendering compatibility advisory." },
    scriptInFragment: { severity: "error", category: "markup", gate: "per-file", evidence: "Live server rejection: Tag script is not allowed; markup.js comment." },
    elInInlineScript: { severity: "error", category: "markup", gate: "per-file", evidence: "PalBuilder parses inline script as server markup; markup.js incident comment." },
    domContentLoadedInFragment: { severity: "warn", category: "markup", gate: "per-file", evidence: "AJAX fragment lifecycle documented in palbuilder-frontend skill." },
    strayCloseTag: { severity: "error", category: "markup", gate: "per-file", evidence: "Live esign orphan-tag incident documented in tagBalance.js." },
    unclosedTag: { severity: "error", category: "markup", gate: "per-file", evidence: "Live esign orphan-tag incident documented in tagBalance.js." },

    datasetJsonParse: { severity: "error", category: "dataset", gate: "per-file", evidence: "A dataset definition must be valid JSON before provisioning." },
    datasetNoFields: { severity: "warn", category: "dataset", gate: "per-file", evidence: "Dataset-definition completeness advisory." },
    datasetFieldType: { severity: "warn", category: "dataset", gate: "per-file", evidence: "Vendored DatasetFieldType.java constants." },
    datasetNoPrimaryKey: { severity: "warn", category: "dataset", gate: "per-file", evidence: "Dataset-definition integrity advisory." },

    invalidPalJsonShape: { severity: "error", category: "manifest", gate: "per-file", evidence: "Vendored Pal/Layout serialized field shapes cited in palJson.js." },
    unknownPalJsonKey: { severity: "both", category: "manifest", gate: "per-file", evidence: "Vendored Pal/Layout serialized fields; aliases remain advisory." },
    bannedFilenamePrefix: { severity: "error", category: "manifest", gate: "per-file", evidence: "Live server category-relative filename contract documented in palJson.js." },
    missingManifestFilename: { severity: "error", category: "manifest", gate: "per-file", evidence: "Push injects content through the typed wrapper filename field." },
    unusedFolderRegistration: { severity: "warn", category: "manifest", gate: "per-file", evidence: "PalBuilder empty-folder behavior documented in palFolders.js." },

    missingPalJsonEntry: { severity: "error", category: "cross-file", gate: "workspace-gate", evidence: "Live silent-push-skip incident documented in palJson.js." },
    malformedManifestEntry: { severity: "error", category: "cross-file", gate: "workspace-gate", evidence: "Push injects content only through typed manifest wrappers." },
    actionRouted: { severity: "both", category: "cross-file", gate: "workspace-gate", evidence: "Bundled workflow routing contract; default routing is advisory." },
    fragmentBinding: { severity: "error", category: "cross-file", gate: "workspace-gate", evidence: "Live test-02 fragment/payload mismatch documented in contracts.js." },
    listNameContract: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled c:list/DataList contract." },
    ajaxTargetExists: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled AJAX target contract." },
    destructiveConfirm: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled destructive-action UI policy." },
    fontDeclaredNotLoaded: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Live 2026-07-16 font fallback eval." },
    scriptWithoutConsumer: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Live 2026-07-16 unused-script eval." },
    pbControlClass: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled selective design-system contract." },
    pbHeadingClass: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled selective design-system contract." },
    pbTableClass: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled selective design-system contract." },
    pbActionAffordance: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled selective design-system contract." },
    pbUndefinedClass: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Workspace stylesheet/markup class contract." },
    pbSection: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled fragment shell contract." },
    pbMain: { severity: "warn", category: "cross-file", gate: "workspace-warning", evidence: "Bundled page shell contract." },

    reservedElWord: { severity: "warn", category: "contract", gate: "per-file", evidence: "Evidence incomplete; promote only after a vendored-source citation or live repro." },
    emptyAction: { severity: "error", category: "contract", gate: "per-file", evidence: "Static empty actions cannot route." },
    elSyntax: { severity: "error", category: "contract", gate: "per-file", evidence: "Only missing EL delimiters are checked; expression bodies are excluded." },
    hrefAction: { severity: "error", category: "contract", gate: "per-file", evidence: "Bundled c:a action transport contract." },
    formTag: { severity: "error", category: "contract", gate: "per-file", evidence: "Live server rejection of form tags in fragments." },
    paramDropped: { severity: "warn", category: "contract", gate: "per-file", evidence: "Markup/workflow action-parameter advisory." },
    ajaxTransport: { severity: "warn", category: "contract", gate: "per-file", evidence: "Bundled AJAX workflow contract." },
    pageResponseSource: { severity: "error", category: "contract", gate: "per-file", evidence: "Bundled controller page-response API contract." },
    staleVendor: { severity: "warn", category: "contract", gate: "per-file", evidence: "Known stale external-vendor dependency advisory." },
    missingFragment: { severity: "error", category: "contract", gate: "per-file", evidence: "Static fragment names must resolve to shipped markup." },
    pbSkipLink: { severity: "warn", category: "contract", gate: "per-file", evidence: "Bundled accessible skip-link recipe." },
    pbRowActionGroup: { severity: "warn", category: "contract", gate: "per-file", evidence: "Live equipment-checkout row-action eval." },
    pbConflictingStateActions: { severity: "warn", category: "contract", gate: "per-file", evidence: "Live equipment-checkout state-action eval." },
    pbFormRhythm: { severity: "warn", category: "contract", gate: "per-file", evidence: "Bundled form-layout design guidance." },
    referenceStylesheetShipped: { severity: "error", category: "contract", gate: "per-file", evidence: "Owner-approved policy gate (Sam, 2026-07-18): reference catalog must not ship at runtime." },
    designSystemBypass: { severity: "warn", category: "contract", gate: "per-file", evidence: "Bundled design-system ownership policy." },
};

function rulesForGate(gate) {
    return new Set(Object.entries(RULE_REGISTRY).filter(([, meta]) => meta.gate === gate).map(([code]) => code));
}

const WORKSPACE_GATE_RULES = rulesForGate("workspace-gate");
const WORKSPACE_WARNING_RULES = rulesForGate("workspace-warning");

module.exports = { RULE_REGISTRY, WORKSPACE_GATE_RULES, WORKSPACE_WARNING_RULES };
