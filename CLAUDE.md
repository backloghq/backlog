# backlog — Task Management Plugin

Claude Code plugin and MCP server with a native TypeScript engine for persistent cross-session task management. No external dependencies beyond Node.js.

## Purpose

Claude Code sessions are ephemeral — task context dies with the conversation. This MCP server bridges that gap by giving agents read/write access to a persistent task store, so tasks created in one session can be picked up in another. Agent teams can coordinate work through shared task state: assignments, annotations, projects, and dependencies.

## Project Isolation

Each project gets its own data directory — full filesystem-level isolation. No filter scoping tricks, no accidental cross-project leaks.

Two modes:

- **Plugin mode** (`TASKDATA_ROOT`): Auto-derives a project-specific subdirectory from the working directory. E.g., `TASKDATA_ROOT=/data/projects` + CWD `/home/user/dev/my-app` → `/data/projects/my-app-a1b2c3d4/`. The slug is `<basename>-<md5(cwd)[0:8]>`.
- **Standalone mode** (`TASKDATA`): Explicit path to task data directory. Takes precedence over `TASKDATA_ROOT`.

If neither is set, the server refuses to start. The server auto-creates the directory on first run.

## Architecture

```
Claude Code / Agent Teams
        │ (MCP stdio)
        ▼
  ┌──────────────┐
  │  MCP Server   │  TypeScript, @modelcontextprotocol/sdk
  │  (stdio)      │  Zod input schemas, structured output
  └──────┬───────┘
         │ direct function calls
         ▼
  ┌──────────────┐
  │  Engine       │  Native TypeScript (src/engine/)
  │  (opslog)     │  Append-only log, in-memory index, checkpoint recovery
  └──────────────┘
```

**Key decisions:**
- **TypeScript** — Zod schemas give explicit input validation (important when inputs come from LLMs), strong type safety, and the TS MCP SDK is the most mature.
- **stdio transport** — standard for Claude Code MCP servers, zero network config.
- **Native engine (not CLI wrapper)** — The engine is a pure TypeScript implementation using [opslog](../opslog) for storage. No external binaries required. All operations are direct function calls — no subprocess spawning, no shell injection surface.
- **opslog storage** — Append-only operation log with in-memory materialized state. Supports undo via log replay, batched writes, and checkpoint-based recovery. Data lives in the project's `TASKDATA` directory.
- **No persistent server state** — all state lives in the opslog data files. The MCP server is stateless.
- **Per-project isolation** — each project gets its own `TASKDATA` directory. No shared backlog, no filter scoping — isolation at the filesystem level. Mandatory `TASKDATA` env var prevents accidental writes to the wrong project.

## Project Structure

```
src/
  index.ts              # Entry point: server init, tool registration, stdio transport
  engine/
    index.ts            # Engine: opslog-backed store, all task operations
    filter.ts           # Filter compiler: parses filter expressions into predicates
    dates.ts            # Date resolution: natural language dates → ISO timestamps
    types.ts            # Task type definition
skills/
  tasks/SKILL.md        # /tasks skill: show backlog overview
  handoff/SKILL.md      # /handoff skill: session handoff
  plan/SKILL.md         # /plan skill: break down goals into tasks
tests/
  engine.test.ts        # Engine unit tests
  server.test.ts        # MCP server integration tests
```

## Tool API

| Tool | Purpose |
|------|---------|
| `task_list` | Query tasks with filter syntax, returns JSON array |
| `task_add` | Create a task with description, project, tags, priority, due, etc. |
| `task_modify` | Update attributes on existing tasks |
| `task_done` | Mark task(s) complete |
| `task_delete` | Delete task(s) |
| `task_annotate` | Add annotation text (great for cross-session context) |
| `task_denotate` | Remove annotation by exact text |
| `task_start` | Mark task as actively being worked on |
| `task_stop` | Stop active time tracking |
| `task_undo` | Undo last modification |
| `task_info` | Get full JSON detail for a single task by ID or UUID |
| `task_import` | Bulk import tasks from JSON array |
| `task_purge` | Permanently remove deleted tasks |
| `task_projects` | List all project names |
| `task_tags` | List all tags |
| `task_count` | Count tasks matching a filter |
| `task_log` | Record an already-completed task |
| `task_duplicate` | Copy a task with optional modifications |
| `task_doc_write` | Attach a markdown document to a task |
| `task_doc_read` | Read a task's attached document |
| `task_doc_delete` | Remove a task's attached document |

### Input Design Principles

- `task_list` accepts a `filter` string — supports attribute matching (`project:X`), tags (`+tag`/`-tag`), date comparisons (`due.before:tomorrow`), virtual tags (`+OVERDUE`, `+ACTIVE`, `+BLOCKED`), description text search, and boolean operators (`and`, `or` with parentheses).
- `task_add` accepts structured fields: `description` (required), `project`, `tags` (array), `priority` (H/M/L), `due`, `depends`, `wait`, `scheduled`, `recur`, `agent`, plus an optional `extra` string for arbitrary attributes.
- `task_modify` accepts `filter` (required) plus the same fields as add.
- `task_import` accepts a `tasks` string containing a JSON array of task objects.
- ID-based tools (`task_done`, `task_delete`, etc.) accept `id` which can be a task ID number or UUID string.

### Output

All tools return `content: [{ type: "text", text: ... }]`. For read operations, return the raw JSON. For write operations, return a confirmation message including the task UUID.

## Engine Internals

### Storage

The engine uses [opslog](../opslog), an append-only operation log. Each write (set/delete) appends to the log. The full state is materialized in memory on startup by replaying the log. Periodic checkpoints compact the log for faster recovery.

### Filter Compilation

The filter compiler (`src/engine/filter.ts`) parses filter expressions into predicate functions. Supports:
- Attribute matching: `project:X`, `status:pending`, `priority:H`, `agent:explorer`
- Tags: `+tag` (has tag), `-tag` (missing tag)
- Virtual tags: `+ACTIVE`, `+BLOCKED`, `+ANNOTATED`, `+TAGGED`, `+OVERDUE`, `+COMPLETED`, `+DELETED`, `+PENDING`, `+WAITING`, `+RECURRING`
- Date comparisons: `due.before:tomorrow`, `due.after:2025-01-01`
- Description text search: bare words match against task description
- Boolean logic: `and`, `or`, parentheses for grouping

### Date Resolution

The date resolver (`src/engine/dates.ts`) converts natural language dates to ISO timestamps: `tomorrow`, `yesterday`, `eow` (end of week), `eom` (end of month), `monday`, `2025-12-31`, etc.

### Urgency

Tasks get a computed `urgency` score based on priority, active status, project, tags, annotations, blocking/blocked status, due date proximity, and age. Higher scores mean more urgent tasks.

### ID Assignment

Pending and recurring tasks get sequential numeric IDs (1, 2, 3...) sorted by entry date. Completed and deleted tasks get ID 0. IDs are transient — they are recalculated on every query, not stored.

### Environment Variables

- `TASKDATA` — explicit path to project-specific data directory. Takes precedence over `TASKDATA_ROOT`.
- `TASKDATA_ROOT` — root directory for auto-derived per-project data. Server creates `<root>/<project-slug>/` based on CWD.
- One of `TASKDATA` or `TASKDATA_ROOT` is required. Server refuses to start without either.

## Development

### Setup

```bash
npm install
```

### Build & Run

```bash
npm run build        # tsc
node dist/index.js   # run directly for testing
```

### Claude Code Integration

**As a plugin** (recommended):
```bash
claude --plugin-dir /path/to/agent-teams-task-mcp
```

**As a standalone MCP server** (per-project `.claude/settings.json`):
```json
{
  "mcpServers": {
    "backlog": {
      "command": "node",
      "args": ["/absolute/path/to/agent-teams-task-mcp/dist/index.js"],
      "env": {
        "TASKDATA": "/home/user/.local/share/backlog/my-project"
      }
    }
  }
}
```

The server auto-creates the `TASKDATA` directory on first run. No manual setup needed per project.

### Testing

```bash
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
```

- Engine tests (`tests/engine.test.ts`) test all operations against a temporary data directory.
- Server tests (`tests/server.test.ts`) spawn the MCP server in-memory and send tool calls via the MCP SDK client.
- Each test gets an isolated temp directory — no shared state between tests.

## Coding Conventions

- Use Zod schemas for all tool inputs — describe every field for LLM comprehension.
- Errors from the engine should be surfaced as MCP tool errors (`isError: true`), not server crashes.
- Use `console.error` for logging (stdout is the MCP JSON-RPC channel).
- No unnecessary abstractions — this is a focused tool, keep it that way.
