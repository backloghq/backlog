#!/usr/bin/env bash
# Show pending task count at session start
set -euo pipefail

PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-}"
[ -z "$PLUGIN_DATA" ] && exit 0

# Derive project-specific TASKDATA from CWD
PROJECT_NAME="$(basename "$PWD" | sed 's/[^a-zA-Z0-9_-]/-/g')"
PROJECT_HASH="$(echo -n "$PWD" | md5sum 2>/dev/null | cut -c1-8 || md5 -q -s "$PWD" 2>/dev/null | cut -c1-8)"
TASKDATA="${PLUGIN_DATA}/projects/${PROJECT_NAME}-${PROJECT_HASH}"
TASKRC="${TASKDATA}/.taskrc"

# Skip if no task data exists for this project
[ -d "$TASKDATA" ] || exit 0

# Check task binary
command -v task &>/dev/null || exit 0

RC_ARGS="rc:${TASKRC} rc.data.location:${TASKDATA} rc.confirmation=off rc.verbose=nothing"

count=$(task $RC_ARGS status:pending count 2>/dev/null || echo "0")
[ "$count" = "0" ] && exit 0

active=$(task $RC_ARGS +ACTIVE count 2>/dev/null || echo "0")
overdue=$(task $RC_ARGS +OVERDUE count 2>/dev/null || echo "0")
blocked=$(task $RC_ARGS +BLOCKED count 2>/dev/null || echo "0")

summary="${count} pending"
[ "$active" != "0" ] && summary="${summary}, ${active} active"
[ "$overdue" != "0" ] && summary="${summary}, ${overdue} overdue"
[ "$blocked" != "0" ] && summary="${summary}, ${blocked} blocked"

echo "Backlog: ${summary}. Run /backlog:tasks for details."
