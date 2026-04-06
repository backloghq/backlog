#!/usr/bin/env bash
# Standalone server start script (for development / non-plugin use)
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-${PLUGIN_ROOT}}"

mkdir -p "${PLUGIN_DATA}"

# Install deps if needed
if ! diff -q "${PLUGIN_ROOT}/package.json" "${PLUGIN_DATA}/package.json" &>/dev/null 2>&1; then
  cd "${PLUGIN_DATA}"
  cp "${PLUGIN_ROOT}/package.json" "${PLUGIN_ROOT}/package-lock.json" .
  npm ci --production --ignore-scripts 2>/dev/null
fi

export NODE_PATH="${PLUGIN_DATA}/node_modules"
exec node "${PLUGIN_ROOT}/dist/index.js"
