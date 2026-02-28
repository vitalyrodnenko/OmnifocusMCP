import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_TIMEOUT_MS = 30_000;

let jxaLock: Promise<void> = Promise.resolve();

function friendlyJxaError(stderr: string): string {
  const lowered = stderr.toLowerCase();
  if (lowered.includes("not running") && lowered.includes("omnifocus")) {
    return "OmniFocus is not running. Please open OmniFocus and try again.";
  }
  if (lowered.includes("application isn't running") && lowered.includes("omnifocus")) {
    return "OmniFocus is not running. Please open OmniFocus and try again.";
  }
  if (
    lowered.includes("not authorized") ||
    lowered.includes("not permitted") ||
    lowered.includes("not authorised") ||
    lowered.includes("apple events") ||
    lowered.includes("(-1743)")
  ) {
    return (
      "macOS blocked Automation access to OmniFocus. " +
      "Grant permission in System Settings > Privacy & Security > Automation."
    );
  }
  if (lowered.includes("syntax error")) {
    return `JXA script syntax error: ${stderr.trim()}`;
  }
  return `JXA execution failed: ${stderr.trim()}`;
}

function friendlyOmniJsError(error: string): string {
  const cleaned = error.trim();
  const lowered = cleaned.toLowerCase();
  if (lowered.startsWith("task not found:")) {
    return cleaned;
  }
  if (lowered.startsWith("project not found:")) {
    return cleaned;
  }
  if (lowered.startsWith("tag not found:")) {
    return cleaned;
  }
  if (lowered.startsWith("folder not found:")) {
    return cleaned;
  }
  if (lowered.includes("not running") && lowered.includes("omnifocus")) {
    return "OmniFocus is not running. Please open OmniFocus and try again.";
  }
  if (lowered.includes("application isn't running") && lowered.includes("omnifocus")) {
    return "OmniFocus is not running. Please open OmniFocus and try again.";
  }
  if (
    lowered.includes("not authorized") ||
    lowered.includes("not permitted") ||
    lowered.includes("not authorised") ||
    lowered.includes("apple events") ||
    lowered.includes("(-1743)")
  ) {
    return (
      "macOS blocked Automation access to OmniFocus. " +
      "Grant permission in System Settings > Privacy & Security > Automation."
    );
  }
  return `OmniFocus operation failed: ${cleaned}`;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const withCode = error as Error & { code?: unknown };
  if (withCode.code === "ETIMEDOUT") {
    return true;
  }
  return error.message.toLowerCase().includes("timed out");
}

async function withJxaLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = jxaLock;
  let release: (() => void) | undefined;
  jxaLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    if (release) {
      release();
    }
  }
}

export function escapeForJxa(value: string): string {
  return JSON.stringify(value);
}

export async function runJxa(
  script: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return withJxaLock(async () => {
    try {
      const { stdout } = await execFileAsync(
        "osascript",
        ["-l", "JavaScript", "-e", script],
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }
      );
      return stdout.trim();
    } catch (error: unknown) {
      if (isTimeoutError(error)) {
        throw new Error(`JXA command timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      if (error instanceof Error) {
        const withStderr = error as Error & { stderr?: unknown };
        if (typeof withStderr.stderr === "string" && withStderr.stderr.trim() !== "") {
          throw new Error(friendlyJxaError(withStderr.stderr));
        }
        if (withStderr.stderr instanceof Buffer) {
          throw new Error(friendlyJxaError(withStderr.stderr.toString("utf-8")));
        }
        throw new Error(friendlyJxaError(error.message));
      }
      throw new Error("JXA execution failed.");
    }
  });
}

export async function runJxaJson(
  script: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const stdout = await runJxa(script, timeoutMs);
  if (stdout === "") {
    throw new Error("JXA command returned empty output.");
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error("JXA command returned malformed JSON.");
  }
}

export async function runOmniJs(
  script: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const wrappedOmniJs = `
(function() {
  try {
    if (typeof document === "object" && document) {
      if (typeof document.flattenedTasks === "undefined" && typeof flattenedTasks !== "undefined") {
        document.flattenedTasks = flattenedTasks;
      }
      if (
        typeof document.flattenedProjects === "undefined" &&
        typeof flattenedProjects !== "undefined"
      ) {
        document.flattenedProjects = flattenedProjects;
      }
      if (typeof document.flattenedTags === "undefined" && typeof flattenedTags !== "undefined") {
        document.flattenedTags = flattenedTags;
      }
      if (
        typeof document.flattenedFolders === "undefined" &&
        typeof flattenedFolders !== "undefined"
      ) {
        document.flattenedFolders = flattenedFolders;
      }
    }
    const __data = (function() {
${script}
    })();
    return JSON.stringify({ ok: true, data: __data });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) });
  }
})()
`.trim();

  const outerJxa = `
const app = Application('OmniFocus');
const result = app.evaluateJavascript(${escapeForJxa(wrappedOmniJs)});
result;
`.trim();

  const envelope = await runJxaJson(outerJxa, timeoutMs);
  if (typeof envelope !== "object" || envelope === null) {
    throw new Error("OmniFocus returned an unexpected response.");
  }

  const record = envelope as Record<string, unknown>;
  if (record.ok !== true) {
    const rawError = record.error;
    if (typeof rawError === "string" && rawError.trim() !== "") {
      throw new Error(friendlyOmniJsError(rawError));
    }
    throw new Error("OmniFocus script error.");
  }

  return record.data;
}
