import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { safe, parseTags } from "../helpers.js";
import { confirmationOutput, LOCAL_NOTE } from "../schemas.js";
import { modifyTask, taskCommand, undo, importTasks, type EngineConfig } from "../engine/index.js";

export function registerModifyTools(server: McpServer, config: EngineConfig): void {
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
}
