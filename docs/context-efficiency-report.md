# Context-efficiency implementation report

## Shipped

- Deterministic, code-unit-sorted generation with content comparison, atomic replacement, symlink
  following, mode preservation, and stable mtimes across instructions, skills, OpenCode commands,
  `.mcp.json`, and `opencode.json`.
- Versioned context manifests, previous-generation diffs, `palsync context inspect|diff`, and a
  locally stable-prefix summary in `palsync cost`.
- A committed snapshot of all 20 advertised MCP wire schemas plus additive
  server instructions. Safety wording remains in tool descriptions because Pi drops instructions.
- Rule-grouped validation/server/SEO output with all unique rules, fixes, and locations preserved;
  full structured results use a stable `.agent-work-history` trailer.
- Content-addressed per-file lint caching with exact content, path, validator version, PalSync
  version, operation mode, and contextual dependency fingerprints.
- `.palsync.usage.json` v2 with raw/returned bytes, condensation, cache hits and misses, duration,
  largest response, and changed context-generation events. Provider-reported cached tokens remain
  separate from local estimates.
- Agent Trim interoperability contract and a deterministic local benchmark.

## Applied principles

Stable prefixes must be byte-stable, large optional knowledge belongs behind progressive disclosure,
and local caches must key every input that can change a result. Observability labels facts by owner:
PalSync reports local bytes/hashes; a harness may report provider tokens; neither is presented as a
provider cache hit.

## Benchmark results

`node eval/benchmark-context.js` reports measured current behavior against the modeled v0.27
formatter/write baseline recorded in `eval/context-efficiency-baseline.json`:

| Scenario | Before | After |
|---|---:|---:|
| Repeated inject | every generated file rewritten | 0 writes |
| Pal-name change | whole instruction file churn, unexplained | `sync-section` identified |
| Skill source edit | unobservable | isolated source edit identifies the exact skill body |
| Tool schema edit | unreviewed | 16,689-byte committed snapshot detects the edit |
| 25 duplicate lint findings | 2,139 B | 815 B (61.9% smaller) |
| Clean validation | 117 B | 106 B (9.4% smaller) |
| Repeated `pal_validate` | 0% local hits | 100% per-file local hits after one cold miss |

Current eager manifest measurement is 48,544 B for the Codex fixture, of which 33,813 B is
release-stable and 14,731 B is the workspace-stable sync tail. This is a local byte model, not a
provider billing or cache measurement.

## Cache correctness model

Only pure local lint results are cached. Keys include cache-format version, PalSync version,
`RULES_VERSION`, relative path, operation mode, content hash, and dependency context. Markup keys
include `parseable:false` and design-system presence; SPEC keys include MAP presence. Cross-file
contracts, `pal.json` workspace checks, baseline comparison, gate decisions, locks, drift, pulls,
debug, previews, screenshots, tunnels, browser state, and all live server results are recomputed.
`PALSYNC_NO_CACHE=1` bypasses entries. The push gate's baseline-diff and workspace-rule logic is
unchanged.

## Runtime limitations

- Claude Code now documents deferred MCP tool search; Codex/Pi/OpenCode do not document equivalent
  cache-preserving third-party loading. The static 20-tool set remains the Codex/OpenCode contract.
- Pi's installed adapter does not surface MCP server instructions, so shared safety prose cannot be
  removed from tool descriptions.
- OpenAI/Anthropic provider cache status is unavailable to PalSync. `tokensCached` is shown only when
  supplied by the harness sidecar and labeled provider-reported.
- The benchmark is deterministic and offline; it does not replace one live smoke launch on each host.

## Rejected or descoped

| Item | Decision | Reason |
|---|---|---|
| Fixed tool profiles | Reject | Small savings fragment capabilities and host cache prefixes. |
| Dynamic/deferred registration | Reject cross-host implementation | Claude supports tool search now; parity and safe behavior are absent across the other hosts. |
| Aggressive schema slimming | Descope | Snapshot makes changes reviewable; existing descriptions carry distinct safety semantics. |
| Plan-template caching | Reject | External/workspace state makes correctness unbounded for spec-to-ship. |
| Whole-workspace validation cache | Reject | Any edit destroys reuse and broadens push-bypass risk; per-file keys are exact. |
| Live server-result caching, LLM summarization, remote telemetry | Reject | Violates PalSync's safety/locality model. |

## Verification and residual risk

The full Node test suite passes, including unchanged `test/pushGate.test.js` invariants. Focused tests
cover deterministic hashes/mtimes, symlinks and file modes, manifest isolation, wire snapshots,
semantic preservation and response limits, cache invalidation/bypass, usage migration, and benchmark
determinism. Context-generation telemetry records changed generations only, preserving the zero-write
invariant; the previous manifest intentionally means the previous changed generation. Atomic replace
preserves POSIX mode but does not promise ACL, extended-attribute, or hard-link identity preservation.
Residual risk is host UI behavior: a manual launch on Claude, Codex, Pi, and OpenCode is still
required to confirm each installed host displays instructions/skills/tools as documented.
