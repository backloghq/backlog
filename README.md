# backlog

[![GitHub stars](https://img.shields.io/github/stars/backloghq/backlog?style=social)](https://github.com/backloghq/backlog)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/backloghq/backlog/actions/workflows/ci.yml/badge.svg)](https://github.com/backloghq/backlog/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-backloghq.io-blue)](https://backloghq.io)

Persistent, cross-session task management for Claude Code. Tasks survive sessions so work started by one agent can be picked up by another.

Built on [@backloghq/agentdb](https://github.com/backloghq/agentdb) — typed schemas, auto-increment IDs, virtual filters, blob storage. Pure TypeScript, zero native dependencies.

## Install

```
/plugin marketplace add backloghq/backlog
/plugin install backlog@backloghq-backlog
```

### From source

```bash
git clone https://github.com/backloghq/backlog.git
cd backlog && npm install && npm run build
claude --plugin-dir /path/to/backlog
```

### Standalone MCP server

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "node",
      "args": ["/path/to/agent-teams-task-mcp/dist/index.js"],
      "env": {
        "TASKDATA": "/path/to/task-data"
      }
    }
  }
}
```

## Skills

| Skill | Description |
|-------|-------------|
| `/backlog:tasks` | Show the current backlog — pending, active, blocked, overdue tasks |
| `/backlog:plan` | Break down a goal into tasks with dependencies, priorities, and specs |
| `/backlog:standup` | Daily standup — done, in progress, blocked, up next |
| `/backlog:refine` | Groom the backlog — fix vague tasks, missing priorities, broken deps, stale items |
| `/backlog:spec` | Write a spec document for a task before implementation |
| `/backlog:implement` | Pick up a task, read its spec, implement it, mark done |
| `/backlog:handoff` | Prepare for next session — annotate progress, stop active tasks, summarize state |

## Agent

The `task-planner` agent can be auto-invoked by Claude when someone needs to plan work. It reads the codebase, decomposes goals into tasks with dependencies, and writes specs for complex items.

## Hooks

| Event | What it does |
|-------|-------------|
| `SessionStart` | Shows pending task count when a session begins |
| `TaskCreated` | Syncs Claude's built-in tasks to the persistent backlog |
| `TaskCompleted` | Marks the matching backlog task as done when Claude completes a built-in task |
| `SubagentStart` | Auto-assigns unassigned pending tasks to the spawned agent |

## Tools (MCP)

Tools for full task lifecycle management:

| Tool | Description |
|------|-------------|
| `task_list` | Query tasks with filter syntax. Returns JSON array with all fields. |
| `task_count` | Count tasks matching a filter. Same syntax as task_list. |
| `task_add` | Create a new pending task. Only description required; all other fields optional. |
| `task_log` | Record already-completed work directly in completed status. |
| `task_modify` | Partial-update one or more tasks matching a filter. Only provided fields change. |
| `task_duplicate` | Copy an existing task with optional field overrides. |
| `task_done` | Mark a task as completed with end timestamp. |
| `task_delete` | Soft-delete a task. Restorable with task_undo. Use task_purge to permanently remove. |
| `task_annotate` | Add a timestamped note. Use task_doc_write for longer content. |
| `task_denotate` | Remove an annotation by exact text match. |
| `task_start` | Mark a task as actively being worked on. Visible in +ACTIVE queries. |
| `task_stop` | Stop working on a task. Returns it to pending status. |
| `task_undo` | Undo the most recent operation. Can be called repeatedly. |
| `task_info` | Get full JSON details for a single task by ID or UUID. |
| `task_import` | Bulk-create tasks from a JSON array. Atomic batch operation. |
| `task_purge` | Permanently remove a deleted task. Irreversible. |
| `task_doc_write` | Attach/replace a markdown document on a task (specs, notes, context). |
| `task_doc_read` | Read the markdown document attached to a task. |
| `task_doc_delete` | Remove a task's document. Permanent. |
| `task_archive` | Move old completed/deleted tasks to quarterly archive segments. |
| `task_archive_list` | List available archive segments. |
| `task_archive_load` | Load archived tasks for read-only inspection. |
| `task_projects` | List project names with pending/recurring tasks. |
| `task_tags` | List tags with pending/recurring tasks. |

## Filter Syntax

```
status:pending                    # all pending tasks
project:backend +bug              # bugs in backend project
priority:H due.before:friday      # high priority due before friday
+OVERDUE                          # overdue tasks
+ACTIVE                           # tasks currently being worked on
+BLOCKED                          # tasks blocked by dependencies
+READY                            # actionable tasks (past scheduled date)
agent:explorer                    # tasks assigned to the explorer agent
( project:web or project:api )    # boolean with parentheses
description.contains:auth         # substring match
```

Supports attribute modifiers (`.before`, `.after`, `.by`, `.has`, `.not`, `.none`, `.any`, `.startswith`, `.endswith`), tags (`+tag`, `-tag`), virtual tags (`+OVERDUE`, `+ACTIVE`, `+BLOCKED`, `+READY`, `+TAGGED`, `+ANNOTATED`, etc.), and boolean operators (`and`, `or`).

## Task Docs

Attach markdown documents (specs, context, handoff notes) to any task:

```
task_doc_write  id:"1"  content:"# Spec\n\nBuild the auth flow.\n"
task_doc_read   id:"1"
task_doc_delete id:"1"
```

Writing a doc adds a `+doc` tag and `has_doc:yes`, so agents can discover tasks with docs:

```
task_list filter:"+doc"
task_list filter:"has_doc:yes"
```

## Agent Identity

Tasks support an `agent` field for tracking which agent owns a task:

```
task_add  description:"Investigate bug"  agent:"explorer"
task_list filter:"agent:explorer status:pending"
```

## Project Isolation

Each project gets its own task data automatically. When used as a plugin, task data lives in `~/.claude/plugins/data/backlog/projects/<project-slug>/`. When used standalone, set `TASKDATA` explicitly.

| Variable | Description |
|----------|-------------|
| `TASKDATA` | Explicit path to task data directory (overrides auto-derivation) |
| `TASKDATA_ROOT` | Root directory for auto-derived per-project task data |
| `BACKLOG_NAMESPACE` | Explicit collection name (default: `tasks`) |
| `BACKLOG_AUTO_NAMESPACE` | Set to `true` to derive collection name from CWD |
| `BACKLOG_AGENT_ID` | Agent ID for multi-writer support (Claude, Gemini, etc.) |
| `BACKLOG_BACKEND` | Storage backend: omit for filesystem (default), `s3` for Amazon S3 |
| `BACKLOG_S3_BUCKET` | S3 bucket name (required when `BACKLOG_BACKEND=s3`) |
| `BACKLOG_S3_REGION` | AWS region (optional if using default credentials) |

### Multi-Writer Support

Backlog supports concurrent access from multiple processes (e.g., Claude Desktop and Gemini CLI) sharing the same data. To enable this:
1. Assign a unique `BACKLOG_AGENT_ID` to each process (e.g., `claude`, `gemini`).
2. When an agent ID is set, the engine uses per-agent write logs, avoiding file locks.
3. Each process automatically calls `refresh()` before operations to pick up changes from other agents.

### Namespacing

If you want to use a single `TASKDATA` directory for multiple projects, you can use namespaces to keep tasks separate:

1. **Manual**: Set `BACKLOG_NAMESPACE=my-project` to use a specific collection name.
2. **Automatic**: Set `BACKLOG_AUTO_NAMESPACE=true` to have Backlog automatically derive a collection name from your current working directory (e.g. `my-app-a1b2c3d4`).

Both methods allow multiple projects to share the same storage backend (filesystem or S3) while maintaining isolated backlogs.

### S3 Backend

Store task data in S3 for team sharing or cloud persistence. Requires `@backloghq/opslog-s3`:

```bash
npm install @backloghq/opslog-s3
```

Configure via environment variables in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "backlog": {
      "command": "node",
      "args": ["/path/to/backlog/dist/index.js"],
      "env": {
        "TASKDATA": "my-project/tasks",
        "BACKLOG_BACKEND": "s3",
        "BACKLOG_S3_BUCKET": "my-team-backlog",
        "BACKLOG_S3_REGION": "us-east-1"
      }
    }
  }
}
```

When using S3, `TASKDATA` becomes the key prefix in the bucket instead of a filesystem path.

## Docker

```bash
docker build -t backlog .
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | docker run --rm -i backlog
```

## Development

```bash
npm install
npm run build          # compile TypeScript
npm run lint           # run ESLint
npm test               # run tests
npm run test:coverage  # run tests with coverage
npm run dev            # watch mode
```

## Community

- [GitHub Discussions](https://github.com/backloghq/backlog/discussions) — questions, ideas, show & tell
- [Issue Tracker](https://github.com/backloghq/backlog/issues) — bug reports and feature requests
- [Documentation](https://backloghq.io) — full docs, skills reference, filter syntax

If backlog is useful to you, consider giving it a star — it helps others find the project.

## License

MIT
