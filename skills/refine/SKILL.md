---
name: refine
description: Review and improve the backlog — identify vague tasks, missing priorities, broken dependencies, tasks needing specs, and stale items. Use when the user wants to groom, refine, clean up, or improve their task backlog.
---

# Refine Backlog

Review the current backlog and improve its quality. This is a grooming pass — make tasks actionable, well-prioritized, and properly connected.

## Process

1. **Load the backlog** — call `task_list` with filter `status:pending` to get all pending tasks.

2. **Analyze each task** for these issues:

   **Vague descriptions** — tasks that are too broad or unclear. A good description starts with a verb and is specific enough that someone could implement it without asking questions. Flag tasks that need to be broken down or clarified.

   **Missing priorities** — tasks without H/M/L priority. Suggest a priority based on the task's description and context.

   **Missing dependencies** — tasks that logically depend on other tasks but don't have `depends` set. Look for ordering constraints (e.g., "write tests" should depend on the feature it tests).

   **Tasks needing specs** — complex tasks (multi-step, architectural, or ambiguous) that don't have a doc attached. Check with `task_count` filter `+doc status:pending` and identify which tasks SHOULD have specs but don't.

   **Stale tasks** — tasks created long ago with no activity. Check `entry` dates and annotations. Flag anything older than 30 days with no progress.

   **Urgency mismatches** — tasks with high urgency scores but low priority, or vice versa. These might need priority adjustments.

3. **Present findings** — group issues by category. For each issue, show the task ID, description, and the specific problem.

4. **Fix with permission** — for each category, ask if the user wants to apply the suggested fixes. Then use `task_modify`, `task_doc_write`, or `task_annotate` to make the changes.

## Guidelines

- Don't create new tasks — refinement improves existing ones
- Don't delete tasks — flag stale ones for the user to decide
- Suggest specific fixes, don't just list problems
- If the backlog is small and clean, say so — don't invent issues
