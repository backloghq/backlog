import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfig,
  ensureSetup,
  run,
  exportTasks,
  addTask,
  modifyTask,
  taskCommand,
  undo,
  getUnique,
  type TaskWarriorConfig,
} from "../src/taskwarrior.js";

function makeConfig(taskData: string): TaskWarriorConfig {
  return {
    taskBin: "task",
    taskData,
    taskRc: join(taskData, ".taskrc"),
  };
}

describe("getConfig", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("throws when TASKDATA is not set", () => {
    delete process.env.TASKDATA;
    expect(() => getConfig()).toThrow("TASKDATA environment variable is required");
  });

  it("returns config when TASKDATA is set", () => {
    process.env.TASKDATA = "/tmp/test-tasks";
    delete process.env.TASKRC;
    delete process.env.TASK_BIN;
    const config = getConfig();
    expect(config.taskData).toBe("/tmp/test-tasks");
    expect(config.taskRc).toBe("/tmp/test-tasks/.taskrc");
    expect(config.taskBin).toBe("task");
  });

  it("respects TASKRC and TASK_BIN env vars", () => {
    process.env.TASKDATA = "/tmp/test-tasks";
    process.env.TASKRC = "/tmp/custom.taskrc";
    process.env.TASK_BIN = "/usr/local/bin/task";
    const config = getConfig();
    expect(config.taskRc).toBe("/tmp/custom.taskrc");
    expect(config.taskBin).toBe("/usr/local/bin/task");
  });
});

describe("ensureSetup", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tw-mcp-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates data directory and .taskrc", async () => {
    const dataDir = join(tmpDir, "nested", "data");
    const config = makeConfig(dataDir);
    await ensureSetup(config);

    const rcContent = await readFile(config.taskRc, "utf-8");
    expect(rcContent).toContain("data.location=");
    expect(rcContent).toContain("confirmation=off");
  });

  it("does not overwrite existing .taskrc", async () => {
    const config = makeConfig(tmpDir);
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(config.taskRc, "custom config\n", "utf-8");

    await ensureSetup(config);

    const rcContent = await readFile(config.taskRc, "utf-8");
    expect(rcContent).toBe("custom config\n");
  });
});

describe("TaskWarrior CLI integration", () => {
  let tmpDir: string;
  let config: TaskWarriorConfig;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tw-mcp-test-"));
    config = makeConfig(tmpDir);
    await ensureSetup(config);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("run", () => {
    it("executes a task command successfully", async () => {
      const result = await run(config, ["_version"]);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("rejects on command that produces stderr", async () => {
      // First add a task so we have a valid ID to modify
      await addTask(config, "temp", {});
      // Invalid date format produces exit code 2 with stderr
      await expect(run(config, ["1", "modify", "due:invalid-date-xyz"])).rejects.toThrow(
        "is not a valid date"
      );
    });

    it("resolves for no matching tasks (exit code 1, no stderr)", async () => {
      const result = await run(config, ["999999", "export"]);
      expect(result.stdout).toBeDefined();
    });
  });

  describe("addTask + exportTasks", () => {
    it("adds a task and retrieves it", async () => {
      await addTask(config, "Test task one", {});
      const tasks = await exportTasks(config, "");
      expect(tasks).toHaveLength(1);
      expect((tasks[0] as Record<string, unknown>).description).toBe("Test task one");
    });

    it("adds a task with project and priority", async () => {
      await addTask(config, "Important task", { project: "backend", priority: "H" });
      const tasks = await exportTasks(config, "");
      const task = tasks[0] as Record<string, unknown>;
      expect(task.description).toBe("Important task");
      expect(task.project).toBe("backend");
      expect(task.priority).toBe("H");
    });

    it("adds a task with tags", async () => {
      await addTask(config, "Tagged task", {}, ["+bug", "+urgent"]);
      const tasks = await exportTasks(config, "");
      const task = tasks[0] as Record<string, unknown>;
      expect(task.tags).toContain("bug");
      expect(task.tags).toContain("urgent");
    });

    it("adds multiple tasks", async () => {
      await addTask(config, "Task one", {});
      await addTask(config, "Task two", {});
      await addTask(config, "Task three", {});
      const tasks = await exportTasks(config, "");
      expect(tasks).toHaveLength(3);
    });
  });

  describe("exportTasks with filters", () => {
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
      expect((tasks[0] as Record<string, unknown>).description).toBe("Backend task");
    });

    it("filters by priority", async () => {
      const tasks = await exportTasks(config, "priority:H");
      expect(tasks).toHaveLength(1);
    });

    it("returns empty array for no matches", async () => {
      const tasks = await exportTasks(config, "project:nonexistent");
      expect(tasks).toHaveLength(0);
    });
  });

  describe("modifyTask", () => {
    it("modifies task description", async () => {
      await addTask(config, "Original description", {});
      await modifyTask(config, "1", { description: "Updated description" });
      const tasks = await exportTasks(config, "");
      expect((tasks[0] as Record<string, unknown>).description).toBe("Updated description");
    });

    it("modifies task project", async () => {
      await addTask(config, "Some task", {});
      await modifyTask(config, "1", { project: "new-project" });
      const tasks = await exportTasks(config, "");
      expect((tasks[0] as Record<string, unknown>).project).toBe("new-project");
    });
  });

  describe("taskCommand", () => {
    it("marks task as done", async () => {
      await addTask(config, "Complete me", {});
      await taskCommand(config, "1", "done");
      const pending = await exportTasks(config, "status:pending");
      expect(pending).toHaveLength(0);
      const completed = await exportTasks(config, "status:completed");
      expect(completed).toHaveLength(1);
    });

    it("deletes a task", async () => {
      await addTask(config, "Delete me", {});
      await taskCommand(config, "1", "delete");
      const pending = await exportTasks(config, "status:pending");
      expect(pending).toHaveLength(0);
    });

    it("annotates a task", async () => {
      await addTask(config, "Annotate me", {});
      await taskCommand(config, "1", "annotate", ["This is a note"]);
      const tasks = await exportTasks(config, "");
      const task = tasks[0] as Record<string, unknown>;
      const annotations = task.annotations as Array<Record<string, unknown>>;
      expect(annotations).toHaveLength(1);
      expect(annotations[0].description).toBe("This is a note");
    });

    it("starts and stops a task", async () => {
      await addTask(config, "Work on me", {});
      await taskCommand(config, "1", "start");
      let tasks = await exportTasks(config, "");
      expect((tasks[0] as Record<string, unknown>).start).toBeTruthy();

      await taskCommand(config, "1", "stop");
      tasks = await exportTasks(config, "");
      expect((tasks[0] as Record<string, unknown>).start).toBeFalsy();
    });
  });

  describe("undo", () => {
    it("undoes the last modification", async () => {
      await addTask(config, "Undo test", {});
      await taskCommand(config, "1", "done");
      const completedBefore = await exportTasks(config, "status:completed");
      expect(completedBefore).toHaveLength(1);

      await undo(config);
      const completedAfter = await exportTasks(config, "status:completed");
      expect(completedAfter).toHaveLength(0);
      const pending = await exportTasks(config, "status:pending");
      expect(pending).toHaveLength(1);
    });
  });

  describe("getUnique", () => {
    beforeEach(async () => {
      await addTask(config, "Task A", { project: "web" }, ["+frontend"]);
      await addTask(config, "Task B", { project: "api" }, ["+backend"]);
      await addTask(config, "Task C", { project: "web" }, ["+frontend"]);
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
});
