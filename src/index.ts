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

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function safe<T>(fn: (args: T) => Promise<ToolResult>): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    try {
      return await fn(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };
}

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
        "Use this for browsing, searching, and reading task data. For just a count, use task_count instead. " +
        "Filter syntax supports: attribute matching (project:X, status:pending, priority:H), tags (+bug, -old), " +
        "virtual tags (+OVERDUE, +ACTIVE, +BLOCKED, +READY), date comparisons (due.before:friday), " +
        "and boolean operators (and, or, parentheses). Empty filter returns all pending tasks.",
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
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
    })
  );

  server.registerTool(
    "task_add",
    {
      title: "Add Task",
      description:
        "Create a new pending task and return its UUID. Only 'description' is required; all other fields are optional. " +
        "The task gets a stable numeric ID and UUID for cross-session references. " +
        "To record already-completed work, use task_log instead. To copy an existing task, use task_duplicate.",
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
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_modify",
    {
      title: "Modify Task",
      description:
        "Update one or more tasks matching a filter. Only provided fields are changed — omitted fields are left untouched (partial update). " +
        "The filter can match multiple tasks; all matches are updated with the same changes. " +
        "Returns the count of modified tasks. Use task_done/task_delete/task_start/task_stop for status changes instead.",
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
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_done",
    {
      title: "Complete Task",
      description:
        "Mark a task as completed, setting its status to 'completed' and recording the end timestamp. " +
        "The task remains in the database and appears in completed task queries. " +
        "If the task is a recurring instance, completing it may trigger generation of the next instance. " +
        "To record work that was already done without creating a pending task first, use task_log instead.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID. Task must be in pending or active status."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "done");
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_delete",
    {
      title: "Delete Task",
      description:
        "Soft-delete a task by setting its status to 'deleted'. The task remains in the database and can be restored with task_undo. " +
        "To permanently remove a deleted task from the database, use task_purge after deleting. " +
        "Deleted tasks are excluded from default queries but visible with 'status:deleted' filter.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID of the task to delete."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "delete");
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_annotate",
    {
      title: "Annotate Task",
      description:
        "Add a timestamped text note to a task. Annotations are short, append-only notes for tracking progress, decisions, or handoff context across sessions. " +
        "Multiple annotations can be added to the same task. " +
        "For longer structured content (specs, designs, context docs), use task_doc_write instead. " +
        "To remove an annotation, use task_denotate with the exact text.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID."),
        text: z.string().describe("Annotation text to add. Stored with a timestamp. Keep concise — use task_doc_write for longer content."),
      }),
    },
    safe(async ({ id, text }) => {
      const result = await taskCommand(config, id, "annotate", [text]);
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_start",
    {
      title: "Start Task",
      description:
        "Mark a task as actively being worked on by recording a start timestamp. " +
        "Started tasks appear in +ACTIVE queries and get a higher urgency score. " +
        "Use task_stop when pausing work, or task_done when finished. Only one task needs to be active at a time, but multiple active tasks are allowed.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID. Task must be in pending status."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "start");
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_stop",
    {
      title: "Stop Task",
      description:
        "Stop actively working on a task by clearing the start timestamp. " +
        "The task returns to pending status and no longer appears in +ACTIVE queries. " +
        "Use this when pausing work on a task. To finish it, use task_done instead.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID. Task must be currently active (started)."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "stop");
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_undo",
    {
      title: "Undo",
      description:
        "Undo the most recent single operation (add, modify, delete, done, start, stop, annotate). " +
        "Restores the previous state of the affected task. Can be called repeatedly to undo multiple operations in reverse order. " +
        "Returns 'Nothing to undo.' if the operation log is empty (e.g. after a checkpoint).",
      inputSchema: z.object({}),
    },
    safe(async () => {
      const result = await undo();
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_info",
    {
      title: "Task Info",
      description:
        "Get the full JSON details for a single task by ID or UUID. Returns all fields including annotations, dependencies, docs, and computed urgency. " +
        "Use this when you need complete details for one specific task. For querying multiple tasks, use task_list with a filter instead.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID. Returns an error if no task matches."),
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
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks[0], null, 2) }] };
    })
  );

  server.registerTool(
    "task_projects",
    {
      title: "List Projects",
      description:
        "Return a JSON array of all project names that have at least one pending or recurring task. " +
        "Useful for discovering available projects before filtering with task_list. " +
        "To see tasks in a specific project, use task_list with filter 'project:name'.",
      inputSchema: z.object({}),
    },
    safe(async () => {
      const projects = await getUnique(config, "project");
      return { content: [{ type: "text" as const, text: JSON.stringify(projects) }] };
    })
  );

  server.registerTool(
    "task_tags",
    {
      title: "List Tags",
      description:
        "Return a JSON array of all tags that have at least one pending or recurring task. " +
        "Useful for discovering available tags before filtering with task_list. " +
        "To see tasks with a specific tag, use task_list with filter '+tagname'.",
      inputSchema: z.object({}),
    },
    safe(async () => {
      const tags = await getUnique(config, "tags");
      return { content: [{ type: "text" as const, text: JSON.stringify(tags) }] };
    })
  );

  server.registerTool(
    "task_denotate",
    {
      title: "Remove Annotation",
      description:
        "Remove a specific annotation from a task by exact text match. The annotation text must match exactly (case-sensitive). " +
        "Use task_info to see all annotations on a task before removing. " +
        "To add annotations, use task_annotate.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID."),
        text: z.string().describe("Exact annotation text to remove (case-sensitive). Must match a previously added annotation."),
      }),
    },
    safe(async ({ id, text }) => {
      const result = await taskCommand(config, id, "denotate", [text]);
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_purge",
    {
      title: "Purge Task",
      description:
        "Permanently and irreversibly remove a deleted task from the database. " +
        "The task must already have status 'deleted' (use task_delete first). " +
        "This cannot be undone — the task data is erased. Use task_archive for bulk cleanup of old completed/deleted tasks instead.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID. Task must be in 'deleted' status."),
      }),
    },
    safe(async ({ id }) => {
      const result = await taskCommand(config, id, "purge");
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_import",
    {
      title: "Import Tasks",
      description:
        "Bulk-create tasks from a JSON array. Each object must have a 'description' field; all other fields (project, tags, priority, due, status, depends, recur) are optional. " +
        "Tasks are created atomically in a single batch. Returns the count of imported tasks. " +
        "Use this for migrating data or creating multiple tasks at once. For creating a single task interactively, use task_add instead.",
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
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_count",
    {
      title: "Count Tasks",
      description:
        "Return the count of tasks matching a filter as a plain number. More efficient than task_list when you only need the count, not the task data. " +
        "Uses the same filter syntax as task_list.",
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
      return { content: [{ type: "text" as const, text: String(count) }] };
    })
  );

  server.registerTool(
    "task_log",
    {
      title: "Log Completed Task",
      description:
        "Record a task that is already completed, creating it directly in 'completed' status with an end timestamp. " +
        "Use this to log work that was done outside the task system, or to record completed items retroactively. " +
        "Unlike task_add followed by task_done, this is a single operation. Logged tasks appear in completed task queries and standups.",
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
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_duplicate",
    {
      title: "Duplicate Task",
      description:
        "Create a new pending task by copying an existing one, optionally overriding specific fields. " +
        "The copy gets a new UUID and ID. Start/end timestamps and status are reset. " +
        "Use this when you need a similar task with small variations. For creating from scratch, use task_add instead.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID of the task to copy."),
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
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_doc_write",
    {
      title: "Write Task Doc",
      description:
        "Attach or replace a markdown document on a task (spec, design, context, handoff notes). " +
        "Each task can have one document. Writing replaces any existing doc. " +
        "Automatically adds +doc tag and has_doc:true to the task for filtering. " +
        "For short notes, use task_annotate instead. To read the doc back, use task_doc_read. To remove it, use task_doc_delete.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID."),
        content: z.string().describe("Document content in markdown format. Replaces any existing document on this task."),
      }),
    },
    safe(async ({ id, content }) => {
      const result = await writeDoc(config, id, content);
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_doc_read",
    {
      title: "Read Task Doc",
      description:
        "Read the markdown document attached to a task. Returns the document content as text, or an error if no document is attached. " +
        "Use task_list with filter '+doc' to find tasks that have documents attached.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID."),
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
      return { content: [{ type: "text" as const, text: doc }] };
    })
  );

  server.registerTool(
    "task_doc_delete",
    {
      title: "Delete Task Doc",
      description:
        "Remove the markdown document attached to a task. Clears the +doc tag and has_doc field. " +
        "The document content is permanently deleted. To update a document instead of removing it, use task_doc_write.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number (e.g. '1') or UUID."),
      }),
    },
    safe(async ({ id }) => {
      const result = await deleteDoc(config, id);
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_archive",
    {
      title: "Archive Old Tasks",
      description:
        "Move completed and deleted tasks older than N days to a quarterly archive segment, keeping the active set small and fast. " +
        "Archived tasks are removed from the active database but can be loaded later with task_archive_load. " +
        "This is a bulk maintenance operation — for removing individual tasks, use task_delete or task_purge instead.",
      inputSchema: z.object({
        older_than_days: z.string().optional().describe("Archive tasks completed/deleted more than this many days ago. Default: 90. E.g. '30' for tasks older than a month."),
      }),
    },
    safe(async ({ older_than_days }) => {
      const days = older_than_days ? parseInt(older_than_days, 10) : 90;
      const result = await archiveTasks(config, days);
      return { content: [{ type: "text" as const, text: result }] };
    })
  );

  server.registerTool(
    "task_archive_list",
    {
      title: "List Archive Segments",
      description:
        "Return a JSON array of available archive segment paths (e.g. 'archive/archive-2026-Q1.json'). " +
        "Each segment contains tasks archived during that quarter. Use task_archive_load with the segment name to inspect archived tasks.",
      inputSchema: z.object({}),
    },
    safe(async () => {
      const segments = listArchiveSegments();
      return { content: [{ type: "text" as const, text: JSON.stringify(segments) }] };
    })
  );

  server.registerTool(
    "task_archive_load",
    {
      title: "Load Archived Tasks",
      description:
        "Load and return tasks from an archive segment as a read-only JSON array for inspection. " +
        "Archived tasks are not restored to the active database — this is view-only. " +
        "Use task_archive_list to discover available segments first.",
      inputSchema: z.object({
        segment: z.string().describe("Archive segment name, e.g. '2026-Q1'. Use task_archive_list to see available segments."),
      }),
    },
    safe(async ({ segment }) => {
      const tasks = await loadArchivedTasks(config, segment);
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
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
