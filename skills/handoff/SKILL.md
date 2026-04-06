---
name: handoff
description: Prepare a session handoff — summarize progress, annotate tasks with current status, and identify what's ready for the next session. Use at the end of a work session or when the user says they're done for now.
---

# Session Handoff

Prepare context for the next session so work can continue seamlessly.

## Process

1. **Review active tasks** — call `task_list` with filter `+ACTIVE` to find tasks that were being worked on. For each:
   - Use `task_annotate` to record what was accomplished and what remains
   - Use `task_stop` to mark them as no longer active

2. **Review pending tasks** — call `task_list` with filter `status:pending` to see the full backlog. Note any tasks whose status has changed based on work done this session.

3. **Log unplanned work** — if work was done that wasn't tracked as a task, use `task_log` to record it retroactively with appropriate project and tags.

4. **Update blocked tasks** — if any blockers were resolved this session, use `task_modify` to remove dependencies or update descriptions.

5. **Present the handoff summary**:
   - **Done this session**: tasks completed or logged
   - **Progress made**: annotations added to in-progress tasks
   - **Ready to pick up next**: pending tasks sorted by priority that aren't blocked
   - **Blockers**: any tasks that are blocked and why

Keep the summary concise — the goal is to give the next session (or agent) a clear starting point.
