#!/usr/bin/env bash
# SubagentStart hook: assign unassigned pending tasks to the spawned agent
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-}"
[ -z "$PLUGIN_DATA" ] && exit 0

PROJECT_NAME="$(basename "$PWD" | sed 's/[^a-zA-Z0-9_-]/-/g')"
PROJECT_HASH="$(echo -n "$PWD" | md5sum 2>/dev/null | cut -c1-8 || md5 -q -s "$PWD" 2>/dev/null | cut -c1-8)"
TASKDATA="${PLUGIN_DATA}/projects/${PROJECT_NAME}-${PROJECT_HASH}"

mkdir -p "$TASKDATA"

INPUT=$(cat)

AGENT_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_name',''))" 2>/dev/null || echo "")

[ -z "$AGENT_NAME" ] && exit 0

echo "{\"subagent_start\":\"${AGENT_NAME}\"}" >> "${TASKDATA}/sync-queue.jsonl"
exit 0
