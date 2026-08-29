import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDescriptor, ToolProvider } from "../../src/runtime/provider";
import { createToolRuntime } from "../../src/runtime/runtime";

const baseDescriptor: ToolDescriptor = {
  id: "test.echo",
  description: "echo",
  keywords: ["test", "echo"],
  risk: "read",
  inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
  provider: { id: "native", kind: "native" },
  source: { id: "test", kind: "extension" },
};

function fakeProvider(id = "native", descriptor: ToolDescriptor = { ...baseDescriptor, provider: { id, kind: "native" } }): ToolProvider {
  return {
    id,
    kind: "native",
    async listTools() { return [descriptor]; },
    async execute(_toolId, input) { return { data: input }; },
  };
}

const options = {
  policy: { async preflight() {} },
  createExecutionContext: async () => ({
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    config: {},
    secrets: { async get() { return undefined; }, async set() {}, async delete() {} },
  }),
};

describe("ToolRuntime", () => {
  test("closes providers in reverse order, attempts all, and is idempotent", async () => {
    const events: string[] = [];
    const first = { ...fakeProvider("first", { ...baseDescriptor, provider: { id: "first", kind: "native" } }), async close() { events.push("first"); } };
    const second = { ...fakeProvider("second", { ...baseDescriptor, id: "second.echo", provider: { id: "second", kind: "native" } }), async close() { events.push("second"); throw new Error("close failed"); } };
    const runtime = await createToolRuntime({ ...options, providers: [first, second] });
    await expect(runtime.close()).rejects.toThrow("close failed");
    await expect(runtime.close()).rejects.toThrow("close failed");
    expect(events).toEqual(["second", "first"]);
  });

  test("isolates an unavailable MCP provider from healthy providers", async () => {
    const events: string[] = [];
    const first = { ...fakeProvider("first", { ...baseDescriptor, provider: { id: "first", kind: "native" } }), async close() { events.push("first"); } };
    const second: ToolProvider = {
      id: "mcp:second", kind: "mcp", namespace: "second",
      async listTools() { throw new Error("discovery failed"); },
      async execute() { return { data: {} }; },
      async close() { events.push("second"); },
    };
    const runtime = await createToolRuntime({ ...options, providers: [first, second] });
    expect((await runtime.search("test")).map((tool) => tool.id)).toEqual(["test.echo"]);
    expect(runtime.providerStatuses()).toContainEqual(expect.objectContaining({ id: "mcp:second", kind: "mcp", status: "unavailable" }));
    expect(await runtime.run("second.echo", {})).toMatchObject({ ok: false, error: { code: "PROVIDER_UNAVAILABLE" } });
    await runtime.close();
    expect(events).toEqual(["second", "first"]);
  });

  test("defers provider discovery until a runtime operation needs it", async () => {
    let calls = 0;
    const lazy: ToolProvider = {
      id: "lazy", kind: "native",
      async listTools() { calls++; return []; },
      async execute() { return { data: {} }; },
    };
    const runtime = await createToolRuntime({ ...options, providers: [lazy] });
    expect(calls).toBe(0);
    await runtime.search("missing");
    expect(calls).toBe(1);
  });

  test("runtime modules do not import CLI modules", () => {
    const runtimeRoot = join(import.meta.dir, "../../src/runtime");
    const files = new Bun.Glob("**/*.ts").scanSync({ cwd: runtimeRoot, absolute: true });
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/(?:from\s*|import\s*\()\s*["'](?:[^"']*\/)?cli(?:\/|["'])/);
    }
  });

  test("initializes asynchronously and provides progressive discovery", async () => {
    const runtime = await createToolRuntime({ ...options, providers: [fakeProvider()] });
    expect((await runtime.search("test"))[0].id).toBe("test.echo");
    expect((await runtime.search("test"))[0]).not.toHaveProperty("inputSchema");
    expect((await runtime.describe("test.echo")).inputSchema).toBeDefined();
  });

  test("reports stable tool-not-found errors", async () => {
    const runtime = await createToolRuntime({ ...options, providers: [fakeProvider()] });
    expect(await runtime.search("does-not-exist")).toEqual([]);
    await expect(runtime.describe("missing.tool")).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
    expect(await runtime.run("missing.tool", {})).toMatchObject({ ok: false, toolId: "missing.tool", error: { code: "TOOL_NOT_FOUND" } });
  });

  test("rejects provider descriptor identity mismatch before serving", async () => {
    const bad = fakeProvider("native", { ...baseDescriptor, provider: { id: "other", kind: "native" } });
    const runtime = await createToolRuntime({ ...options, providers: [bad] });
    await expect(runtime.search("test")).rejects.toMatchObject({ code: "PROVIDER_DESCRIPTOR_MISMATCH" });
  });

  test("rejects duplicate tool IDs across providers before serving", async () => {
    const first = fakeProvider("one", { ...baseDescriptor, provider: { id: "one", kind: "native" } });
    const second = fakeProvider("two", { ...baseDescriptor, provider: { id: "two", kind: "native" } });
    const runtime = await createToolRuntime({ ...options, providers: [first, second] });
    await expect(runtime.search("test")).rejects.toMatchObject({ code: "DUPLICATE_TOOL_ID" });
  });
});
