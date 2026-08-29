# Pi integration

`palsync setup --agent pi` installs the native extension at `~/.pi/agent/extensions/palsync/`. Pi loads its TypeScript entry directly; no build step is required.

The extension exposes `pal_tools`, `pal_context`, `pal_validate`, and `pal_spec_lint` initially. `pal_tools({query})` activates matching tools additively using the deterministic groups `sync`, `browser`, `runtime`, `project`, and `spec`. Its result immediately states any `pal_impact`/`pal_ast` routing guidance, and Pi keeps the same guidance in the system Guidelines while those tools are active. The MCP server starts only when a PalSync tool is first called.

## Existing pi-mcp installation

Do not serve PalSync through both integrations. If the general `pi-mcp` extension is installed, add an explicit `palsync` server entry to its configuration with `"lifecycle":"lazy"`; that prevents its `.palsync.json` auto-detection from eagerly exposing the duplicate static tool set. PalSync reports the collision but never edits third-party configuration.

## Manual smoke

1. Open Pi in a workspace containing `.palsync.json`.
2. Confirm only `pal_tools`, `pal_context`, `pal_validate`, and `pal_spec_lint` are initially active.
3. Call `pal_tools` with `browser testing`.
4. Confirm preview, fetch, screenshot, exercise, SEO, and runtime-test tools were added and the original tools remain active.
5. Call `pal_tools` with `project` and confirm its result includes routing guidance for `pal_impact` and `pal_ast`.

The legacy static `pi-mcp` path remains a fail-open fallback when the native extension is absent.

## Provider cache retention

`PI_CACHE_RETENTION` is a Pi/provider setting, not a PalSync guarantee. Use only a value supported by the selected provider and account; unsupported providers may ignore it. PalSync keeps tool schemas and results deterministic to improve cache locality but cannot observe or promise provider cache hits.

## Telemetry

The native extension appends local JSONL to `.palsync/pi-usage.jsonl`:

```json
{"schema":"palsync/pi-usage/1","tool":"pal_validate","bytes":123,"tokenEstimate":31,"provider":null,"model":null,"cost":null,"currency":null,"isError":false}
```

Text tokens use the same bytes/4 estimator as `palsync cost`; image estimates use pixel dimensions. Provider/model are recorded only when Pi reports them. Cost and currency remain `null` because tool-result events do not report billing. `palsync cost` summarizes this sidecar separately and never turns estimates into spend.

Pi 0.80.10 exposes compaction events but its `session_before_compact` result cannot contribute context or instructions. PalSync therefore installs no custom summarizer or compaction mutation; details refs remain available in tool trailers. Revisit when Pi provides an additive compaction-content API.

Middleware order: PalSync semantic condensation → Agent Trim generic trimming → observers/telemetry. Agent Trim must preserve the final `Full result:` trailer.

## Session handoff

Before dispatching `pal-review` or stopping a session, run `palsync session-summary [--mode full|lite] [--next "<text>"] [--dir <workspace>]` to append the canonical two-line handoff summary. Counts and session number are derived from the parsed `EXECUTION.md` task table and the checkpoint is appended through the validated checkpoint gate in a single atomic write.
