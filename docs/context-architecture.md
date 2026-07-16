# Context architecture

Measured on PalSync 0.27.0 after deterministic manifest generation. Token estimates use `bytes/4`.
Tool-definition bytes are the full advertised wire representation; skill-catalog bytes are the
deterministic name/description representation. Skill bodies are excluded from eager totals.

| Runtime | Component | Source | Destination | Bytes | Est. tokens | Stability | Trigger | Loading |
|---|---|---|---|---:|---:|---|---|---|
| All MCP hosts | Tool definitions | `src/mcp/tools.js` | MCP `tools/list` | 16,689 | 4,173 | release-stable | PalSync/schema upgrade | Host-dependent; Claude may defer |
| Claude | Contract | `bundled-context/CLAUDE.md` + generator stamp | `CLAUDE.palsync.md` via `CLAUDE.md` import | 11,711 | 2,928 | release-stable | PalSync upgrade | eager |
| Codex/OpenCode/Pi | Contract | same | managed `AGENTS.md` block | 11,711 | 2,928 | release-stable | PalSync upgrade/agent switch | eager |
| All | Skill catalog | skill frontmatter | host skill discovery | 5,413 | 1,354 | release-stable | skill/frontmatter upgrade | eager catalog |
| Claude | Sync section | `contextInject.js#syncSection` | `CLAUDE.palsync.md` | 14,498 | 3,625 | workspace-stable | pal name/agent/version | eager |
| Codex/OpenCode | Sync section | same | managed `AGENTS.md` block | 14,731 | 3,683 | workspace-stable | pal name/agent/version | eager |
| Pi | CLI sync section | same | managed `AGENTS.md` block | 12,891 | 3,223 | workspace-stable | pal name/agent/version | eager |
| OpenCode | Slash wrappers | generated per skill | `.opencode/commands/*.md` | per skill | bytes/4 | release-stable | skill set upgrade | on command discovery |
| All | Skill bodies | `bundled-context/skills/*/SKILL.md` | `.claude/skills` or `.agents/skills` | per manifest | bytes/4 | release-stable | skill upgrade | on demand |

## Generation flow

`contextInject.inject()` sorts every disk-derived list by code unit, renders the selected host
flavor, compares bytes, and atomically replaces only changed targets while following symlinks and
preserving target mode. It then emits `.palsync/context-manifest.json`. A changed generation rotates
the former file to `context-manifest.prev.json`; an identical generation writes nothing.

The manifest orders tool definitions, contract, skill catalog, sync tail, then per-skill bodies.
Only the first four are eager. `palsync context inspect` reports release-stable bytes versus the
workspace-stable tail; `context diff` reports the first divergent section. Task files and live pal
state are intentionally absent, so normal work cannot churn generated context.

## Runtime limits

- Claude Code documents deferred tool search; other supported hosts do not expose equivalent
  third-party behavior, so PalSync does not dynamically register profiles.
- Pi uses CLI instructions and its installed MCP adapter does not surface server instructions.
- Provider prompt-cache status is not observable. Manifest percentages are local estimates only.
