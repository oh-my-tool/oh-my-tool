import { afterEach, describe, expect, test } from "bun:test";
import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { McpHttpServerConfig } from "../../src/config/config";
import { memoryStore } from "../../src/secrets/secrets";
import { createMcpOAuthStore } from "../../src/runtime/providers/mcp/oauth-store";
import {
  authorizeMcpServer,
  createMcpOAuthProvider,
} from "../../src/runtime/providers/mcp/oauth-provider";
import {
  createOAuthCallback,
  type OAuthCallback,
} from "../../src/runtime/providers/mcp/oauth-callback";
import { createMcpSession } from "../../src/runtime/providers/mcp/session";
import type { OAuthMcpServerConfig } from "../../src/runtime/providers/mcp/transport";

const fixtureServers = new Set<Bun.Server<undefined>>();

afterEach(() => {
  for (const server of fixtureServers) server.stop(true);
  fixtureServers.clear();
});

const redirectUrl = new URL("http://127.0.0.1:48123/oauth/callback");
const dynamicConfig: OAuthMcpServerConfig = {
  enabled: true,
  namespace: "linear",
  transport: "streamable-http",
  url: "https://mcp.linear.example/api",
  headers: {},
  secretHeaders: {},
  auth: {
    type: "oauth",
    scopes: ["read", "write"],
    callbackPort: 0,
    tokenEndpointAuthMethod: "none",
  },
};

const tokens: StoredOAuthTokens = {
  access_token: "access-value",
  token_type: "Bearer",
  refresh_token: "refresh-value",
  expires_in: 3600,
  issuer: "https://auth.linear.example",
};
const client: StoredOAuthClientInformation = {
  client_id: "dynamic-client",
  client_secret: "dynamic-secret",
  client_id_issued_at: 123,
  issuer: "https://auth.linear.example",
};
const discovery: OAuthDiscoveryState = {
  authorizationServerUrl: "https://auth.linear.example",
  authorizationServerMetadata: {
    issuer: "https://auth.linear.example",
    authorization_endpoint: "https://auth.linear.example/authorize",
    token_endpoint: "https://auth.linear.example/token",
    response_types_supported: ["code"],
  },
  resourceMetadataUrl: "https://mcp.linear.example/.well-known/oauth-protected-resource",
};

describe("MCP OAuth credential store", () => {
  test("round-trips complete SDK credentials under server-scoped secret names", async () => {
    const secrets = memoryStore();
    const store = createMcpOAuthStore("linear", secrets);

    await store.saveTokens(tokens);
    await store.saveClientInformation(client);
    await store.saveCodeVerifier("verifier-value");
    await store.saveDiscoveryState(discovery);

    expect(JSON.parse((await secrets.get("mcp:linear:oauth:tokens"))!)).toEqual(tokens);
    expect(JSON.parse((await secrets.get("mcp:linear:oauth:client"))!)).toEqual(client);
    expect(await secrets.get("mcp:linear:oauth:verifier")).toBe("verifier-value");
    expect(JSON.parse((await secrets.get("mcp:linear:oauth:discovery"))!)).toEqual(discovery);
    expect(await store.tokens()).toEqual(tokens);
    expect(await store.clientInformation()).toEqual(client);
    expect(await store.codeVerifier()).toBe("verifier-value");
    expect(await store.discoveryState()).toEqual(discovery);
    expect((await store.tokens())?.issuer).toBe("https://auth.linear.example");
    expect((await store.clientInformation())?.issuer).toBe("https://auth.linear.example");
    expect((await store.discoveryState())?.authorizationServerMetadata?.issuer).toBe("https://auth.linear.example");
  });

  test("rejects malformed stored JSON without exposing its payload", async () => {
    const payload = "{not-json:never-expose-me";
    const store = createMcpOAuthStore("linear", memoryStore({
      "mcp:linear:oauth:tokens": payload,
    }));

    try {
      await store.tokens();
      throw new Error("expected malformed credentials to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "MCP_OAUTH_CREDENTIALS_INVALID" });
      expect(String(error)).not.toContain(payload);
      expect(String(error)).not.toContain("never-expose-me");
    }
  });
});

describe("MCP OAuth provider", () => {
  test("supports dynamic registration with authorization-code and refresh metadata", async () => {
    const secrets = memoryStore();
    const provider = await createMcpOAuthProvider("linear", dynamicConfig, secrets, {
      redirectUrl,
      interactive: true,
    });

    expect(await provider.clientInformation()).toBeUndefined();
    await provider.saveClientInformation!(client);
    expect(await createMcpOAuthStore("linear", secrets).clientInformation()).toEqual(client);
    expect(provider.redirectUrl).toBe(redirectUrl);
    expect(provider.clientMetadata.redirect_uris).toEqual([redirectUrl.toString()]);
    expect(provider.clientMetadata.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(provider.clientMetadata.response_types).toEqual(["code"]);
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none");
    expect(provider.clientMetadata.scope).toBe("read write");
  });

  test("returns a pre-registered client and configured token endpoint auth method", async () => {
    const config: OAuthMcpServerConfig = {
      ...dynamicConfig,
      auth: {
        type: "oauth",
        scopes: dynamicConfig.auth.scopes,
        callbackPort: dynamicConfig.auth.callbackPort,
        clientId: "pre-registered-client",
        clientSecretSecret: "linear-client-secret",
        tokenEndpointAuthMethod: "client_secret_basic",
      },
    };
    const provider = await createMcpOAuthProvider(
      "linear",
      config,
      memoryStore({ "linear-client-secret": "resolved-client-secret" }),
      { redirectUrl, interactive: true },
    );

    expect(await provider.clientInformation()).toEqual({
      client_id: "pre-registered-client",
      client_secret: "resolved-client-secret",
    });
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("client_secret_basic");
  });

  test("stamps issuer context on saved credentials and returns stored issuer values verbatim", async () => {
    const secrets = memoryStore();
    const provider = await createMcpOAuthProvider("linear", dynamicConfig, secrets, {
      redirectUrl,
      interactive: true,
    });
    const unstampedTokens = { access_token: "new-access", token_type: "Bearer" } as StoredOAuthTokens;
    const unstampedClient = { client_id: "new-client" } as StoredOAuthClientInformation;

    await provider.saveTokens(unstampedTokens, { issuer: "https://issuer-a.example" });
    await provider.saveClientInformation!(unstampedClient, { issuer: "https://issuer-a.example" });

    expect(await provider.tokens()).toEqual({ ...unstampedTokens, issuer: "https://issuer-a.example" });
    expect(await provider.tokens({ issuer: "https://different.example" })).toEqual({
      ...unstampedTokens,
      issuer: "https://issuer-a.example",
    });
    expect(await provider.clientInformation({ issuer: "https://different.example" })).toEqual({
      ...unstampedClient,
      issuer: "https://issuer-a.example",
    });
  });

  test("generates unpredictable base64url state and requires a stored PKCE verifier", async () => {
    const provider = await createMcpOAuthProvider("linear", dynamicConfig, memoryStore(), {
      redirectUrl,
      interactive: true,
    });

    const first = await provider.state!();
    const second = await provider.state!();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    await expect(provider.codeVerifier()).rejects.toMatchObject({ code: "MCP_OAUTH_VERIFIER_MISSING" });
  });

  for (const scope of ["tokens", "client", "verifier", "discovery"] as const) {
    test(`invalidates only ${scope} credentials`, async () => {
      const secrets = memoryStore();
      const store = createMcpOAuthStore("linear", secrets);
      await store.saveTokens(tokens);
      await store.saveClientInformation(client);
      await store.saveCodeVerifier("verifier-value");
      await store.saveDiscoveryState(discovery);
      const provider = await createMcpOAuthProvider("linear", dynamicConfig, secrets, {
        redirectUrl,
        interactive: true,
      });

      await provider.invalidateCredentials!(scope);

      const values = {
        tokens: await secrets.get("mcp:linear:oauth:tokens"),
        client: await secrets.get("mcp:linear:oauth:client"),
        verifier: await secrets.get("mcp:linear:oauth:verifier"),
        discovery: await secrets.get("mcp:linear:oauth:discovery"),
      };
      expect(values[scope]).toBeUndefined();
      for (const [name, value] of Object.entries(values)) {
        if (name !== scope) expect(value).toBeDefined();
      }
    });
  }

  test("invalidates all server credentials", async () => {
    const secrets = memoryStore();
    const store = createMcpOAuthStore("linear", secrets);
    await store.saveTokens(tokens);
    await store.saveClientInformation(client);
    await store.saveCodeVerifier("verifier-value");
    await store.saveDiscoveryState(discovery);
    const provider = await createMcpOAuthProvider("linear", dynamicConfig, secrets, {
      redirectUrl,
      interactive: true,
    });

    await provider.invalidateCredentials!("all");

    expect(await Promise.all([
      secrets.get("mcp:linear:oauth:tokens"),
      secrets.get("mcp:linear:oauth:client"),
      secrets.get("mcp:linear:oauth:verifier"),
      secrets.get("mcp:linear:oauth:discovery"),
    ])).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("MCP OAuth authorization", () => {
  test("closes the loopback callback when pre-registered client secret resolution fails", async () => {
    const config: OAuthMcpServerConfig = {
      ...dynamicConfig,
      auth: {
        ...dynamicConfig.auth,
        clientId: "pre-registered-client",
        clientSecretSecret: "missing-client-secret",
        tokenEndpointAuthMethod: "client_secret_basic",
      },
    };
    let callbackUrl: URL | undefined;

    await expect(authorizeMcpServer("linear", config, memoryStore(), {
      createCallback: async (port) => {
        const value = await createOAuthCallback(port, 1_000);
        callbackUrl = value.redirectUrl;
        return value;
      },
      callbackTimeoutMs: 1_000,
    })).rejects.toMatchObject({ code: "MCP_SECRET_NOT_FOUND" });

    expect(callbackUrl).toBeDefined();
    await expect(fetch(callbackUrl!)).rejects.toBeDefined();
  });

  test("uses official discovery, dynamic registration, PKCE exchange, and a fresh authenticated connection", async () => {
    const fixture = createOAuthMcpFixture();
    const secrets = memoryStore();
    let openedUrl: URL | undefined;
    let callbackState: string | undefined;
    let callbackClosed = false;
    const oauthCallback: OAuthCallback = {
      redirectUrl,
      async waitForResult(expectedState) {
        callbackState = expectedState;
        return new URLSearchParams({ code: "authorization-code", state: expectedState, iss: fixture.origin });
      },
      async close() { callbackClosed = true; },
    };

    const result = await authorizeMcpServer("linear", fixture.config, secrets, {
      createCallback: async () => oauthCallback,
      openBrowser: async (url) => { openedUrl = new URL(url); },
      callbackTimeoutMs: 1_000,
    });

    expect(result).toEqual({ serverId: "linear", authorized: true });
    expect(openedUrl?.protocol).toBe("http:");
    expect(openedUrl?.hostname).toBe("127.0.0.1");
    expect(openedUrl?.searchParams.get("state")).toBe(callbackState);
    expect(openedUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(fixture.registrations).toHaveLength(1);
    expect(fixture.registrations[0]).toMatchObject({
      redirect_uris: [redirectUrl.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(fixture.tokenRequests).toHaveLength(1);
    expect(fixture.tokenRequests[0].get("grant_type")).toBe("authorization_code");
    expect(fixture.tokenRequests[0].get("code")).toBe("authorization-code");
    expect(fixture.tokenRequests[0].get("code_verifier")).toBeTruthy();
    expect((await createMcpOAuthStore("linear", secrets).tokens())?.access_token).toBe("access-token");
    expect(await createMcpOAuthStore("linear", secrets).codeVerifier()).toBeUndefined();
    expect(fixture.authenticatedInitializations).toBe(1);
    expect(callbackClosed).toBe(true);
  });

  test("prints a safe authorization URL once to stderr when browser launch fails and still completes", async () => {
    const fixture = createOAuthMcpFixture();
    const secrets = memoryStore();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    let attemptedUrl = "";
    console.log = (value?: unknown) => stdout.push(String(value));
    console.error = (value?: unknown) => stderr.push(String(value));
    try {
      const result = await authorizeMcpServer("linear", fixture.config, secrets, {
        createCallback: async () => ({
          redirectUrl,
          async waitForResult(expectedState) {
            return new URLSearchParams({ code: "authorization-code", state: expectedState, iss: fixture.origin });
          },
          async close() {},
        }),
        openBrowser: async (url) => {
          attemptedUrl = url;
          throw new Error("browser unavailable");
        },
        callbackTimeoutMs: 1_000,
      });
      expect(result).toEqual({ serverId: "linear", authorized: true });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(stdout).toEqual([]);
    expect(stderr).toEqual([attemptedUrl]);
    expect(stderr[0]).toStartWith(`${fixture.origin}/authorize?`);
    expect(stderr.join(" ")).not.toContain("access-token");
    expect(stderr.join(" ")).not.toContain("refresh-token");
  });

  test("reuses valid persisted credentials without opening a browser", async () => {
    const fixture = createOAuthMcpFixture();
    const secrets = memoryStore();
    await createMcpOAuthStore("linear", secrets).saveTokens({
      access_token: "access-token",
      token_type: "Bearer",
      refresh_token: "refresh-token",
      issuer: fixture.origin,
    });
    let browserOpened = false;

    const result = await authorizeMcpServer("linear", fixture.config, secrets, {
      createCallback: async () => ({ redirectUrl, async waitForResult() { throw new Error("callback not expected"); }, async close() {} }),
      openBrowser: async () => { browserOpened = true; },
      callbackTimeoutMs: 1_000,
    });

    expect(result).toEqual({ serverId: "linear", authorized: true });
    expect(browserOpened).toBe(false);
    expect(fixture.registrations).toHaveLength(0);
    expect(fixture.tokenRequests).toHaveLength(0);
  });

  test("refuses to open a non-HTTPS authorization URL on a non-loopback host", async () => {
    const fixture = createOAuthMcpFixture({ authorizationEndpoint: "http://accounts.example.test/authorize" });
    let browserOpened = false;

    await expect(authorizeMcpServer("linear", fixture.config, memoryStore(), {
      createCallback: async () => ({
        redirectUrl,
        async waitForResult(expectedState) {
          return new URLSearchParams({ code: "authorization-code", state: expectedState, iss: fixture.origin });
        },
        async close() {},
      }),
      openBrowser: async () => { browserOpened = true; },
      callbackTimeoutMs: 1_000,
    })).rejects.toMatchObject({ code: "MCP_OAUTH_AUTHORIZATION_URL_UNSAFE" });

    expect(browserOpened).toBe(false);
  });
});

describe("ordinary MCP OAuth sessions", () => {
  test("surfaces auth-required without launching an interactive callback", async () => {
    const fixture = createOAuthMcpFixture();
    const secrets = memoryStore();

    await expect(createMcpSession("linear", fixture.config, secrets)).rejects.toMatchObject({
      code: "MCP_AUTH_REQUIRED",
      message: "MCP server 'linear' requires user authorization; run 'ohmytool mcp auth linear'",
    });
    expect(await createMcpOAuthStore("linear", secrets).clientInformation()).toBeUndefined();
    expect(await createMcpOAuthStore("linear", secrets).codeVerifier()).toBeUndefined();
  });

  test("refreshes persisted credentials non-interactively and reconnects", async () => {
    const fixture = createOAuthMcpFixture();
    const secrets = memoryStore();
    const store = createMcpOAuthStore("linear", secrets);
    await store.saveTokens({
      access_token: "expired-token",
      token_type: "Bearer",
      refresh_token: "refresh-token",
      issuer: fixture.origin,
    });
    await store.saveClientInformation({ client_id: "dynamic-client", issuer: fixture.origin });

    const session = await createMcpSession("linear", fixture.config, secrets);
    await session.close();

    expect(fixture.tokenRequests).toHaveLength(1);
    expect(fixture.tokenRequests[0].get("grant_type")).toBe("refresh_token");
    expect(fixture.tokenRequests[0].get("refresh_token")).toBe("refresh-token");
    expect((await store.tokens())?.access_token).toBe("access-token");
  });
});

interface OAuthMcpFixture {
  readonly origin: string;
  readonly config: McpHttpServerConfig;
  readonly registrations: Array<Record<string, unknown>>;
  readonly tokenRequests: URLSearchParams[];
  readonly authenticatedInitializations: number;
}

function createOAuthMcpFixture(options: { authorizationEndpoint?: string } = {}): OAuthMcpFixture {
  const registrations: Array<Record<string, unknown>> = [];
  const tokenRequests: URLSearchParams[] = [];
  let authenticatedInitializations = 0;
  let origin = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.includes(".well-known/oauth-protected-resource")) {
        return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
      }
      if (url.pathname.includes(".well-known/oauth-authorization-server") || url.pathname.includes(".well-known/openid-configuration")) {
        return Response.json({
          issuer: origin,
          authorization_endpoint: options.authorizationEndpoint ?? `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (url.pathname === "/register" && request.method === "POST") {
        const body = await request.json() as Record<string, unknown>;
        registrations.push(body);
        return Response.json({ client_id: "dynamic-client", ...body }, { status: 201 });
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const params = new URLSearchParams(await request.text());
        tokenRequests.push(params);
        return Response.json({
          access_token: "access-token",
          token_type: "Bearer",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }
      if (url.pathname === "/mcp") {
        if (request.method === "DELETE") return new Response(null, { status: 200 });
        if (request.headers.get("authorization") !== "Bearer access-token") {
          return new Response(null, {
            status: 401,
            headers: { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` },
          });
        }
        const body = await request.json() as { jsonrpc: string; id?: number; method: string; params?: { protocolVersion?: string } };
        if (body.method === "initialize") {
          authenticatedInitializations += 1;
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: body.params?.protocolVersion ?? "2025-11-25",
              capabilities: {},
              serverInfo: { name: "oauth-fixture", version: "1.0.0" },
            },
          });
        }
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
        return new Response(null, { status: 202 });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  fixtureServers.add(server);
  origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    config: {
      enabled: true,
      namespace: "linear",
      transport: "streamable-http",
      url: `${origin}/mcp`,
      headers: {},
      secretHeaders: {},
      auth: { type: "oauth", scopes: ["tools"], callbackPort: 0, tokenEndpointAuthMethod: "none" },
    },
    registrations,
    tokenRequests,
    get authenticatedInitializations() { return authenticatedInitializations; },
  };
}
