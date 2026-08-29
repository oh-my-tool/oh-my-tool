import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDescriptor, ToolProvider } from "../../src/runtime/provider";
import { executeRuntimeTool } from "../../src/runtime/executor";

const descriptor: ToolDescriptor = {
  id: "test.echo",
  description: "echo",
  risk: "read",
  provider: { id: "native", kind: "native" },
  source: { id: "test", kind: "extension", version: "0.1.0" },
};

const provider: ToolProvider = {
  id: "native",
  kind: "native",
  async listTools() { return [descriptor]; },
  async execute(_toolId, input) { return { data: input }; },
};

const deps = {
  descriptor,
  provider,
  policy: { async preflight() {} },
  createExecutionContext: async () => ({
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    config: {},
    secrets: { async get() { return undefined; }, async set() {}, async delete() {} },
  }),
};

describe("runtime execution boundary", () => {
  test("returns the runtime result contract", async () => {
    await expect(executeRuntimeTool(deps, { value: "hello" })).resolves.toEqual({
      ok: true,
      toolId: "test.echo",
      output: { value: "hello" },
      meta: {},
    });
  });

  test("CLI run command has no legacy result adapter", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/cli/commands/run.ts"), "utf8");
    expect(source).not.toContain("../../core/result");
    expect(source).not.toContain("tool: toolName");
  });

  test("CLI output formatter has no legacy result import", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/cli/output.ts"), "utf8");
    expect(source).not.toContain("../core/result");
  });
});
