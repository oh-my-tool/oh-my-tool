import { afterEach, describe, expect, test } from "bun:test";
import type { McpHttpServerConfig } from "../../src/config/config";
import { createMcpSession } from "../../src/runtime/providers/mcp/session";
import { McpProvider } from "../../src/runtime/providers/mcp/provider";
import { memoryStore } from "../../src/secrets/secrets";

const servers: Array<Bun.Server<undefined>> = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

describe("MCP Streamable HTTP integration", () => {
  test("uses production HTTP transport, auth headers, pagination, and calls", async () => {
    const seen: Headers[] = [];
    let origin = "";
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      seen.push(request.headers);
      if (request.headers.get("authorization") !== "Bearer test-token" || request.headers.get("x-tenant") !== "engineering" || request.headers.get("x-gateway-key") !== "gateway-secret") return new Response(null, { status: 401 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const body = await request.json() as { id?: number; method: string; params?: { cursor?: string; arguments?: { value?: string } } };
      if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "http-fixture", version: "1.0.0" } } });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: body.params?.cursor ? { tools: [{ name: "second", description: "second page", inputSchema: { type: "object", properties: {} } }] } : { tools: [], nextCursor: "second-page" } });
      if (body.method === "tools/call") return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `echoed:${body.params?.arguments?.value ?? ""}` }] } });
      return new Response(null, { status: 202 });
    } });
    servers.push(server);
    origin = `http://127.0.0.1:${server.port}`;
    const config: McpHttpServerConfig = { enabled: true, namespace: "http", transport: "streamable-http", url: `${origin}/mcp`, headers: { "X-Tenant": "engineering" }, secretHeaders: { "X-Gateway-Key": "mcp:http:gateway" }, auth: { type: "bearer", tokenSecret: "mcp:http:token" } };
    const secrets = memoryStore({ "mcp:http:token": "test-token", "mcp:http:gateway": "gateway-secret" });
    const provider = new McpProvider({ serverId: "http", config, secrets, createSession: async (...args) => createMcpSession(...args) });
    const descriptors = await provider.listTools();
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(["http.second"]);
    const result = await provider.execute("http.second", { value: "ok" }, { logger: { debug() {}, info() {}, warn() {}, error() {} }, config: {}, secrets });
    expect(result.data).toEqual({ content: [{ type: "text", text: "echoed:ok" }] });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    await provider.close();
  });
});
