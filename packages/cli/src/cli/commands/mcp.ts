import type { SecretStore } from "@oh-my-tool/sdk";
import type { McpHttpServerConfig, McpServerConfig } from "../../config/config";
import { loadConfig } from "../../config/config";
import { prepareHome } from "../../migration";
import { createPaths } from "../../paths";
import { RuntimeError } from "../../runtime/errors";
import {
  authorizeMcpServer,
  logoutMcpServer,
} from "../../runtime/providers/mcp/oauth-provider";
import { SecretsManager } from "../../secrets/secrets";

export interface McpCommandDependencies {
  readonly secrets?: SecretStore;
  readonly authorize?: typeof authorizeMcpServer;
  readonly logout?: typeof logoutMcpServer;
}

export interface McpServerSummary {
  readonly id: string;
  readonly enabled: boolean;
  readonly transport: McpServerConfig["transport"];
  readonly namespace: string;
  readonly auth: "none" | "bearer" | "oauth" | "disabled";
}

export interface McpListResult {
  readonly servers: McpServerSummary[];
}

/** List configured MCP servers without connecting to them or exposing secrets. */
export async function runMcpList(): Promise<McpListResult> {
  const paths = createPaths();
  await prepareHome(paths);
  const config = loadConfig(paths.home);
  const servers = Object.entries(config.mcp.servers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, server]) => ({
      id,
      enabled: server.enabled,
      transport: server.transport,
      namespace: server.namespace,
      auth: server.transport === "disabled"
        ? "disabled" as const
        : server.transport === "stdio"
          ? "none" as const
          : server.auth.type,
    }));
  return { servers };
}

function oauthTarget(serverId: string, config: McpServerConfig | undefined): McpHttpServerConfig {
  if (config === undefined || !config.enabled || config.transport !== "streamable-http" || config.auth.type !== "oauth") {
    throw new RuntimeError("MCP_OAUTH_NOT_CONFIGURED", `MCP server '${serverId}' is not an enabled OAuth Streamable HTTP server`);
  }
  return config;
}

async function commandContext(serverId: string, secrets?: SecretStore): Promise<{
  config: McpHttpServerConfig;
  secrets: SecretStore;
}> {
  const paths = createPaths();
  await prepareHome(paths);
  const config = loadConfig(paths.home);
  return {
    config: oauthTarget(serverId, config.mcp.servers[serverId]),
    secrets: secrets ?? new SecretsManager(),
  };
}

export async function runMcpAuth(
  serverId: string,
  dependencies: McpCommandDependencies = {},
): Promise<{ serverId: string; authorized: true }> {
  const context = await commandContext(serverId, dependencies.secrets);
  return (dependencies.authorize ?? authorizeMcpServer)(serverId, context.config, context.secrets);
}

export async function runMcpLogout(
  serverId: string,
  dependencies: McpCommandDependencies = {},
): Promise<{ serverId: string; loggedOut: true }> {
  const context = await commandContext(serverId, dependencies.secrets);
  return (dependencies.logout ?? logoutMcpServer)(serverId, context.config, context.secrets);
}
