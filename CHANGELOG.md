# Changelog

## 1.1.0 (2026-04-07)

### Fixed
- **Shell injection in sync hooks** — replaced manual `sed` JSON escaping with `jq -n` in all sync scripts; `session-start.sh` now uses `process.env.TASKDATA` instead of shell interpolation into inline JS
- **blockedCheck false positives** — `+BLOCKED` now checks whether dependencies are actually unresolved, not just whether they exist. Tasks with all dependencies completed are no longer marked blocked
- **Date validation** — ISO date regex now rejects invalid month/day values (e.g., `2025-13-45`) with a descriptive error
- **has_doc type** — changed from `string` to `boolean` for type safety

### Added
- **Status/priority validation** — `modifyTask` and `importTasks` now validate status and priority enum values before accepting them; invalid values throw descriptive errors
- **Reverse dependency index** — `computeUrgency` blocking check is now O(1) instead of O(n) per task; numeric ID lookup in `findTask` is also O(1) via index
- **Sync queue type guard** — malformed JSON entries in the sync queue are safely skipped
- **13 new tests** — validation errors, blocked dependency resolution, invalid dates, compound dates
- **CLAUDE.md docs** — `until` field for recurrence end dates, compound date examples (`now-7d`, `today+2w`, `eow-1d`)

### Changed
- Upgraded `@backloghq/opslog` from 0.1.0 to 0.1.1 (JSON validation, archive merge fix, defensive batch rollback)
- Pinned TypeScript to `~6.0.2`

## 1.0.0

Initial release.

### Tools (24)
- Full task lifecycle: add, modify, done, delete, start, stop, undo, purge
- Query: list (with filter syntax), count, info, projects, tags
- Bulk: import, duplicate, log (record completed work)
- Docs: doc_write, doc_read, doc_delete (attach markdown specs to tasks)
- Annotations: annotate, denotate
- Archive: archive, archive_list, archive_load

### Skills (7)
- `/backlog:tasks` — backlog status overview
- `/backlog:plan` — goal decomposition into tasks
- `/backlog:standup` — daily standup summary
- `/backlog:refine` — backlog grooming
- `/backlog:spec` — write task specifications
- `/backlog:implement` — pick up and implement a task
- `/backlog:handoff` — session handoff context

### Agent
- `task-planner` — auto-invokable agent for task decomposition

### Hooks
- `SessionStart` — show pending task count
- `TaskCreated` — sync Claude's built-in tasks to backlog
- `TaskCompleted` — sync task completions
- `SubagentStart` — auto-assign tasks to spawned agents

### Engine
- Native TypeScript engine (no external binary dependencies)
- Event-sourced storage via opslog (append-only log + snapshots)
- Filter syntax: attributes, modifiers, tags, virtual tags, boolean ops
- Date math: named dates, relative, compound expressions
- Recurrence: template-based recurring tasks
- Stable IDs: assigned at creation, never reassigned
- Per-project isolation via TASKDATA_ROOT
- Input validation for descriptions, project names, dates, UUIDs
- Error handling: all tool handlers wrapped with safe()
