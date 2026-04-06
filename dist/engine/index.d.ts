import type { Task } from "./types.js";
export interface EngineConfig {
    dataDir: string;
}
export declare function deriveProjectSlug(cwd: string): string;
export declare function getConfig(): EngineConfig;
export declare function ensureSetup(cfg: EngineConfig): Promise<void>;
export declare function shutdown(): Promise<void>;
export declare function exportTasks(_config: EngineConfig, filter: string): Promise<Task[]>;
export declare function addTask(_config: EngineConfig, description: string, attrs: Record<string, string>, extraArgs?: string[]): Promise<string>;
export declare function modifyTask(_config: EngineConfig, filter: string, attrs: Record<string, string>, extraArgs?: string[]): Promise<string>;
export declare function taskCommand(_config: EngineConfig, id: string, command: string, extraArgs?: string[]): Promise<string>;
export declare function undo(): Promise<string>;
export declare function countTasks(_config: EngineConfig, filter: string): Promise<number>;
export declare function logTask(_config: EngineConfig, description: string, attrs: Record<string, string>, extraArgs?: string[]): Promise<string>;
export declare function duplicateTask(_config: EngineConfig, id: string, attrs: Record<string, string>, extraArgs?: string[]): Promise<string>;
export declare function importTasks(_config: EngineConfig, tasksJson: string): Promise<string>;
export declare function getUnique(_config: EngineConfig, attribute: string): Promise<string[]>;
export declare function writeDoc(_config: EngineConfig, id: string, content: string): Promise<string>;
export declare function readDoc(_config: EngineConfig, id: string): Promise<string | null>;
export declare function deleteDoc(_config: EngineConfig, id: string): Promise<string>;
export declare function archiveTasks(_config: EngineConfig, olderThanDays?: number): Promise<string>;
export declare function loadArchivedTasks(_config: EngineConfig, segment: string): Promise<Task[]>;
export declare function listArchiveSegments(): string[];
