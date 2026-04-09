import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { safe, parseTags } from "../helpers.js";
import { confirmationOutput, LOCAL_NOTE } from "../schemas.js";
import { addTask, taskCommand, logTask, duplicateTask, type EngineConfig } from "../engine/index.js";

export function registerLifecycleTools(server: McpServer, config: EngineConfig): void {
  server.registerTool(
    "task_add",
    {
      title: "Add Task",
      description:
        "Create a new pending task and return its UUID. Only 'description' is required; all other fields are optional. " +
        "The task gets a stable numeric ID and UUID for cross-session references. Returns a confirmation with the UUID on success. " +
        "Errors if description is empty or exceeds 500 chars, project name has invalid characters, or dates are unparseable. " +
        "This operation can be reversed with task_undo. " +
        "To record already-completed work, use task_log instead. To copy an existing task, use task_duplicate." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        description: z.string().describe("Task description (required, max 500 chars). Brief summary of what needs to be done."),
        project: z.string().optional().describe("Project name for grouping (alphanumeric, hyphens, underscores). E.g. 'backend', 'auth-refactor'"),
        tags: z.string().optional().describe("Tags as comma-separated list or JSON array. E.g. 'bug,urgent' or '[\"bug\",\"urgent\"]'. Used for filtering with +tag/-tag syntax."),
        priority: z.enum(["H", "M", "L"]).optional().describe("Priority: H (high), M (medium), L (low). Affects urgency score and sort order."),
        due: z.string().optional().describe("Due date. Accepts: ISO dates ('2025-12-31'), relative ('3d', '2w'), named ('tomorrow', 'friday', 'eow', 'eom'), compound ('now+3d')."),
        depends: z.string().optional().describe("Comma-separated UUIDs of tasks this depends on. Task shows as +BLOCKED until dependencies are completed."),
        wait: z.string().optional().describe("Wait date — task is hidden from default views until this date. Same date formats as 'due'."),
        scheduled: z.string().optional().describe("Scheduled start date — when to begin working. Same date formats as 'due'."),
        recur: z.string().optional().describe("Recurrence pattern. Requires 'due' to be set. Values: 'daily', 'weekly', 'weekdays', 'biweekly', 'monthly', 'quarterly', 'yearly', or numeric like '3d', '2w'."),
        until: z.string().optional().describe("End date for recurrence — no instances generated past this date. Only meaningful with 'recur'. Same date formats as 'due'."),
        agent: z.string().optional().describe("Agent identity for tracking task ownership across agent teams. E.g. 'explorer', 'planner', 'reviewer'."),
        extra: z.string().optional().describe("Space-separated additional attributes or +tag/-tag modifiers."),
      }),
    },
    safe(async ({ description, project, tags, priority, due, depends, wait, scheduled, recur, until, agent, extra }) => {
      const attrs: Record<string, string> = {};
      if (project) attrs.project = project;
      if (priority) attrs.priority = priority;
      if (due) attrs.due = due;
      if (depends) attrs.depends = depends;
      if (wait) attrs.wait = wait;
      if (scheduled) attrs.scheduled = scheduled;
      if (recur) attrs.recur = recur;
      if (until) attrs.until = until;
      if (agent) attrs.agent = agent;

      const extraArgs: string[] = [];
      const parsed = parseTags(tags);
      if (parsed.length > 0) {
        extraArgs.push(...parsed.map((t) => `+${t}`));
      }
      if (extra) {
        extraArgs.push(...extra.split(/\s+/).filter(Boolean));
      }

      const result = await addTask(config, description, attrs, extraArgs);
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_done",
    {
      title: "Complete Task",
      description:
        "Mark a task as completed, setting its status to 'completed' and recording the end timestamp. " +
        "Returns a confirmation message on success. Errors if the task is not found or is already completed/deleted. " +
        "The task remains in the database and appears in completed task queries (filter: 'status:completed'). " +
        "If the task is a recurring instance, completing it triggers generation of the next instance. " +
        "This operation can be reversed with task_undo. Calling task_done on an already-completed task returns an error. " +
        "To record work that was already done without creating a pending task first, use task_log instead." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs. Task must be in pending or active status."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "done");
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_delete",
    {
      title: "Delete Task",
      description:
        "Soft-delete a task by setting its status to 'deleted'. Returns a confirmation message on success. " +
        "Errors if the task is not found. The task remains in the database and can be restored with task_undo. " +
        "Deleted tasks are excluded from default queries but visible with filter 'status:deleted'. " +
        "To permanently erase a deleted task, use task_purge. For bulk cleanup, use task_archive instead." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID). Use task_list to find IDs."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "delete");
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_start",
    {
      title: "Start Task",
      description:
        "Mark a task as actively being worked on by recording a start timestamp. " +
        "Returns a confirmation on success. Errors if the task is not found or is not in pending status. " +
        "Started tasks appear in +ACTIVE queries and get a higher urgency score. " +
        "Starting an already-active task is idempotent (no error). This operation can be reversed with task_undo. " +
        "Use task_stop when pausing work, or task_done when finished. Multiple tasks can be active simultaneously." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs. Task must be in pending status."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "start");
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_stop",
    {
      title: "Stop Task",
      description:
        "Stop actively working on a task by clearing the start timestamp. " +
        "Returns a confirmation on success. Errors if the task is not found or is not currently active. " +
        "The task returns to pending status and no longer appears in +ACTIVE queries. " +
        "This operation can be reversed with task_undo. To finish a task instead of pausing, use task_done." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs. Task must be currently active (started)."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "stop");
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_log",
    {
      title: "Log Completed Task",
      description:
        "Record a task that is already completed, creating it directly in 'completed' status with an end timestamp. Returns 'Task logged.' on success. " +
        "Errors if description is empty or exceeds 500 chars, or project name has invalid characters. " +
        "Use this to log work done outside the task system or to record completed items retroactively. " +
        "Unlike task_add followed by task_done, this is a single operation. This operation can be reversed with task_undo. " +
        "Logged tasks appear in completed task queries (filter: 'status:completed') and standups." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        description: z.string().describe("Description of the completed work (required, max 500 chars)."),
        project: z.string().optional().describe("Project name for grouping."),
        tags: z.string().optional().describe("Tags as comma-separated list. E.g. 'done,reviewed'"),
        priority: z.enum(["H", "M", "L"]).optional().describe("Priority: H (high), M (medium), L (low)."),
        agent: z.string().optional().describe("Agent identity that completed the work."),
        extra: z.string().optional().describe("Space-separated additional attributes or +tag modifiers."),
      }),
    },
    safe(async ({ description, project, tags, priority, agent, extra }) => {
      const attrs: Record<string, string> = {};
      if (project) attrs.project = project;
      if (priority) attrs.priority = priority;
      if (agent) attrs.agent = agent;

      const extraArgs: string[] = [];
      const parsed = parseTags(tags);
      if (parsed.length > 0) {
        extraArgs.push(...parsed.map((t) => `+${t}`));
      }
      if (extra) {
        extraArgs.push(...extra.split(/\s+/).filter(Boolean));
      }

      const result = await logTask(config, description, attrs, extraArgs);
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_duplicate",
    {
      title: "Duplicate Task",
      description:
        "Create a new pending task by copying an existing one, optionally overriding specific fields. Returns a confirmation with the new UUID. " +
        "The copy gets a new UUID and ID; start/end timestamps and status are reset to pending. " +
        "Errors if the source task is not found, or if overridden fields fail validation (invalid project name, bad date, etc). " +
        "This operation can be reversed with task_undo. For creating from scratch, use task_add instead." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID) of the task to copy."),
        description: z.string().optional().describe("New description to override the original."),
        project: z.string().optional().describe("New project. Pass empty string to clear."),
        tags: z.string().optional().describe("Tags to add (+) or remove (-). E.g. '+frontend,-old'. Applied on top of the copied tags."),
        priority: z.enum(["H", "M", "L", ""]).optional().describe("New priority. Pass empty string to clear."),
        due: z.string().optional().describe("New due date. Pass empty string to clear."),
        agent: z.string().optional().describe("Agent identity for the new task."),
        extra: z.string().optional().describe("Space-separated additional attributes or +tag/-tag modifiers."),
      }),
    },
    safe(async ({ id, description, project, tags, priority, due, agent, extra }) => {
      const attrs: Record<string, string> = {};
      if (description) attrs.description = description;
      if (project !== undefined) attrs.project = project;
      if (priority !== undefined) attrs.priority = priority;
      if (due !== undefined) attrs.due = due;
      if (agent !== undefined) attrs.agent = agent;

      const extraArgs: string[] = [];
      const parsed = parseTags(tags);
      if (parsed.length > 0) {
        extraArgs.push(...parsed.map((t) => (t.startsWith("+") || t.startsWith("-") ? t : `+${t}`)));
      }
      if (extra) {
        extraArgs.push(...extra.split(/\s+/).filter(Boolean));
      }

      const result = await duplicateTask(config, id, attrs, extraArgs);
      return { structuredContent: { message: result } };
    })
  );
}
