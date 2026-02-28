import { z } from "zod";

import { escapeForJxa, runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "list_tags",
    "list tags with availability counts and optional status filter.",
    {
      status: z.enum(["active", "inactive", "all"]).default("all"),
      limit: z.number().int().min(1).default(100),
    },
    async ({ status, limit }) => {
      try {
        const statusFilter = escapeForJxa(status);
        const script = `
const normalizeTagStatus = (tag) => tag.active ? "active" : "inactive";
const tagCounts = new Map();
document.flattenedTasks.forEach(task => {
  if (task.completed) return;
  task.tags.forEach(tag => {
    const current = tagCounts.get(tag.id.primaryKey) || 0;
    tagCounts.set(tag.id.primaryKey, current + 1);
  });
});
const tags = document.flattenedTags
  .filter(tag => statusFilter === "all" || normalizeTagStatus(tag) === statusFilter)
  .slice(0, ${limit});
return tags.map(tag => ({
  id: tag.id.primaryKey,
  name: tag.name,
  parent: tag.parent ? tag.parent.name : null,
  availableTaskCount: tagCounts.get(tag.id.primaryKey) || 0,
  status: normalizeTagStatus(tag)
}));
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "create_tag",
    "create a tag with optional parent tag and return id/name.",
    {
      name: z.string().min(1),
      parent: z.string().min(1).optional(),
    },
    async ({ name, parent }) => {
      try {
        const tagName = escapeForJxa(name.trim());
        const parentName = parent === undefined ? "null" : escapeForJxa(parent.trim());
        const script = `
const tagName = ${tagName};
const parentName = ${parentName};
const parentTag = parentName === null ? null : document.flattenedTags.byName(parentName);
if (parentName !== null && !parentTag) throw new Error(\`Tag not found: \${parentName}\`);
const tag = parentTag ? new Tag(tagName, parentTag.tags.end) : new Tag(tagName, document.tags.end);
return { id: tag.id.primaryKey, name: tag.name };
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );
}
