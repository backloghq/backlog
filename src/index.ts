import { createRequire } from "node:module";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };
import {
  getConfig,
  ensureSetup,
  shutdown,
  exportTasks,
  addTask,
  modifyTask,
  taskCommand,
  undo,
  getUnique,
  importTasks,
  countTasks,
  logTask,
  duplicateTask,
  writeDoc,
  readDoc,
  deleteDoc,
  archiveTasks,
  loadArchivedTasks,
  listArchiveSegments,
  type EngineConfig,
} from "./engine/index.js";

function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  const trimmed = tags.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as string[];
    } catch {
      return [];
    }
  }
  return trimmed.split(",").map((t) => t.trim()).filter(Boolean);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe<T>(fn: (args: T) => Promise<any>): (args: T) => Promise<any> {
  return async (args: T) => {
    try {
      return await fn(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };
}

// Output schemas for structured MCP responses
const taskSchema = z.object({
  uuid: z.string(), id: z.number(), description: z.string(),
  status: z.string(), entry: z.string(), modified: z.string(),
  end: z.string().optional(), project: z.string().optional(),
  tags: z.array(z.string()).optional(), priority: z.string().optional(),
  due: z.string().optional(), wait: z.string().optional(),
  scheduled: z.string().optional(), recur: z.string().optional(),
  until: z.string().optional(), depends: z.array(z.string()).optional(),
  start: z.string().optional(), agent: z.string().optional(),
  has_doc: z.boolean().optional(), urgency: z.number().optional(),
  parent: z.string().optional(),
  annotations: z.array(z.object({ entry: z.string(), description: z.string() })).optional(),
}).passthrough();
const taskArrayOutput = z.object({ tasks: z.array(taskSchema) });
const confirmationOutput = z.object({ message: z.string() });
const countOutput = z.object({ count: z.number() });
const stringArrayOutput = z.object({ items: z.array(z.string()) });
const docOutput = z.object({ content: z.string() });

// Shared note for all tools — no auth, no rate limits, all operations are local
const LOCAL_NOTE = " No authentication required. No rate limits. All operations are local to the project's data directory.";

function createServer(config: EngineConfig): McpServer {
  const server = new McpServer({
    name: "backlog",
    version: PKG_VERSION,
  });

  server.registerTool(
    "task_list",
    {
      title: "List Tasks",
      description:
        "Query and return tasks matching a filter expression. Returns a JSON array of task objects with all fields (uuid, id, description, status, priority, due, tags, urgency, etc). " +
        "Returns an empty array if no tasks match. Use this for browsing, searching, and reading task data. For just a count, use task_count instead. " +
        "Filter syntax supports: attribute matching (project:X, status:pending, priority:H), tags (+bug, -old), " +
        "virtual tags (+OVERDUE, +ACTIVE, +BLOCKED, +READY), date comparisons (due.before:friday), " +
        "and boolean operators (and, or, parentheses). Empty filter returns all pending tasks. " +
        "Invalid filter expressions return an error message." + LOCAL_NOTE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: taskArrayOutput,
      inputSchema: z.object({
        filter: z.string().describe(
          "Filter expression to match tasks. Examples: 'status:pending', 'project:backend +bug', " +
          "'due.before:tomorrow', '+OVERDUE', '+BLOCKED', 'priority:H', 'agent:explorer'. " +
          "Combine with 'and'/'or' and parentheses. Leave empty for all pending tasks."
        ),
      }),
    },
    safe(async ({ filter }) => {
      const effectiveFilter = filter || "status:pending";
      const tasks = await exportTasks(config, effectiveFilter);
      return { structuredContent: { tasks } };
    })
  );

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
    "task_modify",
    {
      title: "Modify Task",
      description:
        "Update one or more tasks matching a filter. Only provided fields are changed — omitted fields are left untouched (partial update). " +
        "The filter can match multiple tasks; all matches are updated with the same changes. " +
        "Returns 'Modified N task(s).' on success, or 'No matching tasks.' if the filter matches nothing. " +
        "Errors if description exceeds 500 chars, priority is invalid, or dates are unparseable. " +
        "Each modification can be reversed with task_undo (one undo per modified task). " +
        "Use task_done/task_delete/task_start/task_stop for status changes instead." + LOCAL_NOTE,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        filter: z.string().describe("Filter to select tasks. Can be a numeric ID ('1'), UUID, or filter expression ('project:backend priority:H'). Matches may update multiple tasks."),
        description: z.string().optional().describe("New description text (max 500 chars). Only set if you want to change it."),
        project: z.string().optional().describe("New project name. Pass empty string to clear."),
        tags: z.string().optional().describe("Tags to add (+) or remove (-). E.g. '+frontend,+urgent' or '-old,+new'. Prefix with + to add, - to remove. Without prefix, tags are added."),
        priority: z.enum(["H", "M", "L", ""]).optional().describe("New priority. Pass empty string to clear priority entirely."),
        due: z.string().optional().describe("New due date. Accepts ISO dates, relative ('3d'), named ('friday', 'eow'). Pass empty string to clear."),
        depends: z.string().optional().describe("New dependency UUIDs (comma-separated). Replaces existing dependencies. Pass empty string to clear."),
        wait: z.string().optional().describe("New wait date. Task hidden from default views until this date. Pass empty string to clear."),
        scheduled: z.string().optional().describe("New scheduled start date. Pass empty string to clear."),
        recur: z.string().optional().describe("New recurrence pattern ('daily', 'weekly', '3d', etc). Pass empty string to clear."),
        until: z.string().optional().describe("End date for recurrence. Pass empty string to clear."),
        agent: z.string().optional().describe("Agent identity. Pass empty string to unassign."),
        extra: z.string().optional().describe("Space-separated additional attributes or +tag/-tag modifiers."),
      }),
    },
    safe(async ({ filter, description, project, tags, priority, due, depends, wait, scheduled, recur, until, agent, extra }) => {
      const attrs: Record<string, string> = {};
      if (description) attrs.description = description;
      if (project !== undefined) attrs.project = project;
      if (priority !== undefined) attrs.priority = priority;
      if (due !== undefined) attrs.due = due;
      if (depends !== undefined) attrs.depends = depends;
      if (wait !== undefined) attrs.wait = wait;
      if (scheduled !== undefined) attrs.scheduled = scheduled;
      if (recur !== undefined) attrs.recur = recur;
      if (until !== undefined) attrs.until = until;
      if (agent !== undefined) attrs.agent = agent;

      const extraArgs: string[] = [];
      const parsed = parseTags(tags);
      if (parsed.length > 0) {
        extraArgs.push(...parsed.map((t) => (t.startsWith("+") || t.startsWith("-") ? t : `+${t}`)));
      }
      if (extra) {
        extraArgs.push(...extra.split(/\s+/).filter(Boolean));
      }

      const result = await modifyTask(config, filter, attrs, extraArgs);
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
    "task_annotate",
    {
      title: "Annotate Task",
      description:
        "Add a timestamped text note to a task. Returns a confirmation on success. Errors if the task is not found. " +
        "Annotations are short, append-only notes for tracking progress, decisions, or handoff context across sessions. " +
        "Multiple annotations can be added to the same task; each is stored with its timestamp. " +
        "Adding the same text twice creates duplicate annotations. This operation can be reversed with task_undo. " +
        "For longer structured content (specs, designs, context docs), use task_doc_write instead. " +
        "To remove an annotation, use task_denotate with the exact text (use task_info to see existing annotations first)." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs."),
        text: z.string().describe("Annotation text to add. Stored with a timestamp. Keep concise — use task_doc_write for longer content."),
      }),
    },
    safe(async ({ id, text }) => {
      const result = await taskCommand(config, id, "annotate", [text]);
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
    "task_undo",
    {
      title: "Undo",
      description:
        "Undo the most recent single operation (add, modify, delete, done, start, stop, annotate). " +
        "Restores the previous state of the affected task. Returns 'Undo completed.' on success. " +
        "Returns 'Nothing to undo.' if the operation log is empty (e.g. after a checkpoint or fresh start). " +
        "Can be called repeatedly to undo multiple operations in reverse chronological order. " +
        "Note: undo itself cannot be undone — it consumes the operation from the log." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({}),
    },
    safe(async () => {
      const result = await undo();
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_info",
    {
      title: "Task Info",
      description:
        "Get the full JSON object for a single task by ID or UUID. Returns all fields including annotations, dependencies, has_doc, and computed urgency score. " +
        "Returns an error if no task matches the given ID. " +
        "Use this when you need complete details for one specific task, e.g. before calling task_denotate (to see annotation text) or task_modify. " +
        "For querying multiple tasks, use task_list with a filter instead." + LOCAL_NOTE,

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: taskArrayOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs. Returns an error if no task matches."),
      }),
    },
    safe(async ({ id }) => {
      const tasks = await exportTasks(config, id);
      if (tasks.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No task found with that ID." }],
          isError: true,
        };
      }
      return { structuredContent: { tasks: [tasks[0]] } };
    })
  );

  server.registerTool(
    "task_projects",
    {
      title: "List Projects",
      description:
        "Return a JSON array of all project names that have at least one pending or recurring task. Returns an empty array if no projects exist. " +
        "Useful for discovering available projects before filtering with task_list (e.g. task_list filter:'project:backend'). " +
        "Completed and deleted tasks are excluded from the project list." + LOCAL_NOTE,

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: stringArrayOutput,
      inputSchema: z.object({}),
    },
    safe(async () => {
      const projects = await getUnique(config, "project");
      return { structuredContent: { items: projects } };
    })
  );

  server.registerTool(
    "task_tags",
    {
      title: "List Tags",
      description:
        "Return a JSON array of all tags that have at least one pending or recurring task. Returns an empty array if no tags exist. " +
        "Useful for discovering available tags before filtering with task_list (e.g. task_list filter:'+bug'). " +
        "Completed and deleted tasks are excluded from the tag list." + LOCAL_NOTE,

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: stringArrayOutput,
      inputSchema: z.object({}),
    },
    safe(async () => {
      const tags = await getUnique(config, "tags");
      return { structuredContent: { items: tags } };
    })
  );

  server.registerTool(
    "task_denotate",
    {
      title: "Remove Annotation",
      description:
        "Remove a specific annotation from a task by exact text match (case-sensitive). " +
        "Returns a confirmation on success. Errors if the task is not found or no annotation matches the given text. " +
        "Use task_info first to see all annotations on a task and get the exact text to match. " +
        "This operation can be reversed with task_undo. To add annotations, use task_annotate." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs."),
        text: z.string().describe("Exact annotation text to remove (case-sensitive). Must match a previously added annotation."),
      }),
    },
    safe(async ({ id, text }) => {
      const result = await taskCommand(config, id, "denotate", [text]);
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_purge",
    {
      title: "Purge Task",
      description:
        "Permanently and irreversibly remove a deleted task from the database. Returns a confirmation on success. " +
        "Errors if the task is not found or is not in 'deleted' status — use task_delete first to soft-delete, then task_purge to erase. " +
        "This cannot be undone — the task data, annotations, and any attached document are permanently erased. " +
        "For bulk cleanup of old tasks, use task_archive instead (which preserves data in cold storage)." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs. Task must be in 'deleted' status."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "purge");
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_import",
    {
      title: "Import Tasks",
      description:
        "Bulk-create tasks from a JSON array. Each object must have a 'description' field; all other fields (project, tags, priority, due, status, depends, recur) are optional. " +
        "Tasks are created atomically — if any task fails validation, none are created. Returns 'Imported N task(s).' on success. " +
        "Errors if JSON is malformed, a description is empty/too long, a status or priority is invalid, or a date is unparseable. " +
        "Use this for migrating data or creating multiple tasks at once. For single tasks, use task_add instead." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        tasks: z.string().describe(
          "JSON array of task objects. Required field: 'description'. Optional: 'project', 'tags' (string[]), 'priority' (H/M/L), " +
          "'due', 'status', 'depends' (UUID[]), 'recur', 'agent', 'uuid' (to set explicit ID). " +
          "Example: '[{\"description\":\"My task\",\"project\":\"foo\",\"priority\":\"H\"}]'"
        ),
      }),
    },
    safe(async ({ tasks }) => {
      const result = await importTasks(config, tasks);
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_count",
    {
      title: "Count Tasks",
      description:
        "Return the count of tasks matching a filter as a plain number (e.g. '5'). Returns '0' if no tasks match. " +
        "More efficient than task_list when you only need the count, not the full task data. " +
        "Uses the same filter syntax as task_list. Invalid filter expressions return an error." + LOCAL_NOTE,

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: countOutput,
      inputSchema: z.object({
        filter: z.string().describe(
          "Filter expression. Same syntax as task_list. Examples: 'status:pending', '+OVERDUE', 'project:backend +bug'. " +
          "Leave empty for all pending tasks."
        ),
      }),
    },
    safe(async ({ filter }) => {
      const effectiveFilter = filter || "status:pending";
      const count = await countTasks(config, effectiveFilter);
      return { structuredContent: { count } };
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

  server.registerTool(
    "task_doc_write",
    {
      title: "Write Task Doc",
      description:
        "Attach or replace a markdown document on a task (spec, design, context, handoff notes). Returns a confirmation on success. " +
        "Each task has at most one document; writing replaces any existing doc content. Errors if the task is not found. " +
        "Automatically adds +doc tag and has_doc:true to the task, so docs are discoverable via task_list filter:'+doc'. " +
        "This operation can be reversed with task_undo (restores previous doc state). " +
        "For short notes, use task_annotate instead. To read the doc, use task_doc_read. To remove it, use task_doc_delete." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs."),
        content: z.string().describe("Document content in markdown format. Replaces any existing document on this task."),
      }),
    },
    safe(async ({ id, content }) => {
      const result = await writeDoc(config, id, content);
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_doc_read",
    {
      title: "Read Task Doc",
      description:
        "Read the markdown document attached to a task. Returns the full document content as text. " +
        "Returns an error ('No doc attached to this task.') if the task has no document. Errors if the task is not found. " +
        "Use task_list with filter '+doc' to discover tasks that have documents before reading." + LOCAL_NOTE,

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: docOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs."),
      }),
    },
    safe(async ({ id }) => {
      const doc = await readDoc(config, id);
      if (doc === null) {
        return {
          content: [{ type: "text" as const, text: "No doc attached to this task." }],
          isError: true,
        };
      }
      return { structuredContent: { content: doc } };
    })
  );

  server.registerTool(
    "task_doc_delete",
    {
      title: "Delete Task Doc",
      description:
        "Remove the markdown document attached to a task. Returns a confirmation on success. Errors if the task is not found. " +
        "Clears the +doc tag and has_doc field. The document content is permanently deleted and cannot be recovered. " +
        "Calling on a task with no document is a no-op. To update a document instead of removing it, use task_doc_write." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        id: z.string().describe("Task ID (numeric like '1', or UUID for cross-session stability). Use task_list to find IDs."),
      }),
    },
    safe(async ({ id }) => {
      const result = await deleteDoc(config, id);
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_archive",
    {
      title: "Archive Old Tasks",
      description:
        "Move completed and deleted tasks older than N days to a quarterly archive segment (cold storage), keeping the active set small and fast. " +
        "Returns the count of archived tasks. Archives are append-only — archiving the same period twice merges records. " +
        "Archived tasks are removed from the active database but preserved in read-only archive files. " +
        "Use task_archive_load to inspect archived tasks (view-only, no restore to active). " +
        "This is a bulk maintenance operation — for removing individual tasks, use task_delete or task_purge instead." + LOCAL_NOTE,

      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: confirmationOutput,
      inputSchema: z.object({
        older_than_days: z.string().optional().describe("Archive tasks completed/deleted more than this many days ago. Default: 90. E.g. '30' for tasks older than a month."),
      }),
    },
    safe(async ({ older_than_days }) => {
      const days = older_than_days ? parseInt(older_than_days, 10) : 90;
      const result = await archiveTasks(config, days);
      return { structuredContent: { message: result } };
    })
  );

  server.registerTool(
    "task_archive_list",
    {
      title: "List Archive Segments",
      description:
        "Return a JSON array of available archive segment paths (e.g. 'archive/archive-2026-Q1.json'). Returns an empty array if no archives exist. " +
        "Each segment contains tasks archived during that quarter. Use task_archive_load with the period name (e.g. '2026-Q1') to inspect contents. " +
        "Use task_archive to create new archive segments from old completed/deleted tasks." + LOCAL_NOTE,

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: stringArrayOutput,
      inputSchema: z.object({}),
    },
    safe(async () => {
      const segments = listArchiveSegments();
      return { structuredContent: { items: segments } };
    })
  );

  server.registerTool(
    "task_archive_load",
    {
      title: "Load Archived Tasks",
      description:
        "Load and return tasks from an archive segment as a read-only JSON array for inspection. " +
        "Errors if the segment is not found — use task_archive_list to discover available segments first. " +
        "This is view-only; archived tasks cannot be restored to the active database. Archives are cold storage for historical reference." + LOCAL_NOTE,

      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: taskArrayOutput,
      inputSchema: z.object({
        segment: z.string().describe("Archive segment name, e.g. '2026-Q1'. Use task_archive_list to see available segments."),
      }),
    },
    safe(async ({ segment }) => {
      const tasks = await loadArchivedTasks(config, segment);
      return { structuredContent: { tasks } };
    })
  );

  return server;
}

async function main(): Promise<void> {
  const config = getConfig();
  await ensureSetup(config);
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("backlog-engine MCP server running on stdio");

  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
}

// Only run when executed directly, not when imported as a module
const isEntryPoint =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/dist/index.js");

if (isEntryPoint) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createServer };
