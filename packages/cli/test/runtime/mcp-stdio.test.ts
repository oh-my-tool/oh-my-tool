import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { McpStdioServerConfig } from "../../src/config/config";
import { createMcpSession } from "../../src/runtime/providers/mcp/session";
import { McpProvider } from "../../src/runtime/providers/mcp/provider";
import { memoryStore } from "../../src/secrets/secrets";

const sessions: Array<{ close(): Promise<void> }> = [];
const fixture = resolve(import.meta.dir, "../fixtures/mcp/stdio-server.ts");
const config: McpStdioServerConfig = {
  enabled: true,
  namespace: "fixture",
  transport: "stdio",
  command: "bun",
  args: [fixture],
  env: {},
  secretEnv: { FIXTURE_TOKEN: "mcp:fixture:token" },
};

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

describe("MCP stdio integration", () => {
  test.skip("discovers and calls a real stdio MCP fixture with secret env (child-process spawning is restricted in the desktop sandbox)", async () => {
    const secrets = memoryStore({ "mcp:fixture:token": "stdio-secret" });
    const provider = new McpProvider({
      serverId: "fixture",
      config,
      secrets,
      createSession: async (...args) => {
        const session = await createMcpSession(...args);
        sessions.push(session);
        return session;
      },
    });
    const [descriptor] = await provider.listTools();
    expect(descriptor).toMatchObject({ id: "fixture.echo", description: "Echo input through MCP", risk: "read" });
    const result = await provider.execute("fixture.echo", { value: "hello" }, {
      logger: { debug() {}, info() {}, warn() {}, error() {} }, config: {}, secrets,
    });
    expect(result).toEqual({
      data: { content: [{ type: "text", text: "echoed:hello" }], structuredContent: { echoed: "hello", tokenPresent: true } },
      meta: { mcpServer: "fixture", remoteTool: "echo" },
    });
    expect(JSON.stringify(result)).not.toContain("stdio-secret");
  });
});
