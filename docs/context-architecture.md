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
| All | `tool-definitions` | `src/mcp/tools.js` | 27,717 | 6,930 | release-stable |
| All | `contract-doc` | `bundled-context/CLAUDE.md + generator stamp` | 3,192 | 798 | release-stable |
| All | `skill-catalog` | `bundled-context/skills/*/SKILL.md#frontmatter` | 2,429 | 608 | release-stable |
| Claude/Codex/OpenCode | `sync-section` | `src/launcher/contextInject.js#syncSection` | 842 | 211 | workspace-stable |
| Pi | `sync-section` | `src/launcher/contextInject.js#syncSection` | 827 | 207 | workspace-stable |
| Claude | `sync-workflow` | `src/launcher/contextInject.js#syncDetails` | 8,886 | 2,222 | on-demand |
| Codex/OpenCode | `sync-workflow` | `src/launcher/contextInject.js#syncDetails` | 9,119 | 2,280 | on-demand |
| Pi | `sync-workflow` | `src/launcher/contextInject.js#syncDetails` | 7,182 | 1,796 | on-demand |
| All | `creating-files` | `src/launcher/contextInject.js#syncDetails` | 3,327 | 832 | on-demand |
| Claude/Codex/OpenCode | `datasets` | `src/launcher/contextInject.js#syncDetails` | 3,539 | 885 | on-demand |
| Pi | `datasets` | `src/launcher/contextInject.js#syncDetails` | 3,567 | 892 | on-demand |
| All | `skill-body:design-build` | `bundled-context/skills/design-build/SKILL.md` | 6,745 | 1,687 | on-demand |
| All | `skill-body:design-system-init` | `bundled-context/skills/design-system-init/SKILL.md` | 18,144 | 4,536 | on-demand |
| All | `skill-body:pal-fix` | `bundled-context/skills/pal-fix/SKILL.md` | 4,361 | 1,091 | on-demand |
| All | `skill-body:pal-init` | `bundled-context/skills/pal-init/SKILL.md` | 10,041 | 2,511 | on-demand |
| All | `skill-body:pal-loop` | `bundled-context/skills/pal-loop/SKILL.md` | 7,972 | 1,993 | on-demand |
| All | `skill-body:pal-review` | `bundled-context/skills/pal-review/SKILL.md` | 16,478 | 4,120 | on-demand |
| All | `skill-body:pal-spec` | `bundled-context/skills/pal-spec/SKILL.md` | 9,831 | 2,458 | on-demand |
| All | `skill-body:palbuilder-core` | `bundled-context/skills/palbuilder-core/SKILL.md` | 3,210 | 803 | on-demand |
| All | `skill-body:palbuilder-data` | `bundled-context/skills/palbuilder-data/SKILL.md` | 15,960 | 3,990 | on-demand |
| All | `skill-body:palbuilder-email` | `bundled-context/skills/palbuilder-email/SKILL.md` | 5,690 | 1,423 | on-demand |
| All | `skill-body:palbuilder-frontend` | `bundled-context/skills/palbuilder-frontend/SKILL.md` | 9,339 | 2,335 | on-demand |
| All | `skill-body:palbuilder-realtime` | `bundled-context/skills/palbuilder-realtime/SKILL.md` | 4,992 | 1,248 | on-demand |
| All | `skill-body:palbuilder-seo` | `bundled-context/skills/palbuilder-seo/SKILL.md` | 9,495 | 2,374 | on-demand |
| All | `skill-body:palbuilder-workflow` | `bundled-context/skills/palbuilder-workflow/SKILL.md` | 11,993 | 2,999 | on-demand |
| All | `skill-body:qa-report` | `bundled-context/skills/qa-report/SKILL.md` | 6,076 | 1,519 | on-demand |

<!-- palsync generated: end -->

## Generation flow

`contextInject.inject()` sorts every disk-derived list by code unit, renders the selected host
flavor, compares bytes, and atomically replaces only changed targets while following symlinks and
preserving target mode. It then emits `.palsync/context-manifest.json`. A changed generation rotates
the former file to `context-manifest.prev.json`; an identical generation writes nothing.

The manifest orders tool definitions, contract, skill catalog, sync tail, then the on-demand sync
details and per-skill bodies; only the release-stable and workspace-stable sections above are eager.
`palsync ctx inspect` reports release-stable bytes versus the workspace-stable tail; `palsync ctx diff`
reports the first divergent section. Task files and live pal state are intentionally absent, so normal
work cannot churn generated context.

## Runtime limits

- Claude Code documents deferred tool search; other supported hosts do not expose equivalent
  third-party behavior, so PalSync does not dynamically register profiles.
- Pi uses CLI instructions and its installed MCP adapter does not surface server instructions.
- Provider prompt-cache status is not observable. Manifest percentages are local estimates only.
