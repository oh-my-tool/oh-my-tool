import {
  StreamableHTTPClientTransport,
  type AuthProvider,
  type OAuthClientProvider,
  type Transport,
} from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
  type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import type { McpEnabledServerConfig, McpHttpServerConfig } from "../../../config/config";
import { RuntimeError } from "../../errors";
import type { SecretStore } from "@oh-my-tool/sdk";

export type McpTransport = Transport & { readonly kind?: "stdio" | "streamable-http"; readonly options?: Record<string, unknown> };

export type OAuthMcpServerConfig = McpHttpServerConfig & { readonly auth: Extract<McpHttpServerConfig["auth"], { type: "oauth" }> };

export type OAuthAuthProviderFactory = (
  serverId: string,
  config: OAuthMcpServerConfig,
  secrets: SecretStore,
) => Promise<AuthProvider | OAuthClientProvider>;

export interface McpTransportDependencies {
  getDefaultEnvironment(): Record<string, string>;
  createStdioTransport(options: StdioServerParameters): McpTransport;
  createHttpTransport(url: URL, options: { authProvider?: AuthProvider | OAuthClientProvider; requestInit: { headers: Record<string, string> } }): McpTransport;
}

export interface McpTransportConnection {
  transport: McpTransport;
  secretValues: readonly string[];
}

export class McpTransportSetupError extends Error {
  constructor(public readonly cause: unknown, public readonly secretValues: readonly string[]) {
    super(cause instanceof Error ? cause.message : "MCP transport setup failed", { cause });
    this.name = "McpTransportSetupError";
  }
}

const defaults: McpTransportDependencies = {
  getDefaultEnvironment,
  createStdioTransport: (options) => new StdioClientTransport(options),
  createHttpTransport: (url, options) => new StreamableHTTPClientTransport(url, options),
};

function hasAuthorizationHeader(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
}

function authProviderSecretValues(provider: AuthProvider | OAuthClientProvider): string[] {
  const values = (provider as { readonly secretValues?: unknown }).secretValues;
  return Array.isArray(values) && values.every((value) => typeof value === "string") ? [...values] : [];
}

async function requiredSecret(serverId: string, name: string, secrets: SecretStore): Promise<string> {
  const value = await secrets.get(name);
  if (value === undefined) {
    throw new RuntimeError("MCP_SECRET_NOT_FOUND", `MCP server '${serverId}' requires missing secret '${name}'`);
  }
  return value;
}

function isPreservedOAuthSetupError(cause: unknown): cause is RuntimeError {
  return cause instanceof RuntimeError && (
    cause.code === "MCP_SECRET_NOT_FOUND" ||
    cause.code === "MCP_AUTH_REQUIRED" ||
    cause.code === "MCP_OAUTH_CREDENTIALS_INVALID"
  );
}

export async function createMcpTransport(
  serverId: string,
  config: McpEnabledServerConfig,
  secrets: SecretStore,
  oauthAuthProviderFactory?: OAuthAuthProviderFactory,
  dependencies: McpTransportDependencies = defaults,
): Promise<McpTransportConnection> {
  const transportKind = (config as { transport: string }).transport;
  if (transportKind !== "stdio" && transportKind !== "streamable-http") {
    throw new RuntimeError("MCP_UNSUPPORTED_TRANSPORT", `MCP server '${serverId}' has unsupported transport '${transportKind}'`);
  }
  if (config.transport === "stdio") {
    const resolvedSecretEnv = Object.fromEntries(await Promise.all(
      Object.entries(config.secretEnv).map(async ([name, secret]) => [name, await requiredSecret(serverId, secret, secrets)]),
    )) as Record<string, string>;
    const secretValues = Object.values(resolvedSecretEnv);
    try {
      return {
        transport: dependencies.createStdioTransport({
          command: config.command,
          args: [...config.args],
          cwd: config.cwd,
          env: { ...dependencies.getDefaultEnvironment(), ...config.env, ...resolvedSecretEnv },
          stderr: "pipe",
        }),
        secretValues,
      };
    } catch (cause) {
      throw new McpTransportSetupError(cause, secretValues);
    }
  }

  if (config.auth.type !== "none" && (hasAuthorizationHeader(config.headers) || hasAuthorizationHeader(config.secretHeaders))) {
    throw new RuntimeError("MCP_INVALID_CONFIG", `MCP server '${serverId}' must not configure Authorization when ${config.auth.type} auth is enabled`);
  }

  const resolvedSecretHeaders = Object.fromEntries(await Promise.all(
    Object.entries(config.secretHeaders).map(async ([name, secret]) => [name, await requiredSecret(serverId, secret, secrets)]),
  )) as Record<string, string>;
  const secretValues = [...Object.values(resolvedSecretHeaders)];
  try {
    let authProvider: AuthProvider | OAuthClientProvider | undefined;
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
      secretValues.push(...authProviderSecretValues(authProvider));
    }
    return {
      transport: dependencies.createHttpTransport(new URL(config.url), {
        ...(authProvider === undefined ? {} : { authProvider }),
        requestInit: { headers: { ...config.headers, ...resolvedSecretHeaders } },
      }),
      secretValues: [...Object.values(config.headers), ...secretValues],
    };
  } catch (cause) {
    if (isPreservedOAuthSetupError(cause)) throw cause;
    throw new McpTransportSetupError(cause, secretValues);
  }
}
