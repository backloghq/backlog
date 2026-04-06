export interface Task {
    uuid: string;
    id: number;
    description: string;
    /** Task status. "waiting" is typically virtual — derived from pending tasks with a future `wait` date. */
    status: "pending" | "completed" | "deleted" | "recurring" | "waiting";
    entry: string;
    modified: string;
    end?: string;
    project?: string;
    tags?: string[];
    priority?: "H" | "M" | "L";
    due?: string;
    wait?: string;
    scheduled?: string;
    recur?: string;
    until?: string;
    depends?: string[];
    start?: string;
    annotations?: Annotation[];
    agent?: string;
    has_doc?: boolean;
    urgency?: number;
    parent?: string;
}
export interface Annotation {
    entry: string;
    description: string;
}
export interface TaskInput {
    description: string;
    project?: string;
    tags?: string[];
    priority?: "H" | "M" | "L";
    due?: string;
    wait?: string;
    scheduled?: string;
    recur?: string;
    until?: string;
    depends?: string[];
    agent?: string;
    extra?: string[];
}
