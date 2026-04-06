#!/usr/bin/env bash
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

# Symlink node_modules into plugin root for ESM resolution
ln -sfn "${PLUGIN_DATA}/node_modules" "${PLUGIN_ROOT}/node_modules" 2>/dev/null || true

exec node "${PLUGIN_ROOT}/dist/index.js"
