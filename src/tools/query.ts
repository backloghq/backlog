import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { safe } from "../helpers.js";
import { taskArrayOutput, countOutput, stringArrayOutput, LOCAL_NOTE } from "../schemas.js";
import { exportTasks, countTasks, getUnique, type EngineConfig } from "../engine/index.js";

export function registerQueryTools(server: McpServer, config: EngineConfig): void {
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
}
