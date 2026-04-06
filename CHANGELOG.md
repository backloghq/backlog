# Changelog

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
