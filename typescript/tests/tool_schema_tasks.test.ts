import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

const registeredShapes = new Map<string, z.ZodRawShape>();

vi.mock("../src/jxa.js", () => ({
  escapeForJxa: (value: string) => JSON.stringify(value),
  runOmniJs: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class MockMcpServer {
    tool(name: string, _description: string, schema: z.ZodRawShape, _handler: unknown): void {
      registeredShapes.set(name, schema);
    }

    registerResource(): void {}

    registerPrompt(): void {}

    resource(): void {}

    prompt(): void {}

    async connect(): Promise<void> {}
  }

  return { McpServer: MockMcpServer };
});

function tagsPropertyIsArrayOfStrings(properties: Record<string, unknown>): void {
  const tagsSchema = properties["tags"];
  expect(tagsSchema).toBeDefined();
  const branches: unknown[] =
    typeof tagsSchema === "object" && tagsSchema !== null && "anyOf" in tagsSchema
      ? (tagsSchema as { anyOf: unknown[] }).anyOf
      : [tagsSchema];
  let found = false;
  for (const branch of branches) {
    if (typeof branch !== "object" || branch === null) {
      continue;
    }
    const b = branch as { type?: string; items?: { type?: string } };
    if (b.type === "array" && b.items?.type === "string") {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
}

function batchItemProperties(root: Record<string, unknown>): Record<string, unknown> {
  const tasksProp = root.properties?.tasks as Record<string, unknown> | undefined;
  expect(tasksProp).toBeDefined();
  const items = tasksProp?.items as Record<string, unknown> | undefined;
  expect(items).toBeDefined();
  const ref = items?.$ref as string | undefined;
  if (ref?.startsWith("#/$defs/")) {
    const defName = ref.split("/").pop()!;
    const defs = root.$defs as Record<string, { properties?: Record<string, unknown> }>;
    const props = defs[defName]?.properties;
    expect(props).toBeDefined();
    return props!;
  }
  const inline = items?.properties as Record<string, unknown> | undefined;
  expect(inline).toBeDefined();
  return inline!;
}

function propertiesForWriteTool(name: string, root: Record<string, unknown>): Record<string, unknown> {
  const props = root.properties as Record<string, unknown> | undefined;
  expect(props).toBeDefined();
  if (name === "create_tasks_batch") {
    return batchItemProperties(root);
  }
  return props!;
}

describe("write task tool zod json schemas", () => {
  beforeEach(async () => {
    registeredShapes.clear();
    vi.resetModules();
    await import("../src/index.js");
  });

  test("tags are arrays of strings and date fields use camelCase keys", () => {
    for (const toolName of ["create_task", "create_subtask", "update_task"] as const) {
      const shape = registeredShapes.get(toolName);
      expect(shape).toBeDefined();
      const root = z.object(shape!).toJSONSchema() as Record<string, unknown>;
      const props = propertiesForWriteTool(toolName, root);
      tagsPropertyIsArrayOfStrings(props);
      expect(props).toHaveProperty("dueDate");
      expect(props).toHaveProperty("deferDate");
      expect(props).toHaveProperty("estimatedMinutes");
      expect(props).not.toHaveProperty("due_date");
      expect(props).not.toHaveProperty("defer_date");
      expect(props).not.toHaveProperty("estimated_minutes");
    }

    const batchShape = registeredShapes.get("create_tasks_batch");
    expect(batchShape).toBeDefined();
    const batchRoot = z.object(batchShape!).toJSONSchema() as Record<string, unknown>;
    const batchProps = propertiesForWriteTool("create_tasks_batch", batchRoot);
    tagsPropertyIsArrayOfStrings(batchProps);
    expect(batchProps).toHaveProperty("dueDate");
    expect(batchProps).toHaveProperty("deferDate");
    expect(batchProps).toHaveProperty("estimatedMinutes");
    expect(batchProps).not.toHaveProperty("due_date");
    expect(batchProps).not.toHaveProperty("defer_date");
    expect(batchProps).not.toHaveProperty("estimated_minutes");
  });

  test("safeParse rejects string-typed tags (issue #7)", () => {
    const createShape = registeredShapes.get("create_task");
    expect(createShape).toBeDefined();
    expect(z.object(createShape!).safeParse({ name: "a", tags: '["Quick"]' }).success).toBe(false);
    expect(z.object(createShape!).safeParse({ name: "a", tags: ["Home"] }).success).toBe(true);

    const subShape = registeredShapes.get("create_subtask");
    expect(subShape).toBeDefined();
    expect(
      z.object(subShape!).safeParse({
        name: "a",
        parent_task_id: "p1",
        tags: '["Quick"]',
      }).success
    ).toBe(false);

    const updateShape = registeredShapes.get("update_task");
    expect(updateShape).toBeDefined();
    expect(
      z.object(updateShape!).safeParse({ task_id: "t1", tags: '["Quick"]' }).success
    ).toBe(false);

    const batchShape = registeredShapes.get("create_tasks_batch");
    expect(batchShape).toBeDefined();
    expect(
      z.object(batchShape!).safeParse({ tasks: [{ name: "a", tags: '["Quick"]' }] }).success
    ).toBe(false);
  });

  test("exported param shapes match registered tool schemas", async () => {
    const mod = await import("../src/tools/tasks.js");
    expect(registeredShapes.get("create_task")).toBe(mod.createTaskParamsShape);
    expect(registeredShapes.get("create_subtask")).toBe(mod.createSubtaskParamsShape);
    expect(registeredShapes.get("update_task")).toBe(mod.updateTaskParamsShape);
    expect(registeredShapes.get("create_tasks_batch")).toBe(mod.createTasksBatchParamsShape);
  });
});
