---
name: tasks
description: Show the current task backlog — pending, active, blocked, and overdue tasks. Use when the user asks about tasks, status, what needs to be done, or what's in progress.
---

# Task Status Overview

Show the current state of the task backlog. Use the TaskWarrior MCP tools to query and present the following:

1. **Active tasks** — call `task_list` with filter `+ACTIVE` to show tasks currently being worked on
2. **Overdue tasks** — call `task_list` with filter `+OVERDUE` to show tasks past their due date
3. **Blocked tasks** — call `task_count` with filter `+BLOCKED status:pending` to count blocked tasks
4. **Pending tasks by priority** — call `task_list` with filter `status:pending` and group results by priority (H, M, L, none)
5. **Tasks with docs** — call `task_count` with filter `+doc status:pending` to count tasks with attached specs/docs
6. **Recently completed** — call `task_list` with filter `status:completed end.after:now-7d` to show work done in the last 7 days

Present the results in a concise, scannable format. Skip sections that have zero results. If the backlog is completely empty, say so and suggest using `/backlog:plan` to create tasks.
