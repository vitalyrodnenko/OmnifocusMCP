import { z } from "zod";

import { escapeForJxa, runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "list_folders",
    "list folder hierarchy and project counts.",
    { limit: z.number().int().min(1).default(100) },
    async ({ limit }) => {
      try {
        const script = `
const folderProjectCounts = new Map();
document.flattenedProjects.forEach(project => {
  const folder = project.folder;
  if (!folder) return;
  const current = folderProjectCounts.get(folder.id.primaryKey) || 0;
  folderProjectCounts.set(folder.id.primaryKey, current + 1);
});
const folders = document.flattenedFolders.slice(0, ${limit});
return folders.map(folder => ({
  id: folder.id.primaryKey,
  name: folder.name,
  parentName: folder.parent ? folder.parent.name : null,
  projectCount: folderProjectCounts.get(folder.id.primaryKey) || 0
}));
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "create_folder",
    "create a folder with optional parent folder and return id/name.",
    {
      name: z.string().min(1).describe("folder name"),
      parent: z.string().min(1).nullable().optional().describe("parent folder name or null"),
    },
    async ({ name, parent }) => {
      try {
        const normalizedName = name.trim();
        if (normalizedName === "") {
          throw new Error("name must not be empty.");
        }
        if (typeof parent === "string" && parent.trim() === "") {
          throw new Error("parent must not be empty when provided.");
        }
        const folderName = escapeForJxa(normalizedName);
        const parentName = parent === undefined || parent === null ? "null" : escapeForJxa(parent.trim());
        const script = `
const folderName = ${folderName};
const parentName = ${parentName};

const folder = (() => {
  if (parentName === null) return new Folder(folderName);
  const parentFolder = document.flattenedFolders.byName(parentName);
  if (!parentFolder) {
    throw new Error(\`Folder not found: \${parentName}\`);
  }
  return new Folder(folderName, parentFolder.ending);
})();

return {
  id: folder.id.primaryKey,
  name: folder.name
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );
}
