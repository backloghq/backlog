import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ensureSetup,
  type TaskWarriorConfig,
} from "../src/taskwarrior.js";
import { createServer } from "../src/index.js";

function makeConfig(taskData: string): TaskWarriorConfig {
  return {
    taskBin: "task",
    taskData,
    taskRc: join(taskData, ".taskrc"),
  };
}

function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

function parseContent(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

describe("MCP Server integration", () => {
  let tmpDir: string;
  let config: TaskWarriorConfig;
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
    expect(names).toHaveLength(12);
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
      tags: ["bug", "urgent"],
    });

    const result = await call(client, "task_list", { filter: "+bug" });
    const tasks = parseContent(result) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toContain("bug");
    expect(tasks[0].tags).toContain("urgent");
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
      tags: ["frontend", "urgent"],
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
    const task = parseContent(result) as Record<string, unknown>;
    const annotations = task.annotations as Array<Record<string, unknown>>;
    expect(annotations).toHaveLength(1);
    expect(annotations[0].description).toBe("Important context");
  });

  it("starts and stops a task", async () => {
    await call(client, "task_add", { description: "Work on me" });
    await call(client, "task_start", { id: "1" });

    let result = await call(client, "task_info", { id: "1" });
    let task = parseContent(result) as Record<string, unknown>;
    expect(task.start).toBeTruthy();

    await call(client, "task_stop", { id: "1" });

    result = await call(client, "task_info", { id: "1" });
    task = parseContent(result) as Record<string, unknown>;
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
    const task = parseContent(result) as Record<string, unknown>;
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
    await call(client, "task_add", { description: "A", tags: ["frontend"] });
    await call(client, "task_add", { description: "B", tags: ["backend"] });

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
});
