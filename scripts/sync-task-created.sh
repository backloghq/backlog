#!/usr/bin/env bash
# TaskCreated hook: queue the task for sync to backlog
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-}"
[ -z "$PLUGIN_DATA" ] && exit 0

# Derive project-specific data dir from CWD
PROJECT_NAME="$(basename "$PWD" | sed 's/[^a-zA-Z0-9_-]/-/g')"
PROJECT_HASH="$(echo -n "$PWD" | md5sum 2>/dev/null | cut -c1-8 || md5 -q -s "$PWD" 2>/dev/null | cut -c1-8)"
TASKDATA="${PLUGIN_DATA}/projects/${PROJECT_NAME}-${PROJECT_HASH}"

# Ensure data dir exists
mkdir -p "$TASKDATA"

# Read hook input from stdin
INPUT=$(cat)

# Extract fields
SUBJECT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('task_subject',''))" 2>/dev/null || echo "")
AGENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('teammate_name',''))" 2>/dev/null || echo "")

[ -z "$SUBJECT" ] && exit 0

# Build sync entry using jq for safe JSON construction
QUEUE="${TASKDATA}/sync-queue.jsonl"
if [ -n "$AGENT" ]; then
  ENTRY=$(jq -n --arg subject "$SUBJECT" --arg agent "$AGENT" '{subject: $subject, agent: $agent}')
else
  ENTRY=$(jq -n --arg subject "$SUBJECT" '{subject: $subject}')
fi
echo "$ENTRY" >> "$QUEUE"
exit 0
