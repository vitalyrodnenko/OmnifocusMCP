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

function parseToolResult(result: { content: [{ type: "text"; text: string }] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("representative read and write tool handlers", () => {
  beforeAll(async () => {
    await import("../src/index.js");
  });

  beforeEach(() => {
    runOmniJsMock.mockReset();
  });

  test("get_inbox generates script with limit and parses response", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      { id: "task-1", name: "inbox item", taskStatus: "available" },
    ]);
    const result = await getTool("get_inbox")({ limit: 5 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain(".slice(0, 5)");
    expect(script).toContain("completionDate: task.completionDate ? task.completionDate.toISOString() : null,");
    expect(script).toContain("hasChildren: task.hasChildren");
    expect(script).toContain("taskStatus: (() => {");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([{ id: "task-1", name: "inbox item", taskStatus: "available" }]);
    expect([
      "available",
      "blocked",
      "next",
      "due_soon",
      "overdue",
      "completed",
      "dropped",
    ]).toContain(parsed[0].taskStatus);
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
    expect(script).toContain("plannedDate: (() => {");
    expect(script).toContain("hasChildren: task.hasChildren");
    expect(script).toContain('if (s.includes("Available")) return "available";');
  });

  test("get_forecast includes deferred, dueThisWeek, counts, and enriched task fields", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      overdue: [{ id: "t-over", name: "Overdue", completionDate: null, hasChildren: false }],
      dueToday: [{ id: "t-today", name: "Today", completionDate: null, hasChildren: true }],
      flagged: [{ id: "t-flag", name: "Flagged", completionDate: null, hasChildren: false }],
      deferred: [{ id: "t-def", name: "Deferred", completionDate: null, hasChildren: false }],
      dueThisWeek: [{ id: "t-week", name: "This week", completionDate: null, hasChildren: false }],
      counts: {
        overdueCount: 2,
        dueTodayCount: 3,
        flaggedCount: 1,
        deferredCount: 4,
        dueThisWeekCount: 5,
      },
    });
    const result = await getTool("get_forecast")({ limit: 6 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const endOfWeek = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));");
    expect(script).toContain("const dueThisWeek = [];");
    expect(script).toContain("counts.dueThisWeekCount += 1;");
    expect(script).toContain("counts.deferredCount += 1;");
    expect(script).toContain("completionDate: task.completionDate ? task.completionDate.toISOString() : null,");
    expect(script).toContain("hasChildren: task.hasChildren");
    expect(script).toContain('if (s.includes("Dropped")) return "dropped";');
    expect(JSON.parse(result.content[0].text)).toEqual({
      overdue: [{ id: "t-over", name: "Overdue", completionDate: null, hasChildren: false }],
      dueToday: [{ id: "t-today", name: "Today", completionDate: null, hasChildren: true }],
      flagged: [{ id: "t-flag", name: "Flagged", completionDate: null, hasChildren: false }],
      deferred: [{ id: "t-def", name: "Deferred", completionDate: null, hasChildren: false }],
      dueThisWeek: [{ id: "t-week", name: "This week", completionDate: null, hasChildren: false }],
      counts: {
        overdueCount: 2,
        dueTodayCount: 3,
        flaggedCount: 1,
        deferredCount: 4,
        dueThisWeekCount: 5,
      },
    });
  });

  test("get_task_counts builds aggregate counter script", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      total: 12,
      available: 5,
      completed: 3,
      overdue: 2,
      dueSoon: 4,
      flagged: 6,
      deferred: 4,
    });
    const result = await getTool("get_task_counts")({
      project: "Proj",
      tag: "urgent",
      tags: ["home", "urgent"],
      tagFilterMode: "all",
      flagged: true,
      dueBefore: "2026-03-10T00:00:00Z",
      dueAfter: "2026-03-01T00:00:00Z",
      deferBefore: "2026-03-08T00:00:00Z",
      deferAfter: "2026-02-25T00:00:00Z",
      completedBefore: "2026-03-09T00:00:00Z",
      completedAfter: "2026-02-20T00:00:00Z",
      maxEstimatedMinutes: 30,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const projectFilter = "Proj";');
    expect(script).toContain('const tagNames = ["urgent","home"];');
    expect(script).toContain('const tagFilterMode = "all";');
    expect(script).toContain("const counts = {");
    expect(script).toContain("counts.total += 1;");
    expect(script).toContain("if (task.completed) {");
    expect(script).toContain("if (task.deferDate !== null && task.deferDate > now) counts.deferred += 1;");
    expect(JSON.parse(result.content[0].text)).toEqual({
      total: 12,
      available: 5,
      completed: 3,
      overdue: 2,
      dueSoon: 4,
      flagged: 6,
      deferred: 4,
    });
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
      plannedBefore: "2026-03-15T00:00:00Z",
      plannedAfter: "2026-02-15T00:00:00Z",
      limit: 9,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const dueBeforeRaw = "2026-03-10T00:00:00Z";');
    expect(script).toContain('const completedAfterRaw = "2026-02-20T00:00:00Z";');
    expect(script).toContain('const plannedBeforeRaw = "2026-03-15T00:00:00Z";');
    expect(script).toContain('const plannedAfterRaw = "2026-02-15T00:00:00Z";');
    expect(script).toContain("const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;");
    expect(script).toContain("statusMatches = includeCompletedForDateFilter;");
    expect(script).toContain("task.completionDate !== null && task.completionDate > completedAfter");
    expect(script).toContain("must be a valid ISO 8601 date string.");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "task-date", name: "dated filter" }]);
  });

  test("list_tasks sort by dueDate asc is included in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-due", name: "sorted task" }]);
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

  test("list_tasks sort by name desc is included in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-name", name: "sorted by name" }]);
    await getTool("list_tasks")({
      sortBy: "name",
      sortOrder: "desc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "name";');
    expect(script).toContain('const sortOrder = "desc";');
    expect(script).toContain("left = String(aValue).toLowerCase();");
    expect(script).toContain('if (left < right) return sortOrder === "asc" ? -1 : 1;');
  });

  test("list_tasks auto-sorts by completionDate desc when completion filters are provided", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-auto", name: "auto sorted" }]);
    await getTool("list_tasks")({
      status: "available",
      completedAfter: "2026-03-01T00:00:00Z",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "completionDate";');
    expect(script).toContain('const sortOrder = "desc";');
  });

  test("list_tasks sorting keeps null values at the end", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "task-sort-null", name: "null ordering" }]);
    await getTool("list_tasks")({
      sortBy: "project",
      sortOrder: "desc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("if (aValue === null) return 1;");
    expect(script).toContain("if (bValue === null) return -1;");
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

  test("get_task_counts uses filters and returns count payload", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      total: 6,
      available: 3,
      completed: 2,
      overdue: 1,
      dueSoon: 2,
      flagged: 2,
      deferred: 1,
    });
    const result = await getTool("get_task_counts")({
      project: "Errands",
      tags: ["Home"],
      flagged: true,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const projectFilter = "Errands";');
    expect(script).toContain('const tagNames = ["Home"];');
    expect(script).toContain("const flaggedFilter = true;");
    expect(script).toContain("const counts = {");
    expect(script).toContain("counts.overdue += 1;");
    expect(JSON.parse(result.content[0].text)).toEqual({
      total: 6,
      available: 3,
      completed: 2,
      overdue: 1,
      dueSoon: 2,
      flagged: 2,
      deferred: 1,
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
    expect(script).toContain("taskStatus: (() => {");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "sub-1", name: "child" }]);
  });

  test("list_notifications maps notification fields for a task", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      {
        id: "n1",
        kind: "absolute",
        absoluteFireDate: "2026-03-02T09:00:00Z",
        relativeFireOffset: null,
        nextFireDate: "2026-03-02T09:00:00Z",
        isSnoozed: false,
      },
    ]);
    const result = await getTool("list_notifications")({ task_id: "task-9" });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskId = "task-9";');
    expect(script).toContain("return task.notifications.map(n => ({");
    expect(script).toContain('kind: n.initialFireDate ? "absolute" : "relative",');
    expect(script).toContain("relativeFireOffset: n.initialFireDate ? null : n.relativeFireOffset,");
    expect(script).toContain("isSnoozed: n.isSnoozed");
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "n1",
        kind: "absolute",
        absoluteFireDate: "2026-03-02T09:00:00Z",
        relativeFireOffset: null,
        nextFireDate: "2026-03-02T09:00:00Z",
        isSnoozed: false,
      },
    ]);
  });

  test("add_notification absolute mode creates date-based reminder", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "n2",
      kind: "absolute",
      absoluteFireDate: "2026-03-03T10:30:00Z",
      relativeFireOffset: null,
      nextFireDate: "2026-03-03T10:30:00Z",
      isSnoozed: false,
    });
    const result = await getTool("add_notification")({
      task_id: "task-9",
      absoluteDate: "2026-03-03T10:30:00Z",
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskId = "task-9";');
    expect(script).toContain('const absoluteDateRaw = "2026-03-03T10:30:00Z";');
    expect(script).toContain("const relativeOffset = null;");
    expect(script).toContain("const parsed = new Date(absoluteDateRaw);");
    expect(script).toContain("return task.addNotification(absoluteDate);");
    expect(script).toContain("if (task.effectiveDueDate === null) {");
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "n2",
      kind: "absolute",
      absoluteFireDate: "2026-03-03T10:30:00Z",
      relativeFireOffset: null,
      nextFireDate: "2026-03-03T10:30:00Z",
      isSnoozed: false,
    });
  });

  test("add_notification relative mode creates due-relative reminder", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "n3",
      kind: "relative",
      absoluteFireDate: null,
      relativeFireOffset: -3600,
      nextFireDate: "2026-03-03T09:00:00Z",
      isSnoozed: false,
    });
    const result = await getTool("add_notification")({
      task_id: "task-9",
      relativeOffset: -3600,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const absoluteDateRaw = null;");
    expect(script).toContain("const relativeOffset = -3600;");
    expect(script).toContain("return task.addNotification(relativeOffset);");
    expect(script).toContain(
      "relativeFireOffset: notification.initialFireDate ? null : notification.relativeFireOffset,"
    );
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "n3",
      kind: "relative",
      absoluteFireDate: null,
      relativeFireOffset: -3600,
      nextFireDate: "2026-03-03T09:00:00Z",
      isSnoozed: false,
    });
  });

  test("add_notification validates exactly one mode", async () => {
    const missingMode = await getTool("add_notification")({ task_id: "task-9" });
    expect(missingMode.isError).toBe(true);
    expect(JSON.parse(missingMode.content[0].text)).toEqual({
      error: "exactly one of absoluteDate or relativeOffset must be provided.",
    });

    const bothModes = await getTool("add_notification")({
      task_id: "task-9",
      absoluteDate: "2026-03-03T10:30:00Z",
      relativeOffset: -300,
    });
    expect(bothModes.isError).toBe(true);
    expect(JSON.parse(bothModes.content[0].text)).toEqual({
      error: "exactly one of absoluteDate or relativeOffset must be provided.",
    });
  });

  test("remove_notification removes a notification by id", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      taskId: "task-9",
      notificationId: "notif-1",
      removed: true,
    });
    const result = await getTool("remove_notification")({
      task_id: "task-9",
      notification_id: "notif-1",
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskId = "task-9";');
    expect(script).toContain('const notificationId = "notif-1";');
    expect(script).toContain(
      "const notification = task.notifications.find(item => item.id.primaryKey === notificationId);"
    );
    expect(script).toContain("task.removeNotification(notification);");
    expect(JSON.parse(result.content[0].text)).toEqual({
      taskId: "task-9",
      notificationId: "notif-1",
      removed: true,
    });
  });

  test("remove_notification validates required ids", async () => {
    const missingTaskId = await getTool("remove_notification")({
      task_id: "   ",
      notification_id: "notif-1",
    });
    expect(missingTaskId.isError).toBe(true);
    expect(JSON.parse(missingTaskId.content[0].text)).toEqual({
      error: "task_id must not be empty.",
    });

    const missingNotificationId = await getTool("remove_notification")({
      task_id: "task-9",
      notification_id: "   ",
    });
    expect(missingNotificationId.isError).toBe(true);
    expect(JSON.parse(missingNotificationId.content[0].text)).toEqual({
      error: "notification_id must not be empty.",
    });
  });

  test("duplicate_task clones full subtree by default", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "copy-1",
      name: "Copied task",
      note: "copied",
      flagged: true,
      dueDate: "2026-03-10T09:00:00Z",
      deferDate: null,
      completed: false,
      completionDate: null,
      projectName: "Errands",
      tags: ["Home"],
      estimatedMinutes: 15,
      hasChildren: true,
      taskStatus: "available",
    });
    const result = await getTool("duplicate_task")({ task_id: "task-9" });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskId = "task-9";');
    expect(script).toContain("const includeChildren = true;");
    expect(script).toMatch(/duplicateTasks\(\[task\], insertionLocation\)/);
    expect(script).toMatch(/taskStatus/);
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "copy-1",
      name: "Copied task",
      note: "copied",
      flagged: true,
      dueDate: "2026-03-10T09:00:00Z",
      deferDate: null,
      completed: false,
      completionDate: null,
      projectName: "Errands",
      tags: ["Home"],
      estimatedMinutes: 15,
      hasChildren: true,
      taskStatus: "available",
    });
  });

  test("duplicate_task supports includeChildren=false manual clone", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "copy-2",
      name: "Copied task flat",
    });
    const result = await getTool("duplicate_task")({
      task_id: "task-9",
      includeChildren: false,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const includeChildren = false;");
    expect(script).toMatch(/new Task\(task\.name, insertionLocation\)/);
    expect(script).toMatch(/addTag\(tag\)/);
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "copy-2",
      name: "Copied task flat",
    });
  });

  test("duplicate_task validates required task id", async () => {
    const result = await getTool("duplicate_task")({ task_id: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "task_id must not be empty.",
    });
  });

  test("get_task includes native taskStatus field mapping", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      id: "task-9",
      name: "single task",
      taskStatus: "overdue",
      effectiveDueDate: null,
      effectiveDeferDate: null,
      effectiveFlagged: false,
      modified: null,
      plannedDate: null,
      effectivePlannedDate: null,
    });
    const result = await getTool("get_task")({ task_id: "task-9" });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const taskId = "task-9";');
    expect(script).toContain("effectiveDueDate: task.effectiveDueDate ? task.effectiveDueDate.toISOString() : null,");
    expect(script).toContain("effectiveDeferDate: task.effectiveDeferDate ? task.effectiveDeferDate.toISOString() : null,");
    expect(script).toContain("effectiveFlagged: task.effectiveFlagged,");
    expect(script).toContain("modified: task.modified ? task.modified.toISOString() : null,");
    expect(script).toContain("plannedDate: (() => {");
    expect(script).toContain("effectivePlannedDate: (() => {");
    expect(script).toContain("taskStatus: (() => {");
    expect(script).toContain('if (s.includes("Overdue")) return "overdue";');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      id: "task-9",
      name: "single task",
      taskStatus: "overdue",
      effectiveDueDate: null,
      effectiveDeferDate: null,
      effectiveFlagged: false,
      modified: null,
      plannedDate: null,
      effectivePlannedDate: null,
    });
    expect([
      "available",
      "blocked",
      "next",
      "due_soon",
      "overdue",
      "completed",
      "dropped",
    ]).toContain(parsed.taskStatus);
  });

  test("search_tasks mapper includes completionDate and hasChildren", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "search-shape", name: "shape" }]);
    await getTool("search_tasks")({ query: "shape", limit: 2 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const queryFilter = "shape".toLowerCase();');
    expect(script).toContain("completionDate: task.completionDate ? task.completionDate.toISOString() : null,");
    expect(script).toContain("plannedDate: (() => {");
    expect(script).toContain("hasChildren: task.hasChildren");
    expect(script).toContain('if (s.includes("Overdue")) return "overdue";');
  });

  test("search_tasks supports project filter and status/sort filters", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "search-proj", name: "shape" }]);
    await getTool("search_tasks")({
      query: "shape",
      project: "Errands",
      status: "overdue",
      sortBy: "name",
      sortOrder: "desc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const projectFilter = "Errands";');
    expect(script).toContain('const statusFilter = "overdue";');
    expect(script).toContain('const sortBy = "name";');
    expect(script).toContain('const sortOrder = "desc";');
    expect(script).toContain("if (!(name.includes(queryFilter) || note.includes(queryFilter))) return false;");
  });

  test("search_tasks completion filters auto-sort by completion date", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "search-complete", name: "shape" }]);
    await getTool("search_tasks")({
      query: "shape",
      completedAfter: "2026-03-01T00:00:00Z",
      plannedBefore: "2026-03-10T00:00:00Z",
      plannedAfter: "2026-02-20T00:00:00Z",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "completionDate";');
    expect(script).toContain('const sortOrder = "desc";');
    expect(script).toContain('const plannedBeforeRaw = "2026-03-10T00:00:00Z";');
    expect(script).toContain('const plannedAfterRaw = "2026-02-20T00:00:00Z";');
    expect(script).toContain(
      "const includeCompletedForDateFilter = completedBefore !== null || completedAfter !== null;"
    );
  });

  test("list_tags includes totalTaskCount and default sorting envelope", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "tag-1", name: "home" }]);
    await getTool("list_tags")({ limit: 9 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const statusFilter = "all";');
    expect(script).toContain("totalTaskCount: counts.totalTaskCount,");
    expect(script).toContain("return sortedTags.slice(0, 9);");
  });

  test("list_tags status filter and count sorting are included in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "tag-2", name: "work" }]);
    await getTool("list_tags")({
      statusFilter: "active",
      sortBy: "totalTaskCount",
      sortOrder: "desc",
      limit: 7,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const statusFilter = "active";');
    expect(script).toContain('const sortBy = "totalTaskCount";');
    expect(script).toContain('const sortOrder = "desc";');
    expect(script).toContain('statusFilter === "all" || normalizeTagStatus(tag) === statusFilter');
    expect(script).toContain("return sortedTags.slice(0, 7);");
  });

  test("list_tags name sorting is included in script", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "tag-3", name: "alpha" }]);
    await getTool("list_tags")({
      sortBy: "name",
      sortOrder: "asc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "name";');
    expect(script).toContain('const sortOrder = "asc";');
    expect(script).toContain('if (sortBy === "name") {');
    expect(script).toContain("return sortedTags.slice(0, 5);");
  });

  test("get_project generates id/name lookup script", async () => {
    runOmniJsMock.mockResolvedValueOnce({ id: "proj-1", name: "Project", modified: null });
    const result = await getTool("get_project")({ project_id_or_name: "Project" });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const projectFilter = "Project";');
    expect(script).toContain("item.id.primaryKey === projectFilter || item.name === projectFilter");
    expect(script).toContain("const nextTask = project.nextTask;");
    expect(script).toContain('const isStalled = normalizeProjectStatus(project) === "active"');
    expect(script).toContain("completedTaskCount: allProjectTasks.filter(task => task.completed).length,");
    expect(script).toContain(
      "availableTaskCount: allProjectTasks.filter(task => !task.completed && (task.deferDate === null || task.deferDate <= new Date())).length,"
    );
    expect(script).toContain("modified: project.modified ? project.modified.toISOString() : null,");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "proj-1", name: "Project", modified: null });
  });

  test("list_projects includes stalled and next task projection fields", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "proj-2", name: "Project 2" }]);
    const result = await getTool("list_projects")({ status: "active", limit: 5 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain("const nextTask = project.nextTask;");
    expect(script).toContain('const isStalled = normalizeProjectStatus(project) === "active"');
    expect(script).toContain("completionDate: project.completionDate ? project.completionDate.toISOString() : null,");
    expect(script).toContain("nextTaskId: nextTask ? nextTask.id.primaryKey : null,");
    expect(script).toContain("nextTaskName: nextTask ? nextTask.name : null,");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: "proj-2", name: "Project 2" }]);
  });

  test("list_projects completion filters auto-set completed status and sorting", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "proj-3", name: "Completed Project" }]);
    await getTool("list_projects")({
      completedAfter: "2026-03-01T00:00:00Z",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const statusFilter = "completed";');
    expect(script).toContain('const sortBy = "completionDate";');
    expect(script).toContain('const sortOrder = "desc";');
    expect(script).toContain(
      "if (completedAfter !== null && !(project.completionDate !== null && project.completionDate > completedAfter)) return false;"
    );
  });

  test("list_projects stalledOnly forces active status and filters stalled projects", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "proj-4", name: "Stalled Project" }]);
    await getTool("list_projects")({
      status: "completed",
      stalledOnly: true,
      sortBy: "taskCount",
      sortOrder: "desc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const statusFilter = "active";');
    expect(script).toContain("const stalledOnly = true;");
    expect(script).toContain("if (stalledOnly && !isStalled) return false;");
    expect(script).toContain('const sortBy = "taskCount";');
    expect(script).toContain('const sortOrder = "desc";');
  });

  test("get_project_counts returns aggregate project counters", async () => {
    runOmniJsMock.mockResolvedValueOnce({
      total: 5,
      active: 2,
      onHold: 1,
      completed: 1,
      dropped: 1,
      stalled: 1,
    });
    const result = await getTool("get_project_counts")({ folder: "Work" });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const folderFilter = "Work";');
    expect(script).toContain("const counts = {");
    expect(script).toContain("counts.onHold += 1;");
    expect(script).toContain("counts.stalled += 1;");
    expect(JSON.parse(result.content[0].text)).toEqual({
      total: 5,
      active: 2,
      onHold: 1,
      completed: 1,
      dropped: 1,
      stalled: 1,
    });
  });

  test("get_project_counts rejects empty folder filter", async () => {
    const result = await getTool("get_project_counts")({ folder: "   " });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: "folder must not be empty when provided.",
    });
  });

  test("list_tags includes status filter and totalTaskCount mapping", async () => {
    runOmniJsMock.mockResolvedValueOnce([
      { id: "tag-1", name: "Errands", availableTaskCount: 3, totalTaskCount: 5 },
    ]);
    const result = await getTool("list_tags")({ statusFilter: "all", limit: 9 });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const statusFilter = "all";');
    expect(script).toContain("totalTaskCount: counts.totalTaskCount,");
    expect(script).toContain("return sortedTags.slice(0, 9);");
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "tag-1", name: "Errands", availableTaskCount: 3, totalTaskCount: 5 },
    ]);
  });

  test("list_tags supports sorting and status filtering", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "tag-2", name: "Home" }]);
    await getTool("list_tags")({
      statusFilter: "active",
      sortBy: "totalTaskCount",
      sortOrder: "desc",
      limit: 7,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const statusFilter = "active";');
    expect(script).toContain('const sortBy = "totalTaskCount";');
    expect(script).toContain('const sortOrder = "desc";');
    expect(script).toContain('statusFilter === "all" || normalizeTagStatus(tag) === statusFilter');
    expect(script).toContain("return sortedTags.slice(0, 7);");
  });

  test("list_tags supports name sorting", async () => {
    runOmniJsMock.mockResolvedValueOnce([{ id: "tag-3", name: "Alpha" }]);
    await getTool("list_tags")({
      sortBy: "name",
      sortOrder: "asc",
      limit: 5,
    });
    const script = String(runOmniJsMock.mock.calls[0]?.[0]);
    expect(script).toContain('const sortBy = "name";');
    expect(script).toContain('const sortOrder = "asc";');
    expect(script).toContain('if (sortBy === "name") {');
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
