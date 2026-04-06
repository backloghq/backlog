import type { Task } from "./types.js";
type Predicate = (task: Task) => boolean;
type TaskGetter = (uuid: string) => Task | undefined;
export declare function compileFilter(filter: string, taskGetter?: TaskGetter): Predicate;
declare module "./types.js" {
    interface Task {
        _blocking?: boolean;
    }
}
export {};
