---
name: implement
description: Pick up a task from the backlog and implement it. Reads the spec if one exists, starts the task, does the work, and marks it done. Use when the user wants to work on a specific task or the next available task.
---

# Implement Task

Pick up a task and implement it. If an argument is provided, use it as the task ID. Otherwise, pick the highest-urgency unblocked task.

## Process

1. **Find the task** — if "$ARGUMENTS" is provided, use `task_info` to get the task. Otherwise, call `task_list` with filter `status:pending` and pick the highest-urgency task that is NOT blocked (+BLOCKED).

2. **Read the spec** — call `task_doc_read` to check if the task has an attached spec. If it does, read it carefully — it defines what to build and how to verify.

3. **Start the task** — call `task_start` to mark it as actively being worked on.

4. **Do the work** — implement what the task and spec describe. Write code, create files, run tests. Use the codebase tools (Read, Edit, Write, Bash, Grep, Glob) as needed.

5. **Verify** — check the acceptance criteria from the spec. Run relevant tests. Make sure the implementation is complete.

6. **Complete the task** — call `task_done` to mark it as completed. Add an annotation with `task_annotate` summarizing what was done if the changes aren't obvious.

7. **Check what's next** — call `task_list` with filter `status:pending` to see if completing this task unblocked anything. Mention what's ready to pick up next.
