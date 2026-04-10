/**
 * Compile a backlog filter string into an agentdb JSON filter object.
 * Handles backlog-specific syntax (date resolution, numeric IDs, UUIDs)
 * on top of agentdb's compact filter parser.
 */
export declare function compileFilter(filter: string): Record<string, unknown>;
