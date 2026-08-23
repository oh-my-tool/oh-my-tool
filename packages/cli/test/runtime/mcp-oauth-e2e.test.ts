import { afterEach, describe, expect, test } from "bun:test";
import type { McpHttpServerConfig } from "../../src/config/config";
import { memoryStore } from "../../src/secrets/secrets";
import { createMcpOAuthStore } from "../../src/runtime/providers/mcp/oauth-store";
import { createMcpSession } from "../../src/runtime/providers/mcp/session";

const servers: Array<Bun.Server<undefined>> = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

describe("MCP OAuth end-to-end session", () => {
  test("uses persisted OAuth credentials for a fresh non-interactive MCP session", async () => {
    let origin = "";
    let initialized = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(rawRequest) {
      const request = rawRequest as unknown as { method: string; headers: { get(name: string): string | null }; json(): Promise<unknown> };
      if (request.headers.get("authorization") !== "Bearer oauth-access") return new Response(null, { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` } });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const body = await request.json() as { id?: number; method: string };
      if (body.method === "initialize") {
        initialized += 1;
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "oauth-fixture", version: "1.0.0" } } });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "secure_echo", description: "OAuth echo", inputSchema: { type: "object", properties: {} } }] } });
      return new Response(null, { status: 202 });
    } });
    servers.push(server);
    origin = `http://127.0.0.1:${server.port}`;
    const config: McpHttpServerConfig = { enabled: true, namespace: "secure", transport: "streamable-http", url: `${origin}/mcp`, headers: {}, secretHeaders: {}, auth: { type: "oauth", scopes: ["tools"], callbackPort: 0, tokenEndpointAuthMethod: "none" } };
    const secrets = memoryStore();
    const store = createMcpOAuthStore("secure", secrets);
    await store.saveTokens({ access_token: "oauth-access", token_type: "Bearer", refresh_token: "oauth-refresh", issuer: origin });
    await store.saveClientInformation({ client_id: "client", issuer: origin });
    const session = await createMcpSession("secure", config, secrets);
    expect(await session.listTools()).toMatchObject({ tools: [{ name: "secure_echo" }] });
    expect(initialized).toBe(1);
    await session.close();
  });
});
