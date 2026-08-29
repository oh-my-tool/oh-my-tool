import { describe, expect, test } from "bun:test";
import type { ToolDescriptor, ToolProvider } from "../../src/runtime/provider";
import { ProviderRegistry } from "../../src/runtime/provider-registry";
import { ToolRegistry } from "../../src/runtime/tool-registry";

function provider(id: string, descriptors: readonly ToolDescriptor[]): ToolProvider {
  return {
    id,
    kind: "native",
    async listTools() {
      return descriptors;
    },
    async execute() {
      return { data: null };
    },
  };
}

const mysqlQuery: ToolDescriptor = {
  id: "mysql.query",
  description: "query mysql databases",
  keywords: ["mysql", "query", "查询"],
  risk: "read",
  inputSchema: { type: "object" },
  provider: { id: "native", kind: "native" },
  source: { id: "mysql", kind: "extension" },
};

describe("ProviderRegistry", () => {
  test("registers providers and distinguishes duplicate and missing IDs", () => {
    const registry = new ProviderRegistry();
    registry.register(provider("native", [mysqlQuery]));
    expect(registry.get("native")).toBeDefined();
    try {
      registry.register(provider("native", []));
      throw new Error("expected duplicate provider error");
    } catch (error) {
      expect(error).toMatchObject({ code: "DUPLICATE_PROVIDER_ID" });
    }
    expect(registry.get("missing")).toBeUndefined();
    try {
      registry.require("missing");
      throw new Error("expected missing provider error");
    } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_NOT_FOUND" });
    }
  });
});

describe("ToolRegistry", () => {
  test("owns descriptors, rejects duplicates, and hides schemas from search", () => {
    const registry = new ToolRegistry();
    registry.register([mysqlQuery]);
    expect(registry.get("mysql.query")).toEqual(mysqlQuery);
    expect(registry.search("mysql")[0]).toMatchObject({ id: "mysql.query" });
    expect(registry.search("mysql")[0]).not.toHaveProperty("inputSchema");
    try {
      registry.register([mysqlQuery]);
      throw new Error("expected duplicate tool error");
    } catch (error) {
      expect(error).toMatchObject({ code: "DUPLICATE_TOOL_ID" });
    }
  });

  test("does not partially register a batch that contains duplicate IDs", () => {
    const registry = new ToolRegistry();
    const redisGet: ToolDescriptor = {
      ...mysqlQuery,
      id: "redis.get",
      provider: { id: "native", kind: "native" },
      source: { id: "redis", kind: "extension" },
    };

    expect(() => registry.register([redisGet, { ...redisGet }])).toThrow(/duplicate tool/i);
    expect(registry.get("redis.get")).toBeUndefined();
  });

  test("search ranks descriptors from multiple providers", () => {
    const registry = new ToolRegistry();
    registry.register([
      mysqlQuery,
      {
        id: "github.search",
        description: "search GitHub repositories",
        keywords: ["github", "repository"],
        risk: "read",
        provider: { id: "remote", kind: "mcp" },
        source: { id: "github", kind: "mcp-server" },
      },
    ]);
    expect(registry.search("github repository")[0].id).toBe("github.search");
  });

  test("search applies exact and prefix ranking with filters and a limit", () => {
    const registry = new ToolRegistry();
    registry.register([
      mysqlQuery,
      { ...mysqlQuery, id: "mysql.schema", description: "inspect schema", keywords: ["schema"], source: { id: "mysql", kind: "extension" } },
      { ...mysqlQuery, id: "redis.get", provider: { id: "remote", kind: "mcp" }, source: { id: "redis", kind: "mcp-server" }, risk: "write" },
    ]);
    const results = registry.search("mysql", { limit: 1, provider: "native", source: "mysql", risk: "read" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("mysql.query");
  });
});
