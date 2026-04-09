import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { safe } from "../helpers.js";
import { confirmationOutput, docOutput, LOCAL_NOTE } from "../schemas.js";
import { writeDoc, readDoc, deleteDoc, type EngineConfig } from "../engine/index.js";

export function registerDocTools(server: McpServer, config: EngineConfig): void {
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
}
