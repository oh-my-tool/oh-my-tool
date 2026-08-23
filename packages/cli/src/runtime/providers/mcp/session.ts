import { Client, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import type { McpServerConfig } from "../../../config/config";
import { VERSION } from "../../../version";
import type { SecretStore } from "@oh-my-tool/sdk";
import { RuntimeError } from "../../errors";
import {
  createMcpTransport,
  type McpTransport,
  type OAuthAuthProviderFactory,
  McpTransportSetupError,
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
  clientVersion: VERSION,
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
  return new RuntimeError("MCP_CONNECTION_FAILED", `MCP server '${serverId}' connection failed: ${sdkDetails(cause, secretValues)}`, cause);
}

export function mcpRequestError(serverId: string, operation: "tools/list" | "tools/call", cause: unknown, secretValues: readonly string[] = []): RuntimeError {
  const code = operation === "tools/list" ? "MCP_LIST_TOOLS_FAILED" : "MCP_CALL_FAILED";
  return new RuntimeError(code, `MCP server '${serverId}' ${operation} failed: ${sdkDetails(cause, secretValues)}`, cause);
}

function configuredValues(config: McpServerConfig): string[] {
  const runtimeConfig = config as unknown as { env?: unknown; headers?: unknown };
  return [runtimeConfig.env, runtimeConfig.headers].flatMap((values) => {
    if (values === null || typeof values !== "object" || Array.isArray(values)) return [];
    return Object.values(values).filter((value): value is string => typeof value === "string");
  });
}

function isMissingSecretError(cause: unknown): cause is RuntimeError {
  return cause instanceof RuntimeError && cause.code === "MCP_SECRET_NOT_FOUND";
}

async function closeQuietly(transport: McpTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    // The original MCP setup or connection error is more useful than cleanup failure.
  }
}

export async function createMcpSession(
  serverId: string,
  config: McpServerConfig,
  secrets: SecretStore,
  dependencies: McpSessionDependencies = defaults,
): Promise<McpSession> {
  let client: McpClient;
  try {
    client = dependencies.createClient({ name: "oh-my-tool", version: dependencies.clientVersion });
  } catch (cause) {
    throw mcpConnectionError(serverId, cause, configuredValues(config));
  }
  let connection;
  try {
    connection = await dependencies.createTransport(serverId, config, secrets, dependencies.oauthAuthProviderFactory);
  } catch (cause) {
    if (isMissingSecretError(cause)) throw cause;
    const setupCause = cause instanceof McpTransportSetupError ? cause.cause : cause;
    const secretValues = cause instanceof McpTransportSetupError ? cause.secretValues : [];
    throw mcpConnectionError(serverId, setupCause, [...configuredValues(config), ...secretValues]);
  }
  const secretValues = [...configuredValues(config), ...connection.secretValues];
  try {
    await client.connect(connection.transport);
  } catch (cause) {
    await closeQuietly(connection.transport);
    throw mcpConnectionError(serverId, cause, secretValues);
  }
  let closed = false;
  return {
    async listTools(cursor) {
      try {
        return await client.listTools({ ...(cursor === undefined ? {} : { cursor }) });
      } catch (cause) {
        throw mcpRequestError(serverId, "tools/list", cause, secretValues);
      }
    },
    async callTool(name, args) {
      try {
        return await client.callTool({ name, arguments: args });
      } catch (cause) {
        throw mcpRequestError(serverId, "tools/call", cause, secretValues);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}
