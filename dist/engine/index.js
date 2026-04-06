import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { Store } from "@backloghq/opslog";
import { compileFilter } from "./filter.js";
import { resolveDate, formatDate } from "./dates.js";
import { generateInstances } from "./recurrence.js";
export const VALID_STATUSES = ["pending", "completed", "deleted", "recurring", "waiting"];
export const VALID_PRIORITIES = ["H", "M", "L"];
export function deriveProjectSlug(cwd) {
    const name = basename(cwd).replace(/[^a-zA-Z0-9_-]/g, "-");
    const hash = createHash("md5").update(cwd).digest("hex").substring(0, 8);
    return `${name}-${hash}`;
}
export function getConfig() {
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
    return { dataDir };
}
let store = null;
let config = null;
export async function ensureSetup(cfg) {
    config = cfg;
    await mkdir(cfg.dataDir, { recursive: true });
    await mkdir(join(cfg.dataDir, "docs"), { recursive: true });
    store = new Store();
    await store.open(cfg.dataDir, { checkpointThreshold: 50 });
}
export async function shutdown() {
    if (store) {
        await store.close();
        store = null;
    }
}
function getStore() {
    if (!store)
        throw new Error("Engine not initialized. Call ensureSetup() first.");
    return store;
}
async function drainSyncQueue() {
    const dir = getDataDir();
    const queuePath = join(dir, "sync-queue.jsonl");
    let content;
    try {
        content = await readFile(queuePath, "utf-8");
    }
    catch {
        return; // No queue file
    }
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0)
        return;
    const s = getStore();
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
                continue;
            const entry = parsed;
            if (entry.subject) {
                // TaskCreated sync
                const uuid = randomUUID();
                const timestamp = now();
                const task = {
                    uuid,
                    id: nextId(),
                    description: entry.subject,
                    status: "pending",
                    entry: timestamp,
                    modified: timestamp,
                };
                if (entry.agent)
                    task.agent = entry.agent;
                await s.set(uuid, task);
            }
            else if (entry.completed) {
                // TaskCompleted sync — find by description and mark done
                const match = s.all().find((t) => t.status === "pending" && t.description === entry.completed);
                if (match) {
                    await s.set(match.uuid, { ...match, status: "completed", end: now(), modified: now() });
                }
            }
            else if (entry.subagent_start) {
                // SubagentStart sync — assign unassigned pending tasks to the agent
                const agentName = entry.subagent_start;
                for (const task of s.all()) {
                    if (task.status === "pending" && !task.agent) {
                        await s.set(task.uuid, { ...task, agent: agentName, modified: now() });
                    }
                }
            }
        }
        catch {
            // Skip malformed entries
        }
    }
    await unlink(queuePath);
}
function getDataDir() {
    if (!config)
        throw new Error("Engine not initialized.");
    return config.dataDir;
}
function now() {
    return formatDate(new Date());
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_RE = /^[a-zA-Z0-9_-]+$/;
function validateAttrs(attrs) {
    if ("description" in attrs) {
        const desc = attrs.description;
        if (!desc || desc.trim().length === 0)
            throw new Error("Description cannot be empty.");
        if (desc.length > 500)
            throw new Error("Description must be under 500 characters.");
    }
    if (attrs.project && !PROJECT_RE.test(attrs.project)) {
        throw new Error("Project name must contain only letters, numbers, hyphens, and underscores.");
    }
    if (attrs.priority && !["H", "M", "L", ""].includes(attrs.priority)) {
        throw new Error("Priority must be H, M, or L.");
    }
    if (attrs.due) {
        try {
            resolveDate(attrs.due);
        }
        catch {
            throw new Error(`Invalid due date: '${attrs.due}'`);
        }
    }
    if (attrs.scheduled) {
        try {
            resolveDate(attrs.scheduled);
        }
        catch {
            throw new Error(`Invalid scheduled date: '${attrs.scheduled}'`);
        }
    }
    if (attrs.wait) {
        try {
            resolveDate(attrs.wait);
        }
        catch {
            throw new Error(`Invalid wait date: '${attrs.wait}'`);
        }
    }
    if (attrs.until !== undefined && attrs.until !== "") {
        try {
            resolveDate(attrs.until);
        }
        catch {
            throw new Error(`Invalid until date: "${attrs.until}".`);
        }
    }
    if (attrs.depends) {
        for (const dep of attrs.depends.split(",").map((d) => d.trim())) {
            if (!UUID_RE.test(dep))
                throw new Error(`Invalid dependency UUID: '${dep}'`);
        }
    }
}
function nextId() {
    const s = getStore();
    let maxId = 0;
    for (const task of s.all()) {
        if (task.id > maxId)
            maxId = task.id;
    }
    return maxId + 1;
}
/**
 * Build a reverse dependency index: maps each UUID to the list of
 * pending task UUIDs that depend on it. O(n) build, O(1) lookup.
 */
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
            list.push(task.uuid);
        }
    }
    return index;
}
/**
 * Build a numeric ID index: maps task ID to UUID. O(n) build, O(1) lookup.
 */
function buildIdIndex(tasks) {
    const index = new Map();
    for (const task of tasks) {
        index.set(task.id, task.uuid);
    }
    return index;
}
function computeUrgency(t, tasksByUuid, blockingIndex) {
    let urgency = 0;
    // Priority
    if (t.priority === "H")
        urgency += 6.0;
    else if (t.priority === "M")
        urgency += 3.9;
    else if (t.priority === "L")
        urgency += 1.8;
    // Active
    if (t.start)
        urgency += 4.0;
    // Project
    if (t.project)
        urgency += 1.0;
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
            const dep = tasksByUuid.get(depUuid);
            return dep && dep.status === "pending";
        });
        if (blocked)
            urgency -= 5.0;
    }
    // Blocking (other tasks depend on this) — O(1) lookup via index
    const dependents = blockingIndex.get(t.uuid);
    if (dependents && dependents.length > 0) {
        urgency += 8.0;
        t._blocking = true;
    }
    // Due
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
    // Age (capped at 365 days)
    const ageMs = Date.now() - new Date(t.entry).getTime();
    const ageDays = Math.min(ageMs / 86400000, 365);
    urgency += (ageDays / 365) * 2.0;
    return Math.round(urgency * 10000) / 10000;
}
// --- Public API ---
export async function exportTasks(_config, filter) {
    await drainSyncQueue();
    const s = getStore();
    // Generate recurring task instances with incrementing IDs
    const allTasks = s.all();
    let idCounter = nextId();
    const newInstances = generateInstances(allTasks, () => idCounter++);
    for (const instance of newInstances) {
        await s.set(instance.uuid, instance);
    }
    const updatedTasks = s.all();
    const tasksByUuid = new Map(updatedTasks.map((t) => [t.uuid, t]));
    const blockingIndex = buildBlockingIndex(updatedTasks);
    updatedTasks.forEach((t) => { t.urgency = computeUrgency(t, tasksByUuid, blockingIndex); });
    // Strip internal fields before returning
    updatedTasks.forEach((t) => { delete t._blocking; });
    const predicate = compileFilter(filter, (uuid) => tasksByUuid.get(uuid));
    return updatedTasks.filter(predicate);
}
export async function addTask(_config, description, attrs, extraArgs = []) {
    if (!description || description.trim().length === 0)
        throw new Error("Description cannot be empty.");
    if (description.length > 500)
        throw new Error("Description must be under 500 characters.");
    validateAttrs(attrs);
    const s = getStore();
    const uuid = randomUUID();
    const timestamp = now();
    const tags = [];
    for (const arg of extraArgs) {
        if (arg.startsWith("+"))
            tags.push(arg.substring(1));
    }
    const task = {
        uuid,
        id: nextId(),
        description,
        status: attrs.recur ? "recurring" : "pending",
        entry: timestamp,
        modified: timestamp,
        ...(attrs.project && { project: attrs.project }),
        ...(tags.length > 0 && { tags }),
        ...(attrs.priority && { priority: attrs.priority }),
        ...(attrs.due && { due: formatDate(resolveDate(attrs.due)) }),
        ...(attrs.wait && { wait: formatDate(resolveDate(attrs.wait)) }),
        ...(attrs.scheduled && { scheduled: formatDate(resolveDate(attrs.scheduled)) }),
        ...(attrs.recur && { recur: attrs.recur }),
        ...(attrs.until && { until: formatDate(resolveDate(attrs.until)) }),
        ...(attrs.depends && { depends: attrs.depends.split(",").map((d) => d.trim()) }),
        ...(attrs.agent && { agent: attrs.agent }),
    };
    await s.set(uuid, task);
    return `Created task ${uuid}.`;
}
export async function modifyTask(_config, filter, attrs, extraArgs = []) {
    validateAttrs(attrs);
    const s = getStore();
    const allTasks = s.all();
    const tasksByUuid = new Map(allTasks.map((t) => [t.uuid, t]));
    const predicate = compileFilter(filter, (uuid) => tasksByUuid.get(uuid));
    const matches = allTasks.filter(predicate);
    if (matches.length === 0)
        return "No matching tasks.";
    let modified = 0;
    for (const task of matches) {
        const updated = { ...task, modified: now() };
        if (attrs.description)
            updated.description = attrs.description;
        if (attrs.project !== undefined)
            updated.project = attrs.project || undefined;
        if (attrs.priority !== undefined)
            updated.priority = attrs.priority || undefined;
        if (attrs.due !== undefined)
            updated.due = attrs.due ? formatDate(resolveDate(attrs.due)) : undefined;
        if (attrs.depends !== undefined)
            updated.depends = attrs.depends ? attrs.depends.split(",").map((d) => d.trim()) : undefined;
        if (attrs.wait !== undefined)
            updated.wait = attrs.wait ? formatDate(resolveDate(attrs.wait)) : undefined;
        if (attrs.scheduled !== undefined)
            updated.scheduled = attrs.scheduled ? formatDate(resolveDate(attrs.scheduled)) : undefined;
        if (attrs.recur !== undefined)
            updated.recur = attrs.recur || undefined;
        if (attrs.until !== undefined)
            updated.until = attrs.until ? formatDate(resolveDate(attrs.until)) : undefined;
        if (attrs.agent !== undefined)
            updated.agent = attrs.agent || undefined;
        if (attrs.has_doc !== undefined)
            updated.has_doc = attrs.has_doc === true ? true : undefined;
        if (attrs.end !== undefined)
            updated.end = attrs.end || undefined;
        if (attrs.status !== undefined) {
            if (!VALID_STATUSES.includes(attrs.status)) {
                throw new Error(`Invalid status: '${attrs.status}'. Must be one of: ${VALID_STATUSES.join(", ")}`);
            }
            updated.status = attrs.status;
        }
        if (attrs.priority !== undefined && attrs.priority !== "") {
            if (!VALID_PRIORITIES.includes(attrs.priority)) {
                throw new Error(`Invalid priority: '${attrs.priority}'. Must be one of: ${VALID_PRIORITIES.join(", ")}`);
            }
        }
        // Handle tag args
        for (const arg of extraArgs) {
            if (arg.startsWith("+")) {
                if (!updated.tags)
                    updated.tags = [];
                if (!updated.tags.includes(arg.substring(1)))
                    updated.tags.push(arg.substring(1));
            }
            else if (arg.startsWith("-")) {
                if (updated.tags)
                    updated.tags = updated.tags.filter((t) => t !== arg.substring(1));
            }
        }
        await s.set(task.uuid, updated);
        modified++;
    }
    return `Modified ${modified} task(s).`;
}
export async function taskCommand(_config, id, command, extraArgs = []) {
    const s = getStore();
    const task = findTask(id);
    if (!task)
        return `No task found matching '${id}'.`;
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
            if (!updated.annotations)
                updated.annotations = [];
            updated.annotations.push({ entry: now(), description: extraArgs.join(" ") });
            break;
        case "denotate": {
            const text = extraArgs.join(" ");
            if (updated.annotations) {
                updated.annotations = updated.annotations.filter((a) => a.description !== text);
                if (updated.annotations.length === 0)
                    updated.annotations = undefined;
            }
            break;
        }
        case "purge":
            if (task.status !== "deleted")
                return "Can only purge deleted tasks.";
            await s.delete(task.uuid);
            return `Task ${task.uuid} purged.`;
        default:
            return `Unknown command: ${command}`;
    }
    await s.set(task.uuid, updated);
    return `Task ${command} completed.`;
}
export async function undo() {
    const s = getStore();
    const undone = await s.undo();
    return undone ? "Undo completed." : "Nothing to undo.";
}
export async function countTasks(_config, filter) {
    const tasks = await exportTasks(_config, filter);
    return tasks.length;
}
export async function logTask(_config, description, attrs, extraArgs = []) {
    const s = getStore();
    const uuid = randomUUID();
    const timestamp = now();
    const tags = [];
    for (const arg of extraArgs) {
        if (arg.startsWith("+"))
            tags.push(arg.substring(1));
    }
    const task = {
        uuid,
        id: nextId(),
        description,
        status: "completed",
        entry: timestamp,
        modified: timestamp,
        end: timestamp,
        ...(attrs.project && { project: attrs.project }),
        ...(tags.length > 0 && { tags }),
        ...(attrs.priority && { priority: attrs.priority }),
        ...(attrs.agent && { agent: attrs.agent }),
    };
    await s.set(uuid, task);
    return "Task logged.";
}
export async function duplicateTask(_config, id, attrs, extraArgs = []) {
    const task = findTask(id);
    if (!task)
        return `No task found matching '${id}'.`;
    const uuid = randomUUID();
    const timestamp = now();
    const newTask = {
        ...task,
        uuid,
        id: nextId(),
        entry: timestamp,
        modified: timestamp,
        start: undefined,
        end: undefined,
        status: "pending",
    };
    if (attrs.description)
        newTask.description = attrs.description;
    if (attrs.project !== undefined)
        newTask.project = attrs.project || undefined;
    if (attrs.priority !== undefined)
        newTask.priority = attrs.priority || undefined;
    if (attrs.due !== undefined)
        newTask.due = attrs.due ? formatDate(resolveDate(attrs.due)) : undefined;
    if (attrs.agent !== undefined)
        newTask.agent = attrs.agent || undefined;
    for (const arg of extraArgs) {
        if (arg.startsWith("+")) {
            if (!newTask.tags)
                newTask.tags = [];
            if (!newTask.tags.includes(arg.substring(1)))
                newTask.tags.push(arg.substring(1));
        }
        else if (arg.startsWith("-")) {
            if (newTask.tags)
                newTask.tags = newTask.tags.filter((t) => t !== arg.substring(1));
        }
    }
    const s = getStore();
    await s.set(uuid, newTask);
    return `Task duplicated as ${uuid}.`;
}
export async function importTasks(_config, tasksJson) {
    const s = getStore();
    const tasks = JSON.parse(tasksJson);
    let count = 0;
    await s.batch(() => {
        for (const raw of tasks) {
            const uuid = raw.uuid || randomUUID();
            const timestamp = now();
            const rawStatus = raw.status || "pending";
            if (!VALID_STATUSES.includes(rawStatus)) {
                throw new Error(`Invalid status '${rawStatus}' in imported task. Must be one of: ${VALID_STATUSES.join(", ")}`);
            }
            const task = {
                uuid,
                id: nextId(),
                description: raw.description,
                status: rawStatus,
                entry: raw.entry || timestamp,
                modified: timestamp,
            };
            if (raw.project)
                task.project = raw.project;
            if (raw.tags)
                task.tags = raw.tags;
            if (raw.priority) {
                const rawPriority = raw.priority;
                if (!VALID_PRIORITIES.includes(rawPriority)) {
                    throw new Error(`Invalid priority '${rawPriority}' in imported task. Must be one of: ${VALID_PRIORITIES.join(", ")}`);
                }
                task.priority = rawPriority;
            }
            if (raw.due)
                task.due = raw.due;
            if (raw.agent)
                task.agent = raw.agent;
            s.set(uuid, task);
            count++;
        }
    });
    return `Imported ${count} task(s).`;
}
export async function getUnique(_config, attribute) {
    const s = getStore();
    const values = new Set();
    for (const task of s.all()) {
        if (task.status !== "pending" && task.status !== "recurring")
            continue;
        if (attribute === "tags") {
            task.tags?.forEach((t) => values.add(t));
        }
        else if (attribute === "project" && task.project) {
            values.add(task.project);
        }
    }
    return [...values];
}
// --- Doc operations ---
function docsDir() {
    return join(getDataDir(), "docs");
}
function docPath(uuid) {
    return join(docsDir(), `${uuid}.md`);
}
export async function writeDoc(_config, id, content) {
    const task = findTask(id);
    if (!task)
        throw new Error(`No task found matching '${id}'`);
    await mkdir(docsDir(), { recursive: true });
    await writeFile(docPath(task.uuid), content, "utf-8");
    await modifyTask(_config, task.uuid, { has_doc: true }, ["+doc"]);
    return `Doc written for task ${task.uuid}.`;
}
export async function readDoc(_config, id) {
    const task = findTask(id);
    if (!task)
        throw new Error(`No task found matching '${id}'`);
    try {
        return await readFile(docPath(task.uuid), "utf-8");
    }
    catch {
        return null;
    }
}
export async function deleteDoc(_config, id) {
    const task = findTask(id);
    if (!task)
        throw new Error(`No task found matching '${id}'`);
    try {
        await unlink(docPath(task.uuid));
    }
    catch { /* ok */ }
    await modifyTask(_config, task.uuid, { has_doc: false }, ["-doc"]);
    return `Doc deleted for task ${task.uuid}.`;
}
// --- Archive ---
export async function archiveTasks(_config, olderThanDays = 90) {
    const s = getStore();
    const cutoff = Date.now() - olderThanDays * 86400000;
    const count = await s.archive((task) => (task.status === "completed" || task.status === "deleted") &&
        !!task.end &&
        new Date(task.end).getTime() < cutoff);
    if (count === 0)
        return "No tasks to archive.";
    return `Archived ${count} task(s) older than ${olderThanDays} days.`;
}
export async function loadArchivedTasks(_config, segment) {
    const s = getStore();
    const records = await s.loadArchive(segment);
    return Array.from(records.values());
}
export function listArchiveSegments() {
    const s = getStore();
    return s.listArchiveSegments();
}
// --- Helpers ---
function findTask(id) {
    const s = getStore();
    // Try as UUID first
    const byUuid = s.get(id);
    if (byUuid)
        return byUuid;
    // Try as numeric ID using index for O(1) lookup
    const numId = parseInt(id, 10);
    if (!isNaN(numId)) {
        const idIndex = buildIdIndex(s.all());
        const uuid = idIndex.get(numId);
        return uuid ? s.get(uuid) : undefined;
    }
    return undefined;
}
