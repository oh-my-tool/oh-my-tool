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
  source: { id: "omt-mysql", kind: "extension" },
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
});
