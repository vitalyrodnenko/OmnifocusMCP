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

  test("complete_project marks project complete and returns confirmation", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "p1", name: "Project 1", completed: true });
    const handler = registeredTools.get("complete_project");
    expect(handler).toBeDefined();
    const result = await handler!({ project_id_or_name: "Project 1" });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "p1", name: "Project 1", completed: true });
    expect(String(runOmniJsMock.mock.calls[0][0])).toContain("project.markComplete()");
  });
});
