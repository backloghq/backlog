# taskwarrior-mcp

MCP server that gives Claude Code and agent teams read/write access to [TaskWarrior](https://taskwarrior.org/). Tasks persist across sessions, so work started by one agent can be picked up by another.

## Requirements

- Node.js >= 20
- [TaskWarrior](https://taskwarrior.org/) 3.x (`task` in PATH)

## Install

```bash
git clone <repo-url>
cd agent-teams-task-mcp
npm install
npm run build
```

## Configure

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "taskwarrior": {
      "command": "node",
      "args": ["/absolute/path/to/agent-teams-task-mcp/dist/index.js"],
      "env": {
        "TASKDATA": "/home/you/.local/share/taskwarrior-mcp/my-project"
      }
    }
  }
}
```

`TASKDATA` is required and must be unique per project. The server creates the directory and a `.taskrc` on first run.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TASKDATA` | Yes | Path to project-specific task data directory |
| `TASKRC` | No | Path to `.taskrc` (defaults to `TASKDATA/.taskrc`) |
| `TASK_BIN` | No | Path to `task` binary (defaults to `task`) |

## Tools

| Tool | Description |
|------|-------------|
| `task_list` | Query tasks with [filter syntax](https://taskwarrior.org/docs/filter/) |
| `task_count` | Count tasks matching a filter (lightweight status check) |
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
| `task_projects` | List all project names |
| `task_tags` | List all tags |

## Filter Examples

TaskWarrior's filter syntax is passed through directly:

```
status:pending                    # all pending tasks
project:backend +bug              # bugs in backend project
priority:H due.before:friday      # high priority due before friday
+OVERDUE                          # overdue tasks
+ACTIVE                           # tasks currently being worked on
+BLOCKED                          # tasks blocked by dependencies
+READY                            # actionable tasks (past scheduled date)
agent:explorer                    # tasks assigned to the explorer agent
```

## Task Docs

Attach markdown documents (specs, context, handoff notes) to any task. Docs are stored as files in the task data directory, keyed by task UUID.

```
task_doc_write  id:"1"  content:"# Spec\n\nBuild the auth flow.\n"
task_doc_read   id:"1"
task_doc_delete id:"1"
```

Writing a doc automatically adds a `+doc` tag and sets `has_doc:yes` on the task, so agents can discover which tasks have docs:

```
task_list filter:"+doc"              # tasks with attached docs
task_list filter:"has_doc:yes"       # same, via UDA
```

## Agent Identity

Tasks support an `agent` field (TaskWarrior UDA) for tracking which agent created or owns a task. Use it in `task_add`, `task_modify`, and filter with `agent:<name>`.

```
task_add  description:"Investigate bug"  agent:"explorer"
task_list filter:"agent:explorer status:pending"
```

## Development

```bash
npm run build          # compile TypeScript
npm run lint           # run ESLint
npm test               # run tests
npm run test:coverage  # run tests with coverage
npm run dev            # watch mode
```

## License

MIT
