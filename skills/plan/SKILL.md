---
name: plan
description: Break down a goal into actionable tasks with dependencies, priorities, and optional specs. Use when the user wants to plan work, decompose a feature, or create a task breakdown.
---

# Plan Work

Break down the given goal into actionable tasks. The goal is: "$ARGUMENTS"

## Process

1. **Understand the goal** — analyze what "$ARGUMENTS" requires. Read relevant code, configs, and docs in the codebase to understand the current state.

2. **Decompose into tasks** — create a logical breakdown of work items. Each task should be:
   - Small enough to complete in one focused session
   - Clear about what "done" looks like
   - Independent where possible, with explicit dependencies where not

3. **Create tasks** — for each task, use `task_add` with:
   - A clear, actionable description (start with a verb)
   - `project` set to a logical grouping
   - `priority` based on urgency and importance (H for blockers, M for core work, L for nice-to-have)
   - `tags` for categorization (e.g., `frontend`, `backend`, `testing`, `docs`)
   - `depends` to express ordering constraints (use UUIDs from previously created tasks)
   - `scheduled` if the task shouldn't start until a certain date

4. **Write specs for complex tasks** — for any task that needs detailed requirements or context, use `task_doc_write` to attach a markdown document explaining:
   - What needs to be built
   - Key technical decisions
   - Acceptance criteria
   - Relevant code locations

5. **Present the plan** — show the created tasks in dependency order with their IDs, descriptions, and priorities. Highlight the first task(s) that can be started immediately (not blocked).
