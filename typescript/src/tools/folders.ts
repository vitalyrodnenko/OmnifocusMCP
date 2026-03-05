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
    "delete a folder by id or name. warning: this permanently removes the folder. do not use delete+recreate for folder edits or renames; use update_folder instead. contained projects may be moved to top level by omnifocus, so confirm with the user before proceeding.",
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

  server.tool(
    "delete_folders_batch",
    "delete multiple folders by id or exact name in a single omnijs call.",
    {
      folder_ids_or_names: z
        .array(z.string().min(1))
        .min(1)
        .describe("required non-empty array of folder ids or exact names"),
    },
    async ({ folder_ids_or_names }) => {
      try {
        if (folder_ids_or_names.length === 0) {
          throw new Error("folder_ids_or_names must contain at least one folder identifier.");
        }
        const normalizedIdentifiers = folder_ids_or_names.map((identifier) => {
          const normalizedIdentifier = identifier.trim();
          if (normalizedIdentifier === "") {
            throw new Error("each folder identifier must be a non-empty string.");
          }
          return normalizedIdentifier;
        });
        const identifiersValue = JSON.stringify(normalizedIdentifiers);
        const script = `
const folderIdentifiers = ${identifiersValue};
const folderById = new Map();
const folderByName = new Map();
for (const folder of document.flattenedFolders) {
  try {
    folderById.set(folder.id.primaryKey, folder);
    if (!folderByName.has(folder.name)) folderByName.set(folder.name, folder);
  } catch (e) {
  }
}
const results = folderIdentifiers.map(identifier => {
  const folder = folderById.get(identifier) || folderByName.get(identifier);
  if (!folder) {
    return {
      id_or_name: identifier,
      id: null,
      name: null,
      deleted: false,
      error: "Folder not found."
    };
  }

  const folderId = folder.id.primaryKey;
  const folderName = folder.name;
  deleteObject(folder);
  return {
    id_or_name: identifier,
    id: folderId,
    name: folderName,
    deleted: true,
    error: null
  };
});

const deletedCount = results.filter(result => result.deleted).length;
const failedCount = results.length - deletedCount;

return {
  summary: {
    requested: folderIdentifiers.length,
    deleted: deletedCount,
    failed: failedCount
  },
  partial_success: deletedCount > 0 && failedCount > 0,
  results: results
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "delete_folders_batch",
    "delete multiple folders by id or exact name in a single omnijs call. destructive operation: this permanently removes folders and may move contained projects depending on omnifocus behavior. use update_folder for non-destructive edits. before calling this tool, always show the user the target folder list and ask for explicit confirmation.",
    {
      folder_ids_or_names: z.array(z.string()).min(1).describe("folder ids or exact names to delete"),
    },
    async ({ folder_ids_or_names }) => {
      try {
        if (folder_ids_or_names.length === 0) {
          throw new Error("folder_ids_or_names must contain at least one folder id or name.");
        }
        const normalizedFolderIdsOrNames = folder_ids_or_names.map((folderIdOrName) => {
          const normalizedFolderIdOrName = folderIdOrName.trim();
          if (normalizedFolderIdOrName === "") {
            throw new Error("each folder id or name must be a non-empty string.");
          }
          return normalizedFolderIdOrName;
        });
        const seenFolderIdsOrNames = new Set<string>();
        for (const normalizedFolderIdOrName of normalizedFolderIdsOrNames) {
          if (seenFolderIdsOrNames.has(normalizedFolderIdOrName)) {
            throw new Error(
              `folder_ids_or_names must not contain duplicates: ${normalizedFolderIdOrName}`
            );
          }
          seenFolderIdsOrNames.add(normalizedFolderIdOrName);
        }

        const folderIdsOrNamesValue = JSON.stringify(normalizedFolderIdsOrNames);
        const script = `
const folderIdsOrNames = ${folderIdsOrNamesValue};
const folders = document.flattenedFolders.slice();
const results = folderIdsOrNames.map(idOrName => {
  const folder = folders.find(item => item.id.primaryKey === idOrName || item.name === idOrName);
  if (!folder) {
    return {
      id_or_name: idOrName,
      id: null,
      name: null,
      deleted: false,
      error: "not found"
    };
  }

  const resolvedId = folder.id.primaryKey;
  const resolvedName = folder.name;
  try {
    deleteObject(folder);
    return {
      id_or_name: idOrName,
      id: resolvedId,
      name: resolvedName,
      deleted: true,
      error: null
    };
  } catch (e) {
    const errorMessage = e && e.message ? String(e.message) : String(e);
    return {
      id_or_name: idOrName,
      id: resolvedId,
      name: resolvedName,
      deleted: false,
      error: errorMessage
    };
  }
});

const deletedCount = results.filter(result => result.deleted).length;
const failedCount = results.length - deletedCount;

return {
  summary: {
    requested: results.length,
    deleted: deletedCount,
    failed: failedCount
  },
  partial_success: deletedCount > 0 && failedCount > 0,
  results: results
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

}
