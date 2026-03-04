import { z } from "zod";

import { runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "list_perspectives",
    "list available perspectives including built-in and custom perspectives.",
    { limit: z.number().int().min(1).default(100) },
    async ({ limit }) => {
      try {
        const script = `
const getPerspectiveId = perspective => {
  if (perspective.id && perspective.id.primaryKey) return perspective.id.primaryKey;
  if (perspective.identifier) return String(perspective.identifier);
  if (perspective.name) return String(perspective.name);
  return "unknown";
};
const normalizePerspective = perspective => ({ id: getPerspectiveId(perspective), name: perspective.name || "" });
const collected = [];
if (typeof Perspective !== "undefined" && Perspective.BuiltIn && Perspective.BuiltIn.all) {
  Perspective.BuiltIn.all.forEach(perspective => collected.push(normalizePerspective(perspective)));
}
if (typeof Perspective !== "undefined" && Perspective.Custom && Perspective.Custom.all) {
  Perspective.Custom.all.forEach(perspective => collected.push(normalizePerspective(perspective)));
}
if (document.perspectives) {
  document.perspectives.forEach(perspective => collected.push(normalizePerspective(perspective)));
}
const unique = [];
const seen = new Set();
collected.forEach(perspective => {
  if (seen.has(perspective.id)) return;
  seen.add(perspective.id);
  unique.push(perspective);
});
return unique.slice(0, ${limit});
`.trim();
        return textResult(await runOmniJs(script));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );
}
