#!/usr/bin/env bash
# Installs the QA agent team (6 agents + the qa-playwright skill) for Claude Code.
#   ./install.sh            install for your user  (~/.claude)
#   ./install.sh --project  install into the current project (./.claude)
#   ./install.sh --force    overwrite existing copies (they are backed up first)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/.claude"; FORCE=0
for a in "$@"; do case "$a" in
  --project) TARGET="$PWD/.claude" ;;
  --force) FORCE=1 ;;
  -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
  *) echo "Unknown option: $a" >&2; exit 1 ;;
esac; done

mkdir -p "$TARGET/agents" "$TARGET/skills"
install_item() { # src dest
  if [ -e "$2" ]; then
    if [ "$FORCE" -eq 0 ]; then echo "Exists, skipping (use --force to replace): $2"; return; fi
    mv "$2" "$2.bak.$(date +%Y%m%d%H%M%S)"; echo "Backed up existing: $2"
  fi
  cp -R "$1" "$2"; echo "Installed: $2"
}
for f in "$HERE"/agents/qa-*.md; do install_item "$f" "$TARGET/agents/$(basename "$f")"; done
install_item "$HERE/skills/qa-playwright" "$TARGET/skills/qa-playwright"

echo; echo "Done. Start a QA run with:  claude --agent qa-lead"
command -v node >/dev/null || echo "Note: Node.js 18+ is required to run the generated tests."
