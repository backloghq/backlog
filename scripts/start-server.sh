#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-${PLUGIN_ROOT}}"

# Check for task binary
if ! command -v task &>/dev/null; then
  echo "TaskWarrior (task) is not installed." >&2
  echo "Install it:" >&2
  echo "  macOS:         brew install task" >&2
  echo "  Debian/Ubuntu: sudo apt install taskwarrior" >&2
  echo "  Arch:          sudo pacman -S task" >&2
  echo "  Other:         https://taskwarrior.org/download/" >&2
  exit 1
fi

# Ensure node dependencies are installed
if ! diff -q "${PLUGIN_ROOT}/package.json" "${PLUGIN_DATA}/package.json" &>/dev/null 2>&1; then
  cd "${PLUGIN_DATA}"
  cp "${PLUGIN_ROOT}/package.json" "${PLUGIN_ROOT}/package-lock.json" .
  npm ci --production --ignore-scripts 2>/dev/null
fi

export NODE_PATH="${PLUGIN_DATA}/node_modules"
exec node "${PLUGIN_ROOT}/dist/index.js"
