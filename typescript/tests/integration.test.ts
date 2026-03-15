import { execFileSync } from "node:child_process";

import { afterAll, afterEach, describe, expect, test } from "vitest";

import { runOmniJs } from "../src/jxa.js";
import { register as registerFolders } from "../src/tools/folders.js";
import { register as registerForecast } from "../src/tools/forecast.js";
import { register as registerPerspectives } from "../src/tools/perspectives.js";
import { register as registerProjects } from "../src/tools/projects.js";
import { register as registerTags } from "../src/tools/tags.js";
import { register as registerTasks } from "../src/tools/tasks.js";
import type { ToolResult } from "../src/types.js";

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
      timeout: 5_000,
    });
    return stdout.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

const runIntegration = process.env.OMNIFOCUS_INTEGRATION === "1";
const integrationDescribe = describe.skipIf(!runIntegration || !isOmniFocusRunning());
const INTEGRATION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = `[TEST-MCP][TS-INTEGRATION-${Date.now()}]`;

const server = new IntegrationServer();
const cleanupTaskIds: string[] = [];
const cleanupProjectIds: string[] = [];

function getHandler(name: string): ToolHandler {
  const handler = server.handlers.get(name);
  if (!handler) {
    throw new Error(`missing handler: ${name}`);
  }
  return handler;
}

registerTasks(server as never);
registerProjects(server as never);
registerTags(server as never);
registerFolders(server as never);
registerForecast(server as never);
registerPerspectives(server as never);

async function sweepArtifacts(projectIds: string[]): Promise<void> {
  const encodedProjectIds = JSON.stringify(projectIds);
  const prefix = JSON.stringify(TEST_PREFIX);
  await runOmniJs(
    `
const projectIds = ${encodedProjectIds};
const prefix = ${prefix};
const projectIdSet = new Set(projectIds);

document.flattenedTasks
  .filter(task => (task.name || "").startsWith(prefix))
  .forEach(task => {
    try {
      deleteObject(task);
    } catch {
      return;
    }
  });

document.flattenedProjects
  .filter(project => projectIdSet.has(project.id.primaryKey) || (project.name || "").startsWith(prefix))
  .forEach(project => {
    try {
      if (project.task) {
        deleteObject(project.task);
      }
    } catch {
      return;
    }
  });

return true;
`.trim()
  );
}

afterEach(async () => {
  try {
    const deleteTask = getHandler("delete_task");
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

    await sweepArtifacts(cleanupProjectIds);
  } catch {
    return;
  } finally {
    cleanupProjectIds.length = 0;
  }
});

afterAll(async () => {
  await sweepArtifacts([]);
  const validation = (await runOmniJs(
    `
const prefix = ${JSON.stringify(TEST_PREFIX)};
const taskLeakCount = document.flattenedTasks.filter(task => {
  if (!(task.name || "").startsWith(prefix)) return false;
  const status = String(task.taskStatus || task.status || "").toLowerCase();
  return !status.includes("dropped");
}).length;
const projectLeakCount = document.flattenedProjects.filter(project => {
  if (!(project.name || "").startsWith(prefix)) return false;
  const status = String(project.status || "").toLowerCase();
  return !status.includes("dropped");
}).length;
return { taskLeakCount, projectLeakCount };
`.trim()
  )) as { taskLeakCount?: unknown; projectLeakCount?: unknown };
  const taskLeakCount = Number(validation.taskLeakCount ?? 0);
  const projectLeakCount = Number(validation.projectLeakCount ?? 0);
  if (taskLeakCount > 0 || projectLeakCount > 0) {
    throw new Error(`teardown leaked test artifacts: tasks=${taskLeakCount}, projects=${projectLeakCount}`);
  }
});

integrationDescribe("typescript integration", () => {
  test(
    "test_jxa_bridge_connectivity",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const result = await runOmniJs("return document.flattenedTasks.length;");
      expect(typeof result).toBe("number");
    }
  );

  test(
    "test_read_tools_return_valid_json",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
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
        await createTask({ name: `${TEST_PREFIX} TS Read Tool Task ${Date.now()}` })
      ) as { id: string };
      cleanupTaskIds.push(createdTask.id);

      const createdProject = parseToolResult(
        await createProject({ name: `${TEST_PREFIX} TS Read Tool Project ${Date.now()}` })
      ) as { id: string };
      cleanupProjectIds.push(createdProject.id);

      const inbox = parseToolResult(await getInbox({ limit: 20 })) as unknown[];
      expect(Array.isArray(inbox)).toBe(true);

      const tasks = parseToolResult(await listTasks({ status: "all", limit: 20 })) as unknown[];
      expect(Array.isArray(tasks)).toBe(true);
      if (tasks.length > 0) {
        expect(tasks[0]).toHaveProperty("completionDate");
        expect(tasks[0]).toHaveProperty("hasChildren");
        expect(tasks[0]).toHaveProperty("taskStatus");
      }

      const task = parseToolResult(await getTask({ task_id: createdTask.id })) as Record<string, unknown>;
      expect(task.id).toBe(createdTask.id);
      expect(task).toHaveProperty("name");
      expect(task).toHaveProperty("taskStatus");

      const searched = parseToolResult(await searchTasks({ query: "TS Read Tool", limit: 20 })) as unknown[];
      expect(Array.isArray(searched)).toBe(true);
      if (searched.length > 0) {
        expect(searched[0]).toHaveProperty("completionDate");
        expect(searched[0]).toHaveProperty("hasChildren");
        expect(searched[0]).toHaveProperty("taskStatus");
      }

      const projects = parseToolResult(await listProjects({ status: "active", limit: 20 })) as unknown[];
      expect(Array.isArray(projects)).toBe(true);

      const project = parseToolResult(
        await getProject({ project_id_or_name: createdProject.id })
      ) as Record<string, unknown>;
      expect(project.id).toBe(createdProject.id);
      expect(project).toHaveProperty("rootTasks");

      const tags = parseToolResult(await listTags({ statusFilter: "all", limit: 20 })) as unknown[];
      expect(Array.isArray(tags)).toBe(true);

      const folders = parseToolResult(await listFolders({ limit: 20 })) as unknown[];
      expect(Array.isArray(folders)).toBe(true);

      const forecast = parseToolResult(await getForecast({ limit: 20 })) as Record<string, unknown>;
      expect(forecast).toHaveProperty("overdue");
      expect(forecast).toHaveProperty("dueToday");
      expect(forecast).toHaveProperty("flagged");
      const overdue = forecast.overdue as Array<Record<string, unknown>> | undefined;
      if (overdue !== undefined && overdue.length > 0) {
        expect(overdue[0]).toHaveProperty("taskStatus");
      }
      expect(forecast).toHaveProperty("deferred");
      expect(forecast).toHaveProperty("dueThisWeek");
      expect(forecast).toHaveProperty("counts");

      const perspectives = parseToolResult(await listPerspectives({ limit: 20 })) as unknown[];
      expect(Array.isArray(perspectives)).toBe(true);
    }
  );

  test(
    "test_task_lifecycle",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createTask = getHandler("create_task");
      const getTask = getHandler("get_task");
      const updateTask = getHandler("update_task");
      const completeTask = getHandler("complete_task");
      const deleteTask = getHandler("delete_task");

      const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const created = parseToolResult(
        await createTask({
          name: `${TEST_PREFIX} TS Lifecycle Task ${Date.now()}`,
          flagged: true,
          dueDate,
        })
      ) as { id: string };
      cleanupTaskIds.push(created.id);

      const fetched = parseToolResult(await getTask({ task_id: created.id })) as Record<string, unknown>;
      expect(fetched.id).toBe(created.id);

      const updatedName = `${TEST_PREFIX} TS Updated Task ${Date.now()}`;
      const updated = parseToolResult(
        await updateTask({ task_id: created.id, name: updatedName })
      ) as Record<string, unknown>;
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(updatedName);

      const completed = parseToolResult(await completeTask({ task_id: created.id })) as Record<string, unknown>;
      expect(completed.id).toBe(created.id);
      expect(completed.completed).toBe(true);

      const deleted = parseToolResult(await deleteTask({ task_id: created.id })) as Record<string, unknown>;
      expect(deleted.id).toBe(created.id);
      expect(deleted.deleted).toBe(true);
      const index = cleanupTaskIds.findIndex((taskId) => taskId === created.id);
      if (index >= 0) {
        cleanupTaskIds.splice(index, 1);
      }
    }
  );

  test(
    "test_search_finds_created_task",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createTask = getHandler("create_task");
      const searchTasks = getHandler("search_tasks");

      const token = Math.random().toString(36).slice(2, 12);
      const created = parseToolResult(
        await createTask({
          name: `${TEST_PREFIX} TS Search ${token}`,
          note: `search token ${token}`,
        })
      ) as { id: string };
      cleanupTaskIds.push(created.id);

      const results = parseToolResult(await searchTasks({ query: token, limit: 50 })) as Array<
        Record<string, unknown>
      >;
      const resultIds = new Set(results.map((item) => String(item.id)));
      expect(resultIds.has(created.id)).toBe(true);
    }
  );

  test(
    "test_project_lifecycle",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createProject = getHandler("create_project");
      const getProject = getHandler("get_project");
      const completeProject = getHandler("complete_project");

      const projectName = `${TEST_PREFIX} TS Lifecycle Project ${Date.now()}`;
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
    }
  );

  test(
    "test_new_feature_parity_matrix",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createProject = getHandler("create_project");
      const createTask = getHandler("create_task");
      const listTasks = getHandler("list_tasks");
      const searchTasks = getHandler("search_tasks");
      const addNotification = getHandler("add_notification");
      const listNotifications = getHandler("list_notifications");
      const removeNotification = getHandler("remove_notification");
      const createTag = getHandler("create_tag");
      const deleteTag = getHandler("delete_tag");
      const deleteTagsBatch = getHandler("delete_tags_batch");
      const createFolder = getHandler("create_folder");
      const deleteFolder = getHandler("delete_folder");
      const deleteFoldersBatch = getHandler("delete_folders_batch");
      const deleteProject = getHandler("delete_project");
      const deleteProjectsBatch = getHandler("delete_projects_batch");

      const extraTagIds: string[] = [];
      const extraFolderIds: string[] = [];
      const extraProjectIds: string[] = [];
      let taskId: string | null = null;
      let notificationId: string | null = null;
      try {
        const parityProjectName = `${TEST_PREFIX} TS Parity Project ${Date.now()}`;
        const parityProject = parseToolResult(await createProject({ name: parityProjectName })) as {
          id: string;
        };
        cleanupProjectIds.push(parityProject.id);

        const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const createdTask = parseToolResult(
          await createTask({
            name: `${TEST_PREFIX} TS Parity Task ${Date.now()}`,
            note: "parity matrix sort notification",
            project: parityProjectName,
            dueDate,
          })
        ) as { id: string };
        taskId = createdTask.id;
        cleanupTaskIds.push(taskId);

        const listed = parseToolResult(
          await listTasks({
            project: parityProjectName,
            status: "all",
            sortBy: "added",
            sortOrder: "desc",
            limit: 50,
          })
        ) as Array<Record<string, unknown>>;
        expect(listed.some((item) => String(item.id) === taskId)).toBe(true);

        const searched = parseToolResult(
          await searchTasks({
            query: "parity matrix sort notification",
            status: "all",
            sortBy: "planned",
            sortOrder: "asc",
            limit: 50,
          })
        ) as Array<Record<string, unknown>>;
        expect(searched.some((item) => String(item.id) === taskId)).toBe(true);

        const createdNotification = parseToolResult(
          await addNotification({ task_id: taskId, absoluteDate: dueDate })
        ) as { id: string };
        notificationId = createdNotification.id;

        const notifications = parseToolResult(
          await listNotifications({ task_id: taskId })
        ) as Array<Record<string, unknown>>;
        expect(notifications.some((item) => String(item.id) === notificationId)).toBe(true);

        const removed = parseToolResult(
          await removeNotification({ task_id: taskId, notification_id: notificationId })
        ) as Record<string, unknown>;
        expect(removed.removed).toBe(true);
        notificationId = null;

        const tagOne = parseToolResult(
          await createTag({ name: `${TEST_PREFIX} TS Batch Tag One ${Date.now()}` })
        ) as { id: string };
        const tagTwo = parseToolResult(
          await createTag({ name: `${TEST_PREFIX} TS Batch Tag Two ${Date.now()}` })
        ) as { id: string };
        extraTagIds.push(tagOne.id, tagTwo.id);
        const deletedTags = parseToolResult(
          await deleteTagsBatch({ tag_ids_or_names: [tagOne.id, tagTwo.id] })
        ) as { summary?: { deleted?: number } };
        expect(deletedTags.summary?.deleted).toBe(2);
        extraTagIds.length = 0;

        const folderOne = parseToolResult(
          await createFolder({ name: `${TEST_PREFIX} TS Batch Folder One ${Date.now()}` })
        ) as { id: string };
        const folderTwo = parseToolResult(
          await createFolder({ name: `${TEST_PREFIX} TS Batch Folder Two ${Date.now()}` })
        ) as { id: string };
        extraFolderIds.push(folderOne.id, folderTwo.id);
        const deletedFolders = parseToolResult(
          await deleteFoldersBatch({ folder_ids_or_names: [folderOne.id, folderTwo.id] })
        ) as { summary?: { deleted?: number } };
        expect(deletedFolders.summary?.deleted).toBe(2);
        extraFolderIds.length = 0;

        const projectOne = parseToolResult(
          await createProject({ name: `${TEST_PREFIX} TS Batch Project One ${Date.now()}` })
        ) as { id: string };
        const projectTwo = parseToolResult(
          await createProject({ name: `${TEST_PREFIX} TS Batch Project Two ${Date.now()}` })
        ) as { id: string };
        extraProjectIds.push(projectOne.id, projectTwo.id);
        const deletedProjects = parseToolResult(
          await deleteProjectsBatch({ project_ids_or_names: [projectOne.id, projectTwo.id] })
        ) as { summary?: { deleted?: number } };
        expect(deletedProjects.summary?.deleted).toBe(2);
        extraProjectIds.length = 0;
      } finally {
        if (taskId && notificationId) {
          try {
            await removeNotification({ task_id: taskId, notification_id: notificationId });
          } catch {
            notificationId = null;
          }
        }

        for (const id of extraTagIds) {
          try {
            await deleteTag({ tag_name_or_id: id });
          } catch {
            continue;
          }
        }

        for (const id of extraFolderIds) {
          try {
            await deleteFolder({ folder_name_or_id: id });
          } catch {
            continue;
          }
        }

        for (const id of extraProjectIds) {
          try {
            await deleteProject({ project_id_or_name: id });
          } catch {
            continue;
          }
        }
      }
    }
  );
});
