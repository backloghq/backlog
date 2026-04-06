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
| `task_add` | Create a task with description, project, tags, priority, due date |
| `task_modify` | Update existing task(s) |
| `task_done` | Mark task as completed |
| `task_delete` | Delete a task |
| `task_annotate` | Add a note to a task |
| `task_start` | Mark task as actively being worked on |
| `task_stop` | Stop working on a task |
| `task_undo` | Undo the last change |
| `task_info` | Get full details for a task |
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
```

## Development

```bash
npm run build          # compile TypeScript
npm test               # run tests
npm run test:coverage  # run tests with coverage
npm run dev            # watch mode
```

## License

MIT
