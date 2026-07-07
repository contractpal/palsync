#!/usr/bin/env bash
# eval/setup-runs.sh — materialize the benchmark workspaces from the FROZEN specs.
#
# Two phases:
#   STAGE  (always, local, no creds): create eval/runs/<folder>/ for each row in eval/runs.map,
#          copy the matching frozen SPEC.md + EXECUTION.md into it, and place the shared
#          DESIGN_SYSTEM.md + COMPONENTS.md at eval/runs/ (the specs reference ../DESIGN_SYSTEM.md).
#   SETUP  (only with --setup AND CloudPiston creds): run `palsync setup --pal <name> --dir <folder>`
#          per row — pulls the empty pal + injects skills + writes .palsync.json. Requires you to
#          have already created each empty pal in PalBuilder (see eval/runs.map).
#
# eval/runs/ is gitignored (ephemeral, dirtied by builds). Re-run anytime to reset staging —
# STAGE overwrites the staged spec files but never touches pulled pal state unless you pass --setup.
#
# Usage:
#   ./eval/setup-runs.sh                    # stage only (safe, offline)
#   CP_USER=you@x.com CP_PASS=... ./eval/setup-runs.sh --setup   # stage + palsync setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPECS="$SCRIPT_DIR/specs"
RUNS="$SCRIPT_DIR/runs"
MAP="$SCRIPT_DIR/runs.map"

DO_SETUP=0
[ "${1:-}" = "--setup" ] && DO_SETUP=1

# folder prefix -> frozen scenario dir under eval/specs/
scenario_for() {
  case "$1" in
    01_*) echo "01_crud_equipment_checkout" ;;
    02_*) echo "02_data_structures_company_directory" ;;
    03_*) echo "03_console_tx_service_requests" ;;
    04_*) echo "04_interpal_tunnels_partner_bridge" ;;
    05_*) echo "05_marketing_website" ;;
    *)    echo "" ;;
  esac
}

[ -f "$MAP" ] || { echo "missing $MAP" >&2; exit 1; }

# shared design files live once at eval/runs/ so every spec's ../DESIGN_SYSTEM.md resolves.
mkdir -p "$RUNS"
cp "$SPECS/DESIGN_SYSTEM.md" "$SPECS/COMPONENTS.md" "$RUNS/"

echo "== STAGE =="
while read -r folder pal url _rest; do
  [ -z "${folder:-}" ] && continue
  case "$folder" in \#*) continue ;; esac
  scen="$(scenario_for "$folder")"
  if [ -z "$scen" ]; then echo "  ! $folder: unknown scenario prefix, skipped" >&2; continue; fi
  dest="$RUNS/$folder"
  mkdir -p "$dest"
  cp "$SPECS/$scen/SPEC.md" "$SPECS/$scen/EXECUTION.md" "$dest/"
  echo "  staged $folder  <- $scen  (pal: $pal)"
done < "$MAP"

if [ "$DO_SETUP" -ne 1 ]; then
  cat <<EOF

STAGE complete. eval/runs/ has 10 workspaces with specs + shared design files.

Remaining (needs your CloudPiston account — not doable offline):
  1. In PalBuilder, create one EMPTY pal per row in eval/runs.map (names as listed).
     Scenario 04 also needs the provider fixture pal named partner_catalog_static.
  2. Re-run with creds to pull + inject skills:
       CP_USER=you@example.com CP_PASS=... ./eval/setup-runs.sh --setup
  3. Launch each: point your harness/model at the workspace and run in auto mode.
       See eval/runs/README.md and eval/run.md.
EOF
  exit 0
fi

echo "== SETUP (palsync setup per workspace) =="
command -v palsync >/dev/null 2>&1 || { echo "palsync not on PATH; run: npm link (or use node bin/palsync.js)" >&2; exit 1; }
while read -r folder pal url _rest; do
  [ -z "${folder:-}" ] && continue
  case "$folder" in \#*) continue ;; esac
  [ -n "$(scenario_for "$folder")" ] || continue
  dest="$RUNS/$folder"
  echo "  setup $folder  (pal: $pal)"
  args=(setup --pal "$pal" --dir "$dest")
  [ -n "${url:-}" ] && args+=(--cloud "$url")
  palsync "${args[@]}"
  # re-assert specs in case setup rewrote the dir
  scen="$(scenario_for "$folder")"
  cp "$SPECS/$scen/SPEC.md" "$SPECS/$scen/EXECUTION.md" "$dest/"
done < "$MAP"
echo "done. Launch each workspace in auto mode; score with eval/scoring.md; log to eval/RESULTS.md."
