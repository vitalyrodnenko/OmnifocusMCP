import { z } from "zod";

import { escapeForJxa, runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "list_tags",
    "list tags with availability counts and optional status filter.",
    {
      statusFilter: z.enum(["active", "on_hold", "dropped", "all"]).default("all"),
      sortBy: z.enum(["name", "availableTaskCount", "totalTaskCount"]).optional(),
      sortOrder: z.enum(["asc", "desc"]).default("asc"),
      limit: z.number().int().min(1).default(100),
    },
    async ({ statusFilter, sortBy, sortOrder, limit }) => {
      try {
        const effectiveStatusFilter = statusFilter ?? "all";
        const effectiveSortOrder = sortOrder ?? "asc";
        const statusFilterValue = escapeForJxa(effectiveStatusFilter);
        const sortByValue = sortBy == null ? "null" : escapeForJxa(sortBy);
        const sortOrderValue = escapeForJxa(effectiveSortOrder);
        const script = `
const statusFilter = ${statusFilterValue};
const sortBy = ${sortByValue};
const sortOrder = ${sortOrderValue};

const tagCounts = new Map();
document.flattenedTasks.forEach(task => {
  task.tags.forEach(tag => {
    const tagId = tag.id.primaryKey;
    const current = tagCounts.get(tagId) || { availableTaskCount: 0, totalTaskCount: 0 };
    current.totalTaskCount += 1;
    if (!task.completed) current.availableTaskCount += 1;
    tagCounts.set(tagId, current);
  });
});
const normalizeTagStatus = (tag) => {
  const rawStatus = String(tag.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) return "on_hold";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};

const compareValues = (left, right) => {
  if (left < right) return sortOrder === "asc" ? -1 : 1;
  if (left > right) return sortOrder === "asc" ? 1 : -1;
  return 0;
};

const filteredTags = document.flattenedTags.filter(tag => {
  return statusFilter === "all" || normalizeTagStatus(tag) === statusFilter;
});

const mappedTags = filteredTags.map(tag => {
  const counts = tagCounts.get(tag.id.primaryKey) || { availableTaskCount: 0, totalTaskCount: 0 };
  return {
    id: tag.id.primaryKey,
    name: tag.name,
    parent: tag.parent ? tag.parent.name : null,
    availableTaskCount: counts.availableTaskCount,
    totalTaskCount: counts.totalTaskCount,
    status: normalizeTagStatus(tag)
  };
});

const sortedTags = sortBy === null ? mappedTags : mappedTags.slice().sort((a, b) => {
  if (sortBy === "name") {
    return compareValues(String(a.name).toLowerCase(), String(b.name).toLowerCase());
  }
  return compareValues(a[sortBy], b[sortBy]);
});
return sortedTags.slice(0, ${limit});
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "search_tags",
    "search tags by query using omnifocus tag matching.",
    {
      query: z.string().min(1).describe("search query"),
      limit: z.number().int().min(1).default(100).describe("max number of tags to return"),
    },
    async ({ query, limit }) => {
      try {
        const normalizedQuery = query.trim();
        if (normalizedQuery === "") {
          throw new Error("query must not be empty.");
        }
        const queryValue = escapeForJxa(normalizedQuery);
        const script = `
const queryValue = ${queryValue};
const normalizeTagStatus = (tag) => {
  const rawStatus = String(tag.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) return "on_hold";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};

return tagsMatching(queryValue)
  .slice(0, ${limit})
  .map(tag => {
    return {
      id: tag.id.primaryKey,
      name: tag.name,
      status: normalizeTagStatus(tag),
      parent: tag.parent ? tag.parent.name : null
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
const tag = (() => {
  if (parentName === null) return new Tag(tagName);
  const parentTag = document.flattenedTags.byName(parentName);
  if (!parentTag) throw new Error(\`Tag not found: \${parentName}\`);
  return new Tag(tagName, parentTag.ending);
})();
return { id: tag.id.primaryKey, name: tag.name };
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "update_tag",
    "update a tag by id or name.",
    {
      tag_name_or_id: z.string().min(1),
      name: z.string().min(1).nullable().optional(),
      status: z.enum(["active", "on_hold", "dropped"]).nullable().optional(),
    },
    async ({ tag_name_or_id, name, status }) => {
      try {
        const tagFilter = tag_name_or_id.trim();
        const newNameValue = name === undefined || name === null ? null : name.trim();
        const statusValue = status === undefined ? null : status;

        if (!tagFilter) {
          throw new Error("tag_name_or_id must not be empty.");
        }
        if (name !== undefined && newNameValue === "") {
          throw new Error("name must not be empty when provided.");
        }
        if (newNameValue === null && statusValue === null) {
          throw new Error("at least one field must be provided: name or status.");
        }

        const escapedTagFilter = escapeForJxa(tagFilter);
        const escapedName = newNameValue === null ? "null" : escapeForJxa(newNameValue);
        const escapedStatus = statusValue === null ? "null" : escapeForJxa(statusValue);

        const script = `
const tagFilter = ${escapedTagFilter};
const newName = ${escapedName};
const statusValue = ${escapedStatus};

const tag = document.flattenedTags.find(
  t => t.id.primaryKey === tagFilter || t.name === tagFilter
);
if (!tag) {
  throw new Error(\`Tag not found: \${tagFilter}\`);
}

if (newName !== null) {
  tag.name = newName;
}

if (statusValue !== null) {
  let targetStatus;
  if (statusValue === "active") {
    targetStatus = Tag.Status.Active;
  } else if (statusValue === "on_hold") {
    targetStatus = Tag.Status.OnHold;
  } else if (statusValue === "dropped") {
    targetStatus = Tag.Status.Dropped;
  } else {
    throw new Error(\`Invalid status: \${statusValue}\`);
  }
  tag.status = targetStatus;
}

const normalizeTagStatus = (tag) => {
  const rawStatus = String(tag.status || "").toLowerCase();
  const flattened = rawStatus
    .replace(/^\\[object_/g, "")
    .replace(/[\\[\\]{}()]/g, " ")
    .replace(/status/g, " ")
    .replace(/[:.=]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
  if (flattened.includes("onhold") || /(^|\\s)on\\s*hold(\\s|$)/.test(flattened)) return "on_hold";
  if (flattened.includes("dropped")) return "dropped";
  if (flattened.includes("active")) return "active";
  return "active";
};

return {
  id: tag.id.primaryKey,
  name: tag.name,
  status: normalizeTagStatus(tag)
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "delete_tag",
    "delete a tag by id or name. warning: tasks using this tag will lose the tag assignment.",
    {
      tag_name_or_id: z.string().min(1),
    },
    async ({ tag_name_or_id }) => {
      try {
        const tagFilter = tag_name_or_id.trim();
        if (!tagFilter) {
          throw new Error("tag_name_or_id must not be empty.");
        }

        const escapedTagFilter = escapeForJxa(tagFilter);
        const script = `
const tagFilter = ${escapedTagFilter};

const tag = document.flattenedTags.find(
  t => t.id.primaryKey === tagFilter || t.name === tagFilter
);
if (!tag) {
  throw new Error(\`Tag not found: \${tagFilter}\`);
}

const tagId = tag.id.primaryKey;
const tagName = tag.name;
const taskCount = tag.tasks.length;

deleteObject(tag);

return {
  id: tagId,
  name: tagName,
  deleted: true,
  taskCount: taskCount
};
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );

  server.tool(
    "delete_tags_batch",
    "delete multiple tags by id or exact name in a single omnijs call. destructive operation: this removes tags and unassigns them from linked tasks. use update_tag for non-destructive edits. before calling this tool, always show the user the target tag list and ask for explicit confirmation.",
    {
      tag_ids_or_names: z.array(z.string()).min(1).describe("tag ids or exact names to delete"),
    },
    async ({ tag_ids_or_names }) => {
      try {
        if (tag_ids_or_names.length === 0) {
          throw new Error("tag_ids_or_names must contain at least one tag id or name.");
        }
        const normalizedTagIdsOrNames = tag_ids_or_names.map((tagIdOrName) => {
          const normalizedTagIdOrName = tagIdOrName.trim();
          if (normalizedTagIdOrName === "") {
            throw new Error("each tag id or name must be a non-empty string.");
          }
          return normalizedTagIdOrName;
        });
        const seenTagIdsOrNames = new Set<string>();
        for (const normalizedTagIdOrName of normalizedTagIdsOrNames) {
          if (seenTagIdsOrNames.has(normalizedTagIdOrName)) {
            throw new Error(`tag_ids_or_names must not contain duplicates: ${normalizedTagIdOrName}`);
          }
          seenTagIdsOrNames.add(normalizedTagIdOrName);
        }

        const tagIdsOrNamesValue = JSON.stringify(normalizedTagIdsOrNames);
        const script = `
const tagIdsOrNames = ${tagIdsOrNamesValue};
const requests = tagIdsOrNames.map((idOrName, index) => ({ idOrName, index }));
const tags = document.flattenedTags
  .map(item => {
    try {
      return {
        id: item.id.primaryKey,
        name: item.name,
        parentId: item.parent ? item.parent.id.primaryKey : null
      };
    } catch (e) {
      return null;
    }
  })
  .filter(item => item !== null);
const tagsById = new Map(tags.map(tag => [tag.id, tag]));

const resolveTag = idOrName => {
  const byId = tagsById.get(idOrName);
  if (byId) return byId;
  return tags.find(tag => tag.name === idOrName);
};

const depthCache = new Map();
const getDepth = (tagId, stack = new Set()) => {
  if (depthCache.has(tagId)) return depthCache.get(tagId);
  if (stack.has(tagId)) return 0;
  stack.add(tagId);
  const tag = tagsById.get(tagId);
  let depth = 0;
  if (tag && tag.parentId && tagsById.has(tag.parentId)) {
    depth = getDepth(tag.parentId, stack) + 1;
  }
  stack.delete(tagId);
  depthCache.set(tagId, depth);
  return depth;
};

const existsTagById = tagId => {
  return document.flattenedTags.some(tag => {
    try {
      return tag.id.primaryKey === tagId;
    } catch (e) {
      return false;
    }
  });
};

const getLiveTagById = tagId => {
  return document.flattenedTags.find(tag => {
    try {
      return tag.id.primaryKey === tagId;
    } catch (e) {
      return false;
    }
  });
};

const results = new Array(requests.length);
const unresolved = [];
const resolved = [];

requests.forEach(request => {
  const tag = resolveTag(request.idOrName);
  if (!tag) {
    unresolved.push(request);
    return;
  }
  resolved.push({
    ...request,
    tag,
    depth: getDepth(tag.id)
  });
});

resolved
  .sort((left, right) => right.depth - left.depth || left.index - right.index)
  .forEach(request => {
    const resolvedId = request.tag.id;
    const resolvedName = request.tag.name;
    const liveTag = getLiveTagById(resolvedId);
    if (!liveTag) {
      results[request.index] = {
        id_or_name: request.idOrName,
        id: resolvedId,
        name: resolvedName,
        deleted: true,
        error: null
      };
      return;
    }
    try {
      deleteObject(liveTag);
      results[request.index] = {
        id_or_name: request.idOrName,
        id: resolvedId,
        name: resolvedName,
        deleted: true,
        error: null
      };
    } catch (e) {
      if (!existsTagById(resolvedId)) {
        results[request.index] = {
          id_or_name: request.idOrName,
          id: resolvedId,
          name: resolvedName,
          deleted: true,
          error: null
        };
        return;
      }
      const errorMessage = e && e.message ? String(e.message) : String(e);
      results[request.index] = {
        id_or_name: request.idOrName,
        id: resolvedId,
        name: resolvedName,
        deleted: false,
        error: errorMessage
      };
    }
  });

unresolved.forEach(request => {
  results[request.index] = {
    id_or_name: request.idOrName,
    id: null,
    name: null,
    deleted: false,
    error: "not found"
  };
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
