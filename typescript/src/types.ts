import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type Server = McpServer;

export type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

export type TaskStatus = "available" | "due_soon" | "overdue" | "on_hold" | "completed" | "all";

export function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "Unknown OmniFocus error.";
}
