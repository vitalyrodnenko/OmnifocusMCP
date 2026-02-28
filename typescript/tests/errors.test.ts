import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileAsyncMock } = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: vi.fn(() => execFileAsyncMock),
}));

describe("jxa error handling", () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
    vi.resetModules();
  });

  it("runJxa surfaces non-zero subprocess failures", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error("Command failed"), {
        stderr: "script blew up",
      })
    );

    const { runJxa } = await import("../src/jxa.js");

    await expect(runJxa("return 1;")).rejects.toThrow("JXA execution failed: script blew up");
  });

  it("runJxa surfaces timeout failures", async () => {
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error("timed out"), {
        code: "ETIMEDOUT",
      })
    );

    const { runJxa } = await import("../src/jxa.js");

    await expect(runJxa("return 1;", 1_000)).rejects.toThrow("JXA command timed out after 1s.");
  });

  it("runOmniJs surfaces malformed json output", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: "not-json",
      stderr: "",
    });

    const { runOmniJs } = await import("../src/jxa.js");

    await expect(runOmniJs("return 1;")).rejects.toThrow("JXA command returned malformed JSON.");
  });
});
