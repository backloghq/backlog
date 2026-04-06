---
name: spec
description: Write a detailed spec document for a task before implementation begins. Use when the user wants to define requirements, acceptance criteria, or technical design for a task.
---

# Write Task Spec

Write a specification document for a task. If an argument is provided, use it as the task ID or description to find the task. Otherwise, ask which task to spec.

## Process

1. **Find the task** — use `task_list` or `task_info` to find the task matching "$ARGUMENTS". If $ARGUMENTS is empty, call `task_list` with filter `status:pending -doc` to show tasks without specs and ask which one.

2. **Understand the context** — read relevant code, configs, and existing docs in the codebase to understand what the task involves.

3. **Write the spec** — use `task_doc_write` to attach a markdown document to the task with:
   - **Goal**: what this task achieves
   - **Requirements**: specific things that must be built or changed
   - **Technical approach**: key decisions and implementation strategy
   - **Acceptance criteria**: how to verify the task is done
   - **Relevant code**: file paths and functions to modify

4. **Confirm** — show a summary of the spec that was written and the task it was attached to.

Keep specs concise and actionable — a spec should be something an agent can pick up and implement without further context.
