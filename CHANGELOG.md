# Changelog

## 1.4.0 (2026-04-07)

### Fixed
- **Empty tag arrays** — removing the last tag now clears to `undefined` instead of leaving `[]`
- **Sync queue ambiguity** — task completion matching skips if multiple pending tasks share the same description, logs warning instead of completing wrong task
- **Import validation** — `importTasks` now validates dates, project names, description length, and handles `depends`/`recur` fields with UUID validation
- **logTask validation** — description validated for non-empty and max 500 chars
- **duplicateTask validation** — now calls `validateAttrs()` for project/date/priority checks
- **Empty dependency strings** — `.filter(Boolean)` added at all dependency split sites
- **Recurrence clarity** — removed redundant `current` assignment, simplified fill-forward logic

### Removed
- **`waiting` status** — removed from `VALID_STATUSES`, `Task` type union, and filter; waiting is now purely virtual (derived from `wait` date on pending tasks)

### Changed
- Upgraded `@backloghq/opslog` from 0.1.3 to 0.1.4 (op semantics, Infinity/NaN, archive lookup)

## 1.3.0 (2026-04-07)

### Fixed
- **Server version mismatch** — MCP server now reads version from package.json dynamically instead of hardcoding `"1.0.0"`
- **Recurrence until timezone** — `until` date comparison now uses date-only strings, avoiding off-by-one errors near timezone boundaries
- **Priority validation** — consolidated duplicate validation in `modifyTask`; now validates before assignment instead of after
- **Recurrence dead code** — removed empty comment block in `recurrence.ts` that appeared unfinished; added clarifying comment for fill-forward behavior

### Changed
- `getUnique()` now calls `drainSyncQueue()` before reading, consistent with other read functions
- Upgraded `@backloghq/opslog` from 0.1.2 to 0.1.3 (snapshot validation, missing snapshot error handling, version range checks)

## 1.2.0 (2026-04-07)

### Fixed
- **has_doc type coercion** — `writeDoc`/`deleteDoc` now pass boolean `true`/`false` instead of string `"true"`/`""`. `modifyTask` uses strict boolean check.

### Added
- **`until` field in API** — exposed in `task_add` and `task_modify` Zod schemas. Sets recurrence end date — no instances generated past this date. Validated via `resolveDate()` in `validateAttrs()`.
- **5 new tests** — `until` add/modify/validation/recurrence, `has_doc` boolean check

### Removed
- **`mask` field** — removed unused field from Task type
- Clarified `waiting` status as virtual (derived from `wait` date, not explicitly set)

### Changed
- CLAUDE.md: added release process documentation

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
