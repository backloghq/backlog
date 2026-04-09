import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ensureSetup,
  shutdown,
  type EngineConfig,
} from "../src/engine/index.js";
import { createServer } from "../src/index.js";

function makeConfig(taskData: string): EngineConfig {
  return { dataDir: taskData };
}

function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

function parseContent(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  // Tools with outputSchema return structuredContent
  const sc = result.structuredContent as Record<string, unknown> | undefined;
  if (sc) {
    if ("tasks" in sc) return sc.tasks;
    if ("items" in sc) return sc.items;
    if ("count" in sc) return sc.count;
    if ("message" in sc) return sc.message;
    if ("content" in sc) return sc.content;
    return sc;
  }
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

function parseTask(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const tasks = parseContent(result) as Array<Record<string, unknown>>;
  return tasks[0];
}

describe("MCP Server integration", () => {
  let tmpDir: string;
  let config: EngineConfig;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tw-mcp-server-test-"));
    config = makeConfig(tmpDir);
    await ensureSetup(config);

    const server = createServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await shutdown();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists available tools", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("task_list");
    expect(names).toContain("task_add");
    expect(names).toContain("task_modify");
    expect(names).toContain("task_done");
    expect(names).toContain("task_delete");
    expect(names).toContain("task_annotate");
    expect(names).toContain("task_start");
    expect(names).toContain("task_stop");
    expect(names).toContain("task_undo");
    expect(names).toContain("task_info");
    expect(names).toContain("task_projects");
    expect(names).toContain("task_tags");
    expect(names).toContain("task_denotate");
    expect(names).toContain("task_purge");
    expect(names).toContain("task_import");
    expect(names).toContain("task_count");
    expect(names).toContain("task_log");
    expect(names).toContain("task_duplicate");
    expect(names).toContain("task_doc_write");
    expect(names).toContain("task_doc_read");
    expect(names).toContain("task_doc_delete");
    expect(names).toContain("task_archive");
    expect(names).toContain("task_archive_list");
    expect(names).toContain("task_archive_load");
    expect(names).toHaveLength(24);
  });

  it("defaults to pending tasks when filter is empty", async () => {
    await call(client, "task_add", { description: "Pending task" });
    await call(client, "task_add", { description: "Done task" });
    await call(client, "task_done", { id: "2" });

    const result = await call(client, "task_list", { filter: "" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Pending task");
  });

  it("adds and lists a task", async () => {
    await call(client, "task_add", {
      description: "Test task from MCP",
      project: "testing",
      priority: "H",
    });

    const result = await call(client, "task_list", { filter: "" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Test task from MCP");
    expect(tasks[0].project).toBe("testing");
    expect(tasks[0].priority).toBe("H");
  });

  it("adds a task with tags", async () => {
    await call(client, "task_add", {
      description: "Tagged task",
      tags: "bug,urgent",
    });

    const result = await call(client, "task_list", { filter: "+bug" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toContain("bug");
    expect(tasks[0].tags).toContain("urgent");
  });

  it("adds a task with tags as JSON array string", async () => {
    await call(client, "task_add", {
      description: "JSON tags",
      tags: '["alpha", "beta"]',
    });

    const result = await call(client, "task_list", { filter: "+alpha" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toContain("alpha");
    expect(tasks[0].tags).toContain("beta");
  });

  it("modifies a task", async () => {
    await call(client, "task_add", { description: "Original" });
    await call(client, "task_modify", {
      filter: "1",
      description: "Modified",
      project: "new-project",
    });

    const result = await call(client, "task_list", { filter: "" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks[0].description).toBe("Modified");
    expect(tasks[0].project).toBe("new-project");
  });

  it("modifies a task with tags", async () => {
    await call(client, "task_add", { description: "Tag me" });
    await call(client, "task_modify", {
      filter: "1",
      tags: "frontend,urgent",
    });

    const result = await call(client, "task_list", { filter: "+frontend" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toContain("frontend");
    expect(tasks[0].tags).toContain("urgent");
  });

  it("completes a task", async () => {
    await call(client, "task_add", { description: "Complete me" });
    await call(client, "task_done", { id: "1" });

    const result = await call(client, "task_list", { filter: "status:pending" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(0);
  });

  it("deletes a task", async () => {
    await call(client, "task_add", { description: "Delete me" });
    await call(client, "task_delete", { id: "1" });

    const result = await call(client, "task_list", { filter: "status:pending" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(0);
  });

  it("annotates a task", async () => {
    await call(client, "task_add", { description: "Annotate me" });
    await call(client, "task_annotate", { id: "1", text: "Important context" });

    const result = await call(client, "task_info", { id: "1" });
    const task = parseTask(result);
    const annotations = task.annotations as Array<Record<string, unknown>>;
    expect(annotations).toHaveLength(1);
    expect(annotations[0].description).toBe("Important context");
  });

  it("starts and stops a task", async () => {
    await call(client, "task_add", { description: "Work on me" });
    await call(client, "task_start", { id: "1" });

    let result = await call(client, "task_info", { id: "1" });
    let task = parseTask(result);
    expect(task.start).toBeTruthy();

    await call(client, "task_stop", { id: "1" });

    result = await call(client, "task_info", { id: "1" });
    task = parseTask(result);
    expect(task.start).toBeFalsy();
  });

  it("undoes last action", async () => {
    await call(client, "task_add", { description: "Undo test" });
    await call(client, "task_done", { id: "1" });
    await call(client, "task_undo");

    const result = await call(client, "task_list", { filter: "status:pending" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(1);
  });

  it("adds a task with extra attributes", async () => {
    await call(client, "task_add", {
      description: "Extra test",
      extra: "+experimental scheduled:tomorrow",
    });

    const result = await call(client, "task_list", { filter: "+experimental" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toContain("experimental");
  });

  it("adds a task with due date", async () => {
    await call(client, "task_add", {
      description: "Due soon",
      due: "2099-12-31",
    });

    const result = await call(client, "task_list", { filter: "" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].due).toBeDefined();
  });

  it("modifies a task with extra attributes", async () => {
    await call(client, "task_add", { description: "Modify extra" });
    await call(client, "task_modify", {
      filter: "1",
      extra: "+hotfix",
    });

    const result = await call(client, "task_list", { filter: "+hotfix" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(1);
  });

  it("returns task info", async () => {
    await call(client, "task_add", {
      description: "Info test",
      project: "myproj",
      priority: "M",
    });

    const result = await call(client, "task_info", { id: "1" });
    const task = parseTask(result);
    expect(task.description).toBe("Info test");
    expect(task.project).toBe("myproj");
    expect(task.priority).toBe("M");
    expect(task.uuid).toBeDefined();
  });

  it("returns error for non-existent task info", async () => {
    const result = await call(client, "task_info", { id: "999999" });
    expect(result.isError).toBe(true);
  });

  it("lists projects", async () => {
    await call(client, "task_add", { description: "A", project: "alpha" });
    await call(client, "task_add", { description: "B", project: "beta" });

    const result = await call(client, "task_projects");
    const projects = parseContent(result) as string[];
    expect(projects).toContain("alpha");
    expect(projects).toContain("beta");
  });

  it("lists tags", async () => {
    await call(client, "task_add", { description: "A", tags: "frontend" });
    await call(client, "task_add", { description: "B", tags: "backend" });

    const result = await call(client, "task_tags");
    const tags = parseContent(result) as string[];
    expect(tags).toContain("frontend");
    expect(tags).toContain("backend");
  });

  it("filters tasks by project", async () => {
    await call(client, "task_add", { description: "A", project: "web" });
    await call(client, "task_add", { description: "B", project: "api" });
    await call(client, "task_add", { description: "C", project: "web" });

    const result = await call(client, "task_list", { filter: "project:web" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(2);
  });

  it("returns empty list for no matches", async () => {
    const result = await call(client, "task_list", { filter: "project:nonexistent" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(0);
  });

  it("denotates (removes annotation from) a task", async () => {
    await call(client, "task_add", { description: "Denotate test" });
    await call(client, "task_annotate", { id: "1", text: "Remove me" });
    await call(client, "task_annotate", { id: "1", text: "Keep me" });

    await call(client, "task_denotate", { id: "1", text: "Remove me" });

    const result = await call(client, "task_info", { id: "1" });
    const task = parseTask(result);
    const annotations = task.annotations as Array<Record<string, unknown>>;
    expect(annotations).toHaveLength(1);
    expect(annotations[0].description).toBe("Keep me");
  });

  it("purges a deleted task", async () => {
    await call(client, "task_add", { description: "Purge me" });
    // Get UUID before deleting (deleted tasks lose their numeric ID)
    const infoResult = await call(client, "task_info", { id: "1" });
    const uuid = parseTask(infoResult).uuid as string;

    await call(client, "task_delete", { id: "1" });
    await call(client, "task_purge", { id: uuid });

    const result = await call(client, "task_list", { filter: "status:deleted" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(0);
  });

  it("imports tasks from JSON", async () => {
    const tasksJson = JSON.stringify([
      { description: "Imported A", project: "import-test" },
      { description: "Imported B", project: "import-test" },
    ]);

    await call(client, "task_import", { tasks: tasksJson });

    const result = await call(client, "task_list", { filter: "project:import-test" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(2);
  });

  it("adds a task with agent UDA", async () => {
    await call(client, "task_add", {
      description: "Agent-assigned task",
      agent: "explorer",
    });

    const result = await call(client, "task_info", { id: "1" });
    const task = parseTask(result);
    expect(task.agent).toBe("explorer");
  });

  it("filters tasks by agent UDA", async () => {
    await call(client, "task_add", { description: "A", agent: "explorer" });
    await call(client, "task_add", { description: "B", agent: "planner" });
    await call(client, "task_add", { description: "C", agent: "explorer" });

    const result = await call(client, "task_list", { filter: "agent:explorer" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks).toHaveLength(2);
  });

  it("modifies agent UDA on a task", async () => {
    await call(client, "task_add", { description: "Reassign me", agent: "explorer" });
    await call(client, "task_modify", { filter: "1", agent: "reviewer" });

    const result = await call(client, "task_info", { id: "1" });
    const task = parseTask(result);
    expect(task.agent).toBe("reviewer");
  });

  it("counts tasks", async () => {
    await call(client, "task_add", { description: "A" });
    await call(client, "task_add", { description: "B" });
    await call(client, "task_add", { description: "C", project: "special" });

    const allResult = await call(client, "task_count", { filter: "" });
    expect((allResult.structuredContent as Record<string, unknown>).count).toBe(3);

    const filteredResult = await call(client, "task_count", { filter: "project:special" });
    expect((filteredResult.structuredContent as Record<string, unknown>).count).toBe(1);
  });

  it("logs a completed task", async () => {
    await call(client, "task_log", {
      description: "Already finished work",
      project: "done-stuff",
      tags: "retroactive",
    });

    const pending = await call(client, "task_list", { filter: "status:pending" });
    expect(parseContent(pending) as Array<unknown>).toHaveLength(0);

    const completed = await call(client, "task_list", { filter: "status:completed" });
    const tasks = parseContent(completed) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Already finished work");
    expect(tasks[0].tags).toContain("retroactive");
  });

  it("duplicates a task with modifications", async () => {
    await call(client, "task_add", {
      description: "Template task",
      project: "web",
      priority: "M",
    });

    await call(client, "task_duplicate", {
      id: "1",
      description: "Cloned task",
      project: "api",
    });

    const result = await call(client, "task_list", { filter: "project:api" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Cloned task");
    expect(tasks[0].priority).toBe("M"); // inherited from original
  });

  it("adds a task with scheduled date", async () => {
    await call(client, "task_add", {
      description: "Scheduled work",
      scheduled: "tomorrow",
    });

    const result = await call(client, "task_info", { id: "1" });
    const task = parseTask(result);
    expect(task.scheduled).toBeDefined();
  });

  it("adds a recurring task", async () => {
    await call(client, "task_add", {
      description: "Daily review",
      due: "tomorrow",
      recur: "daily",
    });

    const result = await call(client, "task_list", { filter: "status:recurring" });
    const tasks = parseContent(result) as Array<unknown>;
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("writes and reads a task doc", async () => {
    await call(client, "task_add", { description: "Spec me" });
    await call(client, "task_doc_write", {
      id: "1",
      content: "# Spec\n\nDo the thing.\n",
    });

    const result = await call(client, "task_doc_read", { id: "1" });
    const doc = (result.structuredContent as Record<string, unknown>).content;
    expect(doc).toBe("# Spec\n\nDo the thing.\n");
  });

  it("auto-tags task when doc is written", async () => {
    await call(client, "task_add", { description: "Auto-tag test" });
    await call(client, "task_doc_write", { id: "1", content: "Doc content" });

    const result = await call(client, "task_list", { filter: "+doc" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].has_doc).toBe(true);
  });

  it("returns error when reading non-existent doc", async () => {
    await call(client, "task_add", { description: "No doc" });
    const result = await call(client, "task_doc_read", { id: "1" });
    expect(result.isError).toBe(true);
  });

  it("deletes a doc and removes markers", async () => {
    await call(client, "task_add", { description: "Delete doc" });
    await call(client, "task_doc_write", { id: "1", content: "Temp doc" });
    await call(client, "task_doc_delete", { id: "1" });

    const readResult = await call(client, "task_doc_read", { id: "1" });
    expect(readResult.isError).toBe(true);

    const listResult = await call(client, "task_list", { filter: "+doc" });
    const tasks = parseContent(listResult) as Array<unknown>;
    expect(tasks).toHaveLength(0);
  });

  it("filters tasks with docs using has_doc UDA", async () => {
    await call(client, "task_add", { description: "With doc" });
    await call(client, "task_add", { description: "Without doc" });
    await call(client, "task_doc_write", { id: "1", content: "Has doc" });

    const result = await call(client, "task_list", { filter: "has_doc:true" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("With doc");
  });
});
