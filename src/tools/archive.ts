import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { safe } from "../helpers.js";
import { confirmationOutput, taskArrayOutput, stringArrayOutput, LOCAL_NOTE } from "../schemas.js";
import { archiveTasks, loadArchivedTasks, listArchiveSegments, type EngineConfig } from "../engine/index.js";

export function registerArchiveTools(server: McpServer, config: EngineConfig): void {
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
      const days = parseInt(older_than_days || "90", 10);
      const result = await archiveTasks(config, days);
      return {
        content: [{ type: "text" as const, text: result }],
        structuredContent: { message: result },
      };
    })
    );

    server.registerTool(
    "task_archive_list",
    {
      title: "List Archive Segments",
      description:
        "Return a JSON array of available archive segment paths (e.g. 'archive/archive-2026-Q1.json'). " +
        "Returns an empty array if no archives exist. Each segment contains tasks archived during that quarter. " +
        "Use task_archive_load with the period name (e.g. '2026-Q1') to inspect contents." + LOCAL_NOTE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: stringArrayOutput,
      inputSchema: z.object({}),
    },
    safe(async () => {
      const segments = listArchiveSegments();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(segments, null, 2) }],
        structuredContent: { items: segments },
      };
    })
    );

    server.registerTool(
    "task_archive_load",
    {
      title: "Load Archived Tasks",
      description:
        "Load and return tasks from an archive segment as a read-only JSON array for inspection. " +
        "Errors if the segment is not found — use task_archive_list to discover available segments first. " +
        "This is view-only; archived tasks cannot be restored to the active database." + LOCAL_NOTE,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: taskArrayOutput,
      inputSchema: z.object({
        segment: z.string().describe("Archive segment name, e.g. '2026-Q1'. Use task_archive_list to see available segments."),
      }),
    },
    safe(async ({ segment }) => {
      const tasks = await loadArchivedTasks(config, segment);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }],
        structuredContent: { tasks },
      };
    })
    );
    }
