#!/usr/bin/env bash
# eval/goal/run.sh — run ONE goal-eval workspace with Claude Code and record run metadata.
#
# The arm letter comes from <workspace>/.eval-arm (written by setup.sh). The prompt is
# eval/goal/arms/<ARM>.md. Output goes to <workspace>/.eval/claude-result.json.
#
# Refuses to run when an oracle.json exists anywhere in the workspace: the oracle is hidden
# from the model, and a stray copy would void the run.
#
# Usage:
#   ./eval/goal/run.sh <folder>            # folder name under eval/runs/
#   MAIN_MODEL=claude-sonnet-5-5 ./eval/goal/run.sh <folder>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS="$ROOT/eval/runs"

FOLDER="${1:-}"
if [ -z "$FOLDER" ]; then
  echo "Usage: ./eval/goal/run.sh <folder>" >&2
  exit 1
fi
case "$FOLDER" in
  ""|.*|*/*|*..*) echo "invalid folder name: $FOLDER" >&2; exit 1 ;;
esac

WS="$RUNS/$FOLDER"
[ -d "$WS" ] || { echo "no workspace: $WS (run ./eval/goal/setup.sh first)" >&2; exit 1; }
[ -f "$WS/.eval-arm" ] || { echo "missing $WS/.eval-arm (run ./eval/goal/setup.sh)" >&2; exit 1; }

ARM="$(tr -d '[:space:]' < "$WS/.eval-arm")"
case "$ARM" in
  A|B|C|D) ;;
  *) echo "invalid arm \"$ARM\" in $WS/.eval-arm" >&2; exit 1 ;;
esac

PROMPT="$SCRIPT_DIR/arms/$ARM.md"
[ -f "$PROMPT" ] || { echo "missing prompt: $PROMPT" >&2; exit 1; }

if find "$WS" -name oracle.json -print -quit | grep -q .; then
  echo "REFUSING: an oracle.json exists in $WS — the oracle must stay outside the run workspace." >&2
  exit 1
fi

mkdir -p "$WS/.eval"

MODEL="${MAIN_MODEL:-claude-opus-5-5}"
# Isolation: a clean Claude config dir keeps the operator's user hooks, agents, CLAUDE.md, and
# model proxy out of the run. It holds only a copy of the Claude login (.credentials.json).
EVAL_CONFIG="${EVAL_CLAUDE_CONFIG_DIR:-$HOME/.palsync-eval/claude-config}"
if [ -f "$EVAL_CONFIG/.credentials.json" ]; then CLEAN_CONFIG=true; else CLEAN_CONFIG=false; EVAL_CONFIG=""; fi
START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
CLAUDE_VERSION="$(claude --version 2>/dev/null | head -n 1 || echo unknown)"

echo "run $FOLDER (arm $ARM, model $MODEL) at $START"

set +e
(
  cd "$WS"
  if [ -n "$EVAL_CONFIG" ]; then export CLAUDE_CONFIG_DIR="$EVAL_CONFIG"; fi
  claude --model "$MODEL" --dangerously-skip-permissions --output-format json \
    --mcp-config .mcp.json --strict-mcp-config \
    -p "$(cat "$PROMPT")" > .eval/claude-result.json
)
RC=$?
set -e

END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node - "$WS/.eval/run-meta.json" "$FOLDER" "$ARM" "$MODEL" "$START" "$END" \
  "$COMMIT" "$CLAUDE_VERSION" "$RC" "$CLEAN_CONFIG" <<'NODE'
const fs = require("fs");
const [file, folder, arm, model, start, end, palsyncCommit, claudeVersion, rc, cleanConfig] = process.argv.slice(2);
const meta = {
    schema: "palsync/goal-run-meta/1",
    folder,
    arm,
    model,
    start,
    end,
    palsyncCommit,
    claudeVersion,
    exitCode: Number(rc),
    cleanConfig: cleanConfig === "true"
};
fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n", "utf8");
NODE

echo "done $FOLDER at $END (exit $RC); wrote $WS/.eval/run-meta.json"
exit "$RC"
