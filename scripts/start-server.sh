#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-${PLUGIN_ROOT}}"

# Check for npm
if ! command -v npm &>/dev/null; then
  echo "npm is not installed. Install Node.js >= 20 to use the backlog plugin." >&2
  exit 1
fi

# Ensure node dependencies are installed
if ! diff -q "${PLUGIN_ROOT}/package.json" "${PLUGIN_DATA}/package.json" &>/dev/null 2>&1; then
  cd "${PLUGIN_DATA}"
  cp "${PLUGIN_ROOT}/package.json" "${PLUGIN_ROOT}/package-lock.json" .
  if ! npm ci --production --ignore-scripts 2>"${PLUGIN_DATA}/npm-error.log"; then
    echo "Failed to install dependencies. See ${PLUGIN_DATA}/npm-error.log" >&2
    # Fall back to existing node_modules if available
    if [ -d "${PLUGIN_DATA}/node_modules/@modelcontextprotocol" ]; then
      echo "Using cached dependencies." >&2
      rm -f "${PLUGIN_DATA}/package.json"
    else
      echo "No cached dependencies available. Check your network and try again." >&2
      exit 1
    fi
  else
    rm -f "${PLUGIN_DATA}/npm-error.log"
  fi
fi

export NODE_PATH="${PLUGIN_DATA}/node_modules"
exec node "${PLUGIN_ROOT}/dist/index.js"
