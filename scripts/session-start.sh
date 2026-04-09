#!/usr/bin/env bash
# Show pending task count at session start
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-}"
[ -z "$PLUGIN_DATA" ] && exit 0

# S3 backend — skip filesystem checks, query via store directly
if [ "${BACKLOG_BACKEND:-}" = "s3" ]; then
  [ -z "${BACKLOG_S3_BUCKET:-}" ] && exit 0
  TASKDATA="${TASKDATA:-}"
  [ -z "$TASKDATA" ] && {
    PROJECT_NAME="$(basename "$PWD" | sed 's/[^a-zA-Z0-9_-]/-/g')"
    PROJECT_HASH="$(echo -n "$PWD" | md5sum 2>/dev/null | cut -c1-8 || md5 -q -s "$PWD" 2>/dev/null | cut -c1-8)"
    TASKDATA="${PLUGIN_DATA}/projects/${PROJECT_NAME}-${PROJECT_HASH}"
  }

  TASKDATA="$TASKDATA" BACKLOG_BACKEND="$BACKLOG_BACKEND" BACKLOG_S3_BUCKET="$BACKLOG_S3_BUCKET" BACKLOG_S3_REGION="${BACKLOG_S3_REGION:-}" NODE_PATH="${PLUGIN_DATA}/node_modules" node --input-type=module -e "
import { Store } from '@backloghq/opslog';
import { S3Backend } from '@backloghq/opslog-s3';
const store = new Store();
const backend = new S3Backend({
  bucket: process.env.BACKLOG_S3_BUCKET,
  prefix: process.env.TASKDATA,
  ...(process.env.BACKLOG_S3_REGION && { region: process.env.BACKLOG_S3_REGION }),
});
try {
  await store.open(process.env.TASKDATA, { readOnly: true, backend });
  const all = store.all();
  const pending = all.filter(t => t.status === 'pending');
  if (pending.length === 0) { await store.close(); process.exit(0); }
  const active = pending.filter(t => t.start);
  const overdue = pending.filter(t => t.due && new Date(t.due) < new Date());
  const blocked = pending.filter(t => t.depends && t.depends.length > 0);
  let summary = pending.length + ' pending';
  if (active.length) summary += ', ' + active.length + ' active';
  if (overdue.length) summary += ', ' + overdue.length + ' overdue';
  if (blocked.length) summary += ', ' + blocked.length + ' blocked';
  console.log('Backlog: ' + summary + '. Run /backlog:tasks for details.');
  await store.close();
} catch { process.exit(0); }
" 2>/dev/null || true
  exit 0
fi

# Filesystem backend (default)
PROJECT_NAME="$(basename "$PWD" | sed 's/[^a-zA-Z0-9_-]/-/g')"
PROJECT_HASH="$(echo -n "$PWD" | md5sum 2>/dev/null | cut -c1-8 || md5 -q -s "$PWD" 2>/dev/null | cut -c1-8)"
TASKDATA="${PLUGIN_DATA}/projects/${PROJECT_NAME}-${PROJECT_HASH}"
MANIFEST="${TASKDATA}/manifest.json"

# Skip if no data exists for this project
[ -f "$MANIFEST" ] || exit 0

TASKDATA="$TASKDATA" NODE_PATH="${PLUGIN_DATA}/node_modules" node --input-type=module -e "
import { Store } from '@backloghq/opslog';
const store = new Store();
const dataDir = process.env.TASKDATA;
try {
  await store.open(dataDir, { readOnly: true });
  const all = store.all();
  const pending = all.filter(t => t.status === 'pending');
  if (pending.length === 0) { await store.close(); process.exit(0); }
  const active = pending.filter(t => t.start);
  const overdue = pending.filter(t => t.due && new Date(t.due) < new Date());
  const blocked = pending.filter(t => t.depends && t.depends.length > 0);
  let summary = pending.length + ' pending';
  if (active.length) summary += ', ' + active.length + ' active';
  if (overdue.length) summary += ', ' + overdue.length + ' overdue';
  if (blocked.length) summary += ', ' + blocked.length + ' blocked';
  console.log('Backlog: ' + summary + '. Run /backlog:tasks for details.');
  await store.close();
} catch { process.exit(0); }
" 2>/dev/null || true
