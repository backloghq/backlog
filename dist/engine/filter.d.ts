import type { Task } from "./types.js";
type Predicate = (task: Task) => boolean;
export declare function compileFilter(filter: string): Predicate;
declare module "./types.js" {
    interface Task {
        _blocking?: boolean;
    }
}
export {};
