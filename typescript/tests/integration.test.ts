import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { escapeForJxa, runOmniJs } from "../src/jxa.js";
import { register as registerFolders } from "../src/tools/folders.js";
import { register as registerForecast } from "../src/tools/forecast.js";
import { register as registerPerspectives } from "../src/tools/perspectives.js";
import { register as registerProjects } from "../src/tools/projects.js";
import { register as registerTags } from "../src/tools/tags.js";
import { register as registerTasks } from "../src/tools/tasks.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

class CaptureServer {
  public readonly tools = new Map<string, ToolHandler>();

  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }
}

function omniFocusAvailable(): boolean {
  try {
    const stdout = execFileSync("osascript", ["-e", 'tell application "OmniFocus" to running'], {
      encoding: "utf-8",
      timeout: 5_000,
    });
    return stdout.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

function registerAllTools(): Map<string, ToolHandler> {
  const server = new CaptureServer();
  const typedServer = server as unknown as Parameters<typeof registerTasks>[0];
  registerTasks(typedServer);
  registerProjects(typedServer);
  registerTags(typedServer);
  registerFolders(typedServer);
  registerForecast(typedServer);
  registerPerspectives(typedServer);
  return server.tools;
}

const toolMap = registerAllTools();

function testName(suffix: string): string {
  return `[TEST-MCP] ${suffix} ${randomUUID().slice(0, 8)}`;
}

function requireTool(name: string): ToolHandler {
  const handler = toolMap.get(name);
  if (!handler) {
    throw new Error(`tool not registered: ${name}`);
  }
  return handler;
}

async function invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await requireTool(name)(args);
  expect(result.isError).not.toBe(true);
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}

function expectObjectKeys(value: unknown, required: string[]): void {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  const record = value as Record<string, unknown>;
  for (const key of required) {
    expect(key in record).toBe(true);
  }
}

const cleanupTaskIds: string[] = [];
const cleanupProjectIds: string[] = [];

afterEach(async () => {
  const deleteTask = requireTool("delete_task");
  for (const taskId of [...cleanupTaskIds].reverse()) {
    try {
      await deleteTask({ task_id: taskId });
    } catch {
      continue;
    }
  }
  cleanupTaskIds.length = 0;

  for (const projectId of [...cleanupProjectIds].reverse()) {
    try {
      await runOmniJs(
        `
const projectId = ${escapeForJxa(projectId)};
const project = document.flattenedProjects.find(item => item.id.primaryKey === projectId);
if (project) {
  project.status = Project.Status.Dropped;
}
return null;
`.trim()
      );
    } catch {
      continue;
    }
  }
  cleanupProjectIds.length = 0;
});

describe.skipIf(!omniFocusAvailable())("integration tests", () => {
  test("test_jxa_bridge_connectivity", async () => {
    const value = await runOmniJs("return document.flattenedTasks.length;");
    expect(typeof value).toBe("number");
    expect(Number(value)).toBeGreaterThanOrEqual(0);
  });

  test("test_read_tools_return_valid_json", async () => {
    const createdTask = await invoke("create_task", { name: testName("Read tool task"), flagged: true });
    expectObjectKeys(createdTask, ["id", "name"]);
    const createdTaskId = String((createdTask as Record<string, unknown>).id);
    cleanupTaskIds.push(createdTaskId);

    const createdProject = await invoke("create_project", { name: testName("Read tool project") });
    expectObjectKeys(createdProject, ["id"]);
    const createdProjectId = String((createdProject as Record<string, unknown>).id);
    cleanupProjectIds.push(createdProjectId);

    const inbox = await invoke("get_inbox", { limit: 20 });
    expect(Array.isArray(inbox)).toBe(true);
    if (Array.isArray(inbox) && inbox.length > 0) {
      expectObjectKeys(inbox[0], ["id", "name", "note", "flagged", "dueDate", "deferDate", "tags", "estimatedMinutes"]);
    }

    const tasks = await invoke("list_tasks", { status: "all", limit: 20 });
    expect(Array.isArray(tasks)).toBe(true);
    if (Array.isArray(tasks) && tasks.length > 0) {
      expectObjectKeys(tasks[0], [
        "id",
        "name",
        "note",
        "flagged",
        "dueDate",
        "deferDate",
        "completed",
        "projectName",
        "tags",
        "estimatedMinutes",
      ]);
    }

    const task = await invoke("get_task", { task_id: createdTaskId });
    expectObjectKeys(task, [
      "id",
      "name",
      "note",
      "flagged",
      "dueDate",
      "deferDate",
      "completed",
      "completionDate",
      "projectName",
      "tags",
      "estimatedMinutes",
      "children",
      "parentName",
      "sequential",
      "repetitionRule",
    ]);

    const search = await invoke("search_tasks", { query: "Read tool", limit: 20 });
    expect(Array.isArray(search)).toBe(true);
    if (Array.isArray(search) && search.length > 0) {
      expectObjectKeys(search[0], [
        "id",
        "name",
        "note",
        "flagged",
        "dueDate",
        "deferDate",
        "completed",
        "projectName",
        "tags",
        "estimatedMinutes",
      ]);
    }

    const projects = await invoke("list_projects", { limit: 20, status: "active" });
    expect(Array.isArray(projects)).toBe(true);
    if (Array.isArray(projects) && projects.length > 0) {
      expectObjectKeys(projects[0], [
        "id",
        "name",
        "status",
        "folderName",
        "taskCount",
        "remainingTaskCount",
        "deferDate",
        "dueDate",
        "note",
        "sequential",
        "reviewInterval",
      ]);
    }

    const project = await invoke("get_project", { project_id_or_name: createdProjectId });
    expectObjectKeys(project, [
      "id",
      "name",
      "status",
      "folderName",
      "taskCount",
      "remainingTaskCount",
      "deferDate",
      "dueDate",
      "note",
      "sequential",
      "reviewInterval",
      "rootTasks",
    ]);

    const tags = await invoke("list_tags", { status: "all", limit: 20 });
    expect(Array.isArray(tags)).toBe(true);
    if (Array.isArray(tags) && tags.length > 0) {
      expectObjectKeys(tags[0], ["id", "name", "parent", "availableTaskCount", "status"]);
    }

    const folders = await invoke("list_folders", { limit: 20 });
    expect(Array.isArray(folders)).toBe(true);
    if (Array.isArray(folders) && folders.length > 0) {
      expectObjectKeys(folders[0], ["id", "name", "parentName", "projectCount"]);
    }

    const forecast = await invoke("get_forecast", { limit: 20 });
    expectObjectKeys(forecast, ["overdue", "dueToday", "flagged"]);

    const perspectives = await invoke("list_perspectives", { limit: 20 });
    expect(Array.isArray(perspectives)).toBe(true);
    if (Array.isArray(perspectives) && perspectives.length > 0) {
      expectObjectKeys(perspectives[0], ["id", "name"]);
    }
  });

  test("test_task_lifecycle", async () => {
    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const created = await invoke("create_task", { name: testName("Lifecycle task"), flagged: true, dueDate });
    expectObjectKeys(created, ["id", "name"]);
    const taskId = String((created as Record<string, unknown>).id);
    cleanupTaskIds.push(taskId);

    const fetched = await invoke("get_task", { task_id: taskId });
    expect((fetched as Record<string, unknown>).id).toBe(taskId);
    expect((fetched as Record<string, unknown>).flagged).toBe(true);

    const updatedName = testName("Lifecycle updated");
    const updated = await invoke("update_task", { task_id: taskId, name: updatedName });
    expect((updated as Record<string, unknown>).id).toBe(taskId);
    expect((updated as Record<string, unknown>).name).toBe(updatedName);

    const completed = await invoke("complete_task", { task_id: taskId });
    expect((completed as Record<string, unknown>).id).toBe(taskId);
    expect((completed as Record<string, unknown>).completed).toBe(true);

    const deleted = await invoke("delete_task", { task_id: taskId });
    expect((deleted as Record<string, unknown>).id).toBe(taskId);
    expect((deleted as Record<string, unknown>).deleted).toBe(true);
    cleanupTaskIds.splice(cleanupTaskIds.indexOf(taskId), 1);
  });

  test("test_search_finds_created_task", async () => {
    const token = randomUUID().replace(/-/g, "").slice(0, 10);
    const created = await invoke("create_task", {
      name: `[TEST-MCP] Search ${token}`,
      note: `search token ${token}`,
    });
    expectObjectKeys(created, ["id", "name"]);
    const taskId = String((created as Record<string, unknown>).id);
    cleanupTaskIds.push(taskId);

    const results = await invoke("search_tasks", { query: token, limit: 50 });
    expect(Array.isArray(results)).toBe(true);
    const ids = (results as unknown[])
      .filter((item) => typeof item === "object" && item !== null && "id" in (item as Record<string, unknown>))
      .map((item) => String((item as Record<string, unknown>).id));
    expect(ids).toContain(taskId);
  });

  test("test_project_lifecycle", async () => {
    const projectName = testName("Lifecycle project");
    const created = await invoke("create_project", { name: projectName });
    expectObjectKeys(created, ["id"]);
    const projectId = String((created as Record<string, unknown>).id);
    cleanupProjectIds.push(projectId);

    const fetched = await invoke("get_project", { project_id_or_name: projectId });
    expect((fetched as Record<string, unknown>).id).toBe(projectId);
    expect((fetched as Record<string, unknown>).name).toBe(projectName);

    const completed = await invoke("complete_project", { project_id_or_name: projectId });
    expect((completed as Record<string, unknown>).id).toBe(projectId);
    expect((completed as Record<string, unknown>).completed).toBe(true);
  });
});
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { runOmniJs } from "../src/jxa.js";
import { register as registerFolders } from "../src/tools/folders.js";
import { register as registerForecast } from "../src/tools/forecast.js";
import { register as registerPerspectives } from "../src/tools/perspectives.js";
import { register as registerProjects } from "../src/tools/projects.js";
import { register as registerTags } from "../src/tools/tags.js";
import { register as registerTasks } from "../src/tools/tasks.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: true;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

class IntegrationServer {
  public readonly handlers = new Map<string, ToolHandler>();

  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }
}

function parseToolResult(result: ToolResult): unknown {
  if (result.isError) {
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { error?: string };
    throw new Error(payload.error ?? "tool returned isError");
  }
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}

function isOmniFocusRunning(): boolean {
  try {
    const stdout = execFileSync("osascript", ["-e", 'tell application "OmniFocus" to running'], {
      encoding: "utf8",
      timeout: 5000,
    });
    return stdout.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

const integrationEnabled = process.env.OMNIFOCUS_INTEGRATION === "1";
const skipIntegration = !integrationEnabled || !isOmniFocusRunning();
const integrationDescribe = describe.skipIf(skipIntegration);

const server = new IntegrationServer();
const cleanupTaskIds: string[] = [];
const cleanupProjectIds: string[] = [];
const INTEGRATION_TIMEOUT_MS = 60_000;

function getHandler(name: string): ToolHandler {
  const handler = server.handlers.get(name);
  if (!handler) {
    throw new Error(`missing handler: ${name}`);
  }
  return handler;
}

beforeAll(() => {
  registerTasks(server as never);
  registerProjects(server as never);
  registerTags(server as never);
  registerFolders(server as never);
  registerForecast(server as never);
  registerPerspectives(server as never);
});

afterEach(async () => {
  const deleteTask = getHandler("delete_task");
  const completeProject = getHandler("complete_project");

  while (cleanupTaskIds.length > 0) {
    const taskId = cleanupTaskIds.pop();
    if (!taskId) {
      continue;
    }
    try {
      await deleteTask({ task_id: taskId });
    } catch {
      continue;
    }
  }

  while (cleanupProjectIds.length > 0) {
    const projectId = cleanupProjectIds.pop();
    if (!projectId) {
      continue;
    }
    try {
      await completeProject({ project_id_or_name: projectId });
    } catch {
      continue;
    }
  }
});

integrationDescribe("typescript integration", () => {
  test("test_jxa_bridge_connectivity", async () => {
    const result = await runOmniJs("return document.flattenedTasks.length;");
    expect(typeof result).toBe("number");
  }, INTEGRATION_TIMEOUT_MS);

  test("test_read_tools_return_valid_json", async () => {
    const createTask = getHandler("create_task");
    const createProject = getHandler("create_project");
    const getInbox = getHandler("get_inbox");
    const listTasks = getHandler("list_tasks");
    const getTask = getHandler("get_task");
    const searchTasks = getHandler("search_tasks");
    const listProjects = getHandler("list_projects");
    const getProject = getHandler("get_project");
    const listTags = getHandler("list_tags");
    const listFolders = getHandler("list_folders");
    const getForecast = getHandler("get_forecast");
    const listPerspectives = getHandler("list_perspectives");

    const createdTask = parseToolResult(
      await createTask({ name: `[TEST-MCP] TS Read Tool Task ${Date.now()}` })
    ) as { id: string };
    cleanupTaskIds.push(createdTask.id);

    const createdProject = parseToolResult(
      await createProject({ name: `[TEST-MCP] TS Read Tool Project ${Date.now()}` })
    ) as { id: string };
    cleanupProjectIds.push(createdProject.id);

    const inbox = parseToolResult(await getInbox({ limit: 20 })) as unknown[];
    expect(Array.isArray(inbox)).toBe(true);

    const tasks = parseToolResult(await listTasks({ status: "all", limit: 20 })) as unknown[];
    expect(Array.isArray(tasks)).toBe(true);

    const task = parseToolResult(await getTask({ task_id: createdTask.id })) as Record<string, unknown>;
    expect(task.id).toBe(createdTask.id);
    expect(task).toHaveProperty("name");

    const searched = parseToolResult(await searchTasks({ query: "TS Read Tool", limit: 20 })) as unknown[];
    expect(Array.isArray(searched)).toBe(true);

    const projects = parseToolResult(await listProjects({ limit: 20 })) as unknown[];
    expect(Array.isArray(projects)).toBe(true);

    const project = parseToolResult(
      await getProject({ project_id_or_name: createdProject.id })
    ) as Record<string, unknown>;
    expect(project.id).toBe(createdProject.id);
    expect(project).toHaveProperty("rootTasks");

    const tags = parseToolResult(await listTags({ limit: 20 })) as unknown[];
    expect(Array.isArray(tags)).toBe(true);

    const folders = parseToolResult(await listFolders({ limit: 20 })) as unknown[];
    expect(Array.isArray(folders)).toBe(true);

    const forecast = parseToolResult(await getForecast({ limit: 20 })) as Record<string, unknown>;
    expect(forecast).toHaveProperty("overdue");
    expect(forecast).toHaveProperty("dueToday");
    expect(forecast).toHaveProperty("flagged");

    const perspectives = parseToolResult(await listPerspectives({ limit: 20 })) as unknown[];
    expect(Array.isArray(perspectives)).toBe(true);
  }, INTEGRATION_TIMEOUT_MS);

  test("test_task_lifecycle", async () => {
    const createTask = getHandler("create_task");
    const getTask = getHandler("get_task");
    const updateTask = getHandler("update_task");
    const completeTask = getHandler("complete_task");
    const deleteTask = getHandler("delete_task");

    const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const created = parseToolResult(
      await createTask({
        name: `[TEST-MCP] TS Lifecycle Task ${Date.now()}`,
        flagged: true,
        dueDate,
      })
    ) as { id: string };
    cleanupTaskIds.push(created.id);

    const fetched = parseToolResult(await getTask({ task_id: created.id })) as Record<string, unknown>;
    expect(fetched.id).toBe(created.id);

    const updatedName = `[TEST-MCP] TS Updated Task ${Date.now()}`;
    const updated = parseToolResult(
      await updateTask({ task_id: created.id, name: updatedName })
    ) as Record<string, unknown>;
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe(updatedName);

    const completed = parseToolResult(
      await completeTask({ task_id: created.id })
    ) as Record<string, unknown>;
    expect(completed.id).toBe(created.id);
    expect(completed.completed).toBe(true);

    const deleted = parseToolResult(await deleteTask({ task_id: created.id })) as Record<string, unknown>;
    expect(deleted.id).toBe(created.id);
    expect(deleted.deleted).toBe(true);
    cleanupTaskIds.splice(
      cleanupTaskIds.findIndex((taskId) => taskId === created.id),
      1
    );
  }, INTEGRATION_TIMEOUT_MS);

  test("test_search_finds_created_task", async () => {
    const createTask = getHandler("create_task");
    const searchTasks = getHandler("search_tasks");

    const token = Math.random().toString(36).slice(2, 12);
    const created = parseToolResult(
      await createTask({
        name: `[TEST-MCP] TS Search ${token}`,
        note: `search token ${token}`,
      })
    ) as { id: string };
    cleanupTaskIds.push(created.id);

    const results = parseToolResult(await searchTasks({ query: token, limit: 50 })) as Array<
      Record<string, unknown>
    >;
    const resultIds = new Set(results.map((item) => String(item.id)));
    expect(resultIds.has(created.id)).toBe(true);
  }, INTEGRATION_TIMEOUT_MS);

  test("test_project_lifecycle", async () => {
    const createProject = getHandler("create_project");
    const getProject = getHandler("get_project");
    const completeProject = getHandler("complete_project");

    const projectName = `[TEST-MCP] TS Lifecycle Project ${Date.now()}`;
    const created = parseToolResult(await createProject({ name: projectName })) as { id: string };
    cleanupProjectIds.push(created.id);

    const fetched = parseToolResult(
      await getProject({ project_id_or_name: created.id })
    ) as Record<string, unknown>;
    expect(fetched.id).toBe(created.id);

    const completed = parseToolResult(
      await completeProject({ project_id_or_name: created.id })
    ) as Record<string, unknown>;
    expect(completed.id).toBe(created.id);
    expect(completed.completed).toBe(true);
  }, INTEGRATION_TIMEOUT_MS);
});
