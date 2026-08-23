import { describe, expect, test } from "bun:test";
import type { ToolDescriptor, ToolProvider } from "../../src/runtime/provider";
import { executeRuntimeTool, type RuntimeExecutionDeps } from "../../src/runtime/executor";

const descriptor: ToolDescriptor = {
  id: "test.echo",
  description: "echo input",
  risk: "read",
  inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
  provider: { id: "native", kind: "native" },
  source: { id: "test", kind: "extension" },
};

function provider(events: string[]): ToolProvider {
  return {
    id: "native",
    kind: "native",
    async listTools() {
      return [descriptor];
    },
    async execute(_toolId, input) {
      events.push("provider.execute");
      return { data: input, meta: { connection: "local", durationMs: 7 } };
    },
  };
}

function deps(events: string[], policy: RuntimeExecutionDeps["policy"]): RuntimeExecutionDeps {
  return {
    descriptor,
    provider: provider(events),
    policy,
    createExecutionContext: () => {
      events.push("context");
      return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        config: {},
        secrets: { async get() { events.push("secret"); return undefined; }, async set() {}, async delete() {} },
      };
    },
  };
}

describe("executeRuntimeTool", () => {
  test("policy rejection prevents context creation and provider execution", async () => {
    const events: string[] = [];
    const result = await executeRuntimeTool(
      deps(events, {
        async preflight() {
          events.push("policy");
          throw new Error("denied");
        },
      }),
      { value: "hello" },
    );
    expect(result).toMatchObject({ ok: false, toolId: "test.echo" });
    expect(events).toEqual(["policy"]);
  });

  test("validates, creates context, executes provider, and normalizes output", async () => {
    const events: string[] = [];
    const result = await executeRuntimeTool(
      deps(events, { async preflight() { events.push("policy"); } }),
      { value: "hello" },
    );
    expect(result).toMatchObject({
      ok: true,
      toolId: "test.echo",
      output: { value: "hello" },
      meta: { connection: "local", durationMs: 7 },
    });
    expect(events).toEqual(["policy", "context", "provider.execute"]);
  });

  test("validates MCP input without applying JSON Schema defaults", async () => {
    const mcpDescriptor: ToolDescriptor = {
      ...descriptor,
      id: "demo.echo",
      inputSchema: {
        type: "object",
        properties: { mode: { type: "string", default: "safe" } },
      },
      provider: { id: "mcp:demo", kind: "mcp" },
      source: { id: "demo", kind: "mcp-server" },
    };
    let received: unknown;

    const result = await executeRuntimeTool({
      descriptor: mcpDescriptor,
      provider: {
        id: "mcp:demo",
        kind: "mcp",
        async listTools() { return [mcpDescriptor]; },
        async execute(_toolId, input) {
          received = input;
          return { data: input };
        },
      },
      policy: { async preflight() {} },
      createExecutionContext: () => ({
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        config: {},
        secrets: { async get() { return undefined; }, async set() {}, async delete() {} },
      }),
    }, {});

    expect(result).toMatchObject({ ok: true, output: {} });
    expect(received).toEqual({});
  });
});
