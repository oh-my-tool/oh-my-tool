import {
  StreamableHTTPClientTransport,
  type AuthProvider,
  type Transport,
} from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import type { McpHttpServerConfig, McpServerConfig } from "../../../config/config";
import { RuntimeError } from "../../errors";
import type { SecretStore } from "@oh-my-tool/sdk";

export type McpTransport = Transport & { readonly kind?: "stdio" | "streamable-http"; readonly options?: Record<string, unknown> };

export type OAuthMcpServerConfig = McpHttpServerConfig & { readonly auth: Extract<McpHttpServerConfig["auth"], { type: "oauth" }> };

export type OAuthAuthProviderFactory = (
  serverId: string,
  config: OAuthMcpServerConfig,
  secrets: SecretStore,
) => Promise<AuthProvider>;

export interface McpTransportDependencies {
  getDefaultEnvironment(): Record<string, string>;
  createStdioTransport(options: StdioServerParameters): McpTransport;
  createHttpTransport(url: URL, options: { authProvider?: AuthProvider; requestInit: { headers: Record<string, string> } }): McpTransport;
}

export interface McpTransportConnection {
  transport: McpTransport;
  secretValues: readonly string[];
}

const defaults: McpTransportDependencies = {
  getDefaultEnvironment,
  createStdioTransport: (options) => new StdioClientTransport(options),
  createHttpTransport: (url, options) => new StreamableHTTPClientTransport(url, options),
};

async function requiredSecret(serverId: string, name: string, secrets: SecretStore): Promise<string> {
  const value = await secrets.get(name);
  if (value === undefined) {
    throw new RuntimeError("MCP_SECRET_NOT_FOUND", `MCP server '${serverId}' requires missing secret '${name}'`);
  }
  return value;
}

export async function createMcpTransport(
  serverId: string,
  config: McpServerConfig,
  secrets: SecretStore,
  oauthAuthProviderFactory?: OAuthAuthProviderFactory,
  dependencies: McpTransportDependencies = defaults,
): Promise<McpTransportConnection> {
  if (config.transport === "stdio") {
    const resolvedSecretEnv = Object.fromEntries(await Promise.all(
      Object.entries(config.secretEnv).map(async ([name, secret]) => [name, await requiredSecret(serverId, secret, secrets)]),
    )) as Record<string, string>;
    return {
      transport: dependencies.createStdioTransport({
        command: config.command,
        args: [...config.args],
        cwd: config.cwd,
        env: { ...dependencies.getDefaultEnvironment(), ...config.env, ...resolvedSecretEnv },
        stderr: "pipe",
      }),
      secretValues: Object.values(resolvedSecretEnv),
    };
  }

  const resolvedSecretHeaders = Object.fromEntries(await Promise.all(
    Object.entries(config.secretHeaders).map(async ([name, secret]) => [name, await requiredSecret(serverId, secret, secrets)]),
  )) as Record<string, string>;
  const secretValues = [...Object.values(resolvedSecretHeaders)];
  let authProvider: AuthProvider | undefined;
  if (config.auth.type === "bearer") {
    const auth = config.auth;
    const token = await requiredSecret(serverId, auth.tokenSecret, secrets);
    secretValues.push(token);
    authProvider = { token: () => secrets.get(auth.tokenSecret) };
  } else if (config.auth.type === "oauth") {
    if (!oauthAuthProviderFactory) {
      throw new RuntimeError("MCP_OAUTH_PROVIDER_UNAVAILABLE", `MCP server '${serverId}' requires an OAuth auth provider`);
    }
    authProvider = await oauthAuthProviderFactory(serverId, config as OAuthMcpServerConfig, secrets);
  }
  return {
    transport: dependencies.createHttpTransport(new URL(config.url), {
      ...(authProvider === undefined ? {} : { authProvider }),
      requestInit: { headers: { ...config.headers, ...resolvedSecretHeaders } },
    }),
    secretValues,
  };
}
