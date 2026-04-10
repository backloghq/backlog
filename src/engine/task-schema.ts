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
  tagField: "tags",
  textSearch: true,

  fields: {
    id: { type: "autoIncrement" },
    description: { type: "string", required: true, maxLength: 500 },
    status: { type: "enum", values: ["pending", "completed", "deleted", "recurring"], default: "pending" },
    priority: { type: "enum", values: ["H", "M", "L"] },
    project: { type: "string", pattern: /^[a-zA-Z0-9_-]+$/ },
    due: { type: "date", resolve: resolveDateField },
    wait: { type: "date", resolve: resolveDateField },
    scheduled: { type: "date", resolve: resolveDateField },
    until: { type: "date", resolve: resolveDateField },
    tags: { type: "string[]" },
    depends: { type: "string[]" },
    recur: { type: "string" },
    agent: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    entry: { type: "string" },
    modified: { type: "string" },
    parent: { type: "string" },
    has_doc: { type: "boolean" },
  },

  indexes: ["status", "project", "priority"],

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
