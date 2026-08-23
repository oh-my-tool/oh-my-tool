import { randomBytes } from "node:crypto";
import open from "open";
import {
  Client,
  UnauthorizedError,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type {
  McpHttpServerConfig,
} from "../../../config/config";
import { VERSION } from "../../../version";
import type { SecretStore } from "@oh-my-tool/sdk";
import { RuntimeError } from "../../errors";
import {
  createMcpTransport,
  type McpTransport,
  type OAuthMcpServerConfig,
} from "./transport";
import { createMcpOAuthStore, type SecretMcpOAuthStore } from "./oauth-store";
import {
  createOAuthCallback,
  DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS,
  type OAuthCallback,
} from "./oauth-callback";

export interface McpOAuthProviderOptions {
  readonly redirectUrl?: URL;
  readonly interactive?: boolean;
}

export interface McpOAuthClientProvider extends OAuthClientProvider {
  readonly redirectUrl: URL;
  authorizationUrl(): URL | undefined;
  authorizationState(): string | undefined;
  clearVerifier(): Promise<void>;
}

export interface InteractiveOAuthDeps {
  readonly openBrowser: (url: string) => Promise<unknown>;
  readonly createCallback: (port: number) => Promise<OAuthCallback>;
  readonly callbackTimeoutMs: number;
}

class PersistentMcpOAuthProvider implements McpOAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata;
  private pendingAuthorizationUrl: URL | undefined;
  private pendingState: string | undefined;

  constructor(
    private readonly serverId: string,
    private readonly config: OAuthMcpServerConfig,
    private readonly store: SecretMcpOAuthStore,
    readonly redirectUrl: URL,
    private readonly preRegisteredClient: StoredOAuthClientInformation | undefined,
    private readonly interactive: boolean,
  ) {
    this.clientMetadata = {
      redirect_uris: [redirectUrl.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: config.auth.tokenEndpointAuthMethod,
      client_name: "Oh My Tool",
      ...(config.auth.scopes.length === 0 ? {} : { scope: config.auth.scopes.join(" ") }),
    };
  }

  state(): string {
    this.pendingState = randomBytes(32).toString("base64url");
    return this.pendingState;
  }

  clientInformation(_ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    if (this.preRegisteredClient !== undefined) return Promise.resolve(this.preRegisteredClient);
    return this.store.clientInformation();
  }

  saveClientInformation(info: StoredOAuthClientInformation, ctx?: OAuthClientInformationContext): Promise<void> {
    return this.store.saveClientInformation(ctx === undefined ? info : { ...info, issuer: ctx.issuer });
  }

  tokens(_ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    return this.store.tokens();
  }

  saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): Promise<void> {
    return this.store.saveTokens(ctx === undefined ? tokens : { ...tokens, issuer: ctx.issuer });
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.interactive) {
      await this.store.clearVerifier();
      if (this.preRegisteredClient === undefined && this.config.auth.callbackPort === 0) {
        await this.store.clear("client");
      }
      throw new RuntimeError(
        "MCP_AUTH_REQUIRED",
        `MCP server '${this.serverId}' requires user authorization; run 'ohmytool mcp auth ${this.serverId}'`,
      );
    }
    this.pendingAuthorizationUrl = new URL(url);
  }

  authorizationUrl(): URL | undefined {
    return this.pendingAuthorizationUrl === undefined ? undefined : new URL(this.pendingAuthorizationUrl);
  }

  authorizationState(): string | undefined {
    return this.pendingState;
  }

  saveCodeVerifier(value: string): Promise<void> {
    return this.store.saveCodeVerifier(value);
  }

  async codeVerifier(): Promise<string> {
    const value = await this.store.codeVerifier();
    if (value === undefined) {
      throw new RuntimeError(
        "MCP_OAUTH_VERIFIER_MISSING",
        `OAuth PKCE verifier for MCP server '${this.serverId}' is missing`,
      );
    }
    return value;
  }

  saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> {
    return this.store.saveDiscoveryState(value);
  }

  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.store.discoveryState();
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    return scope === "all" ? this.store.clearAll() : this.store.clear(scope);
  }

  clearVerifier(): Promise<void> {
    return this.store.clearVerifier();
  }
}

function defaultRedirectUrl(config: OAuthMcpServerConfig): URL {
  return new URL(`http://127.0.0.1:${config.auth.callbackPort}/oauth/callback`);
}

export async function createMcpOAuthProvider(
  serverId: string,
  config: OAuthMcpServerConfig,
  secrets: SecretStore,
  options: McpOAuthProviderOptions = {},
): Promise<McpOAuthClientProvider> {
  let preRegisteredClient: StoredOAuthClientInformation | undefined;
  if (config.auth.clientId !== undefined) {
    let clientSecret: string | undefined;
    if (config.auth.clientSecretSecret !== undefined) {
      clientSecret = await secrets.get(config.auth.clientSecretSecret);
      if (clientSecret === undefined) {
        throw new RuntimeError(
          "MCP_SECRET_NOT_FOUND",
          `MCP server '${serverId}' requires missing secret '${config.auth.clientSecretSecret}'`,
        );
      }
    }
    preRegisteredClient = {
      client_id: config.auth.clientId,
      client_secret: clientSecret,
    };
  }
  return new PersistentMcpOAuthProvider(
    serverId,
    config,
    createMcpOAuthStore(serverId, secrets),
    options.redirectUrl ?? defaultRedirectUrl(config),
    preRegisteredClient,
    options.interactive ?? false,
  );
}

function oauthConfig(serverId: string, config: McpHttpServerConfig): OAuthMcpServerConfig {
  if (!config.enabled || config.transport !== "streamable-http" || config.auth.type !== "oauth") {
    throw new RuntimeError("MCP_OAUTH_NOT_CONFIGURED", `MCP server '${serverId}' is not an enabled OAuth Streamable HTTP server`);
  }
  return config as OAuthMcpServerConfig;
}

function safeAuthorizationUrl(url: URL): boolean {
  return url.protocol === "https:" || (
    url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]" || url.hostname === "localhost")
  );
}

async function waitForCallback(callback: OAuthCallback, state: string, timeoutMs: number): Promise<URLSearchParams> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      callback.waitForResult(state),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RuntimeError("MCP_OAUTH_TIMEOUT", "OAuth callback timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function closeClient(client: Client | undefined): Promise<void> {
  if (client === undefined) return;
  try {
    await client.close();
  } catch {
    // Cleanup must not mask the authorization result or its original error.
  }
}

type FinishableTransport = McpTransport & { finishAuth(callbackParams: URLSearchParams): Promise<void> };

export async function authorizeMcpServer(
  serverId: string,
  config: McpHttpServerConfig,
  secrets: SecretStore,
  deps: Partial<InteractiveOAuthDeps> = {},
): Promise<{ serverId: string; authorized: true }> {
  const validated = oauthConfig(serverId, config);
  const callbackTimeoutMs = deps.callbackTimeoutMs ?? DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS;
  const callback = deps.createCallback === undefined
    ? await createOAuthCallback(validated.auth.callbackPort, callbackTimeoutMs)
    : await deps.createCallback(validated.auth.callbackPort);
  const provider = await createMcpOAuthProvider(serverId, validated, secrets, {
    redirectUrl: callback.redirectUrl,
    interactive: true,
  });
  const openBrowser = deps.openBrowser ?? (async (url: string) => open(url));
  let firstClient: Client | undefined;
  let secondClient: Client | undefined;
  try {
    firstClient = new Client({ name: "oh-my-tool", version: VERSION });
    const firstConnection = await createMcpTransport(serverId, validated, secrets, async () => provider);
    try {
      await firstClient.connect(firstConnection.transport);
      return { serverId, authorized: true };
    } catch (cause) {
      if (!(cause instanceof UnauthorizedError)) throw cause;
    }

    const authorizationUrl = provider.authorizationUrl();
    const state = provider.authorizationState();
    if (authorizationUrl === undefined || state === undefined) {
      throw new RuntimeError("MCP_OAUTH_AUTHORIZATION_FAILED", `MCP server '${serverId}' did not provide an authorization URL`);
    }
    if (!safeAuthorizationUrl(authorizationUrl)) {
      throw new RuntimeError("MCP_OAUTH_AUTHORIZATION_URL_UNSAFE", `MCP server '${serverId}' returned an unsafe authorization URL`);
    }
    try {
      await openBrowser(authorizationUrl.toString());
    } catch {
      console.log(authorizationUrl.toString());
    }
    const callbackParams = await waitForCallback(callback, state, callbackTimeoutMs);
    await (firstConnection.transport as FinishableTransport).finishAuth(callbackParams);
    await closeClient(firstClient);
    firstClient = undefined;

    secondClient = new Client({ name: "oh-my-tool", version: VERSION });
    const secondConnection = await createMcpTransport(serverId, validated, secrets, async () => provider);
    await secondClient.connect(secondConnection.transport);
    return { serverId, authorized: true };
  } finally {
    await closeClient(firstClient);
    await closeClient(secondClient);
    await callback.close();
    await provider.clearVerifier();
  }
}

export async function logoutMcpServer(
  serverId: string,
  config: McpHttpServerConfig,
  secrets: SecretStore,
): Promise<{ serverId: string; loggedOut: true }> {
  oauthConfig(serverId, config);
  await createMcpOAuthStore(serverId, secrets).clearAll();
  return { serverId, loggedOut: true };
}
