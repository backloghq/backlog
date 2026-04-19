/**
 * Task collection schema — declarative definition using agentdb defineSchema().
 * Replaces manual validation, virtual tags, numeric ID counter, and date resolution.
 */
import { defineSchema } from "@backloghq/agentdb";
import { resolveDate, formatDate, isOverdue, isDueToday, isDueTomorrow, isDueThisWeek } from "./dates.js";

function resolveDateField(v: unknown): unknown {
  if (!v || typeof v !== "string" || v === "") return v;
  return formatDate(resolveDate(v)); // throws on invalid date
}

/**
 * Task collection schema definition — shared between default and named namespaces.
 */
const SCHEMA_DEF = {
  version: 1,
  description: "Persistent tasks for Claude Code agents — survive across sessions so work started by one agent can be picked up by another. Each task has a description, status lifecycle, optional priority, project grouping, dates, tags, dependencies, and cross-session agent ownership.",
  instructions: "Status flow: pending → (start/stop to toggle active work) → completed or deleted. 'recurring' is a template that spawns new pending instances on `recur` pattern. Always set `agent` when a task belongs to a specific agent team member. Use `depends` (array of task UUIDs) to model blocking relationships — virtual tag `+BLOCKED` shows tasks with unresolved dependencies, `+READY` shows tasks that can start now. Dates (`due`, `wait`, `scheduled`, `until`) accept natural-language input ('tomorrow', 'next friday', '2w') and are normalised to ISO strings. `has_doc` indicates an attached markdown document — write via `task_doc_write`.",
  tagField: "tags",
  textSearch: true,

  fields: {
    id: { type: "autoIncrement" as const, description: "Stable short numeric ID for humans (1, 2, 3...). UUIDs are the primary key; this is for CLI/display." },
    description: { type: "string" as const, required: true, maxLength: 500, description: "Free-text task description. First line shown in listings; can be multi-line." },
    status: { type: "enum" as const, values: ["pending", "completed", "deleted", "recurring"], default: "pending", description: "Lifecycle state. 'recurring' is a template that generates pending instances on its `recur` schedule." },
    priority: { type: "enum" as const, values: ["H", "M", "L"], description: "H=high/urgent, M=medium/normal, L=low/backlog. Affects urgency score and default sort order." },
    project: { type: "string" as const, pattern: /^[a-zA-Z0-9_-]+$/, description: "Project name for grouping (alphanumeric, hyphens, underscores). E.g. 'backend', 'auth-refactor'." },
    due: { type: "date" as const, resolve: resolveDateField, description: "Due date. Accepts ISO, relative ('3d', '2w'), named ('tomorrow', 'friday', 'eow', 'eom'), compound ('now+3d'). +OVERDUE virtual tag matches past-due pending tasks." },
    wait: { type: "date" as const, resolve: resolveDateField, description: "Wait date — task is hidden from default views until this date passes." },
    scheduled: { type: "date" as const, resolve: resolveDateField, description: "Scheduled start date — when work should begin. +READY excludes tasks scheduled for the future." },
    until: { type: "date" as const, resolve: resolveDateField, description: "End date for recurrence — no instances generated past this date. Only meaningful with `recur`." },
    tags: { type: "string[]" as const, description: "Freeform labels. Queryable with +tag (contains) or -tag (excludes)." },
    depends: { type: "string[]" as const, description: "UUIDs of tasks this depends on. Task shows as +BLOCKED until dependencies complete." },
    recur: { type: "string" as const, description: "Recurrence pattern: 'daily', 'weekly', 'weekdays', 'biweekly', 'monthly', 'quarterly', 'yearly', or numeric like '3d', '2w'. Requires `due`." },
    agent: { type: "string" as const, description: "Agent identity for team ownership. E.g. 'explorer', 'planner', 'reviewer'. Set on task creation or via task_modify." },
    start: { type: "string" as const, description: "ISO timestamp when work started (task_start). Cleared by task_stop." },
    end: { type: "string" as const, description: "ISO timestamp when the task completed or was deleted." },
    entry: { type: "string" as const, description: "ISO timestamp when the task was created. Auto-set by beforeInsert." },
    modified: { type: "string" as const, description: "ISO timestamp of the last modification. Auto-updated by beforeInsert; update on task_modify." },
    parent: { type: "string" as const, description: "UUID of the parent task (for recurrence instances — the template UUID)." },
    has_doc: { type: "boolean" as const, description: "True if task has an attached markdown document (task_doc_read/write). Discoverable via filter `+doc`." },
  },

  indexes: ["status", "project", "priority"],
  arrayIndexes: ["tags", "depends"],

  virtualFilters: {
    "+OVERDUE": (t: Record<string, unknown>) => t.status === "pending" && !!t.due && isOverdue(t.due as string),
    "+ACTIVE": (t: Record<string, unknown>) => t.status === "pending" && !!t.start,
    "+BLOCKED": (t: Record<string, unknown>, getter?: (uuid: string) => Record<string, unknown> | undefined) => {
      const deps = t.depends as string[] | undefined;
      if (!deps || deps.length === 0) return false;
      return deps.some((uuid) => {
        const dep = getter?.(uuid);
        return !dep || (dep.status !== "completed" && dep.status !== "deleted");
      });
    },
    "+UNBLOCKED": (t: Record<string, unknown>, getter?: (uuid: string) => Record<string, unknown> | undefined) => {
      const deps = t.depends as string[] | undefined;
      if (!deps || deps.length === 0) return true;
      return deps.every((uuid) => {
        const dep = getter?.(uuid);
        return dep && (dep.status === "completed" || dep.status === "deleted");
      });
    },
    "+READY": (t: Record<string, unknown>, getter?: (uuid: string) => Record<string, unknown> | undefined) => {
      if (t.status !== "pending" || t.start) return false;
      if (t.scheduled && new Date(t.scheduled as string) > new Date()) return false;
      const deps = t.depends as string[] | undefined;
      if (!deps || deps.length === 0) return true;
      return deps.every((uuid) => {
        const dep = getter?.(uuid);
        return dep && (dep.status === "completed" || dep.status === "deleted");
      });
    },
    "+WAITING": (t: Record<string, unknown>) => t.status === "pending" && !!t.wait && new Date(t.wait as string) > new Date(),
    "+PENDING": (t: Record<string, unknown>) => t.status === "pending",
    "+COMPLETED": (t: Record<string, unknown>) => t.status === "completed",
    "+DELETED": (t: Record<string, unknown>) => t.status === "deleted",
    "+RECURRING": (t: Record<string, unknown>) => t.status === "recurring",
    "+TAGGED": (t: Record<string, unknown>) => !!((t.tags as string[])?.length),
    "+ANNOTATED": (t: Record<string, unknown>) => !!((t.annotations as unknown[])?.length),
    "+PROJECT": (t: Record<string, unknown>) => !!t.project,
    "+PRIORITY": (t: Record<string, unknown>) => !!t.priority,
    "+DUE": (t: Record<string, unknown>) => !!t.due,
    "+SCHEDULED": (t: Record<string, unknown>) => !!t.scheduled,
    "+TODAY": (t: Record<string, unknown>) => !!t.due && isDueToday(t.due as string),
    "+TOMORROW": (t: Record<string, unknown>) => !!t.due && isDueTomorrow(t.due as string),
    "+WEEK": (t: Record<string, unknown>) => !!t.due && isDueThisWeek(t.due as string),
    "+UDA": (t: Record<string, unknown>) => !!t.agent,
  },

  hooks: {
    beforeInsert: (record: Record<string, unknown>) => {
      const now = formatDate(new Date());
      if (!record.entry) record.entry = now;
      record.modified = now;
      return record;
    },
  },
};

/** Create a task collection schema with the given name. */
export function getTaskSchema(name: string) {
  return defineSchema({
    name,
    ...SCHEMA_DEF,
  });
}

/** Default task collection schema (named "tasks"). */
export const taskSchema = getTaskSchema("tasks");

