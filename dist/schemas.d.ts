import * as z from "zod";
export declare const taskSchema: z.ZodObject<{
    uuid: z.ZodString;
    id: z.ZodNumber;
    description: z.ZodString;
    status: z.ZodString;
    entry: z.ZodString;
    modified: z.ZodString;
    end: z.ZodOptional<z.ZodString>;
    project: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    priority: z.ZodOptional<z.ZodString>;
    due: z.ZodOptional<z.ZodString>;
    wait: z.ZodOptional<z.ZodString>;
    scheduled: z.ZodOptional<z.ZodString>;
    recur: z.ZodOptional<z.ZodString>;
    until: z.ZodOptional<z.ZodString>;
    depends: z.ZodOptional<z.ZodArray<z.ZodString>>;
    start: z.ZodOptional<z.ZodString>;
    agent: z.ZodOptional<z.ZodString>;
    has_doc: z.ZodOptional<z.ZodBoolean>;
    urgency: z.ZodOptional<z.ZodNumber>;
    parent: z.ZodOptional<z.ZodString>;
    annotations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        entry: z.ZodString;
        description: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$loose>;
export declare const taskArrayOutput: z.ZodObject<{
    tasks: z.ZodArray<z.ZodObject<{
        uuid: z.ZodString;
        id: z.ZodNumber;
        description: z.ZodString;
        status: z.ZodString;
        entry: z.ZodString;
        modified: z.ZodString;
        end: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        priority: z.ZodOptional<z.ZodString>;
        due: z.ZodOptional<z.ZodString>;
        wait: z.ZodOptional<z.ZodString>;
        scheduled: z.ZodOptional<z.ZodString>;
        recur: z.ZodOptional<z.ZodString>;
        until: z.ZodOptional<z.ZodString>;
        depends: z.ZodOptional<z.ZodArray<z.ZodString>>;
        start: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
        has_doc: z.ZodOptional<z.ZodBoolean>;
        urgency: z.ZodOptional<z.ZodNumber>;
        parent: z.ZodOptional<z.ZodString>;
        annotations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            entry: z.ZodString;
            description: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export declare const confirmationOutput: z.ZodObject<{
    message: z.ZodString;
}, z.core.$strip>;
export declare const countOutput: z.ZodObject<{
    count: z.ZodNumber;
}, z.core.$strip>;
export declare const stringArrayOutput: z.ZodObject<{
    items: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const docOutput: z.ZodObject<{
    content: z.ZodString;
}, z.core.$strip>;
export declare const LOCAL_NOTE = " No authentication required. No rate limits. All operations are local to the project's data directory.";
/**
 * Reminder appended to every mutation tool's description: agents must verify
 * task UUIDs against the live store before mutating. Carried as a constant so
 * the wording stays consistent across task_done, task_modify, task_delete, etc.
 */
export declare const VERIFY_ID_NOTE = " Before passing a numeric ID or UUID to this tool, confirm it exists in the current backlog state via task_list or task_info \u2014 do not rely on IDs from prior sessions, memory, or the user's recall, since tasks may have been deleted, completed, or never existed.";
