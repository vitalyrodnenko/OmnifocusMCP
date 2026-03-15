import { beforeEach, describe, expect, test, vi } from "vitest";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const registeredTools = new Map<string, ToolHandler>();
const registeredSchemas = new Map<string, unknown>();
const runOmniJsMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class MockMcpServer {
    tool(name: string, _description: string, schema: unknown, handler: ToolHandler): void {
      registeredTools.set(name, handler);
      registeredSchemas.set(name, schema);
    }

    registerResource(): void {}

    registerPrompt(): void {}

    resource(): void {}

    prompt(): void {}

    async connect(): Promise<void> {}
  }

  return { McpServer: MockMcpServer };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class MockTransport {},
}));

vi.mock("../src/jxa.js", () => ({
  escapeForJxa: (value: string) => JSON.stringify(value),
  runOmniJs: (...args: unknown[]) => runOmniJsMock(...args),
}));

describe("tool happy paths", () => {
  beforeEach(async () => {
    registeredTools.clear();
    registeredSchemas.clear();
    runOmniJsMock.mockReset();
    vi.resetModules();
    await import("../src/index.js");
  });

  test("get_inbox returns tool text payload", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "a1", name: "Inbox item" }]);
    const handler = registeredTools.get("get_inbox");
    expect(handler).toBeDefined();
    const result = await handler!({ limit: 5 });
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "a1", name: "Inbox item" }]);
    expect(runOmniJsMock).toHaveBeenCalledTimes(1);
    expect(String(runOmniJsMock.mock.calls[0][0])).toContain("const tasks = inbox");
  });

  test("get_forecast returns enriched sections and counts", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      overdue: [{ id: "t1", completionDate: null, hasChildren: false }],
      dueToday: [{ id: "t2", completionDate: null, hasChildren: true }],
      flagged: [{ id: "t3", completionDate: null, hasChildren: false }],
      deferred: [{ id: "t4", completionDate: null, hasChildren: false }],
      dueThisWeek: [{ id: "t5", completionDate: null, hasChildren: false }],
      counts: {
        overdueCount: 2,
        dueTodayCount: 1,
        flaggedCount: 3,
        deferredCount: 4,
        dueThisWeekCount: 5,
      },
    });
    const handler = registeredTools.get("get_forecast");
    expect(handler).toBeDefined();
    const result = await handler!({ limit: 6 });
    expect(JSON.parse(result.content[0].text)).toEqual({
      overdue: [{ id: "t1", completionDate: null, hasChildren: false }],
      dueToday: [{ id: "t2", completionDate: null, hasChildren: true }],
      flagged: [{ id: "t3", completionDate: null, hasChildren: false }],
      deferred: [{ id: "t4", completionDate: null, hasChildren: false }],
      dueThisWeek: [{ id: "t5", completionDate: null, hasChildren: false }],
      counts: {
        overdueCount: 2,
        dueTodayCount: 1,
        flaggedCount: 3,
        deferredCount: 4,
        dueThisWeekCount: 5,
      },
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const dueThisWeek = [];");
    expect(script).toContain("const deferred = [];");
    expect(script).toContain("const counts = {");
    expect(script).toContain("completionDate: task.completionDate ? task.completionDate.toISOString() : null,");
    expect(script).toContain("hasChildren: task.hasChildren");
    expect(script).toContain("if (dueThisWeek.length < 6) dueThisWeek.push(toTaskSummary(task));");
  });

  test("list_tasks builds filtered script and returns payload", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "t1", name: "Task 1" }]);
    const handler = registeredTools.get("list_tasks");
    expect(handler).toBeDefined();
    const result = await handler!({
      project: "Errands",
      tag: "Home",
      flagged: true,
      status: "available",
      limit: 10,
    });
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "t1", name: "Task 1" }]);
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const projectFilter = \"Errands\";");
    expect(script).toContain("const tagNames = [\"Home\"];");
    expect(script).toContain("const tagFilterMode = \"any\";");
    expect(script).toContain("const flaggedFilter = true;");
  });

  test("list_tasks supports added and changed date filters", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      {
        id: "t-added",
        name: "Task with dates",
        addedDate: "2026-03-10T10:00:00Z",
        changedDate: "2026-03-11T10:00:00Z",
      },
    ]);
    const handler = registeredTools.get("list_tasks");
    expect(handler).toBeDefined();
    const result = await handler!({
      status: "all",
      added_after: "2026-03-01T00:00:00Z",
      added_before: "2026-03-31T23:59:59Z",
      changed_after: "2026-03-02T00:00:00Z",
      changed_before: "2026-03-30T23:59:59Z",
      limit: 25,
    });
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "t-added",
        name: "Task with dates",
        addedDate: "2026-03-10T10:00:00Z",
        changedDate: "2026-03-11T10:00:00Z",
      },
    ]);
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const addedAfterRaw = "2026-03-01T00:00:00Z";');
    expect(script).toContain('const addedBeforeRaw = "2026-03-31T23:59:59Z";');
    expect(script).toContain('const changedAfterRaw = "2026-03-02T00:00:00Z";');
    expect(script).toContain('const changedBeforeRaw = "2026-03-30T23:59:59Z";');
    expect(script).toContain('const addedAfter = parseOptionalDate(addedAfterRaw, "added_after");');
    expect(script).toContain('const addedBefore = parseOptionalDate(addedBeforeRaw, "added_before");');
    expect(script).toContain('const changedAfter = parseOptionalDate(changedAfterRaw, "changed_after");');
    expect(script).toContain('const changedBefore = parseOptionalDate(changedBeforeRaw, "changed_before");');
    expect(script).toContain("if (addedBefore !== null && !(task.added !== null && task.added <= addedBefore)) return false;");
    expect(script).toContain("if (addedAfter !== null && !(task.added !== null && task.added >= addedAfter)) return false;");
    expect(script).toContain(
      "if (changedBefore !== null && !(task.modified !== null && task.modified <= changedBefore)) return false;"
    );
    expect(script).toContain(
      "if (changedAfter !== null && !(task.modified !== null && task.modified >= changedAfter)) return false;"
    );
    expect(script).toContain("addedDate: task.added ? task.added.toISOString() : null,");
    expect(script).toContain("changedDate: task.modified ? task.modified.toISOString() : null,");
  });

  test("list_tasks propagates invalid added and changed date field errors", async () => {
    const handler = registeredTools.get("list_tasks");
    expect(handler).toBeDefined();
    const cases: Array<{ field: "added_after" | "added_before" | "changed_after" | "changed_before" }> = [
      { field: "added_after" },
      { field: "added_before" },
      { field: "changed_after" },
      { field: "changed_before" },
    ];
    for (const item of cases) {
      runOmniJsMock.mockRejectedValueOnce(
        new Error(`${item.field} must be a valid ISO 8601 date string.`)
      );
      const result = await handler!({
        status: "all",
        [item.field]: "not-a-date",
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: `${item.field} must be a valid ISO 8601 date string.`,
      });
    }
  });

  test("search_tasks supports added and changed filters and payload dates", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      {
        id: "s1",
        name: "search hit",
        addedDate: "2026-03-12T10:00:00Z",
        changedDate: "2026-03-13T10:00:00Z",
      },
    ]);
    const handler = registeredTools.get("search_tasks");
    expect(handler).toBeDefined();
    const result = await handler!({
      query: "search",
      status: "all",
      added_after: "2026-03-01T00:00:00Z",
      added_before: "2026-03-31T23:59:59Z",
      changed_after: "2026-03-02T00:00:00Z",
      changed_before: "2026-03-30T23:59:59Z",
      limit: 5,
    });
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "s1",
        name: "search hit",
        addedDate: "2026-03-12T10:00:00Z",
        changedDate: "2026-03-13T10:00:00Z",
      },
    ]);
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const queryFilter = "search".toLowerCase();');
    expect(script).toContain('const addedAfterRaw = "2026-03-01T00:00:00Z";');
    expect(script).toContain('const addedBeforeRaw = "2026-03-31T23:59:59Z";');
    expect(script).toContain('const changedAfterRaw = "2026-03-02T00:00:00Z";');
    expect(script).toContain('const changedBeforeRaw = "2026-03-30T23:59:59Z";');
    expect(script).toContain("if (addedBefore !== null && !(task.added !== null && task.added <= addedBefore)) return false;");
    expect(script).toContain("if (addedAfter !== null && !(task.added !== null && task.added >= addedAfter)) return false;");
    expect(script).toContain(
      "if (changedBefore !== null && !(task.modified !== null && task.modified <= changedBefore)) return false;"
    );
    expect(script).toContain(
      "if (changedAfter !== null && !(task.modified !== null && task.modified >= changedAfter)) return false;"
    );
    expect(script).toContain("addedDate: task.added ? task.added.toISOString() : null,");
    expect(script).toContain("changedDate: task.modified ? task.modified.toISOString() : null,");
  });

  test("get_inbox and get_task include addedDate and changedDate payload fields", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      {
        id: "inbox-1",
        name: "Inbox dated",
        addedDate: "2026-03-08T08:00:00Z",
        changedDate: "2026-03-09T09:00:00Z",
      },
    ]);
    runOmniJsMock.mockResolvedValueOnce({
      id: "task-1",
      name: "Detailed task",
      addedDate: "2026-03-10T10:00:00Z",
      changedDate: "2026-03-11T11:00:00Z",
    });

    const inboxHandler = registeredTools.get("get_inbox");
    const taskHandler = registeredTools.get("get_task");
    expect(inboxHandler).toBeDefined();
    expect(taskHandler).toBeDefined();

    const inboxResult = await inboxHandler!({ limit: 5 });
    expect(JSON.parse(inboxResult.content[0].text)).toEqual([
      {
        id: "inbox-1",
        name: "Inbox dated",
        addedDate: "2026-03-08T08:00:00Z",
        changedDate: "2026-03-09T09:00:00Z",
      },
    ]);
    let script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("addedDate: task.added ? task.added.toISOString() : null,");
    expect(script).toContain("changedDate: task.modified ? task.modified.toISOString() : null,");

    const taskResult = await taskHandler!({ task_id: "task-1" });
    expect(JSON.parse(taskResult.content[0].text)).toEqual({
      id: "task-1",
      name: "Detailed task",
      addedDate: "2026-03-10T10:00:00Z",
      changedDate: "2026-03-11T11:00:00Z",
    });
    script = String(runOmniJsMock.mock.calls[1][0]);
    expect(script).toContain("addedDate: task.added ? task.added.toISOString() : null,");
    expect(script).toContain("changedDate: task.modified ? task.modified.toISOString() : null,");
  });

  test("get_project returns structured project payload", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "p1", name: "Project 1", rootTasks: [] });
    const handler = registeredTools.get("get_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "Project 1" });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "p1", name: "Project 1", rootTasks: [] });
    expect(String(runOmniJsMock.mock.calls[0][0])).toContain("Project not found");
  });

  test("search_projects returns matched project summaries", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      { id: "p8", name: "Personal Admin", status: "active", folderName: "Personal" },
    ]);
    const handler = registeredTools.get("search_projects");
    expect(handler).toBeDefined();
    const result = await handler!({ query: "admin", limit: 7 });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "p8", name: "Personal Admin", status: "active", folderName: "Personal" },
    ]);
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const queryValue = "admin";');
    expect(script).toContain("return projectsMatching(queryValue)");
    expect(script).toContain(".slice(0, 7)");
    expect(script).toContain("folderName: project.folder ? project.folder.name : null");
  });

  test("search_projects returns error for empty query", async () => {
    const handler = registeredTools.get("search_projects");
    expect(handler).toBeDefined();
    const result = await handler!({ query: "   ", limit: 7 });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "query must not be empty.",
    });
  });


  test("search_tags returns matched tag summaries", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      { id: "g7", name: "Errands", status: "active", parent: "Personal" },
    ]);
    const handler = registeredTools.get("search_tags");
    expect(handler).toBeDefined();
    const result = await handler!({ query: "err", limit: 6 });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "g7", name: "Errands", status: "active", parent: "Personal" },
    ]);
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const queryValue = "err";');
    expect(script).toContain("return tagsMatching(queryValue)");
    expect(script).toContain(".slice(0, 6)");
    expect(script).toContain("parent: tag.parent ? tag.parent.name : null");
  });

  test("search_tags returns error for empty query", async () => {
    const handler = registeredTools.get("search_tags");
    expect(handler).toBeDefined();
    const result = await handler!({ query: "   ", limit: 6 });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "query must not be empty.",
    });
  });


  test("create_task returns created task summary", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "n1", name: "New task" });
    const handler = registeredTools.get("create_task");
    expect(handler).toBeDefined();
    const result = await handler!({ name: "New task", project: "Errands", tags: ["Home"] });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "n1", name: "New task" });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const taskName = \"New task\";");
    expect(script).toContain("const projectName = \"Errands\";");
  });

  test("create_subtask returns created child task summary", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "child-1",
      name: "Child task",
      parentTaskId: "parent-1",
      parentTaskName: "Parent task",
    });
    const handler = registeredTools.get("create_subtask");
    expect(handler).toBeDefined();
    const result = await handler!({
      name: "Child task",
      parent_task_id: "parent-1",
      note: "detail",
      dueDate: "2026-03-10T10:00:00Z",
      deferDate: "2026-03-09T10:00:00Z",
      flagged: true,
      tags: ["home"],
      estimatedMinutes: 15,
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "child-1",
      name: "Child task",
      parentTaskId: "parent-1",
      parentTaskName: "Parent task",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const taskName = "Child task";');
    expect(script).toContain('const parentTaskId = "parent-1";');
    expect(script).toContain("const task = new Task(taskName, parentTask.ending);");
  });

  test("update_task includes updates payload and returns updated task", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "u1", name: "Updated task", flagged: true });
    const handler = registeredTools.get("update_task");
    expect(handler).toBeDefined();
    const result = await handler!({ task_id: "u1", name: "Updated task", flagged: true });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "u1", name: "Updated task", flagged: true });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const taskId = \"u1\";");
    expect(script).toContain("const updates = {\"name\":\"Updated task\",\"flagged\":true};");
  });

  test("move_task supports parent_task_id destination", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "task-1",
      name: "Task One",
      projectName: "Work",
      inInbox: false,
    });
    const handler = registeredTools.get("move_task");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "task-1",
      parent_task_id: "parent-1",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "task-1",
      name: "Task One",
      projectName: "Work",
      inInbox: false,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const taskId = "task-1";');
    expect(script).toContain('const parentTaskId = "parent-1";');
    expect(script).toContain("moveTasks([task], destinationInfo.location);");
    expect(script).toContain('return { mode: "parent", location: parentTask.ending };');
    expect(script).toContain('throw new Error("Cannot move a task under itself.");');
    expect(script).toContain('throw new Error("Cannot move a task under its own descendant.");');
    expect(script).toContain("inInbox: task.inInbox");
  });

  test("move_tasks_batch supports project destination mode", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      requested_count: 2,
      moved_count: 2,
      failed_count: 0,
      partial_success: false,
      results: [
        {
          id: "task-1",
          name: "Task One",
          moved: true,
          destination: { mode: "project", projectName: "Work" },
          error: null,
        },
        {
          id: "task-2",
          name: "Task Two",
          moved: true,
          destination: { mode: "project", projectName: "Work" },
          error: null,
        },
      ],
    });
    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_ids: ["task-1", "task-2"],
      project: "Work",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      requested_count: 2,
      moved_count: 2,
      failed_count: 0,
      partial_success: false,
      results: [
        {
          id: "task-1",
          name: "Task One",
          moved: true,
          destination: { mode: "project", projectName: "Work" },
          error: null,
        },
        {
          id: "task-2",
          name: "Task Two",
          moved: true,
          destination: { mode: "project", projectName: "Work" },
          error: null,
        },
      ],
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const taskIds = ["task-1"');
    expect(script).toContain('const projectName = "Work";');
    expect(script).toContain("moveTasks(movableTasks, destinationInfo.location);");
    expect(script).toContain("partial_success");
    expect(script).toContain("moved_count");
  });

  test("move_tasks_batch supports inbox and parent destinations", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      requested_count: 2,
      moved_count: 2,
      failed_count: 0,
      partial_success: false,
      results: [
        {
          id: "task-1",
          name: "Task One",
          moved: true,
          destination: { mode: "inbox" },
          error: null,
        },
        {
          id: "task-2",
          name: "Task Two",
          moved: true,
          destination: { mode: "inbox" },
          error: null,
        },
      ],
    });
    runOmniJsMock.mockResolvedValueOnce({
      requested_count: 2,
      moved_count: 1,
      failed_count: 1,
      partial_success: true,
      results: [
        {
          id: "task-3",
          name: "Task Three",
          moved: true,
          destination: {
            mode: "parent",
            parentTaskId: "parent-1",
            parentTaskName: "Parent One",
          },
          error: null,
        },
        {
          id: "missing",
          name: null,
          moved: false,
          destination: {
            mode: "parent",
            parentTaskId: "parent-1",
            parentTaskName: "Parent One",
          },
          error: "Task not found.",
        },
      ],
    });

    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();

    const inboxResult = await handler!({ task_ids: ["task-1", "task-2"] });
    expect(JSON.parse(inboxResult.content[0].text)).toEqual({
      requested_count: 2,
      moved_count: 2,
      failed_count: 0,
      partial_success: false,
      results: [
        {
          id: "task-1",
          name: "Task One",
          moved: true,
          destination: { mode: "inbox" },
          error: null,
        },
        {
          id: "task-2",
          name: "Task Two",
          moved: true,
          destination: { mode: "inbox" },
          error: null,
        },
      ],
    });
    let script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const projectName = null;");
    expect(script).toContain("const parentTaskId = null;");
    expect(script).toContain('summary: { mode: "inbox" }');

    const parentResult = await handler!({
      task_ids: ["task-3", "missing"],
      parent_task_id: "parent-1",
    });
    expect(JSON.parse(parentResult.content[0].text)).toEqual({
      requested_count: 2,
      moved_count: 1,
      failed_count: 1,
      partial_success: true,
      results: [
        {
          id: "task-3",
          name: "Task Three",
          moved: true,
          destination: {
            mode: "parent",
            parentTaskId: "parent-1",
            parentTaskName: "Parent One",
          },
          error: null,
        },
        {
          id: "missing",
          name: null,
          moved: false,
          destination: {
            mode: "parent",
            parentTaskId: "parent-1",
            parentTaskName: "Parent One",
          },
          error: "Task not found.",
        },
      ],
    });
    script = String(runOmniJsMock.mock.calls[1][0]);
    expect(script).toContain('const parentTaskId = "parent-1";');
    expect(script).toContain("Cannot move tasks under their own descendant.");
  });

  test("move_tasks_batch validates empty, ambiguous, duplicate, and self-parenting inputs", async () => {
    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();

    const emptyArrayResult = await handler!({
      task_ids: [],
    });
    expect(emptyArrayResult.isError).toBe(true);
    expect(JSON.parse(emptyArrayResult.content[0].text)).toEqual({
      error: "task_ids must contain at least one task id.",
    });

    const emptyIdResult = await handler!({
      task_ids: ["task-1", "   "],
    });
    expect(emptyIdResult.isError).toBe(true);
    expect(JSON.parse(emptyIdResult.content[0].text)).toEqual({
      error: "each task id must be a non-empty string.",
    });

    const ambiguousResult = await handler!({
      task_ids: ["task-1"],
      project: "Work",
      parent_task_id: "parent-1",
    });
    expect(ambiguousResult.isError).toBe(true);
    expect(JSON.parse(ambiguousResult.content[0].text)).toEqual({
      error: "provide either project or parent_task_id, not both (destination is ambiguous).",
    });

    const duplicateResult = await handler!({
      task_ids: ["task-1", "task-1"],
      project: "Work",
    });
    expect(duplicateResult.isError).toBe(true);
    expect(JSON.parse(duplicateResult.content[0].text).error).toContain(
      "task_ids must not contain duplicate"
    );

    const selfParentResult = await handler!({
      task_ids: ["task-1", "task-2"],
      parent_task_id: "task-1",
    });
    expect(selfParentResult.isError).toBe(true);
    expect(JSON.parse(selfParentResult.content[0].text)).toEqual({
      error: "parent_task_id must not be included in task_ids (cannot move a task under itself).",
    });
  });

  test("move_tasks_batch returns error for ambiguous destination inputs", async () => {
    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_ids: ["task-1"],
      project: "Work",
      parent_task_id: "parent-1",
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "provide either project or parent_task_id, not both (destination is ambiguous).",
    });
  });

  test("move_tasks_batch returns error for duplicate task ids", async () => {
    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_ids: ["task-1", "task-1"],
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain(
      "task_ids must not contain duplicate"
    );
  });

  test("move_tasks_batch returns error when parent_task_id appears in task_ids", async () => {
    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_ids: ["task-1", "task-2"],
      parent_task_id: "task-2",
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "parent_task_id must not be included in task_ids (cannot move a task under itself).",
    });
  });

  test("move_tasks_batch parent destination script includes cycle guard", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      requested_count: 1,
      moved_count: 1,
      failed_count: 0,
      results: [
        {
          id: "task-1",
          name: "Task One",
          moved: true,
          destination: {
            mode: "parent",
            parentTaskId: "parent-1",
            parentTaskName: "Parent One",
          },
          error: null,
        },
      ],
    });
    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_ids: ["task-1"],
      parent_task_id: "parent-1",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      requested_count: 1,
      moved_count: 1,
      failed_count: 0,
      results: [
        {
          id: "task-1",
          name: "Task One",
          moved: true,
          destination: {
            mode: "parent",
            parentTaskId: "parent-1",
            parentTaskName: "Parent One",
          },
          error: null,
        },
      ],
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const parentTaskId = "parent-1";');
    expect(script).toContain('if (taskIds.includes(ancestor.id.primaryKey)) {');
    expect(script).toContain('throw new Error("Cannot move tasks under their own descendant.");');
  });

  test("move_tasks_batch propagates cycle rejection errors", async () => {
    runOmniJsMock.mockRejectedValueOnce(new Error("Cannot move tasks under their own descendant."));
    const handler = registeredTools.get("move_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_ids: ["task-1", "task-2"],
      parent_task_id: "parent-1",
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "Cannot move tasks under their own descendant.",
    });
  });

  test("move_task supports project destination mode", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "task-2",
      name: "Task Two",
      projectName: "Errands",
      inInbox: false,
    });
    const handler = registeredTools.get("move_task");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "task-2",
      project: "Errands",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "task-2",
      name: "Task Two",
      projectName: "Errands",
      inInbox: false,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const taskId = "task-2";');
    expect(script).toContain('const projectName = "Errands";');
    expect(script).toContain('return { mode: "project", location: targetProject.ending };');
  });

  test("move_task defaults to inbox when destination omitted", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "task-3",
      name: "Task Three",
      projectName: null,
      inInbox: true,
    });
    const handler = registeredTools.get("move_task");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "task-3",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "task-3",
      name: "Task Three",
      projectName: null,
      inInbox: true,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const projectName = null;");
    expect(script).toContain("const parentTaskId = null;");
    expect(script).toContain('return { mode: "inbox", location: inbox.ending };');
  });

  test("move_task rejects ambiguous destination inputs", async () => {
    const handler = registeredTools.get("move_task");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "task-4",
      project: "Work",
      parent_task_id: "parent-1",
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "provide either project or parent_task_id, not both (destination is ambiguous).",
    });
  });

  test("move_task propagates self-parenting and descendant-cycle errors", async () => {
    runOmniJsMock.mockRejectedValueOnce(new Error("Cannot move a task under itself."));
    runOmniJsMock.mockRejectedValueOnce(new Error("Cannot move a task under its own descendant."));
    const handler = registeredTools.get("move_task");
    expect(handler).toBeDefined();

    const selfParentResult = await handler!({
      task_id: "task-5",
      parent_task_id: "task-5",
    });
    expect(selfParentResult.isError).toBe(true);
    expect(JSON.parse(selfParentResult.content[0].text)).toEqual({
      error: "Cannot move a task under itself.",
    });

    const cycleResult = await handler!({
      task_id: "task-6",
      parent_task_id: "task-7",
    });
    expect(cycleResult.isError).toBe(true);
    expect(JSON.parse(cycleResult.content[0].text)).toEqual({
      error: "Cannot move a task under its own descendant.",
    });
  });

  test("move_task schema uses parity parameter names", () => {
    const schema = registeredSchemas.get("move_task") as Record<string, unknown> | undefined;
    expect(schema).toBeDefined();
    expect(Object.keys(schema ?? {})).toEqual(["task_id", "project", "parent_task_id"]);
  });

  test("move_tasks_batch schema uses parity parameter names", () => {
    const schema = registeredSchemas.get("move_tasks_batch") as
      | Record<string, unknown>
      | undefined;
    expect(schema).toBeDefined();
    expect(Object.keys(schema ?? {})).toEqual(["task_ids", "project", "parent_task_id"]);
  });

  test("uncomplete_task marks completed task incomplete", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "t9", name: "Done", completed: false });
    const handler = registeredTools.get("uncomplete_task");
    expect(handler).toBeDefined();
    const result = await handler!({ task_id: "t9" });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "t9", name: "Done", completed: false });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const taskId = "t9";');
    expect(script).toContain("if (!task.completed) {");
    expect(script).toContain("task.markIncomplete();");
  });

  test("append_to_note appends text to note and returns summary", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "task-1", name: "Task One", type: "task", noteLength: 42 });
    const handler = registeredTools.get("append_to_note");
    expect(handler).toBeDefined();
    const result = await handler!({
      object_type: "task",
      object_id: "task-1",
      text: "more context",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "task-1",
      name: "Task One",
      type: "task",
      noteLength: 42,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const objectType = "task";');
    expect(script).toContain('const objectId = "task-1";');
    expect(script).toContain('const textValue = "more context";');
    expect(script).toContain("obj.appendStringToNote(textValue);");
  });

  test("append_to_note validates object_type, object_id, and text", async () => {
    const handler = registeredTools.get("append_to_note");
    expect(handler).toBeDefined();

    const badType = await handler!({ object_type: "folder", object_id: "task-1", text: "x" });
    expect(badType.isError).toBe(true);
    expect(JSON.parse(badType.content[0].text)).toEqual({
      error: "object_type must be one of: task, project.",
    });

    const badObjectId = await handler!({ object_type: "task", object_id: "   ", text: "x" });
    expect(badObjectId.isError).toBe(true);
    expect(JSON.parse(badObjectId.content[0].text)).toEqual({
      error: "object_id must not be empty.",
    });

    const badText = await handler!({ object_type: "task", object_id: "task-1", text: "   " });
    expect(badText.isError).toBe(true);
    expect(JSON.parse(badText.content[0].text)).toEqual({
      error: "text must not be empty.",
    });
  });

  test("set_task_repetition sets repetition rule", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "t10", name: "Weekly", repetitionRule: "FREQ=WEEKLY" });
    const handler = registeredTools.get("set_task_repetition");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "t10",
      rule_string: "FREQ=WEEKLY",
      schedule_type: "regularly",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "t10",
      name: "Weekly",
      repetitionRule: "FREQ=WEEKLY",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const taskId = "t10";');
    expect(script).toContain('const ruleString = "FREQ=WEEKLY";');
    expect(script).toContain("Task.RepetitionScheduleType.Regularly");
  });

  test("set_task_repetition clears repetition rule when null", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "t10", name: "Weekly", repetitionRule: null });
    const handler = registeredTools.get("set_task_repetition");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "t10",
      rule_string: null,
      schedule_type: "regularly",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "t10",
      name: "Weekly",
      repetitionRule: null,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const ruleString = null;");
    expect(script).toContain("task.repetitionRule = null;");
  });

  test("set_task_repetition supports none schedule type", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "t10", name: "Weekly", repetitionRule: "FREQ=WEEKLY" });
    const handler = registeredTools.get("set_task_repetition");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "t10",
      rule_string: "FREQ=WEEKLY",
      schedule_type: "none",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "t10",
      name: "Weekly",
      repetitionRule: "FREQ=WEEKLY",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("Task.RepetitionScheduleType.None");
  });

  test("set_task_repetition returns error for empty rule string", async () => {
    const handler = registeredTools.get("set_task_repetition");
    expect(handler).toBeDefined();
    const result = await handler!({
      task_id: "t10",
      rule_string: "   ",
      schedule_type: "regularly",
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "rule_string must not be empty when provided.",
    });
  });

  test("delete_tasks_batch returns batch deletion summary payload", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      deleted_count: 2,
      not_found_count: 0,
      results: [
        { id: "t1", name: "Task One", deleted: true },
        { id: "t2", name: "Task Two", deleted: true },
      ],
    });
    const handler = registeredTools.get("delete_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ task_ids: ["t1", "t2"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      deleted_count: 2,
      not_found_count: 0,
      results: [
        { id: "t1", name: "Task One", deleted: true },
        { id: "t2", name: "Task Two", deleted: true },
      ],
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const taskIds = ["t1", "t2"];');
    expect(script).toContain("deleteObject(task);");
    expect(script).toContain("deleted_count");
  });

  test("delete_tasks_batch supports partial not-found results", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      deleted_count: 1,
      not_found_count: 1,
      results: [
        { id: "t1", name: "Task One", deleted: true },
        { id: "missing", deleted: false, error: "not found" },
      ],
    });
    const handler = registeredTools.get("delete_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ task_ids: ["t1", "missing"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      deleted_count: 1,
      not_found_count: 1,
      results: [
        { id: "t1", name: "Task One", deleted: true },
        { id: "missing", deleted: false, error: "not found" },
      ],
    });
  });

  test("delete_tasks_batch returns error for empty task_ids array", async () => {
    const handler = registeredTools.get("delete_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ task_ids: [] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "task_ids must contain at least one task id.",
    });
  });

  test("delete_tasks_batch returns error for empty trimmed task id", async () => {
    const handler = registeredTools.get("delete_tasks_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ task_ids: ["t1", "   "] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "each task id must be a non-empty string.",
    });
  });

  test("complete_project marks project complete and returns confirmation", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "p1", name: "Project 1", completed: true });
    const handler = registeredTools.get("complete_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "Project 1" });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "p1", name: "Project 1", completed: true });
    expect(String(runOmniJsMock.mock.calls[0][0])).toContain("project.markComplete()");
  });

  test("uncomplete_project marks completed project active", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "p1", name: "Project 1", status: "active" });
    const handler = registeredTools.get("uncomplete_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "Project 1" });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "p1",
      name: "Project 1",
      status: "active",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("if (!project.completed) {");
    expect(script).toContain("project.markIncomplete()");
    expect(script).toContain('status: "active"');
  });

  test("delete_project deletes project and returns deletion summary", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "p5",
      name: "Project Five",
      deleted: true,
      taskCount: 3,
    });
    const handler = registeredTools.get("delete_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "p5" });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "p5",
      name: "Project Five",
      deleted: true,
      taskCount: 3,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const projectFilter = "p5";');
    expect(script).toContain("const taskCount = document.flattenedTasks.filter");
    expect(script).toContain("deleteObject(project);");
    expect(script).toContain("taskCount: taskCount");
  });

  test("delete_project returns error for empty project id or name", async () => {
    const handler = registeredTools.get("delete_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "project_id_or_name must not be empty.",
    });
  });

  test("move_project returns error for empty folder when provided", async () => {
    const handler = registeredTools.get("move_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "p6", folder: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "folder must not be empty when provided.",
    });
  });

  test("move_project supports moving project to top level", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "p6", name: "Project Six", folderName: null });
    const handler = registeredTools.get("move_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "p6", folder: null });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "p6",
      name: "Project Six",
      folderName: null,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain("const folderName = null;");
    expect(
      script.includes("const destination = (() => {") || script.includes("let destination;")
    ).toBe(true);
    expect(
      script.includes("if (folderName === null) return library.ending;") ||
        script.includes("destination = library.ending;")
    ).toBe(true);
    expect(script).toContain("moveSections([project], destination);");
    expect(script).toContain("folderName: folderName");
  });

  test("move_project returns error for empty project id or name", async () => {
    const handler = registeredTools.get("move_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "   ", folder: "Work" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "project_id_or_name must not be empty.",
    });
  });

  test("set_project_status sets organizational project status", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "p4", name: "Project Four", status: "on_hold" });
    const handler = registeredTools.get("set_project_status");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "p4", status: "on_hold" });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "p4",
      name: "Project Four",
      status: "on_hold",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const projectFilter = "p4";');
    expect(script).toContain('const statusValue = "on_hold";');
    expect(script).toContain("Project.Status.OnHold");
    expect(script).toContain("project.status = targetStatus;");
  });

  test("update_project updates provided fields and returns project summary", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "p3",
      name: "Updated Project",
      status: "active",
      folderName: "Work",
      taskCount: 3,
      remainingTaskCount: 2,
      deferDate: "2026-03-01T10:00:00Z",
      dueDate: "2026-03-07T10:00:00Z",
      note: "updated note",
      flagged: true,
      sequential: false,
      completedByChildren: true,
      tags: ["work", "focus"],
      reviewInterval: "2 weeks",
    });
    const handler = registeredTools.get("update_project");
    expect(handler).toBeDefined();
    const result = await handler!({
      project_id_or_name: "p3",
      name: "Updated Project",
      note: "updated note",
      dueDate: "2026-03-07T10:00:00Z",
      deferDate: "2026-03-01T10:00:00Z",
      flagged: true,
      tags: ["work", "focus"],
      sequential: false,
      completedByChildren: true,
      reviewInterval: "2 weeks",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "p3",
      name: "Updated Project",
      status: "active",
      folderName: "Work",
      taskCount: 3,
      remainingTaskCount: 2,
      deferDate: "2026-03-01T10:00:00Z",
      dueDate: "2026-03-07T10:00:00Z",
      note: "updated note",
      flagged: true,
      sequential: false,
      completedByChildren: true,
      tags: ["work", "focus"],
      reviewInterval: "2 weeks",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const projectFilter = "p3";');
    expect(script).toContain('"completedByChildren":true');
    expect(script).toContain("project.reviewInterval = parseReviewInterval(updates.reviewInterval);");
    expect(script).toContain("existingTags.forEach");
    expect(script).toContain("project.addTag(tag);");
  });

  test("update_tag updates name and status", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "tag-1", name: "Next", status: "on_hold" });
    const handler = registeredTools.get("update_tag");
    expect(handler).toBeDefined();
    const result = await handler!({
      tag_name_or_id: "tag-1",
      name: "Next",
      status: "on_hold",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "tag-1",
      name: "Next",
      status: "on_hold",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const tagFilter = "tag-1";');
    expect(script).toContain('const newName = "Next";');
    expect(script).toContain('const statusValue = "on_hold";');
    expect(script).toContain("Tag.Status.OnHold");
    expect(script).toContain("tag.status = targetStatus;");
  });

  test("update_tag returns error when no update fields are provided", async () => {
    const handler = registeredTools.get("update_tag");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_name_or_id: "tag-1" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "at least one field must be provided: name or status.",
    });
  });

  test("delete_tag deletes tag and returns deletion summary", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "tag-2",
      name: "Someday",
      deleted: true,
      taskCount: 4,
    });
    const handler = registeredTools.get("delete_tag");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_name_or_id: "tag-2" });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "tag-2",
      name: "Someday",
      deleted: true,
      taskCount: 4,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const tagFilter = "tag-2";');
    expect(script).toContain("const taskCount = tag.tasks.length;");
    expect(script).toContain("deleteObject(tag);");
    expect(script).toContain("taskCount: taskCount");
  });

  test("delete_tag returns error for empty tag id or name", async () => {
    const handler = registeredTools.get("delete_tag");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_name_or_id: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "tag_name_or_id must not be empty.",
    });
  });

  test("create_folder creates a folder under optional parent", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "folder-1", name: "Areas" });
    const handler = registeredTools.get("create_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ name: "Areas", parent: "Work" });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "folder-1", name: "Areas" });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const folderName = "Areas";');
    expect(script).toContain('const parentName = "Work";');
    expect(script).toContain("return new Folder(folderName, parentFolder.ending);");
  });

  test("create_folder returns error for empty parent when provided", async () => {
    const handler = registeredTools.get("create_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ name: "Areas", parent: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "parent must not be empty when provided.",
    });
  });

  test("get_folder returns folder details with projects and subfolders", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "folder-1",
      name: "Work",
      status: "active",
      parentName: null,
      projects: [{ id: "project-1", name: "Launch", status: "active" }],
      subfolders: [{ id: "folder-2", name: "Q1" }],
    });
    const handler = registeredTools.get("get_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_name_or_id: "folder-1" });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "folder-1",
      name: "Work",
      status: "active",
      parentName: null,
      projects: [{ id: "project-1", name: "Launch", status: "active" }],
      subfolders: [{ id: "folder-2", name: "Q1" }],
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const folderFilter = "folder-1";');
    expect(script).toContain("Folder not found");
    expect(script).toContain("projects: folder.projects.map");
    expect(script).toContain("subfolders: folder.folders.map");
  });

  test("get_folder returns folder details with direct children", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "folder-1",
      name: "Work",
      status: "active",
      parentName: null,
      projects: [{ id: "project-1", name: "Launch", status: "active" }],
      subfolders: [{ id: "folder-2", name: "Q1" }],
    });
    const handler = registeredTools.get("get_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_name_or_id: "folder-1" });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "folder-1",
      name: "Work",
      status: "active",
      parentName: null,
      projects: [{ id: "project-1", name: "Launch", status: "active" }],
      subfolders: [{ id: "folder-2", name: "Q1" }],
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const folderFilter = "folder-1";');
    expect(script).toContain("Folder not found");
    expect(script).toContain("projects: folder.projects.map");
    expect(script).toContain("subfolders: folder.folders.map");
  });

  test("get_folder returns error for empty folder id or name", async () => {
    const handler = registeredTools.get("get_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_name_or_id: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "folder_name_or_id must not be empty.",
    });
  });

  test("update_folder updates name and status", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "folder-1", name: "Areas", status: "dropped" });
    const handler = registeredTools.get("update_folder");
    expect(handler).toBeDefined();
    const result = await handler!({
      folder_name_or_id: "folder-1",
      name: "Areas",
      status: "dropped",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "folder-1",
      name: "Areas",
      status: "dropped",
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const folderFilter = "folder-1";');
    expect(script).toContain('const newName = "Areas";');
    expect(script).toContain('const statusValue = "dropped";');
    expect(script).toContain("Folder.Status.Dropped");
    expect(script).toContain("folder.status = targetStatus;");
  });

  test("update_folder returns error when no update fields are provided", async () => {
    const handler = registeredTools.get("update_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_name_or_id: "folder-1" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "at least one field must be provided: name or status.",
    });
  });

  test("update_folder returns error for unsupported status", async () => {
    const handler = registeredTools.get("update_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_name_or_id: "folder-1", status: "on_hold" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "status must be one of: active, dropped.",
    });
  });

  test("delete_folder deletes folder and returns deletion summary", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "folder-1",
      name: "Areas",
      deleted: true,
      projectCount: 2,
      subfolderCount: 1,
    });
    const handler = registeredTools.get("delete_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_name_or_id: "folder-1" });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "folder-1",
      name: "Areas",
      deleted: true,
      projectCount: 2,
      subfolderCount: 1,
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const folderFilter = "folder-1";');
    expect(script).toContain("const projectCount = folder.projects.length;");
    expect(script).toContain("const subfolderCount = folder.folders.length;");
    expect(script).toContain("deleteObject(folder);");
    expect(script).toContain("projectCount: projectCount");
    expect(script).toContain("subfolderCount: subfolderCount");
  });

  test("delete_folder returns error for empty folder id or name", async () => {
    const handler = registeredTools.get("delete_folder");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_name_or_id: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "folder_name_or_id must not be empty.",
    });
  });

  test("delete_projects_batch returns summary with itemized results", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      summary: { requested: 2, deleted: 2, failed: 0 },
      partial_success: false,
      results: [
        { id_or_name: "p1", id: "p1", name: "Project One", deleted: true, error: null },
        { id_or_name: "Project Two", id: "p2", name: "Project Two", deleted: true, error: null },
      ],
    });
    const handler = registeredTools.get("delete_projects_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ project_ids_or_names: ["p1", "Project Two"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      summary: { requested: 2, deleted: 2, failed: 0 },
      partial_success: false,
      results: [
        { id_or_name: "p1", id: "p1", name: "Project One", deleted: true, error: null },
        { id_or_name: "Project Two", id: "p2", name: "Project Two", deleted: true, error: null },
      ],
    });
    const script = String(runOmniJsMock.mock.calls[0][0]);
    expect(script).toContain('const projectIdsOrNames = ["p1","Project Two"];');
    expect(script).toContain("partial_success");
  });

  test("delete_projects_batch supports partial success", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      summary: { requested: 2, deleted: 1, failed: 1 },
      partial_success: true,
      results: [
        { id_or_name: "p1", id: "p1", name: "Project One", deleted: true, error: null },
        { id_or_name: "missing", id: null, name: null, deleted: false, error: "not found" },
      ],
    });
    const handler = registeredTools.get("delete_projects_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ project_ids_or_names: ["p1", "missing"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      summary: { requested: 2, deleted: 1, failed: 1 },
      partial_success: true,
      results: [
        { id_or_name: "p1", id: "p1", name: "Project One", deleted: true, error: null },
        { id_or_name: "missing", id: null, name: null, deleted: false, error: "not found" },
      ],
    });
  });

  test("delete_projects_batch returns error for empty array", async () => {
    const handler = registeredTools.get("delete_projects_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ project_ids_or_names: [] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "project_ids_or_names must contain at least one project id or name.",
    });
  });

  test("delete_projects_batch returns error for empty trimmed item", async () => {
    const handler = registeredTools.get("delete_projects_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ project_ids_or_names: ["p1", "   "] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "each project id or name must be a non-empty string.",
    });
  });

  test("delete_projects_batch returns error for duplicates", async () => {
    const handler = registeredTools.get("delete_projects_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ project_ids_or_names: ["p1", "p1"] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "project_ids_or_names must not contain duplicates: p1",
    });
  });

  test("delete_tags_batch returns summary with itemized results", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      summary: { requested: 2, deleted: 2, failed: 0 },
      partial_success: false,
      results: [
        { id_or_name: "tag-1", id: "tag-1", name: "Urgent", deleted: true, error: null },
        { id_or_name: "Home", id: "tag-2", name: "Home", deleted: true, error: null },
      ],
    });
    const handler = registeredTools.get("delete_tags_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_ids_or_names: ["tag-1", "Home"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      summary: { requested: 2, deleted: 2, failed: 0 },
      partial_success: false,
      results: [
        { id_or_name: "tag-1", id: "tag-1", name: "Urgent", deleted: true, error: null },
        { id_or_name: "Home", id: "tag-2", name: "Home", deleted: true, error: null },
      ],
    });
    const script = runOmniJsMock.mock.calls.at(-1)?.[0] as string;
    expect(script).toContain("sort((left, right) => right.depth - left.depth || left.index - right.index)");
    expect(script).toContain("const getLiveTagById = tagId => {");
    expect(script).toContain("deleteObject(liveTag);");
  });

  test("delete_tags_batch supports partial success", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      summary: { requested: 2, deleted: 1, failed: 1 },
      partial_success: true,
      results: [
        { id_or_name: "tag-1", id: "tag-1", name: "Urgent", deleted: true, error: null },
        { id_or_name: "missing-tag", id: null, name: null, deleted: false, error: "not found" },
      ],
    });
    const handler = registeredTools.get("delete_tags_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_ids_or_names: ["tag-1", "missing-tag"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      summary: { requested: 2, deleted: 1, failed: 1 },
      partial_success: true,
      results: [
        { id_or_name: "tag-1", id: "tag-1", name: "Urgent", deleted: true, error: null },
        { id_or_name: "missing-tag", id: null, name: null, deleted: false, error: "not found" },
      ],
    });
  });

  test("delete_tags_batch returns error for empty array", async () => {
    const handler = registeredTools.get("delete_tags_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_ids_or_names: [] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "tag_ids_or_names must contain at least one tag id or name.",
    });
  });

  test("delete_tags_batch returns error for empty trimmed item", async () => {
    const handler = registeredTools.get("delete_tags_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_ids_or_names: ["tag-1", "   "] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "each tag id or name must be a non-empty string.",
    });
  });

  test("delete_tags_batch returns error for duplicates", async () => {
    const handler = registeredTools.get("delete_tags_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ tag_ids_or_names: ["tag-a", "tag-a"] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "tag_ids_or_names must not contain duplicates: tag-a",
    });
  });

  test("delete_folders_batch returns summary with itemized results", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      summary: { requested: 2, deleted: 2, failed: 0 },
      partial_success: false,
      results: [
        { id_or_name: "folder-1", id: "folder-1", name: "Areas", deleted: true, error: null },
        { id_or_name: "Work", id: "folder-2", name: "Work", deleted: true, error: null },
      ],
    });
    const handler = registeredTools.get("delete_folders_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_ids_or_names: ["folder-1", "Work"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      summary: { requested: 2, deleted: 2, failed: 0 },
      partial_success: false,
      results: [
        { id_or_name: "folder-1", id: "folder-1", name: "Areas", deleted: true, error: null },
        { id_or_name: "Work", id: "folder-2", name: "Work", deleted: true, error: null },
      ],
    });
    const script = runOmniJsMock.mock.calls.at(-1)?.[0] as string;
    expect(script).toContain("sort((left, right) => right.depth - left.depth || left.index - right.index)");
    expect(script).toContain("const getLiveFolderById = folderId => {");
    expect(script).toContain("deleteObject(liveFolder);");
  });

  test("delete_folders_batch supports partial success", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      summary: { requested: 2, deleted: 1, failed: 1 },
      partial_success: true,
      results: [
        { id_or_name: "folder-1", id: "folder-1", name: "Areas", deleted: true, error: null },
        { id_or_name: "missing-folder", id: null, name: null, deleted: false, error: "not found" },
      ],
    });
    const handler = registeredTools.get("delete_folders_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_ids_or_names: ["folder-1", "missing-folder"] });
    expect(JSON.parse(result.content[0].text)).toEqual({
      summary: { requested: 2, deleted: 1, failed: 1 },
      partial_success: true,
      results: [
        { id_or_name: "folder-1", id: "folder-1", name: "Areas", deleted: true, error: null },
        { id_or_name: "missing-folder", id: null, name: null, deleted: false, error: "not found" },
      ],
    });
  });

  test("delete_folders_batch returns error for empty array", async () => {
    const handler = registeredTools.get("delete_folders_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_ids_or_names: [] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "folder_ids_or_names must contain at least one folder id or name.",
    });
  });

  test("delete_folders_batch returns error for empty trimmed item", async () => {
    const handler = registeredTools.get("delete_folders_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_ids_or_names: ["folder-1", "   "] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "each folder id or name must be a non-empty string.",
    });
  });

  test("delete_folders_batch returns error for duplicates", async () => {
    const handler = registeredTools.get("delete_folders_batch");
    expect(handler).toBeDefined();
    const result = await handler!({ folder_ids_or_names: ["folder-z", "folder-z"] });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "folder_ids_or_names must not contain duplicates: folder-z",
    });
  });

  test("set_project_status returns error for unsupported status value", async () => {
    const handler = registeredTools.get("set_project_status");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "p4", status: "completed" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "status must be one of: active, on_hold, dropped.",
    });
  });
});
