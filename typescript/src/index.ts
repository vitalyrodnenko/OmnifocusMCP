#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { register as registerForecastTools } from "./tools/forecast.js";
import { register as registerFolderTools } from "./tools/folders.js";
import { register as registerPerspectiveTools } from "./tools/perspectives.js";
import { register as registerProjectTools } from "./tools/projects.js";
import { register as registerTagTools } from "./tools/tags.js";
import { register as registerTaskTools } from "./tools/tasks.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";

const server = new McpServer({
  name: "omnifocus-mcp",
  version: "0.1.0",
});

registerTaskTools(server);
registerProjectTools(server);
registerTagTools(server);
registerFolderTools(server);
registerForecastTools(server);
registerPerspectiveTools(server);
registerResources(server);
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
