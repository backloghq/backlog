import type { Task } from "./types.js";
/**
 * Generate pending instances from recurring task templates.
 * Called on read — creates instances up to `limit` ahead of now.
 */
export declare function generateInstances(allTasks: Task[], nextIdFn: () => number, limit?: number): Task[];
