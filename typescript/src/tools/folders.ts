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
  const folderId = folder.id.primaryKey;
  const current = folderProjectCounts.get(folderId) || 0;
  folderProjectCounts.set(folderId, current + 1);
});

const folders = document.flattenedFolders.slice(0, ${limit});
return folders.map(folder => {
  return {
    id: folder.id.primaryKey,
    name: folder.name,
    parentName: folder.parent ? folder.parent.name : null,
    projectCount: folderProjectCounts.get(folder.id.primaryKey) || 0
  };
});
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

  server.tool(
    "get_folder",
    "get a folder by id or name with direct child projects and subfolders.",
    {
      folder_name_or_id: z.string().min(1),
    },
    async ({ folder_name_or_id }) => {
      try {
        const folderFilterValue = folder_name_or_id.trim();
        if (!folderFilterValue) {
          throw new Error("folder_name_or_id must not be empty.");
        }
        const folderFilter = escapeForJxa(folderFilterValue);
        const script = `
const folderFilter = ${folderFilter};

const folder = document.flattenedFolders.find(item => {
  return item.id.primaryKey === folderFilter || item.name === folderFilter;
});
if (!folder) {
  throw new Error(\`Folder not found: \${folderFilter}\`);
}

const normalizeStatus = (value) => {
  const raw = String(value || "").split(".").pop() || "";
  return raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
};

return {
  id: folder.id.primaryKey,
  name: folder.name,
  status: normalizeStatus(folder.status),
  parentName: folder.parent ? folder.parent.name : null,
  projects: folder.projects.map(project => {
    return {
      id: project.id.primaryKey,
      name: project.name,
      status: normalizeStatus(project.status)
    };
  }),
  subfolders: folder.folders.map(subfolder => {
    return {
      id: subfolder.id.primaryKey,
      name: subfolder.name
    };
  })
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "update_folder",
    "update a folder by id or name.",
    {
      folder_name_or_id: z.string().min(1),
      name: z.string().min(1).nullable().optional(),
      status: z.enum(["active", "dropped"]).nullable().optional(),
    },
    async ({ folder_name_or_id, name, status }) => {
      try {
        const folderFilter = folder_name_or_id.trim();
        const newNameValue = name === undefined || name === null ? null : name.trim();
        const statusValue = status === undefined ? null : status;

        if (!folderFilter) {
          throw new Error("folder_name_or_id must not be empty.");
        }
        if (name !== undefined && newNameValue === "") {
          throw new Error("name must not be empty when provided.");
        }
        if (statusValue !== null && statusValue !== "active" && statusValue !== "dropped") {
          throw new Error("status must be one of: active, dropped.");
        }
        if (newNameValue === null && statusValue === null) {
          throw new Error("at least one field must be provided: name or status.");
        }

        const escapedFolderFilter = escapeForJxa(folderFilter);
        const escapedName = newNameValue === null ? "null" : escapeForJxa(newNameValue);
        const escapedStatus = statusValue === null ? "null" : escapeForJxa(statusValue);
        const script = `
const folderFilter = ${escapedFolderFilter};
const newName = ${escapedName};
const statusValue = ${escapedStatus};

const folder = document.flattenedFolders.find(item => {
  return item.id.primaryKey === folderFilter || item.name === folderFilter;
});
if (!folder) {
  throw new Error(\`Folder not found: \${folderFilter}\`);
}

if (newName !== null) {
  folder.name = newName;
}

if (statusValue !== null) {
  let targetStatus;
  if (statusValue === "active") {
    targetStatus = Folder.Status.Active;
  } else if (statusValue === "dropped") {
    targetStatus = Folder.Status.Dropped;
  } else {
    throw new Error(\`Invalid status: \${statusValue}\`);
  }
  folder.status = targetStatus;
}

const normalizeFolderStatus = (item) => {
  const rawStatus = String(item.status || "").toLowerCase();
  if (rawStatus.includes("dropped")) return "dropped";
  return "active";
};

return {
  id: folder.id.primaryKey,
  name: folder.name,
  status: normalizeFolderStatus(folder)
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "delete_folder",
    "delete a folder by id or name. warning: deleting a folder may move contained projects and subfolders to top level in omnifocus.",
    {
      folder_name_or_id: z.string().min(1),
    },
    async ({ folder_name_or_id }) => {
      try {
        const folderFilterValue = folder_name_or_id.trim();
        if (!folderFilterValue) {
          throw new Error("folder_name_or_id must not be empty.");
        }
        const folderFilter = escapeForJxa(folderFilterValue);
        const script = `
const folderFilter = ${folderFilter};

const folder = document.flattenedFolders.find(item => {
  return item.id.primaryKey === folderFilter || item.name === folderFilter;
});
if (!folder) {
  throw new Error(\`Folder not found: \${folderFilter}\`);
}

const folderId = folder.id.primaryKey;
const folderName = folder.name;
const projectCount = folder.projects.length;
const subfolderCount = folder.folders.length;
deleteObject(folder);

return {
  id: folderId,
  name: folderName,
  deleted: true,
  projectCount: projectCount,
  subfolderCount: subfolderCount
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

}
