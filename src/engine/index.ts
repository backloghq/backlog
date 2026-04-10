import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { AgentDB } from "@backloghq/agentdb";
import type { Collection } from "@backloghq/agentdb";
import type { StorageBackend } from "@backloghq/agentdb";
import type { Task, Annotation } from "./types.js";
import { compileFilter } from "./filter.js";
import { formatDate } from "./dates.js";
import { generateInstances } from "./recurrence.js";
import { taskSchema } from "./task-schema.js";

export const VALID_STATUSES = ["pending", "completed", "deleted", "recurring"] as const;
export const VALID_PRIORITIES = ["H", "M", "L"] as const;

export interface EngineConfig {
  dataDir: string;
  backend?: StorageBackend;
}

export function deriveProjectSlug(cwd: string): string {
  const name = basename(cwd).replace(/[^a-zA-Z0-9_-]/g, "-");
  const hash = createHash("md5").update(cwd).digest("hex").substring(0, 8);
  return `${name}-${hash}`;
}

export async function getConfig(): Promise<EngineConfig> {
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

  const result: EngineConfig = { dataDir };

  if (process.env.BACKLOG_BACKEND === "s3") {
    const bucket = process.env.BACKLOG_S3_BUCKET;
    if (!bucket) throw new Error("BACKLOG_S3_BUCKET is required when BACKLOG_BACKEND=s3");
    const region = process.env.BACKLOG_S3_REGION;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await (import("@backloghq/opslog-s3" as any) as Promise<any>);
      result.backend = new mod.S3Backend({
        bucket,
        prefix: dataDir,
        ...(region && { region }),
      });
    } catch {
      throw new Error(
        "BACKLOG_BACKEND=s3 requires @backloghq/opslog-s3. Install it: npm install @backloghq/opslog-s3",
      );
    }
  }

  return result;
}

let db: AgentDB | null = null;
let col: Collection | null = null;
let config: EngineConfig | null = null;

export async function ensureSetup(cfg: EngineConfig): Promise<void> {
  config = cfg;
  db = new AgentDB(cfg.dataDir, {
    checkpointThreshold: 50,
    backend: cfg.backend,
  });
  await db.init();
  col = await db.collection(taskSchema);
}

export async function shutdown(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
    col = null;
  }
}

function getCol(): Collection {
  if (!col) throw new Error("Engine not initialized. Call ensureSetup() first.");
  return col;
}

function getDataDir(): string {
  if (!config) throw new Error("Engine not initialized.");
  return config.dataDir;
}

function now(): string {
  return formatDate(new Date());
}

// UUID_RE used by filter.ts

// --- Sync Queue ---

async function drainSyncQueue(): Promise<void> {
  const dir = getDataDir();
  const queuePath = join(dir, "sync-queue.jsonl");
  let content: string;
  try {
    content = await readFile(queuePath, "utf-8");
  } catch {
    return;
  }
  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return;

  const c = getCol();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const entry = parsed as Record<string, string>;
      if (entry.subject) {
        await c.insert({
          _id: randomUUID(),
          description: entry.subject,
          status: "pending",
          ...(entry.agent && { agent: entry.agent }),
        });
      } else if (entry.completed) {
        const matches = c.find({ filter: { status: "pending", description: entry.completed } });
        if (matches.records.length === 1) {
          const match = matches.records[0];
          await c.update({ _id: match._id }, { $set: { status: "completed", end: now(), modified: now() } });
        } else if (matches.records.length > 1) {
          console.error(`backlog: sync completion skipped — ${matches.records.length} pending tasks match "${entry.completed}"`);
        }
      } else if (entry.subagent_start) {
        const agentName = entry.subagent_start;
        const unassigned = c.find({ filter: { status: "pending", agent: { $exists: false } } });
        for (const task of unassigned.records) {
          await c.update({ _id: task._id }, { $set: { agent: agentName, modified: now() } });
        }
      }
    } catch {
      // Skip malformed entries
    }
  }
  await unlink(queuePath);
}

// --- Urgency ---

function buildBlockingIndex(tasks: Record<string, unknown>[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.status !== "pending" || !task.depends) continue;
    for (const depUuid of task.depends as string[]) {
      let list = index.get(depUuid);
      if (!list) { list = []; index.set(depUuid, list); }
      list.push(task._id as string);
    }
  }
  return index;
}

function computeUrgency(
  t: Record<string, unknown>,
  tasksByUuid: Map<string, Record<string, unknown>>,
  blockingIndex: Map<string, string[]>,
): number {
  let urgency = 0;
  if (t.priority === "H") urgency += 6.0;
  else if (t.priority === "M") urgency += 3.9;
  else if (t.priority === "L") urgency += 1.8;
  if (t.start) urgency += 4.0;
  if (t.project) urgency += 1.0;
  const tags = t.tags as string[] | undefined;
  if (tags && tags.length > 0) urgency += Math.min(tags.length, 3) / 3;
  const annotations = t.annotations as unknown[] | undefined;
  if (annotations && annotations.length > 0) urgency += Math.min(annotations.length, 3) * 0.3;
  const depends = t.depends as string[] | undefined;
  if (depends && depends.length > 0) {
    const blocked = depends.some((depUuid) => {
      const dep = tasksByUuid.get(depUuid);
      return dep && dep.status === "pending";
    });
    if (blocked) urgency -= 5.0;
  }
  const dependents = blockingIndex.get(t._id as string);
  if (dependents && dependents.length > 0) urgency += 8.0;
  if (t.due) {
    const dueDate = new Date(t.due as string);
    const daysUntilDue = (dueDate.getTime() - Date.now()) / 86400000;
    if (daysUntilDue < -7) urgency += 12.0;
    else if (daysUntilDue < 0) urgency += 8.0 + (1 - daysUntilDue / -7) * 4.0;
    else if (daysUntilDue < 7) urgency += 4.0 * (1 - daysUntilDue / 7);
    else if (daysUntilDue < 14) urgency += 2.0 * (1 - (daysUntilDue - 7) / 7);
  }
  const ageMs = Date.now() - new Date(t.entry as string).getTime();
  const ageDays = Math.min(ageMs / 86400000, 365);
  urgency += (ageDays / 365) * 2.0;
  return Math.round(urgency * 10000) / 10000;
}

// --- Helpers ---

function toTask(record: Record<string, unknown>): Task {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, _version, ...rest } = record;
  return { uuid: _id as string, ...rest } as unknown as Task;
}

function findTask(id: string): Record<string, unknown> | undefined {
  const c = getCol();
  // Try as UUID/_id
  const byId = c.findOne(id);
  if (byId) return byId;
  // Try as numeric ID
  const numId = parseInt(id, 10);
  if (!isNaN(numId)) {
    const result = c.find({ filter: { id: numId }, limit: 1 });
    return result.records[0];
  }
  return undefined;
}

// --- Public API ---

export async function exportTasks(_config: EngineConfig, filter: string): Promise<Task[]> {
  await drainSyncQueue();
  const c = getCol();

  // Generate recurring task instances
  const allRecords = c.findAll();
  const allTasks = allRecords.map(toTask);
  let idCounter = 0;
  for (const t of allTasks) { if (t.id > idCounter) idCounter = t.id; }
  idCounter++;
  const newInstances = generateInstances(allTasks, () => idCounter++);
  for (const instance of newInstances) {
    await c.insert({ _id: instance.uuid, ...instance });
  }

  // Re-read after instance generation
  const updatedRecords = c.findAll();
  const tasksByUuid = new Map(updatedRecords.map((r) => [r._id as string, r]));
  const blockingIndex = buildBlockingIndex(updatedRecords);

  // Compute urgency on each record
  for (const record of updatedRecords) {
    record.urgency = computeUrgency(record, tasksByUuid, blockingIndex);
  }

  // Apply filter
  const filterObj = compileFilter(filter);
  const filtered = Object.keys(filterObj).length === 0
    ? updatedRecords
    : c.find({ filter: filterObj, limit: 10000 }).records;

  // Compute urgency on filtered results (if not already)
  for (const record of filtered) {
    if (record.urgency === undefined) {
      record.urgency = computeUrgency(record, tasksByUuid, blockingIndex);
    }
  }

  return filtered.map(toTask);
}

export async function addTask(
  _config: EngineConfig,
  description: string,
  attrs: Record<string, string | boolean>,
  extraArgs: string[] = [],
): Promise<string> {
  const c = getCol();
  const uuid = randomUUID();

  const tags: string[] = [];
  for (const arg of extraArgs) {
    if (arg.startsWith("+")) tags.push(arg.substring(1));
  }

  const record: Record<string, unknown> = {
    _id: uuid,
    description,
    status: attrs.recur ? "recurring" : "pending",
    ...(attrs.project && { project: attrs.project }),
    ...(tags.length > 0 && { tags }),
    ...(attrs.priority && { priority: attrs.priority }),
    ...(attrs.due && { due: attrs.due }),
    ...(attrs.wait && { wait: attrs.wait }),
    ...(attrs.scheduled && { scheduled: attrs.scheduled }),
    ...(attrs.recur && { recur: attrs.recur }),
    ...(attrs.until && { until: attrs.until }),
    ...(attrs.depends && { depends: (attrs.depends as string).split(",").map((d) => d.trim()).filter(Boolean) }),
    ...(attrs.agent && { agent: attrs.agent }),
  };

  await c.insert(record);
  return `Created task ${uuid}.`;
}

export async function modifyTask(
  _config: EngineConfig,
  filter: string,
  attrs: Record<string, string | boolean>,
  extraArgs: string[] = [],
): Promise<string> {
  const c = getCol();
  const filterObj = compileFilter(filter);
  const matches = Object.keys(filterObj).length === 0
    ? c.findAll()
    : c.find({ filter: filterObj, limit: 10000 }).records;

  if (matches.length === 0) return "No matching tasks.";

  let modified = 0;
  for (const record of matches) {
    const updates: Record<string, unknown> = { modified: now() };

    if (attrs.description) updates.description = attrs.description;
    if (attrs.project !== undefined) updates.project = (attrs.project as string) || undefined;
    if (attrs.priority !== undefined) {
      if (attrs.priority !== "" && !(VALID_PRIORITIES as readonly string[]).includes(attrs.priority as string)) {
        throw new Error(`Invalid priority: '${attrs.priority}'. Must be one of: ${VALID_PRIORITIES.join(", ")}`);
      }
      updates.priority = (attrs.priority as string) || undefined;
    }
    if (attrs.due !== undefined) updates.due = attrs.due || undefined;
    if (attrs.depends !== undefined) updates.depends = attrs.depends ? (attrs.depends as string).split(",").map((d) => d.trim()).filter(Boolean) : undefined;
    if (attrs.wait !== undefined) updates.wait = attrs.wait || undefined;
    if (attrs.scheduled !== undefined) updates.scheduled = attrs.scheduled || undefined;
    if (attrs.recur !== undefined) updates.recur = (attrs.recur as string) || undefined;
    if (attrs.until !== undefined) updates.until = attrs.until || undefined;
    if (attrs.agent !== undefined) updates.agent = (attrs.agent as string) || undefined;
    if (attrs.has_doc !== undefined) updates.has_doc = attrs.has_doc === true ? true : undefined;
    if (attrs.end !== undefined) updates.end = (attrs.end as string) || undefined;
    if (attrs.status !== undefined) {
      if (!(VALID_STATUSES as readonly string[]).includes(attrs.status as string)) {
        throw new Error(`Invalid status: '${attrs.status}'. Must be one of: ${VALID_STATUSES.join(", ")}`);
      }
      updates.status = attrs.status;
    }

    // Handle tag args
    let currentTags = (record.tags as string[] | undefined) ?? [];
    let tagsChanged = false;
    for (const arg of extraArgs) {
      if (arg.startsWith("+")) {
        if (!currentTags.includes(arg.substring(1))) { currentTags.push(arg.substring(1)); tagsChanged = true; }
      } else if (arg.startsWith("-")) {
        const before = currentTags.length;
        currentTags = currentTags.filter((t) => t !== arg.substring(1));
        if (currentTags.length !== before) tagsChanged = true;
      }
    }
    if (tagsChanged) updates.tags = currentTags.length > 0 ? currentTags : undefined;

    await c.update({ _id: record._id }, { $set: updates });
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
  const c = getCol();
  const record = findTask(id);
  if (!record) return `No task found matching '${id}'.`;

  const taskId = record._id as string;

  switch (command) {
    case "done":
      await c.update({ _id: taskId }, { $set: { status: "completed", end: now(), modified: now() } });
      break;
    case "delete":
      await c.update({ _id: taskId }, { $set: { status: "deleted", end: now(), modified: now() } });
      break;
    case "start":
      await c.update({ _id: taskId }, { $set: { start: now(), modified: now() } });
      break;
    case "stop":
      await c.update({ _id: taskId }, { $set: { start: undefined, modified: now() } });
      break;
    case "annotate": {
      const annotations = (record.annotations as Annotation[] | undefined) ?? [];
      annotations.push({ entry: now(), description: extraArgs.join(" ") });
      await c.update({ _id: taskId }, { $set: { annotations, modified: now() } });
      break;
    }
    case "denotate": {
      const text = extraArgs.join(" ");
      let annotations = (record.annotations as Annotation[] | undefined) ?? [];
      annotations = annotations.filter((a) => a.description !== text);
      await c.update({ _id: taskId }, { $set: { annotations: annotations.length > 0 ? annotations : undefined, modified: now() } });
      break;
    }
    case "purge":
      if (record.status !== "deleted") return "Can only purge deleted tasks.";
      await c.deleteById(taskId);
      return `Task ${taskId} purged.`;
    default:
      return `Unknown command: ${command}`;
  }

  return `Task ${command} completed.`;
}

export async function undo(): Promise<string> {
  const c = getCol();
  const undone = await c.undo();
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
  if (!description || description.trim().length === 0) throw new Error("Description cannot be empty.");
  if (description.length > 500) throw new Error("Description must be under 500 characters.");

  const c = getCol();
  const uuid = randomUUID();
  const timestamp = now();

  const tags: string[] = [];
  for (const arg of extraArgs) {
    if (arg.startsWith("+")) tags.push(arg.substring(1));
  }

  await c.insert({
    _id: uuid,
    description,
    status: "completed",
    entry: timestamp,
    modified: timestamp,
    end: timestamp,
    ...(attrs.project && { project: attrs.project }),
    ...(tags.length > 0 && { tags }),
    ...(attrs.priority && { priority: attrs.priority }),
    ...(attrs.agent && { agent: attrs.agent }),
  });

  return "Task logged.";
}

export async function duplicateTask(
  _config: EngineConfig,
  id: string,
  attrs: Record<string, string>,
  extraArgs: string[] = [],
): Promise<string> {
  const record = findTask(id);
  if (!record) return `No task found matching '${id}'.`;

  const c = getCol();
  const uuid = randomUUID();
  const timestamp = now();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, _version, id: _numId, ...fields } = record;

  const newRecord: Record<string, unknown> = {
    _id: uuid,
    ...fields,
    entry: timestamp,
    modified: timestamp,
    start: undefined,
    end: undefined,
    status: "pending",
  };

  if (attrs.description) newRecord.description = attrs.description;
  if (attrs.project !== undefined) newRecord.project = attrs.project || undefined;
  if (attrs.priority !== undefined) newRecord.priority = (attrs.priority as string) || undefined;
  if (attrs.due !== undefined) newRecord.due = attrs.due || undefined;
  if (attrs.agent !== undefined) newRecord.agent = attrs.agent || undefined;

  // Handle tag args
  let tags = (newRecord.tags as string[] | undefined) ?? [];
  for (const arg of extraArgs) {
    if (arg.startsWith("+")) {
      if (!tags.includes(arg.substring(1))) tags.push(arg.substring(1));
    } else if (arg.startsWith("-")) {
      tags = tags.filter((t) => t !== arg.substring(1));
    }
  }
  newRecord.tags = tags.length > 0 ? tags : undefined;

  await c.insert(newRecord);
  return `Task duplicated as ${uuid}.`;
}

export async function importTasks(_config: EngineConfig, tasksJson: string): Promise<string> {
  const c = getCol();
  const tasks = JSON.parse(tasksJson) as Array<Record<string, unknown>>;

  const docs: Array<Record<string, unknown>> = [];
  for (const raw of tasks) {
    const uuid = (raw.uuid as string) || randomUUID();
    const desc = raw.description as string;
    if (!desc || desc.trim().length === 0) throw new Error("Imported task description cannot be empty.");
    if (desc.length > 500) throw new Error(`Imported task description exceeds 500 characters: "${desc.slice(0, 50)}..."`);

    const doc: Record<string, unknown> = {
      _id: uuid,
      description: desc,
      status: (raw.status as string) || "pending",
      entry: (raw.entry as string) || now(),
    };
    if (raw.project) doc.project = raw.project;
    if (raw.tags) doc.tags = raw.tags;
    if (raw.priority) doc.priority = raw.priority;
    if (raw.due) doc.due = raw.due;
    if (raw.scheduled) doc.scheduled = raw.scheduled;
    if (raw.wait) doc.wait = raw.wait;
    if (raw.until) doc.until = raw.until;
    if (raw.depends) doc.depends = raw.depends;
    if (raw.recur) doc.recur = raw.recur;
    if (raw.agent) doc.agent = raw.agent;
    docs.push(doc);
  }

  await c.insertMany(docs);
  return `Imported ${docs.length} task(s).`;
}

export async function getUnique(_config: EngineConfig, attribute: string): Promise<string[]> {
  await drainSyncQueue();
  const c = getCol();
  if (attribute === "tags" || attribute === "project") {
    const result = c.distinct(attribute);
    return result.values as string[];
  }
  return [];
}

// --- Doc operations (blob API) ---

export async function writeDoc(_config: EngineConfig, id: string, content: string): Promise<string> {
  const record = findTask(id);
  if (!record) throw new Error(`No task found matching '${id}'`);
  const c = getCol();
  const taskId = record._id as string;

  await c.writeBlob(taskId, "doc", content);
  await c.update({ _id: taskId }, { $set: { has_doc: true, modified: now() } });
  // Add +doc tag
  const tags = (record.tags as string[] | undefined) ?? [];
  if (!tags.includes("doc")) {
    await c.update({ _id: taskId }, { $set: { tags: [...tags, "doc"] } });
  }
  return `Doc written for task ${taskId}.`;
}

export async function readDoc(_config: EngineConfig, id: string): Promise<string | null> {
  const record = findTask(id);
  if (!record) throw new Error(`No task found matching '${id}'`);
  const c = getCol();
  try {
    const buf = await c.readBlob(record._id as string, "doc");
    return buf.toString("utf-8");
  } catch {
    return null;
  }
}

export async function deleteDoc(_config: EngineConfig, id: string): Promise<string> {
  const record = findTask(id);
  if (!record) throw new Error(`No task found matching '${id}'`);
  const c = getCol();
  const taskId = record._id as string;

  try { await c.deleteBlob(taskId, "doc"); } catch { /* ok */ }
  await c.update({ _id: taskId }, { $set: { has_doc: undefined, modified: now() } });
  // Remove -doc tag
  const tags = ((record.tags as string[]) ?? []).filter((t) => t !== "doc");
  await c.update({ _id: taskId }, { $set: { tags: tags.length > 0 ? tags : undefined } });
  return `Doc deleted for task ${taskId}.`;
}

// --- Archive ---

export async function archiveTasks(
  _config: EngineConfig,
  olderThanDays: number = 90,
): Promise<string> {
  const c = getCol();
  const cutoffISO = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  const count = await c.archive({
    $or: [{ status: "completed" }, { status: "deleted" }],
    end: { $lt: cutoffISO },
  });
  if (count === 0) return "No tasks to archive.";
  return `Archived ${count} task(s) older than ${olderThanDays} days.`;
}

export async function loadArchivedTasks(
  _config: EngineConfig,
  segment: string,
): Promise<Task[]> {
  const c = getCol();
  const records = await c.loadArchive(segment);
  return records.map(toTask);
}

export function listArchiveSegments(): string[] {
  const c = getCol();
  return c.listArchiveSegments();
}
