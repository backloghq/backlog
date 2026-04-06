import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { Store } from "opslog";
import type { Task } from "./types.js";
import { compileFilter } from "./filter.js";
import { resolveDate, formatDate } from "./dates.js";
import { generateInstances } from "./recurrence.js";

export interface EngineConfig {
  dataDir: string;
}

export function deriveProjectSlug(cwd: string): string {
  const name = basename(cwd).replace(/[^a-zA-Z0-9_-]/g, "-");
  const hash = createHash("md5").update(cwd).digest("hex").substring(0, 8);
  return `${name}-${hash}`;
}

export function getConfig(): EngineConfig {
  let dataDir = process.env.TASKDATA;

  if (!dataDir) {
    const root = process.env.TASKDATA_ROOT;
    if (root) {
      const slug = deriveProjectSlug(process.cwd());
      dataDir = join(root, slug);
    } else {
      throw new Error(
        "TASKDATA or TASKDATA_ROOT environment variable is required. " +
          "Set TASKDATA to a project-specific directory, or TASKDATA_ROOT to auto-derive from the working directory.",
      );
    }
  }

  return { dataDir };
}

let store: Store<Task> | null = null;
let config: EngineConfig | null = null;

export async function ensureSetup(cfg: EngineConfig): Promise<void> {
  config = cfg;
  await mkdir(cfg.dataDir, { recursive: true });
  await mkdir(join(cfg.dataDir, "docs"), { recursive: true });
  store = new Store<Task>();
  await store.open(cfg.dataDir, { checkpointThreshold: 50 });
}

export async function shutdown(): Promise<void> {
  if (store) {
    await store.close();
    store = null;
  }
}

function getStore(): Store<Task> {
  if (!store) throw new Error("Engine not initialized. Call ensureSetup() first.");
  return store;
}

async function drainSyncQueue(): Promise<void> {
  const dir = getDataDir();
  const queuePath = join(dir, "sync-queue.jsonl");
  let content: string;
  try {
    content = await readFile(queuePath, "utf-8");
  } catch {
    return; // No queue file
  }
  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return;

  const s = getStore();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, string>;
      if (entry.subject) {
        // TaskCreated sync
        const uuid = randomUUID();
        const timestamp = now();
        const task: Task = {
          uuid,
          id: nextId(),
          description: entry.subject,
          status: "pending",
          entry: timestamp,
          modified: timestamp,
        };
        if (entry.agent) task.agent = entry.agent;
        await s.set(uuid, task);
      } else if (entry.completed) {
        // TaskCompleted sync — find by description and mark done
        const match = s.all().find(
          (t) => t.status === "pending" && t.description === entry.completed,
        );
        if (match) {
          await s.set(match.uuid, { ...match, status: "completed", end: now(), modified: now() });
        }
      }
    } catch {
      // Skip malformed entries
    }
  }
  await unlink(queuePath);
}

function getDataDir(): string {
  if (!config) throw new Error("Engine not initialized.");
  return config.dataDir;
}

function now(): string {
  return formatDate(new Date());
}

function nextId(): number {
  const s = getStore();
  let maxId = 0;
  for (const task of s.all()) {
    if (task.id > maxId) maxId = task.id;
  }
  return maxId + 1;
}

function computeUrgency(t: Task, allTasks: Task[]): number {
  let urgency = 0;

  // Priority
  if (t.priority === "H") urgency += 6.0;
  else if (t.priority === "M") urgency += 3.9;
  else if (t.priority === "L") urgency += 1.8;

  // Active
  if (t.start) urgency += 4.0;

  // Project
  if (t.project) urgency += 1.0;

  // Tags
  if (t.tags && t.tags.length > 0) {
    urgency += Math.min(t.tags.length, 3) / 3;
  }

  // Annotations
  if (t.annotations && t.annotations.length > 0) {
    urgency += Math.min(t.annotations.length, 3) * 0.3;
  }

  // Blocked (has unresolved deps)
  if (t.depends && t.depends.length > 0) {
    const blocked = t.depends.some((depUuid) => {
      const dep = allTasks.find((d) => d.uuid === depUuid);
      return dep && dep.status === "pending";
    });
    if (blocked) urgency -= 5.0;
  }

  // Blocking (other tasks depend on this)
  const isBlocking = allTasks.some(
    (other) => other.depends?.includes(t.uuid) && other.status === "pending",
  );
  if (isBlocking) {
    urgency += 8.0;
    t._blocking = true;
  }

  // Due
  if (t.due) {
    const dueDate = new Date(t.due);
    const daysUntilDue = (dueDate.getTime() - Date.now()) / 86400000;
    if (daysUntilDue < -7) urgency += 12.0;
    else if (daysUntilDue < 0) urgency += 8.0 + (1 - daysUntilDue / -7) * 4.0;
    else if (daysUntilDue < 7) urgency += 4.0 * (1 - daysUntilDue / 7);
    else if (daysUntilDue < 14) urgency += 2.0 * (1 - (daysUntilDue - 7) / 7);
  }

  // Age (capped at 365 days)
  const ageMs = Date.now() - new Date(t.entry).getTime();
  const ageDays = Math.min(ageMs / 86400000, 365);
  urgency += (ageDays / 365) * 2.0;

  return Math.round(urgency * 10000) / 10000;
}

// --- Public API ---

export async function exportTasks(_config: EngineConfig, filter: string): Promise<Task[]> {
  await drainSyncQueue();
  const s = getStore();

  // Generate recurring task instances
  const allTasks = s.all();
  const newInstances = generateInstances(allTasks, nextId);
  for (const instance of newInstances) {
    await s.set(instance.uuid, instance);
  }

  const updatedTasks = s.all();
  updatedTasks.forEach((t) => { t.urgency = computeUrgency(t, updatedTasks); });

  const predicate = compileFilter(filter);
  return updatedTasks.filter(predicate);
}

export async function addTask(
  _config: EngineConfig,
  description: string,
  attrs: Record<string, string>,
  extraArgs: string[] = [],
): Promise<string> {
  const s = getStore();
  const uuid = randomUUID();
  const timestamp = now();

  const tags: string[] = [];
  for (const arg of extraArgs) {
    if (arg.startsWith("+")) tags.push(arg.substring(1));
  }

  const task: Task = {
    uuid,
    id: nextId(),
    description,
    status: attrs.recur ? "recurring" : "pending",
    entry: timestamp,
    modified: timestamp,
    ...(attrs.project && { project: attrs.project }),
    ...(tags.length > 0 && { tags }),
    ...(attrs.priority && { priority: attrs.priority as "H" | "M" | "L" }),
    ...(attrs.due && { due: formatDate(resolveDate(attrs.due)) }),
    ...(attrs.wait && { wait: formatDate(resolveDate(attrs.wait)) }),
    ...(attrs.scheduled && { scheduled: formatDate(resolveDate(attrs.scheduled)) }),
    ...(attrs.recur && { recur: attrs.recur }),
    ...(attrs.depends && { depends: attrs.depends.split(",").map((d) => d.trim()) }),
    ...(attrs.agent && { agent: attrs.agent }),
  };

  await s.set(uuid, task);
  return `Created task ${uuid}.`;
}

export async function modifyTask(
  _config: EngineConfig,
  filter: string,
  attrs: Record<string, string>,
  extraArgs: string[] = [],
): Promise<string> {
  const s = getStore();
  const allTasks = s.all();
  const predicate = compileFilter(filter);
  const matches = allTasks.filter(predicate);

  if (matches.length === 0) return "No matching tasks.";

  let modified = 0;
  for (const task of matches) {
    const updated = { ...task, modified: now() };

    if (attrs.description) updated.description = attrs.description;
    if (attrs.project !== undefined) updated.project = attrs.project || undefined;
    if (attrs.priority !== undefined) updated.priority = (attrs.priority as "H" | "M" | "L") || undefined;
    if (attrs.due !== undefined) updated.due = attrs.due ? formatDate(resolveDate(attrs.due)) : undefined;
    if (attrs.depends !== undefined) updated.depends = attrs.depends ? attrs.depends.split(",").map((d) => d.trim()) : undefined;
    if (attrs.wait !== undefined) updated.wait = attrs.wait ? formatDate(resolveDate(attrs.wait)) : undefined;
    if (attrs.scheduled !== undefined) updated.scheduled = attrs.scheduled ? formatDate(resolveDate(attrs.scheduled)) : undefined;
    if (attrs.recur !== undefined) updated.recur = attrs.recur || undefined;
    if (attrs.agent !== undefined) updated.agent = attrs.agent || undefined;
    if (attrs.has_doc !== undefined) updated.has_doc = attrs.has_doc || undefined;
    if (attrs.end !== undefined) updated.end = attrs.end || undefined;
    if (attrs.status !== undefined) updated.status = attrs.status as Task["status"];

    // Handle tag args
    for (const arg of extraArgs) {
      if (arg.startsWith("+")) {
        if (!updated.tags) updated.tags = [];
        if (!updated.tags.includes(arg.substring(1))) updated.tags.push(arg.substring(1));
      } else if (arg.startsWith("-")) {
        if (updated.tags) updated.tags = updated.tags.filter((t) => t !== arg.substring(1));
      }
    }

    await s.set(task.uuid, updated);
    modified++;
  }
  return `Modified ${modified} task(s).`;
}

export async function taskCommand(
  _config: EngineConfig,
  id: string,
  command: string,
  extraArgs: string[] = [],
): Promise<string> {
  const s = getStore();
  const task = findTask(id);
  if (!task) return `No task found matching '${id}'.`;

  const updated = { ...task, modified: now() };

  switch (command) {
    case "done":
      updated.status = "completed";
      updated.end = now();
      break;
    case "delete":
      updated.status = "deleted";
      updated.end = now();
      break;
    case "start":
      updated.start = now();
      break;
    case "stop":
      updated.start = undefined;
      break;
    case "annotate":
      if (!updated.annotations) updated.annotations = [];
      updated.annotations.push({ entry: now(), description: extraArgs.join(" ") });
      break;
    case "denotate": {
      const text = extraArgs.join(" ");
      if (updated.annotations) {
        updated.annotations = updated.annotations.filter((a) => a.description !== text);
        if (updated.annotations.length === 0) updated.annotations = undefined;
      }
      break;
    }
    case "purge":
      if (task.status !== "deleted") return "Can only purge deleted tasks.";
      await s.delete(task.uuid);
      return `Task ${task.uuid} purged.`;
    default:
      return `Unknown command: ${command}`;
  }

  await s.set(task.uuid, updated);
  return `Task ${command} completed.`;
}

export async function undo(): Promise<string> {
  const s = getStore();
  const undone = await s.undo();
  return undone ? "Undo completed." : "Nothing to undo.";
}

export async function countTasks(_config: EngineConfig, filter: string): Promise<number> {
  const tasks = await exportTasks(_config, filter);
  return tasks.length;
}

export async function logTask(
  _config: EngineConfig,
  description: string,
  attrs: Record<string, string>,
  extraArgs: string[] = [],
): Promise<string> {
  const s = getStore();
  const uuid = randomUUID();
  const timestamp = now();

  const tags: string[] = [];
  for (const arg of extraArgs) {
    if (arg.startsWith("+")) tags.push(arg.substring(1));
  }

  const task: Task = {
    uuid,
    id: nextId(),
    description,
    status: "completed",
    entry: timestamp,
    modified: timestamp,
    end: timestamp,
    ...(attrs.project && { project: attrs.project }),
    ...(tags.length > 0 && { tags }),
    ...(attrs.priority && { priority: attrs.priority as "H" | "M" | "L" }),
    ...(attrs.agent && { agent: attrs.agent }),
  };

  await s.set(uuid, task);
  return "Task logged.";
}

export async function duplicateTask(
  _config: EngineConfig,
  id: string,
  attrs: Record<string, string>,
  extraArgs: string[] = [],
): Promise<string> {
  const task = findTask(id);
  if (!task) return `No task found matching '${id}'.`;

  const uuid = randomUUID();
  const timestamp = now();
  const newTask: Task = {
    ...task,
    uuid,
    id: nextId(),
    entry: timestamp,
    modified: timestamp,
    start: undefined,
    end: undefined,
    status: "pending",
  };

  if (attrs.description) newTask.description = attrs.description;
  if (attrs.project !== undefined) newTask.project = attrs.project || undefined;
  if (attrs.priority !== undefined) newTask.priority = (attrs.priority as "H" | "M" | "L") || undefined;
  if (attrs.due !== undefined) newTask.due = attrs.due ? formatDate(resolveDate(attrs.due)) : undefined;
  if (attrs.agent !== undefined) newTask.agent = attrs.agent || undefined;

  for (const arg of extraArgs) {
    if (arg.startsWith("+")) {
      if (!newTask.tags) newTask.tags = [];
      if (!newTask.tags.includes(arg.substring(1))) newTask.tags.push(arg.substring(1));
    } else if (arg.startsWith("-")) {
      if (newTask.tags) newTask.tags = newTask.tags.filter((t) => t !== arg.substring(1));
    }
  }

  const s = getStore();
  await s.set(uuid, newTask);
  return `Task duplicated as ${uuid}.`;
}

export async function importTasks(_config: EngineConfig, tasksJson: string): Promise<string> {
  const s = getStore();
  const tasks = JSON.parse(tasksJson) as Array<Record<string, unknown>>;
  let count = 0;

  await s.batch(() => {
    for (const raw of tasks) {
      const uuid = (raw.uuid as string) || randomUUID();
      const timestamp = now();
      const task: Task = {
        uuid,
        id: nextId(),
        description: raw.description as string,
        status: (raw.status as Task["status"]) || "pending",
        entry: (raw.entry as string) || timestamp,
        modified: timestamp,
      };
      if (raw.project) task.project = raw.project as string;
      if (raw.tags) task.tags = raw.tags as string[];
      if (raw.priority) task.priority = raw.priority as "H" | "M" | "L";
      if (raw.due) task.due = raw.due as string;
      if (raw.agent) task.agent = raw.agent as string;
      s.set(uuid, task);
      count++;
    }
  });

  return `Imported ${count} task(s).`;
}

export async function getUnique(_config: EngineConfig, attribute: string): Promise<string[]> {
  const s = getStore();
  const values = new Set<string>();

  for (const task of s.all()) {
    if (task.status !== "pending" && task.status !== "recurring") continue;
    if (attribute === "tags") {
      task.tags?.forEach((t) => values.add(t));
    } else if (attribute === "project" && task.project) {
      values.add(task.project);
    }
  }

  return [...values];
}

// --- Doc operations ---

function docsDir(): string {
  return join(getDataDir(), "docs");
}

function docPath(uuid: string): string {
  return join(docsDir(), `${uuid}.md`);
}

export async function writeDoc(_config: EngineConfig, id: string, content: string): Promise<string> {
  const task = findTask(id);
  if (!task) throw new Error(`No task found matching '${id}'`);

  await mkdir(docsDir(), { recursive: true });
  await writeFile(docPath(task.uuid), content, "utf-8");
  await modifyTask(_config, task.uuid, { has_doc: "yes" }, ["+doc"]);
  return `Doc written for task ${task.uuid}.`;
}

export async function readDoc(_config: EngineConfig, id: string): Promise<string | null> {
  const task = findTask(id);
  if (!task) throw new Error(`No task found matching '${id}'`);

  try {
    return await readFile(docPath(task.uuid), "utf-8");
  } catch {
    return null;
  }
}

export async function deleteDoc(_config: EngineConfig, id: string): Promise<string> {
  const task = findTask(id);
  if (!task) throw new Error(`No task found matching '${id}'`);

  try { await unlink(docPath(task.uuid)); } catch { /* ok */ }
  await modifyTask(_config, task.uuid, { has_doc: "" }, ["-doc"]);
  return `Doc deleted for task ${task.uuid}.`;
}

// --- Archive ---

export async function archiveTasks(
  _config: EngineConfig,
  olderThanDays: number = 90,
): Promise<string> {
  const s = getStore();
  const cutoff = Date.now() - olderThanDays * 86400000;
  const count = await s.archive(
    (task) =>
      (task.status === "completed" || task.status === "deleted") &&
      !!task.end &&
      new Date(task.end).getTime() < cutoff,
  );
  if (count === 0) return "No tasks to archive.";
  return `Archived ${count} task(s) older than ${olderThanDays} days.`;
}

export async function loadArchivedTasks(
  _config: EngineConfig,
  segment: string,
): Promise<Task[]> {
  const s = getStore();
  const records = await s.loadArchive(segment);
  return Array.from(records.values());
}

export function listArchiveSegments(): string[] {
  const s = getStore();
  return s.listArchiveSegments();
}

// --- Helpers ---

function findTask(id: string): Task | undefined {
  const s = getStore();

  // Try as UUID first
  const byUuid = s.get(id);
  if (byUuid) return byUuid;

  // Try as numeric ID
  const numId = parseInt(id, 10);
  if (!isNaN(numId)) {
    return s.all().find((t) => t.id === numId);
  }

  return undefined;
}


