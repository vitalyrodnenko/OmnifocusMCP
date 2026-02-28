import { z } from "zod";

import { runOmniJs } from "../jxa.js";
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
}
