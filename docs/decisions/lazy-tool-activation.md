# Lazy tool activation by harness

Status: accepted (2026-07-17)

Pi and Claude Code are PalSync's primary harnesses. They may start with a small core tool set and activate additional tools additively during a session. Keyword routing remains deterministic; no model selects or removes tools.

Codex CLI and OpenCode retain the complete static tool set. This intentionally reverses the earlier cross-host parity decision: optimizing the two primary harnesses saves recurring schema context while keeping a fail-open, compatible path everywhere else.

The static MCP surface remains available when lazy loading is unsupported or the native Pi extension is absent. Activation must never change tool behavior or model-visible results.
