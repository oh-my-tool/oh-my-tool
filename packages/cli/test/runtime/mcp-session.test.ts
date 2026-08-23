import { describe, expect, test } from "bun:test";
import type { AuthProvider, CallToolResult, Tool } from "@modelcontextprotocol/client";
import type { McpHttpServerConfig, McpStdioServerConfig } from "../../src/config/config";
import { createMcpSession, type McpClient, type McpSessionDependencies } from "../../src/runtime/providers/mcp/session";
import { createMcpTransport, type McpTransport, type McpTransportDependencies, type OAuthMcpServerConfig } from "../../src/runtime/providers/mcp/transport";
import { memoryStore } from "../../src/secrets/secrets";
import { RuntimeError } from "../../src/runtime/errors";
import { createMcpOAuthProvider } from "../../src/runtime/providers/mcp/oauth-provider";

const stdioConfig: McpStdioServerConfig = {
  enabled: true,
  namespace: "demo",
  transport: "stdio",
  command: "demo-server",
  args: ["--serve"],
  cwd: "/tmp/demo",
  env: { MODE: "test" },
  secretEnv: { API_TOKEN: "mcp:demo:token" },
};

const httpConfig: McpHttpServerConfig = {
  enabled: true,
  namespace: "demo",
  transport: "streamable-http",
  url: "https://mcp.example.test",
  headers: { "x-client": "oh-my-tool" },
  secretHeaders: { "x-api-key": "mcp:demo:header" },
  auth: { type: "bearer", tokenSecret: "mcp:demo:token" },
};

function fakeClient(events: string[]): McpClient {
  return {
    async connect(transport) { events.push(`connect:${transport.kind}`); },
    async listTools({ cursor }) { events.push(`list:${cursor ?? ""}`); return { tools: [{ name: "echo" }] as Tool[], nextCursor: "next" }; },
    async callTool({ name, arguments: args }) { events.push(`call:${name}:${String(args.value)}`); return { content: [] } as CallToolResult; },
    async close() { events.push("client.close"); },
  };
}

function transport(kind: McpTransport["kind"], options: Record<string, unknown>): McpTransport {
  return { kind, options } as McpTransport;
}

function dependencies(events: string[], overrides: Partial<McpSessionDependencies> = {}): McpSessionDependencies {
  return {
    clientVersion: "0.2.0",
    createClient: (info) => {
      events.push(`client:${info.name}:${info.version}`);
      return fakeClient(events);
    },
    createTransport: async (_serverId, config, secrets, oauthAuthProviderFactory) => {
      events.push(`transport:${config.transport}`);
      if (config.transport === "stdio") {
        const secret = await secrets.get(config.secretEnv.API_TOKEN);
        return { transport: transport("stdio", { command: config.command, args: config.args, cwd: config.cwd, env: { ...config.env, API_TOKEN: secret } }), secretValues: secret === undefined ? [] : [secret] };
      }
      const token = config.auth.type === "bearer" ? await secrets.get(config.auth.tokenSecret) : undefined;
      const header = await secrets.get(config.secretHeaders["x-api-key"]);
      const authProvider = config.auth.type === "oauth" ? await oauthAuthProviderFactory?.("demo", config as OAuthMcpServerConfig, secrets) : { token: async () => token };
      return { transport: transport("streamable-http", { url: config.url, headers: { ...config.headers, "x-api-key": header }, authProvider }), secretValues: [token, header].filter((value): value is string => value !== undefined) };
    },
    ...overrides,
  };
}

describe("MCP sessions", () => {
  test("creates the selected transport and delegates MCP lifecycle calls", async () => {
    const events: string[] = [];
    const session = await createMcpSession("demo", stdioConfig, memoryStore({ "mcp:demo:token": "secret-token" }), dependencies(events));

    expect(await session.listTools("cursor-1")).toMatchObject({ tools: [{ name: "echo" }], nextCursor: "next" });
    expect(await session.callTool("echo", { value: "hello" })).toEqual({ content: [] });
    await session.close();
    await session.close();

    expect(events).toEqual([
      "client:oh-my-tool:0.2.0",
      "transport:stdio",
      "connect:stdio",
      "list:cursor-1",
      "call:echo:hello",
      "client.close",
    ]);
  });

  test("resolves stdio secret environment only for its transport", async () => {
    const events: string[] = [];
    let created: McpTransport | undefined;
    const connection = await createMcpTransport("demo", stdioConfig, memoryStore({ "mcp:demo:token": "secret-token" }), undefined, transportDependencies((value) => { created = value; }));

    expect(JSON.stringify(stdioConfig)).not.toContain("secret-token");
    expect(connection.secretValues).toEqual(["secret-token"]);
    expect(created?.options).toMatchObject({ command: "demo-server", args: ["--serve"], cwd: "/tmp/demo", env: { PATH: "test-path", MODE: "test", API_TOKEN: "secret-token" }, stderr: "pipe" });
  });

  test("builds HTTP headers and bearer authentication without an Authorization header", async () => {
    const events: string[] = [];
    let created: McpTransport | undefined;
    const connection = await createMcpTransport("demo", httpConfig, memoryStore({ "mcp:demo:token": "token-value", "mcp:demo:header": "header-value" }), undefined, transportDependencies((value) => { created = value; }));

    const options = created?.options as { headers: Record<string, string>; authProvider: AuthProvider };
    expect(options.headers).toEqual({ "x-client": "oh-my-tool", "x-api-key": "header-value" });
    expect(options.headers.Authorization).toBeUndefined();
    expect(await options.authProvider.token()).toBe("token-value");
    expect(connection.secretValues).toEqual(expect.arrayContaining(["token-value", "header-value"]));
  });

  test("injects the future OAuth auth provider without importing its implementation", async () => {
    const oauthConfig: OAuthMcpServerConfig = { ...httpConfig, auth: { type: "oauth", scopes: ["tools"], callbackPort: 0, tokenEndpointAuthMethod: "none" } };
    const authProvider: AuthProvider = { async token() { return "oauth-token"; } };
    let injected = false;
    await createMcpTransport("demo", oauthConfig, memoryStore({ "mcp:demo:header": "header-value" }), async (serverId, config) => {
        injected = serverId === "demo" && config.auth.type === "oauth";
        return authProvider;
      }, transportDependencies());

    expect(injected).toBe(true);
  });

  for (const [name, config, secrets, missing] of [
    ["stdio environment secret", stdioConfig, memoryStore(), "mcp:demo:token"],
    ["bearer token", httpConfig, memoryStore({ "mcp:demo:header": "header-value" }), "mcp:demo:token"],
    ["HTTP secret header", httpConfig, memoryStore({ "mcp:demo:token": "token-value" }), "mcp:demo:header"],
  ] as const) {
    test(`rejects a missing ${name} before connecting`, async () => {
      await expect(createMcpTransport("demo", config, secrets, undefined, transportDependencies())).rejects.toMatchObject({
        code: "MCP_SECRET_NOT_FOUND",
        message: `MCP server 'demo' requires missing secret '${missing}'`,
      });
    });
  }

  test("redacts resolved secrets when MCP connection and request errors are normalized", async () => {
    const events: string[] = [];
    const secret = "never-expose-me";
    const connectionDeps = dependencies(events, {
      createTransport: async () => ({ transport: transport("stdio", {}), secretValues: [secret] }),
      createClient: () => ({ ...fakeClient(events), async connect() { throw Object.assign(new Error(`failed ${secret}`), { code: "ECONNREFUSED" }); } }),
    });
    await expect(createMcpSession("demo", stdioConfig, memoryStore({ "mcp:demo:token": secret }), connectionDeps)).rejects.toMatchObject({
      code: "MCP_CONNECTION_FAILED",
      message: expect.not.stringContaining(secret),
    });

    const session = await createMcpSession("demo", stdioConfig, memoryStore({ "mcp:demo:token": secret }), dependencies(events, {
      createTransport: async () => ({ transport: transport("stdio", {}), secretValues: [secret] }),
      createClient: () => ({ ...fakeClient(events), async listTools() { throw new Error(`bad ${secret}`); } }),
    }));
    await expect(session.listTools()).rejects.toMatchObject({ code: "MCP_LIST_TOOLS_FAILED", message: expect.not.stringContaining(secret) });
    await session.close();
  });

  test("normalizes setup failures, retains their cause, and redacts configured literal values", async () => {
    const literal = "literal-config-value";
    const cause = new Error(`setup failed: ${literal}`);
    const config: McpStdioServerConfig = { ...stdioConfig, env: { LITERAL: literal } };
    await expect(createMcpSession("demo", config, memoryStore(), dependencies([], {
      createTransport: async () => { throw cause; },
    }))).rejects.toMatchObject({
      code: "MCP_CONNECTION_FAILED",
      cause,
      message: expect.not.stringContaining(literal),
    });
  });

  test("normalizes client construction failures and retains their cause", async () => {
    const cause = new Error("client construction failed");
    await expect(createMcpSession("demo", stdioConfig, memoryStore(), dependencies([], {
      createClient: () => { throw cause; },
    }))).rejects.toMatchObject({
      code: "MCP_CONNECTION_FAILED",
      cause,
      message: expect.stringContaining("client construction failed"),
    });
  });

  test("normalizes setup errors for malformed runtime transports without masking their cause", async () => {
    const cause = new Error("original setup failure");
    const invalid = { ...stdioConfig, transport: "socket" } as unknown as McpStdioServerConfig;
    await expect(createMcpSession("demo", invalid, memoryStore(), dependencies([], {
      createTransport: async () => { throw cause; },
    }))).rejects.toMatchObject({
      code: "MCP_CONNECTION_FAILED",
      cause,
      message: expect.stringContaining("original setup failure"),
    });
  });

  test("redacts resolved HTTP bearer and secret-header values from transport setup errors", async () => {
    const token = "resolved-bearer-token";
    const header = "resolved-secret-header";
    const cause = new Error(`transport rejected ${token} and ${header}`);
    let error: unknown;
    try {
      await createMcpSession("demo", httpConfig, memoryStore({
        "mcp:demo:token": token,
        "mcp:demo:header": header,
      }), dependencies([], {
        createTransport: (serverId, config, secrets, oauth) => createMcpTransport(
          serverId,
          config,
          secrets,
          oauth,
          transportDependencies(() => { throw cause; }),
        ),
      }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "MCP_CONNECTION_FAILED",
      cause,
      message: expect.not.stringContaining(token),
    });
    expect((error as Error).message).toEqual(expect.not.stringContaining(header));
    expect(JSON.stringify(error)).not.toContain(token);
    expect(JSON.stringify(error)).not.toContain(header);
  });

  test("redacts resolved stdio environment values from transport setup errors", async () => {
    const token = "resolved-stdio-token";
    const cause = new Error(`stdio transport rejected ${token}`);
    let error: unknown;
    try {
      await createMcpSession("demo", stdioConfig, memoryStore({ "mcp:demo:token": token }), dependencies([], {
        createTransport: (serverId, config, secrets, oauth) => createMcpTransport(
          serverId,
          config,
          secrets,
          oauth,
          transportDependencies(() => { throw cause; }),
        ),
      }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "MCP_CONNECTION_FAILED",
      cause,
      message: expect.not.stringContaining(token),
    });
    expect(JSON.stringify(error)).not.toContain(token);
  });

  test("redacts literal configured header values from fake SDK errors", async () => {
    const literal = "literal-header-value";
    const config: McpHttpServerConfig = { ...httpConfig, headers: { "x-literal": literal } };
    const cause = new Error(`SDK rejected ${literal}`);
    await expect(createMcpSession("demo", config, memoryStore(), dependencies([], {
      createTransport: async () => ({ transport: transport("streamable-http", {}), secretValues: [] }),
      createClient: () => ({ ...fakeClient([]), async connect() { throw cause; } }),
    }))).rejects.toMatchObject({
      code: "MCP_CONNECTION_FAILED",
      cause,
      message: expect.not.stringContaining(literal),
    });
  });

  test("preserves missing-secret errors and never connects the client", async () => {
    const events: string[] = [];
    await expect(createMcpSession("demo", stdioConfig, memoryStore(), dependencies(events, {
      createTransport: (serverId, config, secrets, oauth) => createMcpTransport(serverId, config, secrets, oauth, transportDependencies()),
    }))).rejects.toMatchObject({ code: "MCP_SECRET_NOT_FOUND" });
    expect(events).not.toContain("connect:stdio");
  });

  test("preserves malformed OAuth credential errors raised during session connection", async () => {
    const config: OAuthMcpServerConfig = {
      ...httpConfig,
      secretHeaders: {},
      auth: { type: "oauth", scopes: ["tools"], callbackPort: 0, tokenEndpointAuthMethod: "none" },
    };
    const malformed = "{malformed-never-expose-me";
    const secrets = memoryStore({ "mcp:demo:oauth:tokens": malformed });

    await expect(createMcpSession("demo", config, secrets, dependencies([], {
      oauthAuthProviderFactory: createMcpOAuthProvider,
      createTransport: (serverId, serverConfig, secretStore, oauth) => createMcpTransport(
        serverId,
        serverConfig,
        secretStore,
        oauth,
        transportDependencies(),
      ),
      createClient: () => ({
        ...fakeClient([]),
        async connect(value) {
          const provider = (value.options as { authProvider: { tokens(): Promise<unknown> } }).authProvider;
          await provider.tokens();
        },
      }),
    }))).rejects.toMatchObject({
      code: "MCP_OAUTH_CREDENTIALS_INVALID",
      message: expect.not.stringContaining(malformed),
    });
  });

  test("closes a partially created transport after connection failure", async () => {
    const events: string[] = [];
    const partial = { ...transport("stdio", {}), async close() { events.push("transport.close"); } } as McpTransport;
    await expect(createMcpSession("demo", stdioConfig, memoryStore(), dependencies(events, {
      createTransport: async () => ({ transport: partial, secretValues: [] }),
      createClient: () => ({ ...fakeClient(events), async connect() { throw new Error("unavailable"); } }),
    }))).rejects.toMatchObject({ code: "MCP_CONNECTION_FAILED" });
    expect(events).toContain("transport.close");
  });

  test("rejects configured Authorization headers for SDK-owned HTTP authentication", async () => {
    const config: McpHttpServerConfig = { ...httpConfig, headers: { authorization: "literal" } };
    await expect(createMcpTransport("demo", config, memoryStore({ "mcp:demo:token": "token-value", "mcp:demo:header": "header-value" }), undefined, transportDependencies())).rejects.toMatchObject({ code: "MCP_INVALID_CONFIG" });
  });

  test("rejects unsupported runtime transport values", async () => {
    const invalid = { ...stdioConfig, transport: "socket" } as unknown as McpStdioServerConfig;
    await expect(createMcpTransport("demo", invalid, memoryStore(), undefined, transportDependencies())).rejects.toMatchObject({ code: "MCP_UNSUPPORTED_TRANSPORT" });
  });
});

function transportDependencies(onTransport: (value: McpTransport) => void = () => {}): McpTransportDependencies {
  return {
    getDefaultEnvironment: () => ({ PATH: "test-path" }),
    createStdioTransport: (options) => {
      const value = transport("stdio", options);
      onTransport(value);
      return value;
    },
    createHttpTransport: (url, options) => {
      const value = transport("streamable-http", { url: url.toString(), headers: options.requestInit.headers, authProvider: options.authProvider });
      onTransport(value);
      return value;
    },
  };
}
