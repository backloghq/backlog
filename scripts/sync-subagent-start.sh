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

# Use agent_type (e.g. "general-purpose", "backlog:task-planner")
AGENT_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('agent_type') or d.get('agent_name') or '')
" 2>/dev/null || echo "")

[ -z "$AGENT_NAME" ] && exit 0

echo "{\"subagent_start\":\"${AGENT_NAME}\"}" >> "${TASKDATA}/sync-queue.jsonl"
exit 0
