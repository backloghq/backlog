# TaskWarrior MCP Server

MCP server that exposes [TaskWarrior](https://taskwarrior.org/) (v3.x) as tools for Claude Code and agent teams, enabling persistent cross-session task management.

## Purpose

Claude Code sessions are ephemeral — task context dies with the conversation. This MCP server bridges that gap by giving agents read/write access to TaskWarrior, so tasks created in one session can be picked up in another. Agent teams can coordinate work through shared task state: assignments, annotations, projects, and dependencies.

## Project Isolation

Each project gets its own TaskWarrior data directory — full filesystem-level isolation. No filter scoping tricks, no accidental cross-project leaks.

The MCP server config sets `TASKDATA` per project:

```json
{
  "mcpServers": {
    "taskwarrior": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": { "TASKDATA": "/home/user/.local/share/taskwarrior-mcp/my-project" }
    }
  }
}
```

Convention for data directories: `~/.local/share/taskwarrior-mcp/<project-name>/`. The server auto-creates the directory and a minimal `.taskrc` if they don't exist on first run, so there's zero manual setup per project.

If `TASKDATA` is not set, the server refuses to start — there is no implicit default. This prevents accidentally writing to the user's personal TaskWarrior database.

## Architecture

```
Claude Code / Agent Teams
        │ (MCP stdio)
        ▼
  ┌──────────────┐
  │  MCP Server   │  TypeScript, @modelcontextprotocol/sdk
  │  (stdio)      │  Zod input schemas, structured output
  └──────┬───────┘
         │ child_process.execFile
         ▼
  ┌──────────────┐
  │  task CLI     │  TaskWarrior 3.4.2 (/usr/bin/task)
  │  (JSON I/O)   │  Reads: `task export`, Writes: `task add/modify/done/...`
  └──────────────┘
```

**Key decisions:**
- **TypeScript** — Zod schemas give explicit input validation (important when inputs come from LLMs), strong type safety, and the TS MCP SDK is the most mature.
- **stdio transport** — standard for Claude Code MCP servers, zero network config.
- **CLI wrapper (not library)** — TaskWarrior has no stable library API. The CLI + JSON export is the supported integration surface. We use `child_process.execFile` (not `exec`) to avoid shell injection.
- **No persistent server state** — all state lives in TaskWarrior's data files. The MCP server is stateless.
- **Per-project isolation** — each project gets its own `TASKDATA` directory. No shared backlog, no filter scoping — isolation at the filesystem level. Mandatory `TASKDATA` env var prevents accidental writes to the user's personal task database.

## Project Structure

```
src/
  index.ts          # Entry point: server init, tool registration, stdio transport
  taskwarrior.ts    # CLI wrapper: execFile, JSON parsing, error handling
  types.ts          # Shared TypeScript types for task data
```

Flat structure — this is a focused tool, not a framework. All tool registrations live in `index.ts`.

## Tool API

Each tool maps to a TaskWarrior command. Use `rc.confirmation=off` and `rc.bulk=0` on all write commands to suppress interactive prompts.

| Tool | TW Command | Purpose |
|------|-----------|---------|
| `task_list` | `task <filter> export` | Query tasks with TW filter syntax, returns JSON array |
| `task_add` | `task add` | Create a task with description, project, tags, priority, due, etc. |
| `task_modify` | `task <filter> modify` | Update attributes on existing tasks |
| `task_done` | `task <id> done` | Mark task(s) complete |
| `task_delete` | `task <id> delete` | Delete task(s) |
| `task_annotate` | `task <id> annotate` | Add annotation text (great for cross-session context) |
| `task_start` | `task <id> start` | Mark task as actively being worked on |
| `task_stop` | `task <id> stop` | Stop active time tracking |
| `task_undo` | `task undo` | Undo last modification |
| `task_info` | `task <id> export` | Get full JSON detail for a single task by ID or UUID |
| `task_projects` | `task _unique project` | List all project names |
| `task_tags` | `task _unique tags` | List all tags |

### Input Design Principles

- `task_list` accepts a `filter` string — expose TaskWarrior's full filter syntax rather than reimplementing it. Examples: `project:myproject +bug status:pending`, `due.before:tomorrow`, `+OVERDUE`.
- `task_add` accepts structured fields: `description` (required), `project`, `tags` (array), `priority` (H/M/L), `due`, `depends`, `wait`, plus an optional `extra` string for arbitrary TW attributes.
- `task_modify` accepts `filter` (required) plus the same fields as add.
- ID-based tools (`task_done`, `task_delete`, etc.) accept `id` which can be a task ID number or UUID string.

### Output

All tools return `content: [{ type: "text", text: ... }]`. For read operations, return the raw JSON from TaskWarrior. For write operations, return a confirmation message including the task ID/UUID.

## TaskWarrior CLI Interaction

### Executing commands

```typescript
import { execFile } from "child_process";

// Always use execFile (not exec) to prevent shell injection
// Always pass rc overrides to suppress interactive prompts
const rcArgs = ["rc.confirmation=off", "rc.bulk=0", "rc.verbose=nothing"];
```

### Reading tasks

```bash
task rc.confirmation=off rc.verbose=nothing <filter> export
# Returns JSON array: [{"id":1,"description":"...","status":"pending",...}]
```

### Writing tasks

```bash
task rc.confirmation=off rc.bulk=0 add "description" project:foo +tag priority:H due:tomorrow
# Output includes the new task ID
```

### Error handling

- Non-zero exit codes indicate errors — parse stderr for the message.
- Common errors: invalid filter syntax, task not found, no matching tasks.
- Return `isError: true` in the MCP response with the stderr message.

### Environment variables

- `TASKDATA` — **(required)** path to project-specific task data directory. Server refuses to start without it. Convention: `~/.local/share/taskwarrior-mcp/<project-name>/`.
- `TASKRC` — path to `.taskrc` config file. If not set, the server auto-creates a minimal one inside `TASKDATA`.
- `TASK_BIN` — path to `task` binary (default: `task` from PATH)

## Development

### Setup

```bash
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
npx tsc --init  # target: ES2022, module: Node16, outDir: ./dist
```

### Build & Run

```bash
npm run build        # tsc
node dist/index.js   # run directly for testing
```

### Claude Code Integration

Add to project `.claude/settings.json` (each project gets its own isolated task data):

```json
{
  "mcpServers": {
    "taskwarrior": {
      "command": "node",
      "args": ["/absolute/path/to/agent-teams-task-mcp/dist/index.js"],
      "env": {
        "TASKDATA": "/home/user/.local/share/taskwarrior-mcp/my-project"
      }
    }
  }
}
```

The server auto-creates `TASKDATA` and a minimal `.taskrc` on first run. No manual setup needed per project.

### Testing

- Test the CLI wrapper with real `task` commands against a temporary TASKDATA directory.
- Use `TASKDATA=$(mktemp -d)` to isolate test state from the user's real tasks.
- Test each tool's input validation by passing invalid inputs and verifying error responses.
- For integration tests, spawn the MCP server over stdio and send JSON-RPC messages.

## Coding Conventions

- Use `execFile` with argument arrays, never string interpolation into shell commands.
- All TaskWarrior commands must include `rc.confirmation=off` to prevent hanging on prompts.
- Parse TaskWarrior's JSON output with `JSON.parse` — the export format is stable.
- Use Zod schemas for all tool inputs — describe every field for LLM comprehension.
- Errors from TaskWarrior should be surfaced as MCP tool errors (`isError: true`), not server crashes.
- Use `console.error` for logging (stdout is the MCP JSON-RPC channel).
- No unnecessary abstractions — this is a thin wrapper, keep it that way.

## TaskWarrior Notes

- **Version**: 3.4.2 installed at `/usr/bin/task`
- **Config**: TaskWarrior 3.x requires a `.taskrc` file. If missing, run `task` interactively once to create it, or create manually.
- **JSON export**: Returns an array of task objects. Key fields: `id`, `uuid`, `description`, `status` (pending/completed/deleted/waiting), `project`, `tags`, `priority`, `due`, `entry`, `modified`, `annotations`.
- **Filter syntax**: Very powerful — supports attribute matching (`project:X`), tags (`+tag`/`-tag`), date math (`due.before:eow`), virtual tags (`+OVERDUE`, `+ACTIVE`, `+BLOCKED`), regex (`/pattern/`), boolean operators (`and`, `or`, `xor` with parentheses).
- **UDAs**: Can define custom attributes via config. Consider adding `agent` UDA if agent identity tracking is needed — but this is optional and can be done later.
