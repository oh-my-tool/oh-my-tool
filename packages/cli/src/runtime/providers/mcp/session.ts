import { Client, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import type { McpEnabledServerConfig } from "../../../config/config";
import { VERSION } from "../../../version";
import type { SecretStore } from "@oh-my-tool/sdk";
import { RuntimeError } from "../../errors";
import {
  createMcpTransport,
  type McpTransport,
  type OAuthAuthProviderFactory,
  McpTransportSetupError,
} from "./transport";
import { createMcpOAuthProvider } from "./oauth-provider";
import {
  configuredMcpValues,
  mcpConnectionError,
  mcpRequestError,
} from "./safe-errors";

export interface McpSession {
  listTools(cursor?: string): Promise<{ tools: readonly Tool[]; nextCursor?: string }>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type McpSessionFactory = (serverId: string, config: McpEnabledServerConfig, secrets: SecretStore) => Promise<McpSession>;

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
  oauthAuthProviderFactory: (serverId, config, secrets) => createMcpOAuthProvider(serverId, config, secrets),
};

function isMissingSecretError(cause: unknown): cause is RuntimeError {
  return cause instanceof RuntimeError && cause.code === "MCP_SECRET_NOT_FOUND";
}

function isPreservedOAuthError(cause: unknown): cause is RuntimeError {
  return cause instanceof RuntimeError && (
    cause.code === "MCP_AUTH_REQUIRED" || cause.code === "MCP_OAUTH_CREDENTIALS_INVALID"
  );
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
  config: McpEnabledServerConfig,
  secrets: SecretStore,
  dependencies: McpSessionDependencies = defaults,
): Promise<McpSession> {
  let client: McpClient;
  try {
    client = dependencies.createClient({ name: "oh-my-tool", version: dependencies.clientVersion });
  } catch (cause) {
    throw mcpConnectionError(serverId, cause, configuredMcpValues(config));
  }
  let connection;
  try {
    connection = await dependencies.createTransport(serverId, config, secrets, dependencies.oauthAuthProviderFactory);
  } catch (cause) {
    if (isMissingSecretError(cause) || isPreservedOAuthError(cause)) throw cause;
    const setupCause = cause instanceof McpTransportSetupError ? cause.cause : cause;
    const secretValues = cause instanceof McpTransportSetupError ? cause.secretValues : [];
    throw mcpConnectionError(serverId, setupCause, [...configuredMcpValues(config), ...secretValues]);
  }
  const secretValues = [...configuredMcpValues(config), ...connection.secretValues];
  try {
    await client.connect(connection.transport);
  } catch (cause) {
    await closeQuietly(connection.transport);
    if (isPreservedOAuthError(cause)) throw cause;
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
