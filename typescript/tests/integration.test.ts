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
      const getFolder = getHandler("get_folder");
      const createFolder = getHandler("create_folder");
      const deleteFolder = getHandler("delete_folder");
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
      for (const tag of tags as Array<Record<string, unknown>>) {
        expect(["active", "on_hold", "dropped"]).toContain(String(tag.status));
      }

      const folders = parseToolResult(await listFolders({ limit: 20 })) as unknown[];
      expect(Array.isArray(folders)).toBe(true);
      let statusFolderId: string | null = null;
      let createdStatusFolderId: string | null = null;
      if (folders.length > 0) {
        const firstFolder = folders[0] as Record<string, unknown>;
        if (firstFolder.id !== undefined && firstFolder.id !== null) {
          statusFolderId = String(firstFolder.id);
        }
      }
      if (statusFolderId === null) {
        const createdFolder = parseToolResult(
          await createFolder({ name: `${TEST_PREFIX} TS Status Folder ${Date.now()}` })
        ) as { id: string };
        statusFolderId = createdFolder.id;
        createdStatusFolderId = createdFolder.id;
      }
      const folderDetails = parseToolResult(
        await getFolder({ folder_name_or_id: statusFolderId })
      ) as Record<string, unknown>;
      expect(["active", "on_hold", "dropped"]).toContain(String(folderDetails.status));
      for (const projectItem of (folderDetails.projects as Array<Record<string, unknown>> | undefined) ?? []) {
        expect(["active", "on_hold", "dropped"]).toContain(String(projectItem.status));
      }
      if (createdStatusFolderId !== null) {
        await deleteFolder({ folder_name_or_id: createdStatusFolderId });
      }

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

        const tagParentName = `${TEST_PREFIX} TS Batch Parent Tag ${Date.now()}`;
        const tagParent = parseToolResult(await createTag({ name: tagParentName })) as { id: string };
        const tagChild = parseToolResult(
          await createTag({
            name: `${TEST_PREFIX} TS Batch Child Tag ${Date.now()}`,
            parent: tagParentName,
          })
        ) as { id: string };
        extraTagIds.push(tagParent.id, tagChild.id);
        const deletedTags = parseToolResult(
          await deleteTagsBatch({ tag_ids_or_names: [tagParent.id, tagChild.id] })
        ) as {
          summary?: { deleted?: number; failed?: number };
          partial_success?: boolean;
          results?: Array<{ error?: unknown }>;
        };
        expect(deletedTags.summary?.deleted).toBe(2);
        expect(deletedTags.summary?.failed).toBe(0);
        expect(deletedTags.partial_success).toBe(false);
        const tagErrors = (deletedTags.results ?? [])
          .map((item) => String(item.error ?? ""))
          .join(" ")
          .toLowerCase();
        expect(tagErrors.includes("invalid object instance")).toBe(false);
        extraTagIds.length = 0;

        const folderParentName = `${TEST_PREFIX} TS Batch Parent Folder ${Date.now()}`;
        const folderParent = parseToolResult(
          await createFolder({ name: folderParentName })
        ) as { id: string };
        const folderChild = parseToolResult(
          await createFolder({
            name: `${TEST_PREFIX} TS Batch Child Folder ${Date.now()}`,
            parent: folderParentName,
          })
        ) as { id: string };
        extraFolderIds.push(folderParent.id, folderChild.id);
        const deletedFolders = parseToolResult(
          await deleteFoldersBatch({ folder_ids_or_names: [folderParent.id, folderChild.id] })
        ) as {
          summary?: { deleted?: number; failed?: number };
          partial_success?: boolean;
          results?: Array<{ error?: unknown }>;
        };
        expect(deletedFolders.summary?.deleted).toBe(2);
        expect(deletedFolders.summary?.failed).toBe(0);
        expect(deletedFolders.partial_success).toBe(false);
        const folderErrors = (deletedFolders.results ?? [])
          .map((item) => String(item.error ?? ""))
          .join(" ")
          .toLowerCase();
        expect(folderErrors.includes("invalid object instance")).toBe(false);
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

  test(
    "test_plan_a_parent_child_batch_delete_effective_success",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createTag = getHandler("create_tag");
      const deleteTag = getHandler("delete_tag");
      const deleteTagsBatch = getHandler("delete_tags_batch");
      const createFolder = getHandler("create_folder");
      const deleteFolder = getHandler("delete_folder");
      const deleteFoldersBatch = getHandler("delete_folders_batch");

      const extraTagIds: string[] = [];
      const extraFolderIds: string[] = [];
      const prefix = `${TEST_PREFIX} hierarchy ${Date.now()}`;
      try {
        const parentTagName = `${prefix} parent tag`;
        const childTagName = `${prefix} child tag`;
        const parentTag = parseToolResult(await createTag({ name: parentTagName })) as { id: string };
        const childTag = parseToolResult(
          await createTag({ name: childTagName, parent: parentTagName })
        ) as { id: string };
        extraTagIds.push(parentTag.id, childTag.id);
        const deletedTags = parseToolResult(
          await deleteTagsBatch({ tag_ids_or_names: [parentTag.id, childTag.id] })
        ) as {
          summary?: { deleted?: number; failed?: number };
          partial_success?: boolean;
          results?: Array<{ deleted?: boolean; error?: unknown }>;
        };
        expect(deletedTags.summary?.deleted).toBe(2);
        expect(deletedTags.summary?.failed).toBe(0);
        expect(deletedTags.partial_success).toBe(false);
        expect((deletedTags.results ?? []).every((item) => item.deleted === true)).toBe(true);
        expect(
          (deletedTags.results ?? []).every((item) => {
            const message = String(item.error ?? "").toLowerCase();
            return !(message.includes("invalid") && message.includes("instance"));
          })
        ).toBe(true);
        extraTagIds.length = 0;

        const parentFolderName = `${prefix} parent folder`;
        const childFolderName = `${prefix} child folder`;
        const parentFolder = parseToolResult(
          await createFolder({ name: parentFolderName })
        ) as { id: string };
        const childFolder = parseToolResult(
          await createFolder({ name: childFolderName, parent: parentFolderName })
        ) as { id: string };
        extraFolderIds.push(parentFolder.id, childFolder.id);
        const deletedFolders = parseToolResult(
          await deleteFoldersBatch({ folder_ids_or_names: [parentFolder.id, childFolder.id] })
        ) as {
          summary?: { deleted?: number; failed?: number };
          partial_success?: boolean;
          results?: Array<{ deleted?: boolean; error?: unknown }>;
        };
        expect(deletedFolders.summary?.deleted).toBe(2);
        expect(deletedFolders.summary?.failed).toBe(0);
        expect(deletedFolders.partial_success).toBe(false);
        expect((deletedFolders.results ?? []).every((item) => item.deleted === true)).toBe(true);
        expect(
          (deletedFolders.results ?? []).every((item) => {
            const message = String(item.error ?? "").toLowerCase();
            return !(message.includes("invalid") && message.includes("instance"));
          })
        ).toBe(true);
        extraFolderIds.length = 0;
      } finally {
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
      }
    }
  );

  test(
    "test_plan_c_alias_calls_match_canonical_behavior",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createProject = getHandler("create_project");
      const createTask = getHandler("create_task");
      const createTag = getHandler("create_tag");
      const deleteTag = getHandler("delete_tag");
      const listTasks = getHandler("list_tasks");
      const searchTasks = getHandler("search_tasks");
      const getTaskCounts = getHandler("get_task_counts");

      const extraTagIds: string[] = [];
      let taskId: string | null = null;
      try {
        const projectName = `${TEST_PREFIX} TS Plan C Alias Project ${Date.now()}`;
        const createdProject = parseToolResult(await createProject({ name: projectName })) as {
          id: string;
        };
        cleanupProjectIds.push(createdProject.id);

        const tagA = parseToolResult(
          await createTag({ name: `${TEST_PREFIX} TS Plan C Alias Tag A ${Date.now()}` })
        ) as { id: string; name: string };
        const tagB = parseToolResult(
          await createTag({ name: `${TEST_PREFIX} TS Plan C Alias Tag B ${Date.now()}` })
        ) as { id: string; name: string };
        extraTagIds.push(tagA.id, tagB.id);

        const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const taskName = `${TEST_PREFIX} TS Plan C Alias Task ${Date.now()}`;
        const createdTask = parseToolResult(
          await createTask({
            name: taskName,
            note: "plan c alias integration probe",
            project: projectName,
            dueDate,
            tags: [tagA.name, tagB.name],
          })
        ) as { id: string };
        taskId = createdTask.id;
        cleanupTaskIds.push(taskId);

        const canonicalList = parseToolResult(
          await listTasks({
            project: projectName,
            tags: [tagA.name, tagB.name],
            tagFilterMode: "all",
            status: "due_soon",
            sortOrder: "desc",
            limit: 50,
          })
        ) as Array<Record<string, unknown>>;
        const aliasList = parseToolResult(
          await listTasks({
            project: projectName,
            tags: [tagA.name, tagB.name],
            tagFilterMode: "AND",
            status: "due soon",
            sortOrder: "descending",
            limit: 50,
          })
        ) as Array<Record<string, unknown>>;
        expect(canonicalList.some((item) => String(item.id) === taskId)).toBe(true);
        expect(aliasList.some((item) => String(item.id) === taskId)).toBe(true);

        const canonicalSearch = parseToolResult(
          await searchTasks({
            query: "plan c alias integration probe",
            project: projectName,
            tagFilterMode: "any",
            status: "due_soon",
            sortOrder: "asc",
            limit: 50,
          })
        ) as Array<Record<string, unknown>>;
        const aliasSearch = parseToolResult(
          await searchTasks({
            query: "plan c alias integration probe",
            project: projectName,
            tagFilterMode: "OR",
            status: "due-soon",
            sortOrder: "ascending",
            limit: 50,
          })
        ) as Array<Record<string, unknown>>;
        expect(canonicalSearch.some((item) => String(item.id) === taskId)).toBe(true);
        expect(aliasSearch.some((item) => String(item.id) === taskId)).toBe(true);

        const canonicalCounts = parseToolResult(
          await getTaskCounts({
            project: projectName,
            tags: [tagA.name, tagB.name],
            tagFilterMode: "all",
          })
        ) as { total?: number };
        const aliasCounts = parseToolResult(
          await getTaskCounts({
            project: projectName,
            tags: [tagA.name, tagB.name],
            tagFilterMode: "AND",
          })
        ) as { total?: number };
        expect(canonicalCounts.total).toBe(aliasCounts.total);
      } finally {
        for (const id of extraTagIds) {
          try {
            await deleteTag({ tag_name_or_id: id });
          } catch {
            continue;
          }
        }
      }
    }
  );

  test(
    "test_plan_b_statuses_are_canonical_in_tags_and_folder_projects",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createTag = getHandler("create_tag");
      const listTags = getHandler("list_tags");
      const deleteTag = getHandler("delete_tag");
      const createFolder = getHandler("create_folder");
      const getFolder = getHandler("get_folder");
      const deleteFolder = getHandler("delete_folder");
      const createProject = getHandler("create_project");
      const completeProject = getHandler("complete_project");

      const allowedStatuses = new Set(["active", "on_hold", "dropped"]);
      let tagId: string | null = null;
      let folderId: string | null = null;
      let projectId: string | null = null;
      try {
        const createdTag = parseToolResult(
          await createTag({ name: `${TEST_PREFIX} TS Plan B Status Tag ${Date.now()}` })
        ) as { id: string };
        tagId = createdTag.id;

        const createdFolder = parseToolResult(
          await createFolder({ name: `${TEST_PREFIX} TS Plan B Status Folder ${Date.now()}` })
        ) as { id: string; name: string };
        folderId = createdFolder.id;

        const createdProject = parseToolResult(
          await createProject({
            name: `${TEST_PREFIX} TS Plan B Status Project ${Date.now()}`,
            folder: createdFolder.name,
          })
        ) as { id: string };
        projectId = createdProject.id;

        const tags = parseToolResult(await listTags({ statusFilter: "all", limit: 100 })) as Array<
          Record<string, unknown>
        >;
        const tagEntry = tags.find((item) => String(item.id) === tagId);
        expect(tagEntry).toBeDefined();
        expect(allowedStatuses.has(String(tagEntry?.status))).toBe(true);

        const folder = parseToolResult(
          await getFolder({ folder_name_or_id: folderId })
        ) as Record<string, unknown>;
        expect(allowedStatuses.has(String(folder.status))).toBe(true);
        const projects = (folder.projects ?? []) as Array<Record<string, unknown>>;
        const nestedProject = projects.find((item) => String(item.id) === projectId);
        expect(nestedProject).toBeDefined();
        expect(allowedStatuses.has(String(nestedProject?.status))).toBe(true);
      } finally {
        if (tagId) {
          try {
            await deleteTag({ tag_name_or_id: tagId });
          } catch {
            tagId = null;
          }
        }
        if (projectId) {
          try {
            await completeProject({ project_id_or_name: projectId });
          } catch {
            projectId = null;
          }
        }
        if (folderId) {
          try {
            await deleteFolder({ folder_name_or_id: folderId });
          } catch {
            folderId = null;
          }
        }
      }
    }
  );

  test(
    "test_plan_c_alias_inputs_work_for_task_tools",
    { timeout: INTEGRATION_TIMEOUT_MS },
    async () => {
      const createTag = getHandler("create_tag");
      const deleteTag = getHandler("delete_tag");
      const createTask = getHandler("create_task");
      const listTasks = getHandler("list_tasks");
      const searchTasks = getHandler("search_tasks");
      const getTaskCounts = getHandler("get_task_counts");

      let tagId: string | null = null;
      try {
        const tagName = `${TEST_PREFIX} TS Plan C Alias Tag ${Date.now()}`;
        const createdTag = parseToolResult(await createTag({ name: tagName })) as { id: string };
        tagId = createdTag.id;

        const taskName = `${TEST_PREFIX} TS Plan C Alias Task ${Date.now()}`;
        const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
        const createdTask = parseToolResult(
          await createTask({ name: taskName, dueDate, tags: [tagName] })
        ) as { id: string };
        cleanupTaskIds.push(createdTask.id);

        const listed = parseToolResult(
          await listTasks({
            tags: [tagName],
            tagFilterMode: "AND",
            status: "due soon",
            sortOrder: "descending",
            limit: 100,
          })
        ) as Array<Record<string, unknown>>;
        const listedMatch = listed.find((item) => String(item.id) === createdTask.id);
        expect(listedMatch).toBeDefined();
        expect(String(listedMatch?.taskStatus)).toBe("due_soon");

        const searched = parseToolResult(
          await searchTasks({
            query: taskName,
            tags: [tagName],
            tagFilterMode: "and",
            status: "due-soon",
            sortOrder: "descending",
            limit: 100,
          })
        ) as Array<Record<string, unknown>>;
        const searchedMatch = searched.find((item) => String(item.id) === createdTask.id);
        expect(searchedMatch).toBeDefined();
        expect(String(searchedMatch?.taskStatus)).toBe("due_soon");

        const counts = parseToolResult(
          await getTaskCounts({ tags: [tagName], tagFilterMode: "AND" })
        ) as { total?: number };
        expect(typeof counts.total).toBe("number");
        expect((counts.total ?? 0) >= 1).toBe(true);
      } finally {
        if (tagId !== null) {
          try {
            await deleteTag({ tag_name_or_id: tagId });
          } catch {
            tagId = null;
          }
        }
      }
    }
  );
});
