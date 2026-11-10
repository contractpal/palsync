#!/usr/bin/env bash
# eval/goal/setup.sh — stage and set up the goal-only eval workspaces.
#
# Reads eval/goal/runs.map: <folder> <server_pal_name> <arm> [cloud_url]
#
# Two phases (mirrors eval/setup-runs.sh):
#   STAGE  (always, local, no creds): create eval/runs/<folder>/ and copy the workspace docs:
#          arm A -> eval/specs/01_crud_equipment_checkout/{SPEC.md,EXECUTION.md}
#          arm B/C/D -> eval/goal/01_equipment_checkout/GOAL.md
#          Also writes <folder>/.eval-arm (the arm letter, read by run.sh).
#          oracle.json is EVALUATOR-OWNED and is NEVER copied.
#   SETUP  (only with --setup AND CloudPiston creds): `palsync setup --pal <name> --dir <folder>`
#          per row, then re-copies the staged docs.
#
# eval/runs/ is gitignored. --reset deletes ONLY the folders named in this eval's runs.map;
# it never touches the benchmark folders staged by eval/setup-runs.sh.
#
# Usage:
#   ./eval/goal/setup.sh                              # stage only (safe, offline)
#   ./eval/goal/setup.sh --reset                      # discard and re-stage this eval's workspaces
#   CP_USER=you@x.com CP_PASS=... ./eval/goal/setup.sh --reset --setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS="$ROOT/eval/runs"
MAP="$SCRIPT_DIR/runs.map"

# Folder prefix -> frozen arm-A spec dir and goal scenario dir.
scenario_dirs() {
  case "$1" in
    goal01_*) echo "$ROOT/eval/specs/01_crud_equipment_checkout $SCRIPT_DIR/01_equipment_checkout" ;;
    goal03_*) echo "$ROOT/eval/specs/03_console_tx_service_requests $SCRIPT_DIR/03_service_requests" ;;
    *) echo "" ;;
  esac
}

DO_SETUP=0
DO_RESET=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --setup) DO_SETUP=1 ;;
    --reset) DO_RESET=1 ;;
    --only) shift; ONLY="${1:-}" ;;
    *) echo "unknown argument: $1 (use --setup, --reset, --only <folder-prefix>)" >&2; exit 1 ;;
  esac
  shift
done

# --only limits every phase (including --reset) to folders with this prefix.
selected() { [ -z "$ONLY" ] || case "$1" in "$ONLY"*) return 0 ;; *) return 1 ;; esac; }

[ -f "$MAP" ] || { echo "missing $MAP" >&2; exit 1; }

valid_folder() {
  case "$1" in
    ""|.*|*/*|*..*) return 1 ;;
    *) return 0 ;;
  esac
}

# Re-assert the staged docs for one workspace. Removes the other arm's docs so an arm change
# cannot leave two competing instruction sets in place. Never writes oracle.json.
stage() {
  local folder="$1" arm="$2"
  local dest="$RUNS/$folder" dirs specs goal
  dirs="$(scenario_dirs "$folder")"
  [ -n "$dirs" ] || { echo "  ! $folder: unknown scenario prefix, skipped" >&2; return 1; }
  specs="${dirs%% *}"; goal="${dirs##* }"
  for f in "$specs/SPEC.md" "$specs/EXECUTION.md" "$goal/GOAL.md"; do
    [ -f "$f" ] || { echo "  ! missing $f" >&2; return 1; }
  done
  mkdir -p "$dest"
  rm -f "$dest/SPEC.md" "$dest/EXECUTION.md" "$dest/GOAL.md"
  case "$arm" in
    A) cp "$specs/SPEC.md" "$specs/EXECUTION.md" "$dest/" ;;
    B|C|D) cp "$goal/GOAL.md" "$dest/" ;;
    *) echo "  ! $folder: unknown arm \"$arm\", skipped" >&2; return 1 ;;
  esac
  printf '%s\n' "$arm" > "$dest/.eval-arm"
}

if [ "$DO_RESET" -eq 1 ]; then
  echo "== RESET (goal-eval workspaces only) =="
  mkdir -p "$RUNS"
  while read -r folder _pal _arm _rest; do
    [ -z "${folder:-}" ] && continue
    case "$folder" in \#*) continue ;; esac
  selected "$folder" || continue
    if ! valid_folder "$folder"; then
      echo "  ! refusing unsafe folder name: $folder" >&2
      continue
    fi
    if [ -d "$RUNS/$folder" ]; then
      rm -rf "$RUNS/$folder"
      echo "  removed $folder"
    fi
  done < "$MAP"
fi

mkdir -p "$RUNS"

echo "== STAGE =="
while read -r folder pal arm url _rest; do
  [ -z "${folder:-}" ] && continue
  case "$folder" in \#*) continue ;; esac
  selected "$folder" || continue
  if ! valid_folder "$folder"; then
    echo "  ! $folder: unsafe folder name, skipped" >&2
    continue
  fi
  if ! stage "$folder" "$arm"; then
    continue
  fi
  case "$arm" in
    A) echo "  staged $folder  <- arm A (SPEC.md + EXECUTION.md, pal: $pal)" ;;
    *) echo "  staged $folder  <- arm $arm (GOAL.md only, pal: $pal)" ;;
  esac
done < "$MAP"

if [ "$DO_SETUP" -ne 1 ]; then
  cat <<EOF

STAGE complete. Workspaces are under eval/runs/.

Remaining (needs your CloudPiston account — not doable offline):
  1. In PalBuilder, create one EMPTY console pal per row in eval/goal/runs.map.
  2. Re-run with creds to pull + inject skills into each workspace:
       CP_USER=you@example.com CP_PASS=... ./eval/goal/setup.sh --reset --setup
  3. Run each workspace from the repo root: ./eval/goal/run.sh <folder>
  4. Score it: node scripts/score-goal-eval.js --dir eval/runs/<folder> --arm <A-D> --trial <n>

oracle.json is never staged.
EOF
  exit 0
fi

echo "== SETUP (palsync setup per workspace) =="
if ! command -v palsync >/dev/null 2>&1; then
  echo "palsync not on PATH; run: npm link (or use node bin/palsync.js)" >&2
  exit 1
fi
while read -r folder pal arm url _rest; do
  [ -z "${folder:-}" ] && continue
  case "$folder" in \#*) continue ;; esac
  selected "$folder" || continue
  valid_folder "$folder" || continue
  dest="$RUNS/$folder"
  echo "  setup $folder  (pal: $pal, arm: $arm)"
  args=(setup --pal "$pal" --dir "$dest")
  [ -n "${url:-}" ] && args+=(--cloud "$url")
  palsync "${args[@]}"
  # setup may rewrite the workspace dir; re-assert the staged docs and arm marker.
  stage "$folder" "$arm"
done < "$MAP"
echo "done. Run each workspace with ./eval/goal/run.sh <folder>."
