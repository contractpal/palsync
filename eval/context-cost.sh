#!/usr/bin/env bash
# eval/context-cost.sh — static context-cost snapshot of palsync's always-loaded surface.
#
# Measures the token-adjacent size of everything the agent carries as context:
#   - bundled-context/CLAUDE.md
#   - every skill's SKILL.md
#   - every skill references/* file (loaded on demand, but part of the skill's cost budget)
#   - the always-on metadata cost: total frontmatter `description:` chars across all skills
#     (a skill's description is loaded EVERY session, whether or not the skill fires)
#   - total MCP tool `description` chars in src/mcp/tools.js (same — always in the tool list)
#
# Prints tables + grand totals. Sessions 2-3 diff their snapshot against the committed baseline
# (eval/context-cost-baseline.txt) to prove context shrank. Per-skill rows also give the teammate
# a cost readout as new palbuilder skills land.
#
# Char count is the portable proxy for tokens (~4 chars/token for English prose). No tokenizer
# dependency; the diff between snapshots is what matters, and chars diff monotonically with tokens.
set -euo pipefail

# Resolve repo root from this script's location so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SKILLS_DIR="bundled-context/skills"
CLAUDE_MD="bundled-context/CLAUDE.md"
TOOLS_JS="src/mcp/tools.js"

# words / chars for one file → echoes "<words> <chars>"
wc_wc() { wc -w -c < "$1" | awk '{print $1, $2}'; }

# ---- frontmatter description chars for one SKILL.md ----
# Grabs the `description:` value from the YAML frontmatter and prints its char count. Handles both
# inline (`description: "..."`) and folded/literal block scalars (`description: >` then indented
# lines) — block lines are joined with single spaces, matching how the description is consumed.
desc_chars() {
  awk '
    /^---[[:space:]]*$/ { c++; if (c==2) exit; next }
    c==1 && !started && /^description:/ {
      started=1
      val=$0; sub(/^description:[[:space:]]*/, "", val)
      if (val ~ /^[>|][+-]?[[:space:]]*$/) { block=1; next }   # block scalar opener
      sub(/^"/, "", val); sub(/"[[:space:]]*$/, "", val)
      sub(/^'\''/, "", val); sub(/'\''[[:space:]]*$/, "", val)
      total=length(val); next
    }
    c==1 && block {
      if ($0 ~ /^[^[:space:]]/) { block=0; next }              # next frontmatter key ends block
      line=$0; sub(/^[[:space:]]+/, "", line)
      if (total>0) total+=1                                    # joining space
      total+=length(line); next
    }
    END { print total+0 }
  ' "$1"
}

printf '=== palsync context-cost snapshot ===\n'
printf 'repo SHA: %s\n\n' "$(git rev-parse --short HEAD 2>/dev/null || echo '(no git)')"

# ---------- 1. File sizes ----------
printf '%-58s %8s %9s\n' 'FILE' 'WORDS' 'CHARS'
printf '%-58s %8s %9s\n' '----' '-----' '-----'

TOTAL_W=0; TOTAL_C=0

emit_row() {
  local f="$1"
  [ -f "$f" ] || return 0
  read -r w c < <(wc_wc "$f")
  printf '%-58s %8d %9d\n' "$f" "$w" "$c"
  TOTAL_W=$((TOTAL_W + w)); TOTAL_C=$((TOTAL_C + c))
}

emit_row "$CLAUDE_MD"

# SKILL.md files (sorted)
while IFS= read -r f; do emit_row "$f"; done < <(find "$SKILLS_DIR" -name SKILL.md | sort)

# references/* files (sorted)
while IFS= read -r f; do emit_row "$f"; done < <(find "$SKILLS_DIR" -path '*/references/*' -type f | sort)

printf '%-58s %8s %9s\n' '----' '-----' '-----'
printf '%-58s %8d %9d\n\n' 'FILE TOTAL' "$TOTAL_W" "$TOTAL_C"

# ---------- 2. Always-on metadata: skill description chars ----------
printf '=== always-on metadata: skill frontmatter description chars ===\n'
printf '%-40s %9s\n' 'SKILL' 'DESC CHARS'
printf '%-40s %9s\n' '-----' '----------'
DESC_TOTAL=0
while IFS= read -r f; do
  name="$(basename "$(dirname "$f")")"
  dc="$(desc_chars "$f")"; dc="${dc:-0}"
  printf '%-40s %9d\n' "$name" "$dc"
  DESC_TOTAL=$((DESC_TOTAL + dc))
done < <(find "$SKILLS_DIR" -name SKILL.md | sort)
printf '%-40s %9s\n' '-----' '----------'
printf '%-40s %9d\n\n' 'SKILL DESC TOTAL' "$DESC_TOTAL"

# ---------- 3. MCP tool description chars ----------
printf '=== always-on metadata: MCP tool description chars (%s) ===\n' "$TOOLS_JS"
MCP_OUT="$(node -e '
  const {TOOLS} = require("./src/mcp/tools.js");
  let total = 0;
  for (const t of TOOLS) {
    const n = (t.description || "").length;
    total += n;
    console.log(`${t.name}\t${n}`);
  }
  console.log(`__TOTAL__\t${total}`);
')"
printf '%-40s %9s\n' 'TOOL' 'DESC CHARS'
printf '%-40s %9s\n' '----' '----------'
MCP_TOTAL=0
while IFS=$'\t' read -r name n; do
  if [ "$name" = "__TOTAL__" ]; then MCP_TOTAL="$n"; continue; fi
  printf '%-40s %9d\n' "$name" "$n"
done <<< "$MCP_OUT"
printf '%-40s %9s\n' '----' '----------'
printf '%-40s %9d\n\n' 'MCP DESC TOTAL' "$MCP_TOTAL"

# ---------- Grand totals ----------
printf '=== GRAND TOTALS ===\n'
printf 'file chars (SKILL.md + references + CLAUDE.md) : %d\n' "$TOTAL_C"
printf 'always-on metadata chars (skill desc + MCP desc): %d\n' "$((DESC_TOTAL + MCP_TOTAL))"
printf 'combined                                         : %d\n' "$((TOTAL_C + DESC_TOTAL + MCP_TOTAL))"
