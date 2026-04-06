import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfig,
  deriveProjectSlug,
  ensureSetup,
  shutdown,
  exportTasks,
  addTask,
  modifyTask,
  taskCommand,
  undo,
  getUnique,
  importTasks,
  countTasks,
  logTask,
  duplicateTask,
  writeDoc,
  readDoc,
  deleteDoc,
  archiveTasks,
  loadArchivedTasks,
  listArchiveSegments,
  type EngineConfig,
} from "../src/engine/index.js";
describe("Engine config", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("throws when neither TASKDATA nor TASKDATA_ROOT is set", () => {
    delete process.env.TASKDATA;
    delete process.env.TASKDATA_ROOT;
    expect(() => getConfig()).toThrow("TASKDATA or TASKDATA_ROOT");
  });

  it("returns config when TASKDATA is set", () => {
    process.env.TASKDATA = "/tmp/test-tasks";
    delete process.env.TASKDATA_ROOT;
    const config = getConfig();
    expect(config.dataDir).toBe("/tmp/test-tasks");
  });

  it("derives from TASKDATA_ROOT and CWD", () => {
    delete process.env.TASKDATA;
    process.env.TASKDATA_ROOT = "/tmp/projects";
    const config = getConfig();
    expect(config.dataDir).toMatch(/^\/tmp\/projects\/.+-[a-f0-9]{8}$/);
  });

  it("prefers TASKDATA over TASKDATA_ROOT", () => {
    process.env.TASKDATA = "/tmp/explicit";
    process.env.TASKDATA_ROOT = "/tmp/projects";
    expect(getConfig().dataDir).toBe("/tmp/explicit");
  });

  it("derives consistent slugs", () => {
    expect(deriveProjectSlug("/home/user/dev/proj")).toBe(deriveProjectSlug("/home/user/dev/proj"));
  });

  it("derives different slugs for different paths", () => {
    expect(deriveProjectSlug("/a")).not.toBe(deriveProjectSlug("/b"));
  });
});

describe("Engine operations", () => {
  let tmpDir: string;
  let config: EngineConfig;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "engine-test-"));
    config = { dataDir: tmpDir };
    await ensureSetup(config);
  });

  afterEach(async () => {
    await shutdown();
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("addTask + exportTasks", () => {
    it("adds and retrieves a task", async () => {
      await addTask(config, "Test task", {});
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Test task");
      expect(tasks[0].uuid).toBeDefined();
      expect(tasks[0].id).toBe(1);
    });

    it("adds with project and priority", async () => {
      await addTask(config, "Important", { project: "backend", priority: "H" });
      const tasks = await exportTasks(config, "");
      expect(tasks[0].project).toBe("backend");
      expect(tasks[0].priority).toBe("H");
    });

    it("adds with tags", async () => {
      await addTask(config, "Tagged", {}, ["+bug", "+urgent"]);
      const tasks = await exportTasks(config, "");
      expect(tasks[0].tags).toContain("bug");
      expect(tasks[0].tags).toContain("urgent");
    });

    it("adds with due date", async () => {
      await addTask(config, "Due soon", { due: "2099-12-31" });
      const tasks = await exportTasks(config, "");
      expect(tasks[0].due).toBeDefined();
    });

    it("adds multiple tasks with sequential IDs", async () => {
      await addTask(config, "One", {});
      await addTask(config, "Two", {});
      await addTask(config, "Three", {});
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(3);
      const ids = tasks.map((t) => t.id).sort();
      expect(ids).toEqual([1, 2, 3]);
    });

    it("IDs are stable after deletions", async () => {
      await addTask(config, "One", {});
      await addTask(config, "Two", {});
      await addTask(config, "Three", {});

      // Delete task 2
      await taskCommand(config, "2", "delete");

      // Task 1 and 3 keep their IDs
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(2);
      expect(tasks.find((t) => t.description === "One")?.id).toBe(1);
      expect(tasks.find((t) => t.description === "Three")?.id).toBe(3);

      // New task gets ID 4, not 3
      await addTask(config, "Four", {});
      const after = await exportTasks(config, "status:pending");
      expect(after.find((t) => t.description === "Four")?.id).toBe(4);
    });
  });

  describe("filters", () => {
    beforeEach(async () => {
      await addTask(config, "Frontend task", { project: "web", priority: "H" }, ["+frontend"]);
      await addTask(config, "Backend task", { project: "api", priority: "M" }, ["+backend"]);
      await addTask(config, "Docs task", { project: "web", priority: "L" }, ["+docs"]);
    });

    it("filters by project", async () => {
      const tasks = await exportTasks(config, "project:web");
      expect(tasks).toHaveLength(2);
    });

    it("filters by tag", async () => {
      const tasks = await exportTasks(config, "+backend");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Backend task");
    });

    it("filters by priority", async () => {
      const tasks = await exportTasks(config, "priority:H");
      expect(tasks).toHaveLength(1);
    });

    it("returns empty for no matches", async () => {
      const tasks = await exportTasks(config, "project:nonexistent");
      expect(tasks).toHaveLength(0);
    });

    it("supports implicit AND", async () => {
      const tasks = await exportTasks(config, "project:web +frontend");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Frontend task");
    });

    it("supports OR with parentheses", async () => {
      const tasks = await exportTasks(config, "( project:web or project:api )");
      expect(tasks).toHaveLength(3);
    });

    it("defaults to pending when filter is empty", async () => {
      await taskCommand(config, "1", "done");
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(2);
    });

    it("filters by description text", async () => {
      const tasks = await exportTasks(config, "Frontend");
      expect(tasks).toHaveLength(1);
    });
  });

  describe("modifyTask", () => {
    it("modifies description", async () => {
      await addTask(config, "Original", {});
      await modifyTask(config, "1", { description: "Updated" });
      const tasks = await exportTasks(config, "");
      expect(tasks[0].description).toBe("Updated");
    });

    it("modifies project", async () => {
      await addTask(config, "Task", {});
      await modifyTask(config, "1", { project: "new-project" });
      const tasks = await exportTasks(config, "");
      expect(tasks[0].project).toBe("new-project");
    });

    it("adds tags via extraArgs", async () => {
      await addTask(config, "Tag me", {});
      await modifyTask(config, "1", {}, ["+frontend", "+urgent"]);
      const tasks = await exportTasks(config, "+frontend");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].tags).toContain("urgent");
    });

    it("removes tags via extraArgs", async () => {
      await addTask(config, "Untag", {}, ["+old"]);
      await modifyTask(config, "1", {}, ["-old", "+new"]);
      const tasks = await exportTasks(config, "");
      expect(tasks[0].tags).not.toContain("old");
      expect(tasks[0].tags).toContain("new");
    });
  });

  describe("taskCommand", () => {
    it("marks done", async () => {
      await addTask(config, "Complete me", {});
      await taskCommand(config, "1", "done");
      expect(await exportTasks(config, "status:pending")).toHaveLength(0);
      expect(await exportTasks(config, "status:completed")).toHaveLength(1);
    });

    it("deletes", async () => {
      await addTask(config, "Delete me", {});
      await taskCommand(config, "1", "delete");
      expect(await exportTasks(config, "status:pending")).toHaveLength(0);
    });

    it("annotates", async () => {
      await addTask(config, "Annotate me", {});
      await taskCommand(config, "1", "annotate", ["This is a note"]);
      const tasks = await exportTasks(config, "");
      expect(tasks[0].annotations).toHaveLength(1);
      expect(tasks[0].annotations![0].description).toBe("This is a note");
    });

    it("denotates", async () => {
      await addTask(config, "Denotate", {});
      await taskCommand(config, "1", "annotate", ["Keep me"]);
      await taskCommand(config, "1", "annotate", ["Remove me"]);
      await taskCommand(config, "1", "denotate", ["Remove me"]);
      const tasks = await exportTasks(config, "");
      expect(tasks[0].annotations).toHaveLength(1);
      expect(tasks[0].annotations![0].description).toBe("Keep me");
    });

    it("starts and stops", async () => {
      await addTask(config, "Work on me", {});
      await taskCommand(config, "1", "start");
      let tasks = await exportTasks(config, "");
      expect(tasks[0].start).toBeTruthy();

      await taskCommand(config, "1", "stop");
      tasks = await exportTasks(config, "");
      expect(tasks[0].start).toBeFalsy();
    });

    it("purges deleted task", async () => {
      await addTask(config, "Purge me", {});
      const tasks = await exportTasks(config, "");
      const uuid = tasks[0].uuid;
      await taskCommand(config, "1", "delete");
      await taskCommand(config, uuid, "purge");
      expect(await exportTasks(config, "status:deleted")).toHaveLength(0);
    });
  });

  describe("undo", () => {
    it("undoes last action", async () => {
      await addTask(config, "Undo test", {});
      await taskCommand(config, "1", "done");
      expect(await exportTasks(config, "status:completed")).toHaveLength(1);

      await undo();
      expect(await exportTasks(config, "status:completed")).toHaveLength(0);
      expect(await exportTasks(config, "status:pending")).toHaveLength(1);
    });
  });

  describe("countTasks", () => {
    it("counts pending", async () => {
      await addTask(config, "One", {});
      await addTask(config, "Two", {});
      expect(await countTasks(config, "status:pending")).toBe(2);
    });

    it("counts with filter", async () => {
      await addTask(config, "A", { project: "alpha" });
      await addTask(config, "B", { project: "beta" });
      expect(await countTasks(config, "project:alpha")).toBe(1);
    });
  });

  describe("logTask", () => {
    it("creates completed task", async () => {
      await logTask(config, "Already done", { project: "test" });
      expect(await exportTasks(config, "status:pending")).toHaveLength(0);
      const completed = await exportTasks(config, "status:completed");
      expect(completed).toHaveLength(1);
      expect(completed[0].description).toBe("Already done");
    });

    it("supports tags", async () => {
      await logTask(config, "Tagged log", {}, ["+done", "+reviewed"]);
      const completed = await exportTasks(config, "status:completed");
      expect(completed[0].tags).toContain("done");
    });
  });

  describe("duplicateTask", () => {
    it("duplicates a task", async () => {
      await addTask(config, "Original", { project: "test", priority: "H" });
      await duplicateTask(config, "1", {});
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(2);
    });

    it("duplicates with modifications", async () => {
      await addTask(config, "Template", { project: "web" });
      await duplicateTask(config, "1", { description: "Variation", project: "api" });
      const tasks = await exportTasks(config, "project:api");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Variation");
    });
  });

  describe("getUnique", () => {
    beforeEach(async () => {
      await addTask(config, "A", { project: "web" }, ["+frontend"]);
      await addTask(config, "B", { project: "api" }, ["+backend"]);
      await addTask(config, "C", { project: "web" }, ["+frontend"]);
    });

    it("lists unique projects", async () => {
      const projects = await getUnique(config, "project");
      expect(projects).toContain("web");
      expect(projects).toContain("api");
      expect(projects).toHaveLength(2);
    });

    it("lists unique tags", async () => {
      const tags = await getUnique(config, "tags");
      expect(tags).toContain("frontend");
      expect(tags).toContain("backend");
      expect(tags).toHaveLength(2);
    });
  });

  describe("importTasks", () => {
    it("imports tasks from JSON", async () => {
      const json = JSON.stringify([
        { description: "Imported A", project: "test" },
        { description: "Imported B", project: "test" },
      ]);
      await importTasks(config, json);
      const tasks = await exportTasks(config, "project:test");
      expect(tasks).toHaveLength(2);
    });
  });

  describe("task docs", () => {
    it("writes and reads a doc", async () => {
      await addTask(config, "Doc test", {});
      await writeDoc(config, "1", "# Spec\n\nContent here.\n");
      const doc = await readDoc(config, "1");
      expect(doc).toBe("# Spec\n\nContent here.\n");
    });

    it("auto-tags task with +doc", async () => {
      await addTask(config, "Doc tag test", {});
      await writeDoc(config, "1", "Some doc");
      const tasks = await exportTasks(config, "+doc");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].has_doc).toBe("yes");
    });

    it("returns null for task without doc", async () => {
      await addTask(config, "No doc", {});
      const doc = await readDoc(config, "1");
      expect(doc).toBeNull();
    });

    it("deletes doc and removes markers", async () => {
      await addTask(config, "Delete doc", {});
      await writeDoc(config, "1", "To delete");
      await deleteDoc(config, "1");
      expect(await readDoc(config, "1")).toBeNull();
      const tasks = await exportTasks(config, "");
      expect(tasks[0].tags ?? []).not.toContain("doc");
    });

    it("creates doc file in docs/ subdirectory", async () => {
      await addTask(config, "File path test", {});
      await writeDoc(config, "1", "Content");
      const tasks = await exportTasks(config, "");
      const filePath = join(tmpDir, "docs", `${tasks[0].uuid}.md`);
      await access(filePath); // throws if missing
    });
  });

  describe("agent UDA", () => {
    it("supports agent attribute", async () => {
      await addTask(config, "Agent task", { agent: "explorer" });
      const tasks = await exportTasks(config, "");
      expect(tasks[0].agent).toBe("explorer");
    });

    it("filters by agent", async () => {
      await addTask(config, "Explorer task", { agent: "explorer" });
      await addTask(config, "Planner task", { agent: "planner" });
      const tasks = await exportTasks(config, "agent:explorer");
      expect(tasks).toHaveLength(1);
    });
  });

  describe("scheduled and recur", () => {
    it("adds with scheduled date", async () => {
      await addTask(config, "Scheduled", { scheduled: "2099-12-31" });
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks[0].scheduled).toBeDefined();
    });

    it("generates instances for recurring tasks", async () => {
      await addTask(config, "Daily standup", { due: "tomorrow", recur: "daily" });
      const all = await exportTasks(config, "");
      // Should have the template (recurring) + generated instances (pending)
      const template = all.find((t) => t.status === "recurring");
      const instances = all.filter((t) => t.status === "pending" && t.parent === template?.uuid);
      expect(template).toBeDefined();
      expect(instances.length).toBeGreaterThanOrEqual(1);
      expect(instances[0].description).toBe("Daily standup");
    });

    it("does not generate more than limit instances", async () => {
      await addTask(config, "Weekly review", { due: "tomorrow", recur: "weekly" });
      const all = await exportTasks(config, "");
      const template = all.find((t) => t.status === "recurring");
      const instances = all.filter((t) => t.status === "pending" && t.parent === template?.uuid);
      expect(instances.length).toBeLessThanOrEqual(3);
    });

    it("completing an instance allows new generation", async () => {
      await addTask(config, "Recurring task", { due: "tomorrow", recur: "daily" });
      let all = await exportTasks(config, "");
      const template = all.find((t) => t.status === "recurring")!;
      const firstInstance = all.find((t) => t.parent === template.uuid)!;

      await taskCommand(config, String(firstInstance.id), "done");

      all = await exportTasks(config, "");
      const pending = all.filter((t) => t.parent === template.uuid && t.status === "pending");
      expect(pending.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("virtual tags", () => {
    it("+ACTIVE filters started tasks", async () => {
      await addTask(config, "Active", {});
      await addTask(config, "Inactive", {});
      await taskCommand(config, "1", "start");
      const tasks = await exportTasks(config, "+ACTIVE");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Active");
    });

    it("+BLOCKED filters tasks with pending deps", async () => {
      await addTask(config, "Blocker", {});
      const blockerTasks = await exportTasks(config, "");
      const blockerUuid = blockerTasks[0].uuid;
      await addTask(config, "Blocked", { depends: blockerUuid });
      const tasks = await exportTasks(config, "+BLOCKED");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Blocked");
    });

    it("+ANNOTATED filters annotated tasks", async () => {
      await addTask(config, "Has note", {});
      await addTask(config, "No note", {});
      await taskCommand(config, "1", "annotate", ["A note"]);
      const tasks = await exportTasks(config, "+ANNOTATED");
      expect(tasks).toHaveLength(1);
    });

    it("+TAGGED filters tasks with tags", async () => {
      await addTask(config, "Tagged", {}, ["+bug"]);
      await addTask(config, "Untagged", {});
      const tasks = await exportTasks(config, "+TAGGED");
      expect(tasks).toHaveLength(1);
    });
  });

  describe("urgency", () => {
    it("calculates urgency score", async () => {
      await addTask(config, "High priority", { priority: "H" });
      const tasks = await exportTasks(config, "");
      expect(tasks[0].urgency).toBeGreaterThan(0);
    });

    it("higher priority = higher urgency", async () => {
      await addTask(config, "High", { priority: "H" });
      await addTask(config, "Low", { priority: "L" });
      const tasks = await exportTasks(config, "");
      const high = tasks.find((t) => t.description === "High")!;
      const low = tasks.find((t) => t.description === "Low")!;
      expect(high.urgency!).toBeGreaterThan(low.urgency!);
    });
  });

  describe("persistence", () => {
    it("survives shutdown and reopen", async () => {
      await addTask(config, "Persistent", { project: "test" });
      await shutdown();

      await ensureSetup(config);
      const tasks = await exportTasks(config, "");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe("Persistent");
      expect(tasks[0].project).toBe("test");
    });
  });

  describe("archive", () => {
    it("archives completed tasks older than threshold", async () => {
      await addTask(config, "Old task", {});
      await taskCommand(config, "1", "done");

      // Backdate via modify — set end to 100 days ago
      const tasks = await exportTasks(config, "status:completed");
      const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
      await modifyTask(config, tasks[0].uuid, { end: oldDate });

      const result = await archiveTasks(config, 90);
      expect(result).toContain("Archived 1");

      const remaining = await exportTasks(config, "status:completed");
      expect(remaining).toHaveLength(0);
    });

    it("returns message when nothing to archive", async () => {
      const result = await archiveTasks(config, 90);
      expect(result).toBe("No tasks to archive.");
    });

    it("lists and loads archive segments", async () => {
      await addTask(config, "To archive", {});
      await taskCommand(config, "1", "done");
      const tasks = await exportTasks(config, "status:completed");
      const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
      await modifyTask(config, tasks[0].uuid, { end: oldDate });
      await archiveTasks(config, 90);

      const segments = listArchiveSegments();
      expect(segments.length).toBeGreaterThan(0);

      const archived = await loadArchivedTasks(config, segments[0]);
      expect(archived.length).toBeGreaterThan(0);
    });
  });

  describe("input validation", () => {
    it("rejects empty description", async () => {
      await expect(addTask(config, "", {})).rejects.toThrow("Description cannot be empty");
    });

    it("rejects description over 500 chars", async () => {
      await expect(addTask(config, "x".repeat(501), {})).rejects.toThrow("under 500 characters");
    });

    it("rejects invalid project name", async () => {
      await expect(addTask(config, "Test", { project: "has spaces" })).rejects.toThrow("letters, numbers, hyphens");
    });

    it("rejects invalid date", async () => {
      await expect(addTask(config, "Test", { due: "not-a-date-xyz" })).rejects.toThrow("Invalid due date");
    });

    it("rejects invalid dependency UUID", async () => {
      await expect(addTask(config, "Test", { depends: "not-a-uuid" })).rejects.toThrow("Invalid dependency UUID");
    });

    it("accepts valid inputs", async () => {
      await addTask(config, "Valid task", { project: "my-project", priority: "H", due: "friday" });
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(1);
    });
  });

  describe("sync queue", () => {
    it("drains TaskCreated sync entries on next read", async () => {
      // Simulate what the hook script writes
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(
        join(tmpDir, "sync-queue.jsonl"),
        '{"subject":"Synced from TaskCreate"}\n{"subject":"Another synced task","agent":"planner"}\n',
        "utf-8",
      );

      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(2);
      expect(tasks.find((t) => t.description === "Synced from TaskCreate")).toBeDefined();
      const planned = tasks.find((t) => t.description === "Another synced task");
      expect(planned?.agent).toBe("planner");
    });

    it("drains TaskCompleted sync entries on next read", async () => {
      await addTask(config, "Will be completed externally", {});

      const { writeFile: wf } = await import("node:fs/promises");
      await wf(
        join(tmpDir, "sync-queue.jsonl"),
        '{"completed":"Will be completed externally"}\n',
        "utf-8",
      );

      const pending = await exportTasks(config, "status:pending");
      expect(pending).toHaveLength(0);
      const completed = await exportTasks(config, "status:completed");
      expect(completed).toHaveLength(1);
    });

    it("cleans up queue file after draining", async () => {
      const { writeFile: wf, access: ac } = await import("node:fs/promises");
      const queuePath = join(tmpDir, "sync-queue.jsonl");
      await wf(queuePath, '{"subject":"Temp task"}\n', "utf-8");

      await exportTasks(config, "");

      await expect(ac(queuePath)).rejects.toThrow();
    });

    it("drains SubagentStart sync entries — assigns unassigned tasks", async () => {
      await addTask(config, "Unassigned task", {});
      await addTask(config, "Already assigned", { agent: "planner" });

      const { writeFile: wf } = await import("node:fs/promises");
      await wf(
        join(tmpDir, "sync-queue.jsonl"),
        '{"subagent_start":"explorer"}\n',
        "utf-8",
      );

      const tasks = await exportTasks(config, "status:pending");
      const unassigned = tasks.find((t) => t.description === "Unassigned task");
      const assigned = tasks.find((t) => t.description === "Already assigned");
      expect(unassigned?.agent).toBe("explorer");
      expect(assigned?.agent).toBe("planner"); // unchanged
    });

    it("handles empty or missing queue file gracefully", async () => {
      const tasks = await exportTasks(config, "status:pending");
      expect(tasks).toHaveLength(0); // No crash, no tasks
    });
  });
});
