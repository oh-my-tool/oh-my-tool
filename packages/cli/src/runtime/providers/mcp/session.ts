import { Client, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import type { McpServerConfig } from "../../../config/config";
import type { SecretStore } from "@oh-my-tool/sdk";
import { RuntimeError } from "../../errors";
import {
  createMcpTransport,
  type McpTransport,
  type OAuthAuthProviderFactory,
} from "./transport";

export interface McpSession {
  listTools(cursor?: string): Promise<{ tools: readonly Tool[]; nextCursor?: string }>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type McpSessionFactory = (serverId: string, config: McpServerConfig, secrets: SecretStore) => Promise<McpSession>;

export interface McpClient {
  connect(transport: McpTransport): Promise<void>;
  listTools(params: { cursor?: string }): Promise<{ tools: Tool[]; nextCursor?: string }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface McpSessionDependencies {
  clientVersion: string;
  createClient(info: { name: string; version: string }): McpClient;
  createTransport: typeof createMcpTransport;
  oauthAuthProviderFactory?: OAuthAuthProviderFactory;
}

const defaults: McpSessionDependencies = {
  clientVersion: "0.2.0",
  createClient: (info) => new Client(info),
  createTransport: createMcpTransport,
};

function redact(message: string, secretValues: readonly string[]): string {
  return secretValues.reduce((result, value) => value.length === 0 ? result : result.split(value).join("[REDACTED]"), message);
}

function sdkDetails(cause: unknown, secretValues: readonly string[]): string {
  if (!(cause instanceof Error)) return "unknown MCP error";
  const error = cause as Error & { code?: unknown };
  const code = typeof error.code === "string" ? ` (${error.code})` : "";
  return `${code} ${redact(cause.message, secretValues)}`.trim();
}

export function mcpConnectionError(serverId: string, cause: unknown, secretValues: readonly string[] = []): RuntimeError {
  return new RuntimeError("MCP_CONNECTION_FAILED", `MCP server '${serverId}' connection failed: ${sdkDetails(cause, secretValues)}`);
}

export function mcpRequestError(serverId: string, operation: "tools/list" | "tools/call", cause: unknown, secretValues: readonly string[] = []): RuntimeError {
  const code = operation === "tools/list" ? "MCP_LIST_TOOLS_FAILED" : "MCP_CALL_FAILED";
  return new RuntimeError(code, `MCP server '${serverId}' ${operation} failed: ${sdkDetails(cause, secretValues)}`);
}

export async function createMcpSession(
  serverId: string,
  config: McpServerConfig,
  secrets: SecretStore,
  dependencies: McpSessionDependencies = defaults,
): Promise<McpSession> {
  const client = dependencies.createClient({ name: "oh-my-tool", version: dependencies.clientVersion });
  const connection = await dependencies.createTransport(serverId, config, secrets, dependencies.oauthAuthProviderFactory);
  try {
    await client.connect(connection.transport);
  } catch (cause) {
    throw mcpConnectionError(serverId, cause, connection.secretValues);
  }
  let closed = false;
  return {
    async listTools(cursor) {
      try {
        return await client.listTools({ ...(cursor === undefined ? {} : { cursor }) });
      } catch (cause) {
        throw mcpRequestError(serverId, "tools/list", cause, connection.secretValues);
      }
    },
    async callTool(name, args) {
      try {
        return await client.callTool({ name, arguments: args });
      } catch (cause) {
        throw mcpRequestError(serverId, "tools/call", cause, connection.secretValues);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}
