import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod";
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
  type TaskWarriorConfig,
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

function createServer(config: TaskWarriorConfig): McpServer {
  const server = new McpServer({
    name: "taskwarrior-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "task_list",
    {
      title: "List Tasks",
      description:
        "Query tasks using TaskWarrior filter syntax. " +
        "Examples: 'status:pending', 'project:myproject +bug', 'due.before:tomorrow', '+OVERDUE'. " +
        "Empty filter returns all pending tasks.",
      inputSchema: z.object({
        filter: z.string().describe("TaskWarrior filter expression. Leave empty for all pending tasks."),
      }),
    },
    async ({ filter }) => {
      const effectiveFilter = filter || "status:pending";
      const tasks = await exportTasks(config, effectiveFilter);
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  server.registerTool(
    "task_add",
    {
      title: "Add Task",
      description: "Create a new task in TaskWarrior.",
      inputSchema: z.object({
        description: z.string().describe("Task description text"),
        project: z.string().optional().describe("Project name, e.g. 'backend'"),
        tags: z.string().optional().describe("Tags to apply, as comma-separated list or JSON array. E.g. 'bug,urgent' or '[\"bug\",\"urgent\"]'"),
        priority: z.enum(["H", "M", "L"]).optional().describe("Priority: H (high), M (medium), L (low)"),
        due: z.string().optional().describe("Due date, e.g. 'tomorrow', '2025-12-31', 'eow'"),
        depends: z.string().optional().describe("UUID(s) of tasks this depends on, comma-separated"),
        wait: z.string().optional().describe("Wait date — task hidden until this date"),
        scheduled: z.string().optional().describe("Scheduled date — when to start working on the task, e.g. 'monday', 'tomorrow'"),
        recur: z.string().optional().describe("Recurrence frequency, e.g. 'daily', 'weekly', '2wks', 'monthly'. Requires a due date."),
        agent: z.string().optional().describe("Agent identity, e.g. 'explorer', 'planner', 'reviewer'"),
        extra: z.string().optional().describe("Additional raw TaskWarrior attributes"),
      }),
    },
    async ({ description, project, tags, priority, due, depends, wait, scheduled, recur, agent, extra }) => {
      const attrs: Record<string, string> = {};
      if (project) attrs.project = project;
      if (priority) attrs.priority = priority;
      if (due) attrs.due = due;
      if (depends) attrs.depends = depends;
      if (wait) attrs.wait = wait;
      if (scheduled) attrs.scheduled = scheduled;
      if (recur) attrs.recur = recur;
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
    }
  );

  server.registerTool(
    "task_modify",
    {
      title: "Modify Task",
      description: "Modify existing task(s) matching a filter.",
      inputSchema: z.object({
        filter: z.string().describe("Filter to select tasks to modify (ID, UUID, or filter expression)"),
        description: z.string().optional().describe("New description text"),
        project: z.string().optional().describe("New project name"),
        tags: z.string().optional().describe("Tags to add (+) or remove (-), as comma-separated list. E.g. 'frontend,urgent' or '-old,+new'"),
        priority: z.enum(["H", "M", "L", ""]).optional().describe("New priority (empty string to clear)"),
        due: z.string().optional().describe("New due date"),
        depends: z.string().optional().describe("New dependency UUIDs"),
        wait: z.string().optional().describe("New wait date"),
        scheduled: z.string().optional().describe("New scheduled date"),
        recur: z.string().optional().describe("New recurrence frequency"),
        agent: z.string().optional().describe("Agent identity, e.g. 'explorer', 'planner', 'reviewer'"),
        extra: z.string().optional().describe("Additional raw attributes"),
      }),
    },
    async ({ filter, description, project, tags, priority, due, depends, wait, scheduled, recur, agent, extra }) => {
      const attrs: Record<string, string> = {};
      if (description) attrs.description = description;
      if (project !== undefined) attrs.project = project;
      if (priority !== undefined) attrs.priority = priority;
      if (due !== undefined) attrs.due = due;
      if (depends !== undefined) attrs.depends = depends;
      if (wait !== undefined) attrs.wait = wait;
      if (scheduled !== undefined) attrs.scheduled = scheduled;
      if (recur !== undefined) attrs.recur = recur;
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
    }
  );

  server.registerTool(
    "task_done",
    {
      title: "Complete Task",
      description: "Mark task(s) as completed.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
      }),
    },
    async ({ id }) => {
      const result = await taskCommand(config, id, "done");
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_delete",
    {
      title: "Delete Task",
      description: "Delete task(s). This marks them as deleted, not purged.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
      }),
    },
    async ({ id }) => {
      const result = await taskCommand(config, id, "delete");
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_annotate",
    {
      title: "Annotate Task",
      description: "Add an annotation (note) to a task. Great for cross-session context.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
        text: z.string().describe("Annotation text"),
      }),
    },
    async ({ id, text }) => {
      const result = await taskCommand(config, id, "annotate", [text]);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_start",
    {
      title: "Start Task",
      description: "Mark a task as actively being worked on.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
      }),
    },
    async ({ id }) => {
      const result = await taskCommand(config, id, "start");
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_stop",
    {
      title: "Stop Task",
      description: "Stop actively working on a task.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
      }),
    },
    async ({ id }) => {
      const result = await taskCommand(config, id, "stop");
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_undo",
    {
      title: "Undo",
      description: "Undo the last TaskWarrior modification.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await undo();
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_info",
    {
      title: "Task Info",
      description: "Get full details for a specific task by ID or UUID.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
      }),
    },
    async ({ id }) => {
      const tasks = await exportTasks(config, id);
      if (tasks.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No task found with that ID." }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(tasks[0], null, 2) }] };
    }
  );

  server.registerTool(
    "task_projects",
    {
      title: "List Projects",
      description: "List all project names in use.",
      inputSchema: z.object({}),
    },
    async () => {
      const projects = await getUnique(config, "project");
      return { content: [{ type: "text" as const, text: JSON.stringify(projects) }] };
    }
  );

  server.registerTool(
    "task_tags",
    {
      title: "List Tags",
      description: "List all tags in use.",
      inputSchema: z.object({}),
    },
    async () => {
      const tags = await getUnique(config, "tags");
      return { content: [{ type: "text" as const, text: JSON.stringify(tags) }] };
    }
  );

  server.registerTool(
    "task_denotate",
    {
      title: "Remove Annotation",
      description: "Remove an annotation from a task. Pass the exact annotation text to remove.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
        text: z.string().describe("Exact annotation text to remove"),
      }),
    },
    async ({ id, text }) => {
      const result = await taskCommand(config, id, "denotate", [text]);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_purge",
    {
      title: "Purge Task",
      description: "Permanently remove deleted task(s) from the database. Task must be deleted first.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID of a deleted task"),
      }),
    },
    async ({ id }) => {
      const result = await taskCommand(config, id, "purge");
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_import",
    {
      title: "Import Tasks",
      description: "Import tasks from a JSON array. Each object should have at least a 'description' field. Can create new tasks or update existing ones by UUID.",
      inputSchema: z.object({
        tasks: z.string().describe("JSON array of task objects, e.g. '[{\"description\":\"My task\",\"project\":\"foo\"}]'"),
      }),
    },
    async ({ tasks }) => {
      const result = await importTasks(config, tasks);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_count",
    {
      title: "Count Tasks",
      description: "Count tasks matching a filter. More efficient than listing when you only need the number.",
      inputSchema: z.object({
        filter: z.string().describe("TaskWarrior filter expression. Leave empty for all pending tasks."),
      }),
    },
    async ({ filter }) => {
      const effectiveFilter = filter || "status:pending";
      const count = await countTasks(config, effectiveFilter);
      return { content: [{ type: "text" as const, text: String(count) }] };
    }
  );

  server.registerTool(
    "task_log",
    {
      title: "Log Completed Task",
      description: "Record a task that is already completed. Unlike add+done, this creates the task directly in completed state.",
      inputSchema: z.object({
        description: z.string().describe("Task description text"),
        project: z.string().optional().describe("Project name"),
        tags: z.string().optional().describe("Tags to apply, as comma-separated list. E.g. 'done,reviewed'"),
        priority: z.enum(["H", "M", "L"]).optional().describe("Priority: H/M/L"),
        agent: z.string().optional().describe("Agent identity"),
        extra: z.string().optional().describe("Additional raw TaskWarrior attributes"),
      }),
    },
    async ({ description, project, tags, priority, agent, extra }) => {
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
    }
  );

  server.registerTool(
    "task_duplicate",
    {
      title: "Duplicate Task",
      description: "Create a copy of an existing task, optionally with modifications.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID to duplicate"),
        description: z.string().optional().describe("New description (overrides original)"),
        project: z.string().optional().describe("New project"),
        tags: z.string().optional().describe("Tags to add or remove, as comma-separated list. E.g. 'frontend,urgent' or '-old,+new'"),
        priority: z.enum(["H", "M", "L", ""]).optional().describe("New priority"),
        due: z.string().optional().describe("New due date"),
        agent: z.string().optional().describe("Agent identity"),
        extra: z.string().optional().describe("Additional raw attributes"),
      }),
    },
    async ({ id, description, project, tags, priority, due, agent, extra }) => {
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
    }
  );

  server.registerTool(
    "task_doc_write",
    {
      title: "Write Task Doc",
      description:
        "Attach or update a document (spec, notes, context) to a task. " +
        "Stored as a markdown file. Automatically adds +doc tag and has_doc:yes to the task.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
        content: z.string().describe("Document content (markdown)"),
      }),
    },
    async ({ id, content }) => {
      const result = await writeDoc(config, id, content);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.registerTool(
    "task_doc_read",
    {
      title: "Read Task Doc",
      description: "Read the document attached to a task. Returns null if no doc exists.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
      }),
    },
    async ({ id }) => {
      const doc = await readDoc(config, id);
      if (doc === null) {
        return {
          content: [{ type: "text" as const, text: "No doc attached to this task." }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: doc }] };
    }
  );

  server.registerTool(
    "task_doc_delete",
    {
      title: "Delete Task Doc",
      description: "Remove the document attached to a task. Removes +doc tag and has_doc from the task.",
      inputSchema: z.object({
        id: z.string().describe("Task ID number or UUID"),
      }),
    },
    async ({ id }) => {
      const result = await deleteDoc(config, id);
      return { content: [{ type: "text" as const, text: result }] };
    }
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
