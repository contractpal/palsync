# Context architecture

Tool-definition bytes are the full advertised wire representation; skill-catalog bytes are the
deterministic name/description representation. Skill bodies are excluded from eager totals.

<!-- palsync generated: context measurement table (scripts/gen-context-architecture.js) -->

Measured on PalSync 0.30.0 from `.palsync/context-manifest.json`, the artifact
`contextInject` emits for a real workspace. Token estimates are the manifest's own
`estimatedTokens`. Regenerate with `node scripts/gen-context-architecture.js` — never hand-edit
these numbers; a hand-edit is how this table came to claim 16,689 tool-definition bytes on a
basis that could not be reproduced.

| Runtime | Section | Source | Bytes | Est. tokens | Loading |
|---|---|---|---:|---:|---|
| All | `tool-definitions` | `src/mcp/tools.js` | 30,303 | 7,576 | release-stable |
| All | `contract-doc` | `bundled-context/CLAUDE.md + generator stamp` | 3,274 | 819 | release-stable |
| All | `skill-catalog` | `bundled-context/skills/*/SKILL.md#frontmatter` | 2,260 | 565 | release-stable |
| Claude | `sync-section` | `src/launcher/contextInject.js#syncSection` | 2,403 | 601 | workspace-stable |
| Codex/OpenCode | `sync-section` | `src/launcher/contextInject.js#syncSection` | 2,403 | 601 | workspace-stable |
| Pi | `sync-section` | `src/launcher/contextInject.js#syncSection` | 2,388 | 597 | workspace-stable |
| Claude | `sync-workflow` | `src/launcher/contextInject.js#syncDetails` | 8,703 | 2,176 | on-demand |
| Codex/OpenCode | `sync-workflow` | `src/launcher/contextInject.js#syncDetails` | 8,936 | 2,234 | on-demand |
| Pi | `sync-workflow` | `src/launcher/contextInject.js#syncDetails` | 6,901 | 1,726 | on-demand |
| All | `creating-files` | `src/launcher/contextInject.js#syncDetails` | 4,978 | 1,245 | on-demand |
| Claude/Codex/OpenCode | `datasets` | `src/launcher/contextInject.js#syncDetails` | 3,539 | 885 | on-demand |
| Pi | `datasets` | `src/launcher/contextInject.js#syncDetails` | 3,567 | 892 | on-demand |
| All | `skill-body:design-build` | `bundled-context/skills/design-build/SKILL.md` | 4,862 | 1,216 | on-demand |
| All | `skill-body:design-system-init` | `bundled-context/skills/design-system-init/SKILL.md` | 18,126 | 4,532 | on-demand |
| All | `skill-body:pal-fix` | `bundled-context/skills/pal-fix/SKILL.md` | 4,167 | 1,042 | on-demand |
| All | `skill-body:pal-loop` | `bundled-context/skills/pal-loop/SKILL.md` | 8,611 | 2,153 | on-demand |
| All | `skill-body:pal-review` | `bundled-context/skills/pal-review/SKILL.md` | 16,744 | 4,186 | on-demand |
| All | `skill-body:pal-spec` | `bundled-context/skills/pal-spec/SKILL.md` | 10,398 | 2,600 | on-demand |
| All | `skill-body:palbuilder-core` | `bundled-context/skills/palbuilder-core/SKILL.md` | 3,210 | 803 | on-demand |
| All | `skill-body:palbuilder-data` | `bundled-context/skills/palbuilder-data/SKILL.md` | 15,966 | 3,992 | on-demand |
| All | `skill-body:palbuilder-email` | `bundled-context/skills/palbuilder-email/SKILL.md` | 5,690 | 1,423 | on-demand |
| All | `skill-body:palbuilder-frontend` | `bundled-context/skills/palbuilder-frontend/SKILL.md` | 9,339 | 2,335 | on-demand |
| All | `skill-body:palbuilder-realtime` | `bundled-context/skills/palbuilder-realtime/SKILL.md` | 4,992 | 1,248 | on-demand |
| All | `skill-body:palbuilder-seo` | `bundled-context/skills/palbuilder-seo/SKILL.md` | 9,624 | 2,406 | on-demand |
| All | `skill-body:palbuilder-workflow` | `bundled-context/skills/palbuilder-workflow/SKILL.md` | 11,993 | 2,999 | on-demand |
| All | `skill-body:qa-report` | `bundled-context/skills/qa-report/SKILL.md` | 7,485 | 1,872 | on-demand |

<!-- palsync generated: end -->

## Generation flow

`contextInject.inject()` sorts every disk-derived list by code unit, renders the selected host
flavor, compares bytes, and atomically replaces only changed targets while following symlinks and
preserving target mode. It then emits `.palsync/context-manifest.json`. A changed generation rotates
the former file to `context-manifest.prev.json`; an identical generation writes nothing.

The manifest orders tool definitions, contract, skill catalog, sync tail, then the on-demand sync
details and per-skill bodies; only the release-stable and workspace-stable sections above are eager.
`pal_stats` / `palsync stats` reports release-stable bytes versus the workspace-stable tail and the
first divergent section. Task files and live pal state are intentionally absent, so normal
work cannot churn generated context.

## Runtime limits

- Claude Code documents deferred tool search; other supported hosts do not expose equivalent
  third-party behavior, so PalSync does not dynamically register profiles.
- Pi uses CLI instructions and its installed MCP adapter does not surface server instructions.
- Provider prompt-cache status is not observable. Manifest percentages are local estimates only.
