import { describe, expect, test } from "bun:test";
import type { Tool } from "@modelcontextprotocol/client";
import { normalizeMcpTool } from "../../src/runtime/providers/mcp/normalize";

function tool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "create_issue",
    title: "Create issue",
    description: "Create a repository issue",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" } },
    },
    ...overrides,
  };
}

describe("normalizeMcpTool", () => {
  test("normalizes identity and MCP provenance metadata", () => {
    const normalized = normalizeMcpTool("github", "github", "mcp:github", tool());

    expect(normalized.descriptor).toMatchObject({
      id: "github.create_issue",
      description: "Create a repository issue",
      provider: { id: "mcp:github", kind: "mcp" },
      source: { id: "github", kind: "mcp-server" },
    });
    expect(normalized.remoteName).toBe("create_issue");
  });

  test("includes each distinct server, namespace, remote name, and title keyword once", () => {
    const normalized = normalizeMcpTool("github", "ops", "mcp:github", tool());

    expect(normalized.descriptor.keywords).toEqual(["github", "ops", "create_issue", "Create issue"]);
  });

  test("falls back from description to title and then the MCP tool name", () => {
    expect(normalizeMcpTool("github", "github", "mcp:github", tool({ description: undefined })).descriptor.description)
      .toBe("Create issue");
    expect(normalizeMcpTool("github", "github", "mcp:github", tool({ title: undefined, description: undefined })).descriptor.description)
      .toBe("MCP tool create_issue");
  });

  test.each([
    [{ destructiveHint: true, readOnlyHint: true }, "admin"],
    [{ destructiveHint: false, readOnlyHint: true }, "read"],
    [{ readOnlyHint: false }, "write"],
    [undefined, "write"],
  ] as const)("maps annotations %j to risk %s", (annotations, risk) => {
    expect(normalizeMcpTool("github", "github", "mcp:github", tool({ annotations })).descriptor.risk).toBe(risk);
  });

  test("preserves the complete input schema without mutation", () => {
    const inputSchema: Tool["inputSchema"] = {
      type: "object",
      properties: { title: { type: "string" } },
      additionalProperties: false,
      $schema: "https://json-schema.org/draft/2020-12/schema",
    };

    const normalized = normalizeMcpTool("github", "github", "mcp:github", tool({ inputSchema }));

    expect(normalized.descriptor.inputSchema).toEqual(inputSchema);
    expect(inputSchema).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
      additionalProperties: false,
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
  });

  test("normalizes a missing input schema to an empty object schema", () => {
    expect(normalizeMcpTool("github", "github", "mcp:github", tool({ inputSchema: undefined })).descriptor.inputSchema)
      .toEqual({ type: "object", properties: {} });
  });
});
