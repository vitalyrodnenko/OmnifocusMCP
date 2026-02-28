import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("top-level readme config docs", () => {
  it("documents both implementation configs and switching guidance", () => {
    const readme = readFileSync(join(process.cwd(), "..", "README.md"), "utf8");

    expect(readme.toLowerCase()).toContain("switching between rust, python, and typescript");
    expect(readme).toContain("\"command\": \"uv\"");
    expect(readme).toContain("\"command\": \"node\"");
    expect(readme).toContain("\"args\": [\"-m\", \"omnifocus_mcp\"]");
    expect(readme).toContain("\"args\": [\"dist/index.js\"]");
  });
});
