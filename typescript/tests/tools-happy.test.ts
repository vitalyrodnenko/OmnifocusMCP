import { beforeEach, describe, expect, test, vi } from "vitest";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const registeredTools = new Map<string, ToolHandler>();
const runOmniJsMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class MockMcpServer {
    tool(name: string, _description: string, _schema: unknown, handler: ToolHandler): void {
      registeredTools.set(name, handler);
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
    expect(script).toContain("const tagFilter = \"Home\";");
    expect(script).toContain("const flaggedFilter = true;");
  });

  test("get_project returns structured project payload", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "p1", name: "Project 1", rootTasks: [] });
    const handler = registeredTools.get("get_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "Project 1" });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "p1", name: "Project 1", rootTasks: [] });
    expect(String(runOmniJsMock.mock.calls[0][0])).toContain("Project not found");
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
    expect(script).toContain("task.drop(false);");
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
});
