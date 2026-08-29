import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { loadConfig, getConnectionConfig, listConnections, validateConfiguredConnections } from "../src/config/config";
import type { McpHttpServerConfig } from "../src/config/config";

let home: string;

beforeEach(() => {
  home = join(tmpdir(), `omt-test-config-${Date.now()}-${Math.random()}`);
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const toml = `
[extensions.mysql.connections.iot-test]
environment = "test"
[extensions.mysql.connections.iot-test.settings]
host = "mysql-test.company.internal"
port = 3306
database = "iot"
username = "iot_readonly"
tls = true
[extensions.mysql.connections.iot-test.secrets]
password = "mysql:iot-test"

[extensions.mysql.connections.prod]
environment = "prod"
[extensions.mysql.connections.prod.settings]
host = "mysql-prod.company.internal"
port = 3306
database = "iot"
username = "iot_readonly"
tls = true
[extensions.mysql.connections.prod.secrets]
password = "mysql:prod"
`;

describe("config", () => {
  test("loads connections from config.toml", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    expect(listConnections(cfg, "mysql")).toEqual(["iot-test", "prod"]);
  });

  test("getConnectionConfig returns a typed connection", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    const c = getConnectionConfig(cfg, "mysql", "iot-test");
    expect(c).toBeDefined();
    expect(c!.settings.host).toBe("mysql-test.company.internal");
    expect(c!.settings.database).toBe("iot");
    expect(c!.secrets.password).toBe("mysql:iot-test");
  });

  test("unknown connection returns undefined", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    expect(getConnectionConfig(cfg, "mysql", "nope")).toBeUndefined();
  });

  test("missing config.toml yields empty config", () => {
    const cfg = loadConfig(home);
    expect(listConnections(cfg, "mysql")).toEqual([]);
    expect(getConnectionConfig(cfg, "mysql", "iot-test")).toBeUndefined();
  });

  test("generic connections keep secret references separate from settings", () => {
    writeFileSync(join(home, "config.toml"), toml, "utf8");
    const cfg = loadConfig(home);
    const c = getConnectionConfig(cfg, "mysql", "iot-test")!;
    expect(c).not.toHaveProperty("password");
    expect(c).toHaveProperty("secrets.password");
  });

  test("rejects invalid connection types instead of coercing them", () => {
    writeFileSync(
      join(home, "config.toml"),
      `[extensions.mysql.connections.bad]\nlegacy = true\n`,
      "utf8",
    );
    expect(() => loadConfig(home)).toThrow(/unknown field|legacy|environment|settings|secrets/i);
  });

  test("validates generic settings with an extension connection schema", () => {
    writeFileSync(join(home, "config.toml"), `[extensions.kafka.connections.prod]\n[extensions.kafka.connections.prod.settings]\nclientId = "omt"\n`, "utf8");
    const cfg = loadConfig(home);
    expect(() => validateConfiguredConnections(cfg, [{
      id: "kafka",
      manifest: { connectionSchema: {
        type: "object", required: ["brokers"], properties: { brokers: { type: "array" } },
      } },
    }] as any)).toThrow(/brokers/);
  });

  test("can validate only the targeted extension", () => {
    writeFileSync(join(home, "config.toml"), `[extensions.mysql.connections.prod.settings]\nport = "3306"\n[extensions.kafka.connections.prod.settings]\nbrokers = ["kafka:9092"]\n`, "utf8");
    const cfg = loadConfig(home);
    const extensions = [
      { id: "mysql", manifest: { connectionSchema: { type: "object", properties: { port: { type: "integer" } } } } },
      { id: "kafka", manifest: { connectionSchema: { type: "object", required: ["brokers"], properties: { brokers: { type: "array" } } } } },
    ];
    expect(() => validateConfiguredConnections(cfg, extensions as any, "kafka")).not.toThrow();
    expect(() => validateConfiguredConnections(cfg, extensions as any, "mysql")).toThrow(/port/);
  });

  test("loads an MCP stdio server definition", () => {
    writeFileSync(
      join(home, "config.toml"),
      `${toml}
[mcp.servers.filesystem]
transport = "stdio"
command = "bun"
args = ["run", "./server.ts"]
cwd = "C:/workspace"
namespace = "fs"

[mcp.servers.filesystem.env]
LOG_LEVEL = "warn"

[mcp.servers.filesystem.secretEnv]
FILESYSTEM_TOKEN = "mcp:filesystem:token"
`,
      "utf8",
    );

    const cfg = loadConfig(home);
    expect(cfg.mcp.servers.filesystem).toEqual({
      enabled: true,
      transport: "stdio",
      command: "bun",
      args: ["run", "./server.ts"],
      cwd: "C:/workspace",
      namespace: "fs",
      env: { LOG_LEVEL: "warn" },
      secretEnv: { FILESYSTEM_TOKEN: "mcp:filesystem:token" },
    });
  });

  test("loads an MCP Streamable HTTP bearer definition", () => {
    writeFileSync(
      join(home, "config.toml"),
      `[mcp.servers.github]
transport = "streamable-http"
url = "https://mcp.example.test/mcp"
auth = "bearer"
bearerTokenSecret = "mcp:github:token"

[mcp.servers.github.headers]
X-Tenant = "engineering"

[mcp.servers.github.secretHeaders]
X-Gateway-Key = "mcp:github:gateway-key"
`,
      "utf8",
    );

    const cfg = loadConfig(home);
    expect(cfg.mcp.servers.github).toEqual({
      enabled: true,
      transport: "streamable-http",
      url: "https://mcp.example.test/mcp",
      namespace: "github",
      headers: { "X-Tenant": "engineering" },
      secretHeaders: { "X-Gateway-Key": "mcp:github:gateway-key" },
      auth: { type: "bearer", tokenSecret: "mcp:github:token" },
    });
  });

  test("loads an MCP interactive OAuth definition and defaults dynamic registration", () => {
    writeFileSync(
      join(home, "config.toml"),
      `[mcp.servers.linear]
transport = "streamable-http"
url = "https://mcp.linear.example/mcp"
auth = "oauth"
oauthScopes = ["mcp:read", "mcp:write"]
oauthCallbackPort = 8765
oauthClientId = "oh-my-tool"
oauthClientSecretSecret = "mcp:linear:client-secret"
oauthTokenEndpointAuthMethod = "client_secret_basic"

[mcp.servers.dynamic]
transport = "streamable-http"
url = "https://mcp.dynamic.example/mcp"
auth = "oauth"
`,
      "utf8",
    );

    const cfg = loadConfig(home);
    const linear = cfg.mcp.servers.linear;
    const dynamic = cfg.mcp.servers.dynamic;
    expect(linear.transport).toBe("streamable-http");
    expect(dynamic.transport).toBe("streamable-http");
    expect((linear as McpHttpServerConfig).auth).toEqual({
      type: "oauth",
      scopes: ["mcp:read", "mcp:write"],
      callbackPort: 8765,
      clientId: "oh-my-tool",
      clientSecretSecret: "mcp:linear:client-secret",
      tokenEndpointAuthMethod: "client_secret_basic",
    });
    expect((dynamic as McpHttpServerConfig).auth).toEqual({
      type: "oauth",
      scopes: [],
      callbackPort: 0,
      tokenEndpointAuthMethod: "none",
    });
  });

  test("accepts a disabled MCP server without validating transport-specific fields", () => {
    writeFileSync(
      join(home, "config.toml"),
      `[mcp.servers.old]
enabled = false
transport = "legacy-sse"
namespace = "Invalid Namespace"
url = 123
auth = "unsupported"
`,
      "utf8",
    );

    const cfg = loadConfig(home);

    expect(cfg.mcp.servers.old).toMatchObject({ enabled: false });
  });

  test("rejects uppercase MCP server IDs and namespaces", () => {
    writeFileSync(join(home, "config.toml"), `[mcp.servers.BadId]\ntransport = "stdio"\ncommand = "bun"\n`, "utf8");
    let error: unknown;
    try {
      loadConfig(home);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });

    writeFileSync(join(home, "config.toml"), `[mcp.servers.good]\ntransport = "stdio"\ncommand = "bun"\nnamespace = "BadNamespace"\n`, "utf8");
    error = undefined;
    try {
      loadConfig(home);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });
  });

  test("rejects case-insensitive HTTP header conflicts", () => {
    for (const authorizationHeader of ["authorization", "aUtHoRiZaTiOn"]) {
      writeFileSync(join(home, "config.toml"), `[mcp.servers.test]\ntransport = "streamable-http"\nurl = "https://example.test"\nauth = "bearer"\nbearerTokenSecret = "token"\n[mcp.servers.test.headers]\n${authorizationHeader} = "literal"\n`, "utf8");
      let error: unknown;
      try {
        loadConfig(home);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });
    }

    writeFileSync(join(home, "config.toml"), `[mcp.servers.test]\ntransport = "streamable-http"\nurl = "https://example.test"\n[mcp.servers.test.headers]\nX-Key = "literal"\n[mcp.servers.test.secretHeaders]\nx-key = "secret"\n`, "utf8");
    let error: unknown;
    try {
      loadConfig(home);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });
  });

  test("rejects bearer auth with Authorization in secretHeaders", () => {
    writeFileSync(join(home, "config.toml"), `[mcp.servers.test]\ntransport = "streamable-http"\nurl = "https://example.test"\nauth = "bearer"\nbearerTokenSecret = "token"\n[mcp.servers.test.secretHeaders]\naUtHoRiZaTiOn = "secret"\n`, "utf8");
    let error: unknown;
    try {
      loadConfig(home);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });
  });

  test("rejects OAuth auth with case-insensitive Authorization headers", () => {
    for (const section of ["headers", "secretHeaders"]) {
      writeFileSync(join(home, "config.toml"), `[mcp.servers.test]\ntransport = "streamable-http"\nurl = "https://example.test"\nauth = "oauth"\n[mcp.servers.test.${section}]\naUtHoRiZaTiOn = "value"\n`, "utf8");
      let error: unknown;
      try {
        loadConfig(home);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });
    }
  });

  test("rejects malformed MCP server collections", () => {
    for (const serversValue of ['"not-a-table"', "[]", '["bad"]']) {
      writeFileSync(join(home, "config.toml"), `mcp.servers = ${serversValue}\n`, "utf8");
      let error: unknown;
      try {
        loadConfig(home);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });
    }
  });

  const invalidMcpConfigs: Array<[string, string]> = [
    ["unsupported transport", `transport = "socket"`],
    ["invalid server ID", `[mcp.servers."bad id"]\ntransport = "stdio"\ncommand = "bun"`],
    ["invalid namespace", `transport = "stdio"\ncommand = "bun"\nnamespace = "bad namespace"`],
    ["namespace native or mcp", `transport = "stdio"\ncommand = "bun"\nnamespace = "native"`],
    ["empty stdio command", `transport = "stdio"\ncommand = ""`],
    ["non-string stdio argument", `transport = "stdio"\ncommand = "bun"\nargs = [1]`],
    ["invalid or non-http(s) URL", `transport = "streamable-http"\nurl = "ftp://example.test"`],
    ["unsupported HTTP auth mode", `transport = "streamable-http"\nurl = "https://example.test"\nauth = "basic"`],
    ["empty bearer secret name", `transport = "streamable-http"\nurl = "https://example.test"\nauth = "bearer"\nbearerTokenSecret = ""`],
    ["OAuth configured for stdio", `transport = "stdio"\ncommand = "bun"\nauth = "oauth"`],
    ["callback port outside 0 or 1024..65535", `transport = "streamable-http"\nurl = "https://example.test"\nauth = "oauth"\noauthCallbackPort = 80`],
    ["client secret without client ID", `transport = "streamable-http"\nurl = "https://example.test"\nauth = "oauth"\noauthClientSecretSecret = "secret"`],
    ["secret auth method without client secret", `transport = "streamable-http"\nurl = "https://example.test"\nauth = "oauth"\noauthClientId = "client"\noauthTokenEndpointAuthMethod = "client_secret_basic"`],
    ["client secret with token auth method none", `transport = "streamable-http"\nurl = "https://example.test"\nauth = "oauth"\noauthClientId = "client"\noauthClientSecretSecret = "secret"\noauthTokenEndpointAuthMethod = "none"`],
    ["same header in headers and secretHeaders", `transport = "streamable-http"\nurl = "https://example.test"\n[mcp.servers.test.headers]\nX-Key = "literal"\n[mcp.servers.test.secretHeaders]\nX-Key = "secret"`],
    ["Authorization configured together with bearerTokenSecret", `transport = "streamable-http"\nurl = "https://example.test"\nauth = "bearer"\nbearerTokenSecret = "token"\n[mcp.servers.test.headers]\nAuthorization = "literal"`],
  ];

  for (const [name, server] of invalidMcpConfigs) {
    test(`rejects MCP config: ${name}`, () => {
      writeFileSync(join(home, "config.toml"), `[mcp.servers.test]\n${server}\n`, "utf8");
      let error: unknown;
      try {
        loadConfig(home);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "MCP_INVALID_CONFIG" });
    });
  }
});
