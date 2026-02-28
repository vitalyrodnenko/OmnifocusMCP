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

  test("list_tasks ignores empty tags array", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-empty-tags", name: "empty tags" }]);
    await getTool("list_tasks")({
      tags: [],
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const tagNames = null;");
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
