# backlog

[![GitHub stars](https://img.shields.io/github/stars/backloghq/backlog?style=social)](https://github.com/backloghq/backlog)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/backloghq/backlog/actions/workflows/ci.yml/badge.svg)](https://github.com/backloghq/backlog/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-backloghq.io-blue)](https://backloghq.io)

Persistent, cross-session task management for Claude Code. Tasks survive sessions so work started by one agent can be picked up by another.

Zero external dependencies — pure TypeScript with event-sourced storage. Install and it works.

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

24 tools for full task lifecycle management:

| Tool | Description |
|------|-------------|
| `task_list` | Query tasks with filter syntax |
| `task_count` | Count tasks matching a filter |
| `task_add` | Create a task with description, project, tags, priority, due, scheduled, recur, agent |
| `task_log` | Record an already-completed task |
| `task_modify` | Update existing task(s) |
| `task_duplicate` | Clone a task with optional modifications |
| `task_done` | Mark task as completed |
| `task_delete` | Delete a task |
| `task_annotate` | Add a note to a task |
| `task_denotate` | Remove a note from a task |
| `task_start` | Mark task as actively being worked on |
| `task_stop` | Stop working on a task |
| `task_undo` | Undo the last change |
| `task_info` | Get full details for a task |
| `task_import` | Bulk import tasks from JSON |
| `task_purge` | Permanently remove deleted tasks |
| `task_doc_write` | Attach/update a markdown document to a task |
| `task_doc_read` | Read the document attached to a task |
| `task_doc_delete` | Remove a document from a task |
| `task_archive` | Archive completed/deleted tasks older than N days |
| `task_archive_list` | List available archive segments |
| `task_archive_load` | Load archived tasks for inspection |
| `task_projects` | List all project names |
| `task_tags` | List all tags |

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
