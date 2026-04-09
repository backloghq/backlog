import * as z from "zod";
export const taskSchema = z.object({
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
export const taskArrayOutput = z.object({ tasks: z.array(taskSchema) });
export const confirmationOutput = z.object({ message: z.string() });
export const countOutput = z.object({ count: z.number() });
export const stringArrayOutput = z.object({ items: z.array(z.string()) });
export const docOutput = z.object({ content: z.string() });
export const LOCAL_NOTE = " No authentication required. No rate limits. All operations are local to the project's data directory.";
