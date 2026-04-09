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
  index.ts              # Entry point: server init, stdio transport
  helpers.ts            # Shared utilities: parseTags(), safe() error wrapper
  schemas.ts            # Output schemas and shared constants
  tools/
    index.ts            # Barrel: registerTools() calling all domain modules
    query.ts            # task_list, task_info, task_count, task_projects, task_tags
    lifecycle.ts        # task_add, task_done, task_delete, task_start, task_stop, task_log, task_duplicate
    modify.ts           # task_modify, task_annotate, task_denotate, task_undo, task_purge, task_import
    docs.ts             # task_doc_write, task_doc_read, task_doc_delete
    archive.ts          # task_archive, task_archive_list, task_archive_load
  engine/
    index.ts            # Engine: opslog-backed store, all task operations
    filter.ts           # Filter compiler: parses filter expressions into predicates
    dates.ts            # Date resolution: natural language dates → ISO timestamps
    recurrence.ts       # Recurring task template expansion
    types.ts            # Task type definition
skills/
  tasks/SKILL.md        # /tasks skill: show backlog overview
  plan/SKILL.md         # /plan skill: break down goals into tasks
  standup/SKILL.md      # /standup skill: daily standup summary
  refine/SKILL.md       # /refine skill: backlog grooming
  spec/SKILL.md         # /spec skill: write task specifications
  implement/SKILL.md    # /implement skill: pick up and implement a task
  handoff/SKILL.md      # /handoff skill: session handoff
agents/
  task-planner.md       # Auto-invokable agent for task decomposition
hooks/
  hooks.json            # SessionStart, TaskCreated, TaskCompleted, SubagentStart
scripts/
  start-server.sh       # MCP server launcher (installs deps, starts node)
  session-start.sh      # SessionStart hook: show pending task count
  sync-task-created.sh  # TaskCreated hook: queue task for sync
  sync-task-completed.sh # TaskCompleted hook: queue completion for sync
  sync-subagent-start.sh # SubagentStart hook: queue agent assignment
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
| `task_count` | Count tasks matching a filter |
| `task_log` | Record an already-completed task |
| `task_duplicate` | Copy a task with optional modifications |
| `task_doc_write` | Attach a markdown document to a task |
| `task_doc_read` | Read a task's attached document |
| `task_doc_delete` | Remove a task's attached document |
| `task_archive` | Move old completed/deleted tasks to archive segments |
| `task_archive_list` | List available archive segments |
| `task_archive_load` | Load archived tasks for inspection |
| `task_projects` | List all project names |
| `task_tags` | List all tags |

### Input Design Principles

- `task_list` accepts a `filter` string — supports attribute matching (`project:X`), tags (`+tag`/`-tag`), date comparisons (`due.before:tomorrow`), virtual tags (`+OVERDUE`, `+ACTIVE`, `+BLOCKED`), description text search, and boolean operators (`and`, `or` with parentheses).
- `task_add` accepts structured fields: `description` (required), `project`, `tags` (array), `priority` (H/M/L), `due`, `depends`, `wait`, `scheduled`, `recur`, `agent`, plus an optional `extra` string for arbitrary attributes.
- `task_modify` accepts `filter` (required) plus the same fields as add.
- `task_import` accepts a `tasks` string containing a JSON array of task objects.
- ID-based tools (`task_done`, `task_delete`, etc.) accept `id` which can be a task ID number or UUID string.

### Output

All tools return `content: [{ type: "text", text: ... }]`. For read operations, return the raw JSON. For write operations, return a confirmation message including the task UUID.

## Skills

| Skill | Purpose |
|-------|---------|
| `/backlog:tasks` | Show backlog overview: pending, active, blocked, overdue |
| `/backlog:plan` | Break down a goal into tasks with dependencies and specs |
| `/backlog:standup` | Daily standup: done, in progress, blocked, up next |
| `/backlog:refine` | Groom the backlog: fix vague tasks, missing priorities, broken deps |
| `/backlog:spec` | Write a spec document for a task before implementation |
| `/backlog:implement` | Pick up a task, read its spec, implement it, mark done |
| `/backlog:handoff` | Session handoff: annotate progress, stop active tasks, summarize |

## Agent

The `task-planner` agent (`agents/task-planner.md`) is auto-invokable by Claude when someone needs to plan work. It reads the codebase, decomposes goals into 5-10 tasks with dependencies, assigns priorities, and writes specs for complex items.

## Hooks

| Event | Script | Purpose |
|-------|--------|---------|
| `SessionStart` | `session-start.sh` | Shows pending task count when a session begins |
| `TaskCreated` | `sync-task-created.sh` | Queues Claude's built-in tasks for sync to backlog |
| `TaskCompleted` | `sync-task-completed.sh` | Queues task completions for sync |
| `SubagentStart` | `sync-subagent-start.sh` | Queues agent assignment for unassigned tasks |

Hooks use a sync-queue pattern: shell scripts write to `sync-queue.jsonl`, the engine drains the queue on the next read operation. This avoids concurrent write issues between hook processes and the MCP server.

## Engine Internals

### Storage

The engine uses [opslog](../opslog), an append-only operation log. Each write (set/delete) appends to the log. The full state is materialized in memory on startup by replaying the log. Periodic checkpoints compact the log for faster recovery.

### Filter Compilation

The filter compiler (`src/engine/filter.ts`) parses filter expressions into predicate functions. Supports:
- Attribute matching: `project:X`, `status:pending`, `priority:H`, `agent:explorer`
- Attribute modifiers: `.before`, `.after`, `.by`, `.is`, `.not`, `.has`, `.hasnt`, `.none`, `.any`, `.startswith`, `.endswith`
- Tags: `+tag` (has tag), `-tag` (missing tag)
- Virtual tags: `+ACTIVE`, `+BLOCKED`, `+BLOCKING`, `+UNBLOCKED`, `+READY`, `+ANNOTATED`, `+TAGGED`, `+OVERDUE`, `+COMPLETED`, `+DELETED`, `+PENDING`, `+WAITING`, `+RECURRING`, `+TODAY`, `+TOMORROW`, `+YESTERDAY`, `+WEEK`, `+MONTH`, `+QUARTER`, `+YEAR`, `+DUE`, `+SCHEDULED`, `+PROJECT`, `+PRIORITY`, `+UDA`
- Date comparisons: `due.before:tomorrow`, `due.after:2025-01-01`, compound: `end.after:now-7d`
- Bare numeric IDs: `1`, `42` — match by task ID
- Bare UUIDs: match by UUID
- Description text search: bare words match against task description and annotations
- Boolean logic: `and`, `or`, parentheses for grouping

### Date Resolution

The date resolver (`src/engine/dates.ts`) converts natural language dates to ISO timestamps: `tomorrow`, `yesterday`, `eow` (end of week), `eom` (end of month), `monday`, `2025-12-31`, relative (`3d`, `2w`, `1m`), compound (`now-7d`, `today+2w`), etc. Compound date examples: `now-7d` (7 days ago), `today+2w` (2 weeks from today), `eow-1d` (day before end of week).

### Recurrence

Tasks with `recur` and `due` fields become templates (status: `recurring`). The engine generates pending child instances lazily on read, up to 3 ahead. Children link to the parent via `parent` UUID. Completing an instance triggers generation of the next one. Supports: `daily`, `weekly`, `weekdays`, `biweekly`, `monthly`, `quarterly`, `yearly`, and numeric patterns (`3d`, `2w`). An optional `until` field sets an end date for recurrence -- no instances are generated past this date (e.g., `until: "2026-12-31"`).

### Urgency

Tasks get a computed `urgency` score based on priority, active status, project, tags, annotations, blocking/blocked status, due date proximity, and age. Higher scores mean more urgent tasks.

### ID Assignment

Tasks get a stable, monotonically incrementing numeric ID assigned at creation time. IDs are never reassigned — deleting task 2 does not renumber task 3. New tasks always get `max_id + 1`. UUIDs are the stable identifier for cross-session references.

### Environment Variables

- `TASKDATA` — explicit path to project-specific data directory. Takes precedence over `TASKDATA_ROOT`. When using S3 backend, this becomes the key prefix in the bucket.
- `TASKDATA_ROOT` — root directory for auto-derived per-project data. Server creates `<root>/<project-slug>/` based on CWD.
- One of `TASKDATA` or `TASKDATA_ROOT` is required. Server refuses to start without either.
- `BACKLOG_BACKEND` — storage backend. Omit for filesystem (default), set to `s3` for Amazon S3.
- `BACKLOG_S3_BUCKET` — S3 bucket name (required when `BACKLOG_BACKEND=s3`).
- `BACKLOG_S3_REGION` — AWS region (optional if using default credentials).
- S3 backend requires `@backloghq/opslog-s3` as an optional peer dependency. It is dynamically imported only when `BACKLOG_BACKEND=s3`.

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
- Errors from the engine should be surfaced as MCP tool errors (`isError: true`), not server crashes. All handlers are wrapped with `safe()`.
- Use `console.error` for logging (stdout is the MCP JSON-RPC channel).
- No unnecessary abstractions — this is a focused tool, keep it that way.

## Release Process

When making changes:
1. Update `CHANGELOG.md` with a new version entry (Fixed/Added/Changed sections, [Keep a Changelog](https://keepachangelog.com) format)
2. Bump version in **all three places**: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
3. Run `npm run build && npm run lint && npm test`
4. **Commit `dist/` with your changes** — the plugin is distributed via committed JS files. CI will fail the PR if `dist/` is stale.
5. Push, create PR
6. After merge: push to main, the marketplace picks up the new version automatically
