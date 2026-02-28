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
