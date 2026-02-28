import { z } from "zod";

import { runOmniJs } from "../jxa.js";
import { errorResult, normalizeError, textResult, type Server } from "../types.js";

export function register(server: Server): void {
  server.tool(
    "get_forecast",
    "get forecast sections for overdue, due today, and flagged tasks.",
    { limit: z.number().int().min(1).default(100) },
    async ({ limit }) => {
      try {
        return textResult(await getForecastData(limit));
      } catch (error: unknown) {
        return errorResult(normalizeError(error));
      }
    }
  );
}

export async function getForecastData(limit: number): Promise<unknown> {
  const script = `
const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endOfToday = new Date(startOfToday.getTime() + (24 * 60 * 60 * 1000));
const toTaskSummary = task => ({
  id: task.id.primaryKey,
  name: task.name,
  note: task.note,
  flagged: task.flagged,
  completed: task.completed,
  dueDate: task.dueDate ? task.dueDate.toISOString() : null,
  deferDate: task.deferDate ? task.deferDate.toISOString() : null,
  projectName: task.containingProject ? task.containingProject.name : null,
  tags: task.tags.map(tag => tag.name),
  estimatedMinutes: task.estimatedMinutes
});
const openTasks = document.flattenedTasks.filter(task => !task.completed);
const overdue = openTasks
  .filter(task => task.dueDate !== null && task.dueDate < startOfToday)
  .slice(0, ${limit})
  .map(toTaskSummary);
const dueToday = openTasks
  .filter(task => task.dueDate !== null && task.dueDate >= startOfToday && task.dueDate < endOfToday)
  .slice(0, ${limit})
  .map(toTaskSummary);
const flagged = openTasks
  .filter(task => task.flagged)
  .slice(0, ${limit})
  .map(toTaskSummary);
return { overdue, dueToday, flagged };
`.trim();
  return runOmniJs(script);
}
