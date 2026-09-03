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
~10K tokens of schemas to every prefix for no hit-rate gain. Codex CLI and OpenCode keep the
complete static set as before.
