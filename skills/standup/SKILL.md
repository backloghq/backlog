---
name: standup
description: Daily standup summary — what was completed recently, what's in progress, and what's blocked. Use when the user asks for a standup, status update, or summary of recent work.
---

# Daily Standup

Generate a concise standup report by querying the backlog.

## Process

1. **Done** — call `task_list` with filter `status:completed end.after:now-1d` to show tasks completed in the last 24 hours. If empty, try `end.after:now-7d` for the last week.

2. **In progress** — call `task_list` with filter `+ACTIVE` to show tasks currently being worked on.

3. **Blocked** — call `task_list` with filter `+BLOCKED status:pending` to show tasks waiting on dependencies. For each, identify which task is blocking it.

4. **Up next** — call `task_list` with filter `status:pending` and pick the top 3 by urgency that are NOT blocked. These are what should be worked on next.

5. **Overdue** — call `task_count` with filter `+OVERDUE` to flag any overdue tasks.

## Format

Present as a brief, scannable report:

```
**Done**: [completed tasks or "nothing recent"]
**In progress**: [active tasks or "nothing started"]
**Blocked**: [blocked tasks and what's blocking them, or "none"]
**Up next**: [top 3 actionable tasks by urgency]
**Overdue**: [count, or skip if 0]
```

Keep it concise — this is a quick status check, not a full report. Skip sections that are empty.
