import type { Tool } from "@modelcontextprotocol/client";
import type { ToolDescriptor } from "../../provider";

export interface NormalizedMcpTool {
  readonly descriptor: ToolDescriptor;
  readonly remoteName: string;
}

function riskFor(tool: Tool): ToolDescriptor["risk"] {
  if (tool.annotations?.destructiveHint === true) return "admin";
  if (tool.annotations?.readOnlyHint === true) return "read";
  return "write";
}

export function normalizeMcpTool(
  serverId: string,
  namespace: string,
  providerId: string,
  tool: Tool,
): NormalizedMcpTool {
  const description = tool.description ?? tool.title ?? `MCP tool ${tool.name}`;
  const keywords = [...new Set([serverId, namespace, tool.name, tool.title].filter((value): value is string => value !== undefined))];

  return {
    descriptor: {
      id: `${namespace}.${tool.name}`,
      description,
      keywords,
      risk: riskFor(tool),
      inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      provider: { id: providerId, kind: "mcp" },
      source: { id: serverId, kind: "mcp-server" },
    },
    remoteName: tool.name,
  };
}
