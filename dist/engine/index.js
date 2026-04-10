import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { AgentDB } from "@backloghq/agentdb";
import { compileFilter } from "./filter.js";
import { formatDate } from "./dates.js";
import { generateInstances } from "./recurrence.js";
import { taskSchema } from "./task-schema.js";
export const VALID_STATUSES = ["pending", "completed", "deleted", "recurring"];
export const VALID_PRIORITIES = ["H", "M", "L"];
export function deriveProjectSlug(cwd) {
    const name = basename(cwd).replace(/[^a-zA-Z0-9_-]/g, "-");
    const hash = createHash("md5").update(cwd).digest("hex").substring(0, 8);
    return `${name}-${hash}`;
}
export async function getConfig() {
    let dataDir = process.env.TASKDATA;
    if (!dataDir) {
        const root = process.env.TASKDATA_ROOT;
        if (root) {
            const slug = deriveProjectSlug(process.cwd());
            dataDir = join(root, slug);
        }
        else {
            throw new Error("TASKDATA or TASKDATA_ROOT environment variable is required. " +
                "Set TASKDATA to a project-specific directory, or TASKDATA_ROOT to auto-derive from the working directory.");
        }
    }
    const result = { dataDir };
    if (process.env.BACKLOG_BACKEND === "s3") {
        const bucket = process.env.BACKLOG_S3_BUCKET;
        if (!bucket)
            throw new Error("BACKLOG_S3_BUCKET is required when BACKLOG_BACKEND=s3");
        const region = process.env.BACKLOG_S3_REGION;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await import("@backloghq/opslog-s3");
            result.backend = new mod.S3Backend({
                bucket,
                prefix: dataDir,
                ...(region && { region }),
            });
        }
        catch {
            throw new Error("BACKLOG_BACKEND=s3 requires @backloghq/opslog-s3. Install it: npm install @backloghq/opslog-s3");
        }
    }
    return result;
}
let db = null;
let col = null;
let config = null;
export async function ensureSetup(cfg) {
    config = cfg;
    // Reset autoIncrement counters for fresh stores (important for tests)
    taskSchema.counters.clear();
    db = new AgentDB(cfg.dataDir, {
        checkpointThreshold: 50,
        backend: cfg.backend,
    });
    await db.init();
    col = await db.collection(taskSchema);
}
export async function shutdown() {
    if (db) {
        await db.close();
        db = null;
        col = null;
    }
}
function getCol() {
    if (!col)
        throw new Error("Engine not initialized. Call ensureSetup() first.");
    return col;
}
function getDataDir() {
    if (!config)
        throw new Error("Engine not initialized.");
    return config.dataDir;
}
function now() {
    return formatDate(new Date());
}
// UUID_RE used by filter.ts
// --- Sync Queue ---
async function drainSyncQueue() {
    const dir = getDataDir();
    const queuePath = join(dir, "sync-queue.jsonl");
    let content;
    try {
        content = await readFile(queuePath, "utf-8");
    }
    catch {
        return;
    }
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0)
        return;
    const c = getCol();
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
                continue;
            const entry = parsed;
            if (entry.subject) {
                await c.insert({
                    _id: randomUUID(),
                    description: entry.subject,
                    status: "pending",
                    ...(entry.agent && { agent: entry.agent }),
                });
            }
            else if (entry.completed) {
                const matches = c.find({ filter: { status: "pending", description: entry.completed } });
                if (matches.records.length === 1) {
                    const match = matches.records[0];
                    await c.update({ _id: match._id }, { $set: { status: "completed", end: now(), modified: now() } });
                }
                else if (matches.records.length > 1) {
                    console.error(`backlog: sync completion skipped — ${matches.records.length} pending tasks match "${entry.completed}"`);
                }
            }
            else if (entry.subagent_start) {
                const agentName = entry.subagent_start;
                const unassigned = c.find({ filter: { status: "pending", agent: { $exists: false } } });
                for (const task of unassigned.records) {
                    await c.update({ _id: task._id }, { $set: { agent: agentName, modified: now() } });
                }
            }
        }
        catch {
            // Skip malformed entries
        }
    }
    await unlink(queuePath);
}
// --- Urgency ---
function buildBlockingIndex(tasks) {
    const index = new Map();
    for (const task of tasks) {
        if (task.status !== "pending" || !task.depends)
            continue;
        for (const depUuid of task.depends) {
            let list = index.get(depUuid);
            if (!list) {
                list = [];
                index.set(depUuid, list);
            }
            list.push(task._id);
        }
    }
    return index;
}
function computeUrgency(t, tasksByUuid, blockingIndex) {
    let urgency = 0;
    if (t.priority === "H")
        urgency += 6.0;
    else if (t.priority === "M")
        urgency += 3.9;
    else if (t.priority === "L")
        urgency += 1.8;
    if (t.start)
        urgency += 4.0;
    if (t.project)
        urgency += 1.0;
    const tags = t.tags;
    if (tags && tags.length > 0)
        urgency += Math.min(tags.length, 3) / 3;
    const annotations = t.annotations;
    if (annotations && annotations.length > 0)
        urgency += Math.min(annotations.length, 3) * 0.3;
    const depends = t.depends;
    if (depends && depends.length > 0) {
        const blocked = depends.some((depUuid) => {
            const dep = tasksByUuid.get(depUuid);
            return dep && dep.status === "pending";
        });
        if (blocked)
            urgency -= 5.0;
    }
    const dependents = blockingIndex.get(t._id);
    if (dependents && dependents.length > 0)
        urgency += 8.0;
    if (t.due) {
        const dueDate = new Date(t.due);
        const daysUntilDue = (dueDate.getTime() - Date.now()) / 86400000;
        if (daysUntilDue < -7)
            urgency += 12.0;
        else if (daysUntilDue < 0)
            urgency += 8.0 + (1 - daysUntilDue / -7) * 4.0;
        else if (daysUntilDue < 7)
            urgency += 4.0 * (1 - daysUntilDue / 7);
        else if (daysUntilDue < 14)
            urgency += 2.0 * (1 - (daysUntilDue - 7) / 7);
    }
    const ageMs = Date.now() - new Date(t.entry).getTime();
    const ageDays = Math.min(ageMs / 86400000, 365);
    urgency += (ageDays / 365) * 2.0;
    return Math.round(urgency * 10000) / 10000;
}
// --- Helpers ---
function toTask(record) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, _version, ...rest } = record;
    return { uuid: _id, ...rest };
}
function findTask(id) {
    const c = getCol();
    // Try as UUID/_id
    const byId = c.findOne(id);
    if (byId)
        return byId;
    // Try as numeric ID
    const numId = parseInt(id, 10);
    if (!isNaN(numId)) {
        const result = c.find({ filter: { id: numId }, limit: 1 });
        return result.records[0];
    }
    return undefined;
}
// --- Public API ---
export async function exportTasks(_config, filter) {
    await drainSyncQueue();
    const c = getCol();
    // Generate recurring task instances
    const allRecords = c.findAll();
    const allTasks = allRecords.map(toTask);
    let idCounter = 0;
    for (const t of allTasks) {
        if (t.id > idCounter)
            idCounter = t.id;
    }
    idCounter++;
    const newInstances = generateInstances(allTasks, () => idCounter++);
    for (const instance of newInstances) {
        await c.insert({ _id: instance.uuid, ...instance });
    }
    // Re-read after instance generation
    const updatedRecords = c.findAll();
    const tasksByUuid = new Map(updatedRecords.map((r) => [r._id, r]));
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
export async function addTask(_config, description, attrs, extraArgs = []) {
    const c = getCol();
    const uuid = randomUUID();
    const tags = [];
    for (const arg of extraArgs) {
        if (arg.startsWith("+"))
            tags.push(arg.substring(1));
    }
    const record = {
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
        ...(attrs.depends && { depends: attrs.depends.split(",").map((d) => d.trim()).filter(Boolean) }),
        ...(attrs.agent && { agent: attrs.agent }),
    };
    await c.insert(record);
    return `Created task ${uuid}.`;
}
export async function modifyTask(_config, filter, attrs, extraArgs = []) {
    const c = getCol();
    const filterObj = compileFilter(filter);
    const matches = Object.keys(filterObj).length === 0
        ? c.findAll()
        : c.find({ filter: filterObj, limit: 10000 }).records;
    if (matches.length === 0)
        return "No matching tasks.";
    let modified = 0;
    for (const record of matches) {
        const updates = { modified: now() };
        if (attrs.description)
            updates.description = attrs.description;
        if (attrs.project !== undefined)
            updates.project = attrs.project || undefined;
        if (attrs.priority !== undefined) {
            if (attrs.priority !== "" && !VALID_PRIORITIES.includes(attrs.priority)) {
                throw new Error(`Invalid priority: '${attrs.priority}'. Must be one of: ${VALID_PRIORITIES.join(", ")}`);
            }
            updates.priority = attrs.priority || undefined;
        }
        if (attrs.due !== undefined)
            updates.due = attrs.due || undefined;
        if (attrs.depends !== undefined)
            updates.depends = attrs.depends ? attrs.depends.split(",").map((d) => d.trim()).filter(Boolean) : undefined;
        if (attrs.wait !== undefined)
            updates.wait = attrs.wait || undefined;
        if (attrs.scheduled !== undefined)
            updates.scheduled = attrs.scheduled || undefined;
        if (attrs.recur !== undefined)
            updates.recur = attrs.recur || undefined;
        if (attrs.until !== undefined)
            updates.until = attrs.until || undefined;
        if (attrs.agent !== undefined)
            updates.agent = attrs.agent || undefined;
        if (attrs.has_doc !== undefined)
            updates.has_doc = attrs.has_doc === true ? true : undefined;
        if (attrs.end !== undefined)
            updates.end = attrs.end || undefined;
        if (attrs.status !== undefined) {
            if (!VALID_STATUSES.includes(attrs.status)) {
                throw new Error(`Invalid status: '${attrs.status}'. Must be one of: ${VALID_STATUSES.join(", ")}`);
            }
            updates.status = attrs.status;
        }
        // Handle tag args
        let currentTags = record.tags ?? [];
        let tagsChanged = false;
        for (const arg of extraArgs) {
            if (arg.startsWith("+")) {
                if (!currentTags.includes(arg.substring(1))) {
                    currentTags.push(arg.substring(1));
                    tagsChanged = true;
                }
            }
            else if (arg.startsWith("-")) {
                const before = currentTags.length;
                currentTags = currentTags.filter((t) => t !== arg.substring(1));
                if (currentTags.length !== before)
                    tagsChanged = true;
            }
        }
        if (tagsChanged)
            updates.tags = currentTags.length > 0 ? currentTags : undefined;
        await c.update({ _id: record._id }, { $set: updates });
        modified++;
    }
    return `Modified ${modified} task(s).`;
}
export async function taskCommand(_config, id, command, extraArgs = []) {
    const c = getCol();
    const record = findTask(id);
    if (!record)
        return `No task found matching '${id}'.`;
    const taskId = record._id;
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
            const annotations = record.annotations ?? [];
            annotations.push({ entry: now(), description: extraArgs.join(" ") });
            await c.update({ _id: taskId }, { $set: { annotations, modified: now() } });
            break;
        }
        case "denotate": {
            const text = extraArgs.join(" ");
            let annotations = record.annotations ?? [];
            annotations = annotations.filter((a) => a.description !== text);
            await c.update({ _id: taskId }, { $set: { annotations: annotations.length > 0 ? annotations : undefined, modified: now() } });
            break;
        }
        case "purge":
            if (record.status !== "deleted")
                return "Can only purge deleted tasks.";
            await c.deleteById(taskId);
            return `Task ${taskId} purged.`;
        default:
            return `Unknown command: ${command}`;
    }
    return `Task ${command} completed.`;
}
export async function undo() {
    const c = getCol();
    const undone = await c.undo();
    return undone ? "Undo completed." : "Nothing to undo.";
}
export async function countTasks(_config, filter) {
    const tasks = await exportTasks(_config, filter);
    return tasks.length;
}
export async function logTask(_config, description, attrs, extraArgs = []) {
    if (!description || description.trim().length === 0)
        throw new Error("Description cannot be empty.");
    if (description.length > 500)
        throw new Error("Description must be under 500 characters.");
    const c = getCol();
    const uuid = randomUUID();
    const timestamp = now();
    const tags = [];
    for (const arg of extraArgs) {
        if (arg.startsWith("+"))
            tags.push(arg.substring(1));
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
export async function duplicateTask(_config, id, attrs, extraArgs = []) {
    const record = findTask(id);
    if (!record)
        return `No task found matching '${id}'.`;
    const c = getCol();
    const uuid = randomUUID();
    const timestamp = now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, _version, id: _numId, ...fields } = record;
    const newRecord = {
        _id: uuid,
        ...fields,
        entry: timestamp,
        modified: timestamp,
        start: undefined,
        end: undefined,
        status: "pending",
    };
    if (attrs.description)
        newRecord.description = attrs.description;
    if (attrs.project !== undefined)
        newRecord.project = attrs.project || undefined;
    if (attrs.priority !== undefined)
        newRecord.priority = attrs.priority || undefined;
    if (attrs.due !== undefined)
        newRecord.due = attrs.due || undefined;
    if (attrs.agent !== undefined)
        newRecord.agent = attrs.agent || undefined;
    // Handle tag args
    let tags = newRecord.tags ?? [];
    for (const arg of extraArgs) {
        if (arg.startsWith("+")) {
            if (!tags.includes(arg.substring(1)))
                tags.push(arg.substring(1));
        }
        else if (arg.startsWith("-")) {
            tags = tags.filter((t) => t !== arg.substring(1));
        }
    }
    newRecord.tags = tags.length > 0 ? tags : undefined;
    await c.insert(newRecord);
    return `Task duplicated as ${uuid}.`;
}
export async function importTasks(_config, tasksJson) {
    const c = getCol();
    const tasks = JSON.parse(tasksJson);
    const docs = [];
    for (const raw of tasks) {
        const uuid = raw.uuid || randomUUID();
        const desc = raw.description;
        if (!desc || desc.trim().length === 0)
            throw new Error("Imported task description cannot be empty.");
        if (desc.length > 500)
            throw new Error(`Imported task description exceeds 500 characters: "${desc.slice(0, 50)}..."`);
        const doc = {
            _id: uuid,
            description: desc,
            status: raw.status || "pending",
            entry: raw.entry || now(),
        };
        if (raw.project)
            doc.project = raw.project;
        if (raw.tags)
            doc.tags = raw.tags;
        if (raw.priority)
            doc.priority = raw.priority;
        if (raw.due)
            doc.due = raw.due;
        if (raw.scheduled)
            doc.scheduled = raw.scheduled;
        if (raw.wait)
            doc.wait = raw.wait;
        if (raw.until)
            doc.until = raw.until;
        if (raw.depends)
            doc.depends = raw.depends;
        if (raw.recur)
            doc.recur = raw.recur;
        if (raw.agent)
            doc.agent = raw.agent;
        docs.push(doc);
    }
    await c.insertMany(docs);
    return `Imported ${docs.length} task(s).`;
}
export async function getUnique(_config, attribute) {
    await drainSyncQueue();
    const c = getCol();
    if (attribute === "tags" || attribute === "project") {
        const result = c.distinct(attribute);
        return result.values;
    }
    return [];
}
// --- Doc operations (blob API) ---
export async function writeDoc(_config, id, content) {
    const record = findTask(id);
    if (!record)
        throw new Error(`No task found matching '${id}'`);
    const c = getCol();
    const taskId = record._id;
    await c.writeBlob(taskId, "doc", content);
    await c.update({ _id: taskId }, { $set: { has_doc: true, modified: now() } });
    // Add +doc tag
    const tags = record.tags ?? [];
    if (!tags.includes("doc")) {
        await c.update({ _id: taskId }, { $set: { tags: [...tags, "doc"] } });
    }
    return `Doc written for task ${taskId}.`;
}
export async function readDoc(_config, id) {
    const record = findTask(id);
    if (!record)
        throw new Error(`No task found matching '${id}'`);
    const c = getCol();
    try {
        const buf = await c.readBlob(record._id, "doc");
        return buf.toString("utf-8");
    }
    catch {
        return null;
    }
}
export async function deleteDoc(_config, id) {
    const record = findTask(id);
    if (!record)
        throw new Error(`No task found matching '${id}'`);
    const c = getCol();
    const taskId = record._id;
    try {
        await c.deleteBlob(taskId, "doc");
    }
    catch { /* ok */ }
    await c.update({ _id: taskId }, { $set: { has_doc: undefined, modified: now() } });
    // Remove -doc tag
    const tags = (record.tags ?? []).filter((t) => t !== "doc");
    await c.update({ _id: taskId }, { $set: { tags: tags.length > 0 ? tags : undefined } });
    return `Doc deleted for task ${taskId}.`;
}
// --- Archive ---
export async function archiveTasks(_config, olderThanDays = 90) {
    const c = getCol();
    const cutoffISO = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const count = await c.archive({
        $or: [{ status: "completed" }, { status: "deleted" }],
        end: { $lt: cutoffISO },
    });
    if (count === 0)
        return "No tasks to archive.";
    return `Archived ${count} task(s) older than ${olderThanDays} days.`;
}
export async function loadArchivedTasks(_config, segment) {
    const c = getCol();
    const records = await c.loadArchive(segment);
    return records.map(toTask);
}
export function listArchiveSegments() {
    const c = getCol();
    return c.listArchiveSegments();
}
