import { describe, expect, test } from "bun:test";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type { McpServerConfig } from "../../src/config/config";
import { McpProvider } from "../../src/runtime/providers/mcp/provider";
import type { McpSession } from "../../src/runtime/providers/mcp/session";
import { executeRuntimeTool } from "../../src/runtime/executor";

const config: McpServerConfig = {
  enabled: true,
  transport: "streamable-http",
  url: "https://mcp.example.test",
  namespace: "github",
  headers: {},
  secretHeaders: {},
  auth: { type: "none" },
};
const secrets = { async get() { return undefined; }, async set() {}, async delete() {} };
const ctx = { logger: { debug() {}, info() {}, warn() {}, error() {} }, config: {}, secrets };

function tool(name: string, title = name): Tool {
  return { name, title, description: `description for ${name}`, inputSchema: { type: "object", properties: {} } };
}

function session(pages: Array<{ tools: Tool[]; nextCursor?: string }>, calls: string[] = [], result?: CallToolResult): McpSession {
  return {
    async listTools(cursor) { return pages[cursor === undefined ? 0 : 1] ?? { tools: [] }; },
    async callTool(name, args) { calls.push(`${name}:${JSON.stringify(args)}`); return result ?? { content: [{ type: "text", text: "created" }] }; },
    async close() { calls.push("close"); },
  };
}

describe("McpProvider", () => {
  test("discovers paginated tools and routes to exact remote names", async () => {
    const calls: string[] = [];
    const provider = new McpProvider({ serverId: "github", config, secrets, createSession: async () => session([
      { tools: [tool("alpha")], nextCursor: "page-2" },
      { tools: [tool("beta")] },
    ], calls) });
    const descriptors = await provider.listTools();
    expect(descriptors.map((item) => item.id)).toEqual(["github.alpha", "github.beta"]);
    expect(await provider.listTools()).toBe(descriptors);
    await provider.execute("github.alpha", {}, ctx);
    await provider.execute("github.beta", {}, ctx);
    expect(calls).toEqual(["alpha:{}", "beta:{}"]);
  });

  test("rejects pagination loops and duplicate exposed IDs before returning", async () => {
    const closed: string[] = [];
    const loop = new McpProvider({ serverId: "github", config, secrets, createSession: async () => session([
      { tools: [], nextCursor: "same" }, { tools: [], nextCursor: "same" },
    ], closed) });
    await expect(loop.listTools()).rejects.toMatchObject({ code: "MCP_PAGINATION_LOOP" });
    expect(closed).toEqual(["close"]);

    const duplicate = new McpProvider({ serverId: "github", config, secrets, createSession: async () => session([
      { tools: [tool("same")], nextCursor: "page-2" }, { tools: [tool("same")] },
    ]) });
    await expect(duplicate.listTools()).rejects.toMatchObject({ code: "MCP_DUPLICATE_TOOL_ID" });
  });

  test("does not call the session for an undiscovered tool", async () => {
    const calls: string[] = [];
    const provider = new McpProvider({ serverId: "github", config, secrets, createSession: async () => session([{ tools: [tool("listed")] }], calls) });
    await provider.listTools();
    await expect(provider.execute("github.not_listed", {}, ctx)).rejects.toMatchObject({ code: "MCP_TOOL_NOT_FOUND" });
    expect(calls).toEqual([]);
  });

  test("returns successful content and structured content with MCP metadata", async () => {
    const result = { content: [{ type: "text", text: "created" }], structuredContent: { number: 42 } } as CallToolResult;
    const provider = new McpProvider({ serverId: "github", config, secrets, createSession: async () => session([{ tools: [tool("create_issue")] }], [], result) });
    await provider.listTools();
    await expect(provider.execute("github.create_issue", { title: "bug" }, ctx)).resolves.toEqual({
      data: result,
      meta: { mcpServer: "github", remoteTool: "create_issue" },
    });
  });

  test("normalizes MCP tool errors into structured runtime errors", async () => {
    const result = { isError: true, content: [{ type: "text", text: "permission denied" }], structuredContent: { retryable: false } } as CallToolResult;
    const provider = new McpProvider({ serverId: "github", config, secrets, createSession: async () => session([{ tools: [tool("create_issue")] }], [], result) });
    const descriptor = (await provider.listTools())[0];
    const execution = await executeRuntimeTool({
      descriptor,
      provider,
      policy: { preflight() {} },
      createExecutionContext: () => ctx,
    }, {});
    expect(execution).toEqual({
      ok: false,
      toolId: "github.create_issue",
      error: {
        code: "MCP_TOOL_ERROR",
        message: "MCP tool 'github.create_issue' reported an error",
        details: { content: result.content, structuredContent: result.structuredContent },
      },
    });
  });

  test("close is idempotent", async () => {
    let closeCount = 0;
    const provider = new McpProvider({ serverId: "github", config, secrets, createSession: async () => ({ ...session([{ tools: [tool("one")] }]), async close() { closeCount += 1; } }) });
    await provider.listTools();
    await Promise.all([provider.close(), provider.close()]);
    expect(closeCount).toBe(1);
  });
});
