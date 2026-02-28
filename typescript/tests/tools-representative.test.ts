import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const runOmniJsMock = vi.fn();
let mockServer:
  | {
      tools: Map<string, (args: Record<string, unknown>) => Promise<{ content: [{ type: "text"; text: string }] }>>;
    }
  | undefined;

vi.mock("../src/jxa.js", () => ({
  escapeForJxa: (value: string) => JSON.stringify(value),
  runOmniJs: runOmniJsMock,
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class MockMcpServer {
    tools = new Map<
      string,
      (args: Record<string, unknown>) => Promise<{ content: [{ type: "text"; text: string }] }>
    >();

    tool(
      name: string,
      _description: string,
      _schema: Record<string, unknown>,
      cb: (args: Record<string, unknown>) => Promise<{ content: [{ type: "text"; text: string }] }>
    ): void {
      this.tools.set(name, cb);
    }

    registerResource(): void {}

    registerPrompt(): void {}

    resource(): void {}

    prompt(): void {}

    async connect(): Promise<void> {}
  }

  return {
    McpServer: class extends MockMcpServer {
      constructor(...args: unknown[]) {
        super(...args);
        mockServer = this;
      }
    },
  };
});

function getTool(name: string): (args: Record<string, unknown>) => Promise<{ content: [{ type: "text"; text: string }] }> {
  if (!mockServer) {
    throw new Error("mock server not initialized");
  }
  const tool = mockServer.tools.get(name);
  if (!tool) {
    throw new Error(`tool not registered: ${name}`);
  }
  return tool;
}

describe("representative read and write tool handlers", () => {
  beforeAll(async () => {
    await import("../src/index.js");
  });

  beforeEach(() => {
    runOmniJsMock.mockReset();
  });

  test("get_inbox generates script with limit and parses response", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-1", name: "inbox item" }]);
    const result = await getTool("get_inbox")({ limit: 5 });
    expect(runOmniJsMock.mock.calls[0]?.[0]).toContain(".slice(0, 5)");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "task-1", name: "inbox item" }]);
  });

  test("list_tasks uses provided filters in generated script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-2", name: "filtered" }]);
    const result = await getTool("list_tasks")({
      project: "Errands",
      tag: "Home",
      flagged: true,
      status: "all",
      limit: 3,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const projectFilter = "Errands";');
    expect(script).toContain('const tagNames = ["Home"];');
    expect(script).toContain('const tagFilterMode = "any";');
    expect(script).toContain("const flaggedFilter = true;");
    expect(script).toContain(".slice(0, 3)");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "task-2", name: "filtered" }]);
  });

  test("list_tasks mapper includes completionDate and hasChildren", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-shape", name: "shape" }]);
    await getTool("list_tasks")({ status: "all", limit: 2 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("completionDate: task.completionDate ? task.completionDate.toISOString() : null,");
    expect(script).toContain("hasChildren: task.hasChildren");
  });

  test("list_tasks supports tags with any/all mode and tag+tags merge", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-merge", name: "merged" }]);
    await getTool("list_tasks")({
      tag: "Home",
      tags: ["Errands", "Home"],
      tagFilterMode: "all",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const tagNames = ["Home","Errands"];');
    expect(script).toContain('const tagFilterMode = "all";');
    expect(script).toContain("tagNames.every(tn => task.tags.some(t => t.name === tn))");
  });

  test("list_tasks supports multiple tags in any mode", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-any", name: "any mode" }]);
    await getTool("list_tasks")({
      tags: ["Home", "Deep"],
      tagFilterMode: "any",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const tagNames = ["Home","Deep"];');
    expect(script).toContain('const tagFilterMode = "any";');
    expect(script).toContain("task.tags.some(t => tagNames.includes(t.name))");
  });

  test("list_tasks supports multiple tags in any mode", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-any", name: "any mode" }]);
    await getTool("list_tasks")({
      tags: ["Home", "Errands"],
      tagFilterMode: "any",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const tagNames = ["Home","Errands"];');
    expect(script).toContain('const tagFilterMode = "any";');
    expect(script).toContain("task.tags.some(t => tagNames.includes(t.name))");
  });

  test("list_tasks ignores empty tags array", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-empty-tags", name: "empty tags" }]);
    await getTool("list_tasks")({
      tags: [],
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const tagNames = null;");
    expect(script).toContain("if (tagNames !== null && tagNames.length > 0) {");
  });

  test("list_tasks includes duration filter for 15 minutes", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-15", name: "short task" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 15,
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const maxEstimatedMinutes = 15;");
  });

  test("list_tasks includes duration filter for 60 minutes", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-60", name: "medium task" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 60,
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const maxEstimatedMinutes = 60;");
  });

  test("list_tasks duration filter excludes null estimated minutes", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-duration", name: "duration filtered" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 30,
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain(
      "if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;"
    );
  });

  test("list_tasks includes date filters and completed-date status override logic", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-date", name: "dated filter" }]);
    const result = await getTool("list_tasks")({
      project: "Errands",
      tag: "Home",
      flagged: true,
      status: "available",
      dueBefore: "2026-03-10T00:00:00Z",
      dueAfter: "2026-03-01T00:00:00Z",
      deferBefore: "2026-03-08T00:00:00Z",
      deferAfter: "2026-02-25T00:00:00Z",
      completedBefore: "2026-03-09T00:00:00Z",
      completedAfter: "2026-02-20T00:00:00Z",
      limit: 9,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const dueBeforeRaw = "2026-03-10T00:00:00Z";');
    expect(script).toContain('const completedAfterRaw = "2026-02-20T00:00:00Z";');
    expect(script).toContain("const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;");
    expect(script).toContain("statusMatches = includeCompletedForDateFilter;");
    expect(script).toContain("task.completionDate !== null && task.completionDate > completedAfter");
    expect(script).toContain("must be a valid ISO 8601 date string.");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "task-date", name: "dated filter" }]);
  });

  test("list_tasks includes dueDate asc sorting in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-due", name: "sort due" }]);
    await getTool("list_tasks")({
      sortBy: "dueDate",
      sortOrder: "asc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "dueDate";');
    expect(script).toContain('const sortOrder = "asc";');
    expect(script).toContain('if (sortBy === "dueDate") {');
  });

  test("list_tasks includes name desc sorting in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-name", name: "sort name" }]);
    await getTool("list_tasks")({
      sortBy: "name",
      sortOrder: "desc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "name";');
    expect(script).toContain('const sortOrder = "desc";');
    expect(script).toContain("left = String(aValue).toLowerCase();");
  });

  test("list_tasks auto-sorts by completionDate desc with completion filters", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-auto", name: "auto sort" }]);
    await getTool("list_tasks")({
      completedAfter: "2026-03-01T00:00:00Z",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "completionDate";');
    expect(script).toContain('const sortOrder = "desc";');
  });

  test("list_tasks keeps null values last in script comparator", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-nulls", name: "nulls last" }]);
    await getTool("list_tasks")({
      sortBy: "project",
      sortOrder: "desc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("if (aValue === null) return 1;");
    expect(script).toContain("if (bValue === null) return -1;");
  });

  test("list_tasks supports maxEstimatedMinutes duration filtering", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-15", name: "quick task" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 15,
      limit: 5,
    });
    const script15 = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script15).toContain("const maxEstimatedMinutes = 15;");
    expect(script15).toContain(
      "if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;"
    );

    runOmniJsMock.mockResolvedValueOnce([{ id: "task-60", name: "longer task" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 60,
      limit: 5,
    });
    const script60 = String(runOmniJsMock.mock.calls[1]?.[0]);
    expect(script60).toContain("const maxEstimatedMinutes = 60;");
    expect(script60).toContain("task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes");
  });

  test("list_tasks surfaces invalid date validation errors", async () => {
    runOmniJsMock.mockRejectedValueOnce(new Error("dueBefore must be a valid ISO 8601 date string."));
    const result = await getTool("list_tasks")({
      dueBefore: "bad-date",
      limit: 5,
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "dueBefore must be a valid ISO 8601 date string.",
    });
  });

  test("list_tasks duration filter 15 minutes is included in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-15", name: "short task" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 15,
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const maxEstimatedMinutes = 15;");
    expect(script).toContain(
      "if (maxEstimatedMinutes !== null && !(task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes)) return false;"
    );
  });

  test("list_tasks duration filter 60 minutes is included in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-60", name: "longer task" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 60,
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const maxEstimatedMinutes = 60;");
  });

  test("list_tasks duration filter excludes null estimated minutes in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-null-estimate", name: "estimated task" }]);
    await getTool("list_tasks")({
      maxEstimatedMinutes: 30,
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("task.estimatedMinutes !== null && task.estimatedMinutes <= maxEstimatedMinutes");
  });

  test("list_subtasks generates child query script with limit", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "sub-1", name: "child" }]);
    const result = await getTool("list_subtasks")({
      task_id: "parent-1",
      limit: 2,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskId = "parent-1";');
    expect(script).toContain("const subtasks = task.children.slice(0, 2);");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "sub-1", name: "child" }]);
  });

  test("search_tasks mapper includes completionDate and hasChildren", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "search-shape", name: "shape" }]);
    await getTool("search_tasks")({ query: "shape", limit: 2 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("completionDate: task.completionDate ? task.completionDate.toISOString() : null,");
    expect(script).toContain("hasChildren: task.hasChildren");
  });

  test("get_project generates id/name lookup script", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "proj-1", name: "Project" });
    const result = await getTool("get_project")({ project_id_or_name: "Project" });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const projectFilter = "Project";');
    expect(script).toContain("item.id.primaryKey === projectFilter || item.name === projectFilter");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "proj-1", name: "Project" });
  });

  test("create_task generates project-aware creation script", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "task-3", name: "created" });
    const result = await getTool("create_task")({
      name: "created",
      project: "Errands",
      tags: ["Home"],
      flagged: true,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskName = "created";');
    expect(script).toContain('const projectName = "Errands";');
    expect(script).toContain("const task = new Task(taskName, parent);");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "task-3", name: "created" });
  });

  test("update_task only sends provided fields", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "task-4", name: "updated" });
    const result = await getTool("update_task")({
      task_id: "task-4",
      name: "updated",
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskId = "task-4";');
    expect(script).toContain('const updates = {"name":"updated"};');
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "task-4", name: "updated" });
  });

  test("complete_project marks project complete in script", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "proj-2", completed: true });
    const result = await getTool("complete_project")({
      project_id_or_name: "proj-2",
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const projectFilter = "proj-2";');
    expect(script).toContain("project.markComplete();");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "proj-2", completed: true });
  });
});
