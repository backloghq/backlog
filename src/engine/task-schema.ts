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

export const taskSchema = defineSchema({
  name: "tasks",
  version: 1,
  description: "Persistent tasks for Claude Code agents — survive across sessions so work started by one agent can be picked up by another. Each task has a description, status lifecycle, optional priority, project grouping, dates, tags, dependencies, and cross-session agent ownership.",
  instructions: "Status flow: pending → (start/stop to toggle active work) → completed or deleted. 'recurring' is a template that spawns new pending instances on `recur` pattern. Always set `agent` when a task belongs to a specific agent team member. Use `depends` (array of task UUIDs) to model blocking relationships — virtual tag `+BLOCKED` shows tasks with unresolved dependencies, `+READY` shows tasks that can start now. Dates (`due`, `wait`, `scheduled`, `until`) accept natural-language input ('tomorrow', 'next friday', '2w') and are normalised to ISO strings. `has_doc` indicates an attached markdown document — write via `task_doc_write`.",
  tagField: "tags",
  textSearch: true,

  fields: {
    id: { type: "autoIncrement", description: "Stable short numeric ID for humans (1, 2, 3...). UUIDs are the primary key; this is for CLI/display." },
    description: { type: "string", required: true, maxLength: 500, description: "Free-text task description. First line shown in listings; can be multi-line." },
    status: { type: "enum", values: ["pending", "completed", "deleted", "recurring"], default: "pending", description: "Lifecycle state. 'recurring' is a template that generates pending instances on its `recur` schedule." },
    priority: { type: "enum", values: ["H", "M", "L"], description: "H=high/urgent, M=medium/normal, L=low/backlog. Affects urgency score and default sort order." },
    project: { type: "string", pattern: /^[a-zA-Z0-9_-]+$/, description: "Project name for grouping (alphanumeric, hyphens, underscores). E.g. 'backend', 'auth-refactor'." },
    due: { type: "date", resolve: resolveDateField, description: "Due date. Accepts ISO, relative ('3d', '2w'), named ('tomorrow', 'friday', 'eow', 'eom'), compound ('now+3d'). +OVERDUE virtual tag matches past-due pending tasks." },
    wait: { type: "date", resolve: resolveDateField, description: "Wait date — task is hidden from default views until this date passes." },
    scheduled: { type: "date", resolve: resolveDateField, description: "Scheduled start date — when work should begin. +READY excludes tasks scheduled for the future." },
    until: { type: "date", resolve: resolveDateField, description: "End date for recurrence — no instances generated past this date. Only meaningful with `recur`." },
    tags: { type: "string[]", description: "Freeform labels. Queryable with +tag (contains) or -tag (excludes)." },
    depends: { type: "string[]", description: "UUIDs of tasks this depends on. Task shows as +BLOCKED until dependencies complete." },
    recur: { type: "string", description: "Recurrence pattern: 'daily', 'weekly', 'weekdays', 'biweekly', 'monthly', 'quarterly', 'yearly', or numeric like '3d', '2w'. Requires `due`." },
    agent: { type: "string", description: "Agent identity for team ownership. E.g. 'explorer', 'planner', 'reviewer'. Set on task creation or via task_modify." },
    // annotations stored as array of {entry, description} — no schema type constraint (AgentDB allows extra fields)
    start: { type: "string", description: "ISO timestamp when work started (task_start). Cleared by task_stop." },
    end: { type: "string", description: "ISO timestamp when the task completed or was deleted." },
    entry: { type: "string", description: "ISO timestamp when the task was created. Auto-set by beforeInsert." },
    modified: { type: "string", description: "ISO timestamp of the last modification. Auto-updated by beforeInsert; update on task_modify." },
    parent: { type: "string", description: "UUID of the parent task (for recurrence instances — the template UUID)." },
    has_doc: { type: "boolean", description: "True if task has an attached markdown document (task_doc_read/write). Discoverable via filter `+doc`." },
  },

  indexes: ["status", "project", "priority"],
  arrayIndexes: ["tags", "depends"],

  virtualFilters: {
    "+OVERDUE": (t) => t.status === "pending" && !!t.due && isOverdue(t.due as string),
    "+ACTIVE": (t) => t.status === "pending" && !!t.start,
    "+BLOCKED": (t, getter) => {
      const deps = t.depends as string[] | undefined;
      if (!deps || deps.length === 0) return false;
      return deps.some((uuid) => {
        const dep = getter?.(uuid);
        return !dep || (dep.status !== "completed" && dep.status !== "deleted");
      });
    },
    "+UNBLOCKED": (t, getter) => {
      const deps = t.depends as string[] | undefined;
      if (!deps || deps.length === 0) return true;
      return deps.every((uuid) => {
        const dep = getter?.(uuid);
        return dep && (dep.status === "completed" || dep.status === "deleted");
      });
    },
    "+READY": (t, getter) => {
      if (t.status !== "pending" || t.start) return false;
      if (t.scheduled && new Date(t.scheduled as string) > new Date()) return false;
      const deps = t.depends as string[] | undefined;
      if (!deps || deps.length === 0) return true;
      return deps.every((uuid) => {
        const dep = getter?.(uuid);
        return dep && (dep.status === "completed" || dep.status === "deleted");
      });
    },
    "+BLOCKING": () => {
      // Blocking status requires scanning all tasks — computed in urgency instead
      return false;
    },
    "+WAITING": (t) => t.status === "pending" && !!t.wait && new Date(t.wait as string) > new Date(),
    "+PENDING": (t) => t.status === "pending",
    "+COMPLETED": (t) => t.status === "completed",
    "+DELETED": (t) => t.status === "deleted",
    "+RECURRING": (t) => t.status === "recurring",
    "+TAGGED": (t) => !!((t.tags as string[])?.length),
    "+ANNOTATED": (t) => !!((t.annotations as unknown[])?.length),
    "+PROJECT": (t) => !!t.project,
    "+PRIORITY": (t) => !!t.priority,
    "+DUE": (t) => !!t.due,
    "+SCHEDULED": (t) => !!t.scheduled,
    "+TODAY": (t) => !!t.due && isDueToday(t.due as string),
    "+TOMORROW": (t) => !!t.due && isDueTomorrow(t.due as string),
    "+WEEK": (t) => !!t.due && isDueThisWeek(t.due as string),
    "+UDA": (t) => !!t.agent,
  },

  hooks: {
    beforeInsert: (record) => {
      const now = formatDate(new Date());
      if (!record.entry) record.entry = now;
      record.modified = now;
      return record;
    },
  },
});
