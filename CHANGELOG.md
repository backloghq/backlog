# Changelog

## 2.3.0 (2026-04-19)

### Added
- **Multi-writer support on by default** — the engine now automatically generates a unique `agentId` (e.g., `backlog-laptop-a1b2c3d4`) if `BACKLOG_AGENT_ID` is not provided. This allows multiple processes (Claude, Gemini, etc.) to share the same project data without directory locking issues, making global MCP configuration seamless.
- **Namespacing support** — added `BACKLOG_NAMESPACE` and `BACKLOG_AUTO_NAMESPACE` to allow partitioning a single data directory into multiple isolated backlogs. This enables sharing a single storage backend (like an S3 bucket or a global folder) while maintaining per-project task isolation at the collection level.
- **Improved data synchronization** — added `sync()` helper that automatically calls `col.refresh()` and `drainSyncQueue()` before all read and write operations. This ensures that a persistent agent process always sees the latest changes from other agents and any tasks queued by external hooks.

### Changed
- **Removed `queueDrained` optimization** — the sync queue is now always checked during `sync()` to ensure reliable processing of tasks created by hooks in long-running sessions.

## 2.2.0 (2026-04-18)

### Changed
- **Upgraded `@backloghq/agentdb` from 1.2.1 to 1.3.0** — unlocks persisted schemas with agent context, the schema lifecycle toolset (`db_get_schema`, `db_set_schema`, `db_delete_schema`, `db_diff_schema`, `db_migrate`, `db_infer_schema`), the `$strLen` filter operator, and schema bootstrap via `<dataDir>/schemas/*.json` or `--schemas` CLI flag.

### Added
- **Agent-facing context on `taskSchema`** — the `tasks` collection now carries a `description`, `instructions`, and per-field `description` values. On first open these auto-persist to `<taskdataRoot>/<project>/meta/tasks.schema.json`, so any agent connecting to the backlog MCP server can call `db_get_schema` and discover the shape + usage guidance of the tasks collection without reading this repo's source.
- **Schema `version: 1`** declared on `taskSchema` so future schema evolution can be tracked against the persisted file.

## 2.1.1 (2026-04-11)

### Fixed
- **Snapshot loading crash on startup** — upgraded `@backloghq/agentdb` from 1.2.0 to 1.2.1, which fixes opslog 0.8.0 failing to parse multi-line legacy JSON snapshots (first-line detection broke on `{` alone).

## 2.1.0 (2026-04-11)

### Changed
- **Upgraded `@backloghq/agentdb` from 1.1.1 to 1.2.0** — adapts to async Collection read methods (`findOne`, `find`, `findAll`, `count`). All engine read paths now `await` these calls, enabling future disk-backed storage mode.
- **`findTask()` is now async** — cascades `await` to all callers: `taskCommand`, `writeDoc`, `readDoc`, `deleteDoc`, `duplicateTask`.

### Added
- **Array indexes on `tags` and `depends`** — uses agentdb's new `arrayIndexes` schema option for O(1) `$contains` lookups. Tag filters (`+bug`, `-old`) and dependency checks are now index-accelerated instead of full-scan.

## 2.0.2 (2026-04-11)

### Fixed
- **Imported tasks now get numeric IDs** — upgraded `@backloghq/agentdb` from 1.1.0 to 1.1.1 which fixes `insertMany` to apply schema hooks (autoIncrement, defaults, date resolution). Previously imported tasks had no numeric `id` field and couldn't be looked up by number.

## 2.0.1 (2026-04-10)

### Fixed
- **CWD restoration in start-server.sh** — the dep install step (`cd $PLUGIN_DATA && npm ci`) changed the working directory but never restored it. This caused `process.cwd()` to return the plugin data directory instead of the project directory, producing wrong project slugs and storing task data in the wrong location. Tasks appeared lost on subsequent sessions when deps didn't need reinstalling (CWD stayed correct).

## 2.0.0 (2026-04-10)

### Changed (BREAKING)
- **Engine rewritten on AgentDB** — replaced raw `@backloghq/opslog` Store with `@backloghq/agentdb` Collection API. Task data is now managed via AgentDB with `defineSchema()`, typed validation, auto-increment IDs, date resolution on fields, virtual filters, and computed urgency.
- **Filter compiler rewritten** — backlog filter syntax now translates to AgentDB JSON filter objects. Virtual tags (+OVERDUE, +BLOCKED, etc.) resolved via schema virtualFilters. Bare text triggers AgentDB's text search. Date modifiers (`.before`, `.after`) auto-resolve through dates.ts.
- **Doc storage migrated to blob API** — `writeDoc`/`readDoc`/`deleteDoc` now use AgentDB's `Collection.writeBlob()`/`readBlob()`/`deleteBlob()` instead of filesystem `docs/` directory. Works with S3 backend transparently.
- **Task records use `_id` as UUID** — AgentDB's `_id` field replaces the `uuid` field. Numeric `id` is now an `autoIncrement` schema field.
- Direct `@backloghq/opslog` dependency removed — opslog is now a transitive dependency via agentdb.

### Added
- `src/engine/task-schema.ts` — declarative task collection schema with field validation, defaults, date resolution, virtual filters, computed urgency, and auto-increment IDs
- Schema validation replaces manual `validateAttrs()` — field types, constraints, and patterns enforced by agentdb
- `isDueTomorrow()` helper in dates.ts

### Removed
- Manual `validateAttrs()` function (replaced by schema)
- Manual `nextId()` counter (replaced by autoIncrement)
- Filesystem-based doc storage (replaced by blob API)

## 1.8.0 (2026-04-09)

### Added
- **S3 storage backend** — set `BACKLOG_BACKEND=s3` with `BACKLOG_S3_BUCKET` and optional `BACKLOG_S3_REGION` to store task data in Amazon S3. Requires `@backloghq/opslog-s3` as an optional peer dependency (dynamically imported). Enables team sharing and cloud persistence.

### Changed
- Upgraded `@backloghq/opslog` from 0.2.0 to 0.4.0 — adds pluggable storage backends, multi-writer concurrency with Lamport clocks, WAL tailing for cross-process live updates, and automatic delta encoding for space-efficient updates.
- `getConfig()` is now async (supports dynamic import of optional S3 backend)
- `EngineConfig` extended with optional `backend` field

## 1.7.0 (2026-04-09)

### Changed
- Upgraded `@backloghq/opslog` from 0.1.4 to 0.2.0 — adds async mutation serializer (prevents concurrent write interleaving), advisory directory lock (prevents multi-process corruption), and O(1) ftruncate-based undo
- `session-start.sh` now opens the store in read-only mode (`readOnly: true`) to avoid lock conflicts with the running MCP server

## 1.6.0 (2026-04-09)

### Added
- **MCP tool annotations** on all 24 tools — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` declared for each tool so MCP clients can make informed decisions without parsing descriptions
- **Error conditions** documented in every tool description — what errors are returned and when
- **Return value documentation** for all mutation tools — exact success/failure messages
- **Reversibility notes** — each mutating tool states whether it can be undone with task_undo
- **Discovery workflows** — parameter descriptions link to prerequisite tools (e.g. "use task_info to see annotations before denotating")
- **Archive cold storage** — explicitly documented that archived tasks are view-only with no restore operation
- **Permissions/rate limits** — all tools note that no authentication is required, no rate limits apply, and all operations are local
- **Output schemas** on all 24 tools — formal Zod response schemas with `structuredContent` returns for typed MCP responses

### Changed
- **Refactored tool registrations** into domain-grouped modules: `tools/query.ts`, `tools/lifecycle.ts`, `tools/modify.ts`, `tools/docs.ts`, `tools/archive.ts`. Entry point reduced from 775 lines to 50. Shared helpers and schemas extracted to `helpers.ts` and `schemas.ts`.
- **Dockerfile** upgraded to Node.js 25
- **CI** added Docker build + MCP introspection verification job, bumped CI node to 22
- **189 tests** — 51 new tests for archive tools, filter branches, date resolution, recurrence patterns, and schema validation

## 1.5.0 (2026-04-08)

### Changed
- **All 24 MCP tool descriptions rewritten** — each tool now documents behavior, return format, parameter syntax, edge cases, and when to use it vs alternatives
- README tool table updated with concise descriptions matching the MCP schema

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
