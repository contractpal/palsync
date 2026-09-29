# Lazy tool activation by harness

Status: accepted (2026-07-17). Revised 2026-09-02 (Claude Code → eager)

Pi and Claude Code are PalSync's primary harnesses. They may start with a small core tool set and activate additional tools additively during a session. Keyword routing remains deterministic; no model selects or removes tools.

Codex CLI and OpenCode retain the complete static tool set. This intentionally reverses the earlier cross-host parity decision: optimizing the two primary harnesses saves recurring schema context while keeping a fail-open, compatible path everywhere else.

The static MCP surface remains available when lazy loading is unsupported or the native Pi extension is absent. Activation must never change tool behavior or model-visible results.

## Revision 2026-09-02 — Claude Code boots the full static set (eager)

Claude Code now boots the FULL static set (profile "claude" = all tools, no pal_tools).
Claude Code re-renders the entire prompt prefix when the tool list changes, so a mid-session
pal_tools activation guaranteed full-prefix KV-cache invalidations — and every real session
activated at least once, because the 3-tool core (pal_validate, pal_spec_lint, pal_context)
cannot push, test, or preview. Lazy loading there saved schema tokens once while invalidating
the whole cached prefix on every activation: a net loss.

Pi keeps lazy activation. Pi applies purely additive active-set changes at the tool-result
position, preserving the stable prefix for cache-aware models — so eager there would add
~10K tokens of schemas to every prefix for no hit-rate gain. Before the first agent response,
the native extension may add only explicitly named `pal_*` tools, narrow screenshot/exercise
requests, or the fixed requirements of an exactly-expanded bundled `pal-review` skill. Generic
prose does not activate groups; `pal_tools` remains the fallback. Codex CLI and OpenCode keep the
complete static set as before.

## Revision 2026-09-29 — the server no longer gates tools

The server once carried its own profiles (`PROFILE_TOOLS`, `PALSYNC_TOOL_PROFILE`) and disabled every
tool outside the active profile. Pi's native extension duplicated that gate with `pi.setActiveTools`,
and the two disagreed: a tool the extension activated in `before_agent_start` (for example
`pal_test` or `pal_screenshot` for a review turn) stayed disabled on the server, so the model's
first call failed with "Tool pal_test disabled". Every other host already received the full static
set, so the server-side gate added no capability the model could not already reach — it only refused
tools the harness had exposed. The profile mechanism is gone: every `TOOLS` entry is registered and
listed by every host, and the server has no `pal_tools` tool. Pi keeps its prompt lazy via
`setActiveTools`; its extension is the only prompt gate.
