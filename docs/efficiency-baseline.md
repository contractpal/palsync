# Efficiency baseline

Measured locally with `node eval/benchmark-context.js --json`; no live model or provider-cache claims.

| Metric | Baseline |
|---|---:|
| Eager context | 49,219 B |
| Release-stable prefix | 34,176 B |
| Workspace-stable tail | 15,043 B |
| Tool schemas | 16,861 B |
| Repeated lint-cache hit rate | 100.0% (1 hit, 0 misses after 1 cold miss) |
| `pal_validate` clean fixture result | 106 B |
| `pal_validate` diagnostic fixture result | 815 B |

After eager-context reduction (M4):

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Eager context | 49,219 B | 38,101 B | -11,118 B (-22.6%) |
| Workspace-stable tail | 15,043 B | 1,582 B | -13,461 B (-89.5%) |
| Release-stable prefix | 34,176 B | 36,519 B | +2,343 B (new tool schema) |
| Tool schemas | 16,861 B | 19,204 B | +2,343 B (`pal_context` + envelope options) |
| Incremental lint-cache hit rate | 61.5% observed audit | 95.0% synthetic harness | +33.5 points |

The lint harness edits one of 20 files per round across ten rounds. Dependency fingerprints invalidate only affected entries; miss counters distinguish content, dependency, rule-version, PalSync-version, eviction, and cold misses. Lock, drift, remote state, manifest contracts, and workspace gates remain uncached.

The checked-in JSON is generated from the existing context benchmark. Repeated runs are byte-identical and serve as the before/after input for later milestones.
