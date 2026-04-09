export declare function parseTags(tags: string | undefined): string[];
export declare function safe<T>(fn: (args: T) => Promise<any>): (args: T) => Promise<any>;
