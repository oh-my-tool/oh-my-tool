# Oh My Tool v0.3 MCP Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make configured MCP servers first-class `ToolProvider`s so `ohmytool search`, `ohmytool describe`, and `ohmytool run` behave consistently for native and MCP-backed tools.

**Architecture:** Treat each enabled MCP server as an independently addressable provider with provider ID `mcp:<server-id>` and kind `mcp`. A transport-neutral MCP session adapter owns the official TypeScript client, connection, pagination, invocation, authentication, and shutdown. `McpProvider` normalizes each remote tool into the existing runtime descriptor model and exposes it as `<namespace>.<remote-tool-name>`; the existing global registry remains the final collision gate.

**Tech Stack:** Bun 1.4+, TypeScript 5.9, Bun test, `@modelcontextprotocol/client` 2.0.0, `open` 11.0.0 for cross-platform browser launch, MCP protocol compatibility provided by the official client, existing `ToolRuntime`, `SecretStore`, and TOML configuration.

**Spec:** `docs/roadmap.md` — “Next — v0.3 MCP Provider Integration”

## Global Constraints

- MCP is southbound only: OMT consumes MCP servers and does not serve MCP.
- Implement only `tools/list` and `tools/call`; do not expose MCP resources, prompts, roots, sampling, elicitation, tasks, or completions.
- Support only `stdio` and Streamable HTTP transports; do not add legacy SSE fallback in v0.3.
- Use the official `@modelcontextprotocol/client` package at `2.0.0`; do not use the retired monolithic v1 `@modelcontextprotocol/sdk` package.
- Keep MCP implementation internal under `packages/cli/src/runtime/providers/mcp`; do not add a public runtime package or change `@oh-my-tool/sdk`.
- One enabled server definition produces one provider with ID `mcp:<server-id>` and kind `mcp`.
- MCP server IDs and namespaces must match `^[a-z0-9][a-z0-9_-]*$`.
- Default namespace is the server ID.
- Every exposed MCP tool ID is `<namespace>.<remote-tool-name>`.
- Store the remote tool name in the provider's private route map; never reconstruct it by splitting the exposed ID.
- `descriptor.source` for MCP tools is `{ id: <server-id>, kind: "mcp-server" }`.
- A configured namespace may not equal `native` or `mcp`.
- Reject duplicate exposed tool IDs within one MCP server as `MCP_DUPLICATE_TOOL_ID`.
- Continue to reject collisions across MCP servers and native extensions through `ToolRegistry` as `DUPLICATE_TOOL_ID`.
- Normalize MCP risk conservatively: `destructiveHint === true` maps to `admin`; otherwise `readOnlyHint === true` maps to `read`; all other tools map to `write`.
- Missing MCP descriptions normalize to the tool title, then to `MCP tool <remote-name>`.
- Missing MCP input schemas normalize to `{ type: "object", properties: {} }`.
- Follow all `nextCursor` values returned by `tools/list`; an empty page with a new cursor is valid.
- Detect a repeated cursor and fail discovery with `MCP_PAGINATION_LOOP`.
- HTTP authentication supports no auth, a non-interactive Bearer token, or an interactive OAuth 2.1 authorization-code flow.
- Interactive OAuth applies only to Streamable HTTP; stdio authentication continues to use configured secret environment variables.
- OAuth authorization is explicit through `ohmytool mcp auth <server-id>`; `search`, `describe`, and `run` must never open a browser or wait for a callback.
- Normal MCP commands silently reuse valid OAuth tokens and allow the official SDK to refresh expired access tokens when a refresh token is available.
- When user interaction is required outside the explicit auth command, fail with `MCP_AUTH_REQUIRED` and name the exact command to run.
- OAuth must use PKCE, a cryptographically random `state`, RFC 8707 resource indicators through the official SDK, validated authorization-server metadata, and a loopback callback bound only to `127.0.0.1`.
- Accept OAuth callback traffic only on the exact `/oauth/callback` path. Reject mismatched state, OAuth error responses, duplicate callbacks, non-GET requests, and callback timeouts.
- Default OAuth callback port is an OS-assigned free port. An optional configured fixed port supports pre-registration, SSH forwarding, and firewall rules.
- Support both dynamic client registration and optional pre-registered client information. A configured client secret is a `SecretStore` reference, never a literal value.
- Persist OAuth tokens and dynamically registered client information verbatim, including the SDK's issuer stamp, in `SecretStore` under server-scoped names.
- Persist PKCE verifier and OAuth discovery state with the same durability until the callback finishes; clear the verifier after success or terminal failure.
- `ohmytool mcp logout <server-id>` deletes tokens, registered client information, verifier, and discovery state for that server. Token revocation is not part of v0.3.
- Never disable issuer metadata validation or permit non-loopback plain-HTTP authorization/token endpoints.
- Stdio secret environment values are loaded from `SecretStore`; literal secret values must not appear in `config.toml`, descriptors, errors, logs, snapshots, or normal CLI output.
- Do not implement device-code, client-credentials, private-key JWT, Cross-App Access, token exchange, or custom authorization-server flows in v0.3.
- Non-secret stdio environment values and non-secret HTTP headers may be configured literally.
- Never merge the complete parent `process.env` into a child MCP server. Use the official stdio safe default environment plus explicitly configured values.
- A missing configured secret fails with `MCP_SECRET_NOT_FOUND` and identifies the secret name, never its value.
- Native discovery remains static-only. MCP discovery necessarily connects to enabled servers and may resolve configured transport credentials; documentation must state this v0.3 behavior explicitly.
- Runtime initialization remains atomic: failure to configure, connect, or list tools from any enabled MCP server prevents the runtime from serving commands.
- Disabled MCP servers are not validated beyond the shared server-ID syntax, are not connected, and expose no tools.
- `McpProvider.execute()` must call only a tool previously discovered by that provider instance.
- MCP `isError: true` results normalize to `MCP_TOOL_ERROR` while preserving `content` and `structuredContent` in structured error details.
- Successful MCP output is `{ content, structuredContent? }`; preserve every content block without converting images, audio, or embedded resources to text.
- MCP protocol/transport failures normalize to stable OMT codes and retain the original exception as `cause`; do not leak request headers, environment values, or bearer tokens in messages.
- Add provider/runtime shutdown. Every CLI command must close the runtime in `finally`, including discovery failures and tool errors.
- `ToolRuntime.close()` is idempotent and attempts to close every provider even if one close fails.
- Native provider behavior and the independent `omt-mysql` / `omt-redis` contracts must remain unchanged.
- Do not inject native-only `maxRows`, `timeoutMs`, or connection policy fields into MCP tool arguments.
- Existing command names and JSON envelope remain `ohmytool search`, `ohmytool describe`, and `ohmytool run`.
- MCP server definitions remain managed through `config.toml`; the only MCP management commands in v0.3 are `mcp auth` and `mcp logout` for interactive OAuth credentials.
- Every production behavior change starts with a failing Bun test.

---

## Target File Structure

```text
packages/cli/
├─ package.json
├─ src/
│  ├─ cli/
│  │  ├─ context.ts
│  │  └─ commands/
│  │     ├─ search.ts
│  │     ├─ describe.ts
│  │     ├─ run.ts
│  │     └─ mcp.ts
│  ├─ config/
│  │  └─ config.ts
│  ├─ runtime/
│  │  ├─ errors.ts
│  │  ├─ executor.ts
│  │  ├─ provider.ts
│  │  ├─ result.ts
│  │  ├─ runtime.ts
│  │  └─ providers/
│  │     ├─ native/
│  │     │  └─ provider.ts
│  │     └─ mcp/
│  │        ├─ config.ts
│  │        ├─ oauth-provider.ts
│  │        ├─ oauth-callback.ts
│  │        ├─ oauth-store.ts
│  │        ├─ session.ts
│  │        ├─ transport.ts
│  │        ├─ normalize.ts
│  │        └─ provider.ts
│  └─ secrets/
│     └─ secrets.ts
└─ test/
   ├─ config.test.ts
   ├─ commands.test.ts
   ├─ e2e.test.ts
   ├─ fixtures/
   │  └─ mcp/
   │     └─ stdio-server.ts
   └─ runtime/
      ├─ mcp-oauth.test.ts
      ├─ mcp-oauth-callback.test.ts
      ├─ mcp-normalize.test.ts
      ├─ mcp-provider.test.ts
      ├─ mcp-stdio.test.ts
      ├─ mcp-http.test.ts
      ├─ executor.test.ts
      └─ runtime.test.ts
```

Dependency direction:

```text
CLI context
   |
   +--> Config + SecretStore
   |
   +--> NativeExtensionProvider
   |
   +--> McpProvider (one per enabled server)
              |
              v
        McpSession adapter
              |
              v
   official MCP Client + transport

All providers --> ToolRuntime --> ToolRegistry
```

Forbidden dependencies:

```text
runtime/providers/mcp/* -> cli/*
runtime/providers/mcp/* -> extension/*
config/*                -> MCP SDK
```

---

### Task 1: Freeze the MCP Dependency and Configuration Contract

**Files:**

- Modify: `packages/cli/package.json`
- Modify: `package-lock.json`
- Modify: `packages/cli/src/config/config.ts`
- Modify: `packages/cli/test/config.test.ts`

**Interfaces:**

Produces:

```ts
export interface McpCommonServerConfig {
  readonly enabled: boolean;
  readonly namespace: string;
}

export interface McpStdioServerConfig extends McpCommonServerConfig {
  readonly transport: "stdio";
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly secretEnv: Readonly<Record<string, string>>;
}

export interface McpHttpServerConfig extends McpCommonServerConfig {
  readonly transport: "streamable-http";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly secretHeaders: Readonly<Record<string, string>>;
  readonly auth: McpHttpAuthConfig;
}

export type McpHttpAuthConfig =
  | { readonly type: "none" }
  | { readonly type: "bearer"; readonly tokenSecret: string }
  | {
      readonly type: "oauth";
      readonly scopes: readonly string[];
      readonly callbackPort: number;
      readonly clientId?: string;
      readonly clientSecretSecret?: string;
      readonly tokenEndpointAuthMethod:
        | "none"
        | "client_secret_basic"
        | "client_secret_post";
    };

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface Config {
  extensions: Record<string, { connections: Record<string, ConnectionConfig> }>;
  mcp: { servers: Record<string, McpServerConfig> };
}
```

- [ ] **Step 1: Add failing tests for a stdio server definition**

Add this TOML fixture to `config.test.ts`:

```toml
[mcp.servers.filesystem]
transport = "stdio"
command = "bun"
args = ["run", "./server.ts"]
cwd = "C:/workspace"
namespace = "fs"

[mcp.servers.filesystem.env]
LOG_LEVEL = "warn"

[mcp.servers.filesystem.secretEnv]
FILESYSTEM_TOKEN = "mcp:filesystem:token"
```

Assert the parsed discriminated union equals:

```ts
expect(cfg.mcp.servers.filesystem).toEqual({
  enabled: true,
  transport: "stdio",
  command: "bun",
  args: ["run", "./server.ts"],
  cwd: "C:/workspace",
  namespace: "fs",
  env: { LOG_LEVEL: "warn" },
  secretEnv: { FILESYSTEM_TOKEN: "mcp:filesystem:token" },
});
```

- [ ] **Step 2: Add failing tests for a Streamable HTTP definition**

Use:

```toml
[mcp.servers.github]
transport = "streamable-http"
url = "https://mcp.example.test/mcp"
auth = "bearer"
bearerTokenSecret = "mcp:github:token"

[mcp.servers.github.headers]
X-Tenant = "engineering"

[mcp.servers.github.secretHeaders]
X-Gateway-Key = "mcp:github:gateway-key"
```

Assert `enabled` defaults to `true`, `namespace` defaults to `github`, and both header maps are preserved as names-to-literal-or-secret-reference mappings.

- [ ] **Step 3: Add failing tests for an interactive OAuth definition**

Use:

```toml
[mcp.servers.linear]
transport = "streamable-http"
url = "https://mcp.linear.example/mcp"
auth = "oauth"
oauthScopes = ["mcp:read", "mcp:write"]
oauthCallbackPort = 8765
oauthClientId = "oh-my-tool"
oauthClientSecretSecret = "mcp:linear:client-secret"
oauthTokenEndpointAuthMethod = "client_secret_basic"
```

Assert the parsed `auth` value is:

```ts
{
  type: "oauth",
  scopes: ["mcp:read", "mcp:write"],
  callbackPort: 8765,
  clientId: "oh-my-tool",
  clientSecretSecret: "mcp:linear:client-secret",
  tokenEndpointAuthMethod: "client_secret_basic",
}
```

Also assert the minimal dynamic-registration form defaults to `scopes: []`, `callbackPort: 0`, and `tokenEndpointAuthMethod: "none"`.

- [ ] **Step 4: Add failing validation tests**

Cover each stable code:

```text
MCP_INVALID_CONFIG  unsupported transport
MCP_INVALID_CONFIG  invalid server ID
MCP_INVALID_CONFIG  invalid namespace
MCP_INVALID_CONFIG  namespace native or mcp
MCP_INVALID_CONFIG  empty stdio command
MCP_INVALID_CONFIG  non-string stdio argument
MCP_INVALID_CONFIG  invalid or non-http(s) URL
MCP_INVALID_CONFIG  unsupported HTTP auth mode
MCP_INVALID_CONFIG  empty bearer secret name
MCP_INVALID_CONFIG  OAuth configured for stdio
MCP_INVALID_CONFIG  callback port outside 0 or 1024..65535
MCP_INVALID_CONFIG  client secret without client ID
MCP_INVALID_CONFIG  secret auth method without client secret
MCP_INVALID_CONFIG  client secret with token auth method none
MCP_INVALID_CONFIG  same header in headers and secretHeaders
MCP_INVALID_CONFIG  Authorization configured together with bearerTokenSecret
```

Use `expect(() => loadConfig(home)).toThrowObject({ code: "MCP_INVALID_CONFIG" })` or the Bun equivalent already supported by the test suite.

- [ ] **Step 5: Verify the tests fail**

Run:

```powershell
bun test packages/cli/test/config.test.ts
```

Expected: failure because `Config` has no `mcp` section and validation does not exist.

- [ ] **Step 6: Add the official MCP client and browser-launch dependencies**

Run:

```powershell
npm install --workspace=@oh-my-tool/cli --save-exact @modelcontextprotocol/client@2.0.0 open@11.0.0
```

Expected package entry:

```json
"@modelcontextprotocol/client": "2.0.0",
"open": "11.0.0"
```

- [ ] **Step 7: Implement strict MCP config parsing**

Keep TOML parsing in `config.ts`. Parse extensions exactly as today, then parse `mcp.servers`. Create small helpers with exact responsibilities:

```ts
function parseStringMap(value: unknown, path: string): Record<string, string>;
function parseStringArray(value: unknown, path: string): string[];
function parseMcpServer(id: string, value: unknown): McpServerConfig;
function assertMcpName(value: string, path: string): void;
```

Throw:

```ts
new RuntimeError("MCP_INVALID_CONFIG", `${path}: <safe reason>`)
```

Do not include raw map values in error messages.

- [ ] **Step 8: Preserve missing-config compatibility**

For an absent file, return:

```ts
{ extensions: {}, mcp: { servers: {} } }
```

For a file with only `[extensions]`, preserve all existing extension results and return an empty MCP server map.

- [ ] **Step 9: Run config and type checks**

Run:

```powershell
bun test packages/cli/test/config.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add packages/cli/package.json package-lock.json packages/cli/src/config/config.ts packages/cli/test/config.test.ts
git commit -m "feat: add MCP server configuration"
```

---

### Task 2: Build the Transport-Neutral MCP Session Adapter

**Files:**

- Create: `packages/cli/src/runtime/providers/mcp/session.ts`
- Create: `packages/cli/src/runtime/providers/mcp/transport.ts`
- Create: `packages/cli/test/runtime/mcp-session.test.ts`
- Modify: `packages/cli/src/runtime/errors.ts`

**Interfaces:**

```ts
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";

export interface McpSession {
  listTools(cursor?: string): Promise<{
    tools: readonly Tool[];
    nextCursor?: string;
  }>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type McpSessionFactory = (
  serverId: string,
  config: McpServerConfig,
  secrets: SecretStore,
) => Promise<McpSession>;
```

- [ ] **Step 1: Write failing session adapter tests with a fake official client**

Inject a narrow client factory so unit tests do not start a process or open a socket. Assert this sequence:

```text
create client(name=oh-my-tool, version=current CLI version)
create selected transport
client.connect(transport)
client.listTools({ cursor })
client.callTool({ name, arguments })
client.close()
```

Assert `close()` is idempotent.

- [ ] **Step 2: Add failing secret-resolution tests**

For stdio:

```ts
secretEnv: { API_TOKEN: "mcp:demo:token" }
```

Assert the child receives `API_TOKEN=<resolved value>` and the resolved value is absent from serialized config and thrown messages.

For HTTP `auth.type === "bearer"`, assert `auth.tokenSecret` produces an auth provider equivalent to:

```ts
const authProvider: AuthProvider = {
  token: () => secrets.get(config.auth.tokenSecret),
};
```

For `secretHeaders`, resolve values immediately before connection and place them only in the transport's `requestInit.headers`. For `auth.type === "oauth"`, inject the non-interactive `OAuthClientProvider` created in Task 3.

- [ ] **Step 3: Add missing-secret tests**

Assert a missing stdio secret, bearer token, or secret header rejects before `client.connect()`:

```ts
{
  code: "MCP_SECRET_NOT_FOUND",
  message: "MCP server 'demo' requires missing secret 'mcp:demo:token'"
}
```

- [ ] **Step 4: Verify focused tests fail**

Run:

```powershell
bun test packages/cli/test/runtime/mcp-session.test.ts
```

Expected: missing adapter modules.

- [ ] **Step 5: Implement stdio transport construction**

Use official imports:

```ts
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
```

Build parameters as:

```ts
{
  command: config.command,
  args: [...config.args],
  cwd: config.cwd,
  env: {
    ...getDefaultEnvironment(),
    ...config.env,
    ...resolvedSecretEnv,
  },
  stderr: "pipe",
}
```

Drain stderr through the OMT logger when one is supplied later, but never parse stdout or write protocol messages directly.

- [ ] **Step 6: Implement Streamable HTTP construction**

Use:

```ts
import {
  Client,
  StreamableHTTPClientTransport,
  type AuthProvider,
} from "@modelcontextprotocol/client";
```

Construct:

```ts
new StreamableHTTPClientTransport(new URL(config.url), {
  authProvider,
  requestInit: { headers: resolvedHeaders },
});
```

Do not set an `Authorization` header when Bearer or OAuth auth is configured; let `AuthProvider` / `OAuthClientProvider` own it.

- [ ] **Step 7: Normalize transport and protocol errors**

Add safe wrappers:

```ts
function mcpConnectionError(serverId: string, cause: unknown): RuntimeError;
function mcpRequestError(serverId: string, operation: "tools/list" | "tools/call", cause: unknown): RuntimeError;
```

Stable codes:

```text
MCP_CONNECTION_FAILED
MCP_LIST_TOOLS_FAILED
MCP_CALL_FAILED
```

Messages include only server ID, operation, SDK error code when present, and the SDK message after redacting every resolved secret value.

- [ ] **Step 8: Run focused tests and typecheck**

```powershell
bun test packages/cli/test/runtime/mcp-session.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add packages/cli/src/runtime/providers/mcp packages/cli/src/runtime/errors.ts packages/cli/test/runtime/mcp-session.test.ts
git commit -m "feat: add MCP client sessions"
```

---

### Task 3: Implement Interactive OAuth, Credential Persistence, and CLI Commands

**Files:**

- Create: `packages/cli/src/runtime/providers/mcp/oauth-store.ts`
- Create: `packages/cli/src/runtime/providers/mcp/oauth-provider.ts`
- Create: `packages/cli/src/runtime/providers/mcp/oauth-callback.ts`
- Create: `packages/cli/src/cli/commands/mcp.ts`
- Modify: `packages/cli/src/cli/commands/index.ts`
- Modify: `packages/cli/src/cli/index.ts`
- Modify: `packages/cli/src/cli/parseArgs.ts`
- Create: `packages/cli/test/runtime/mcp-oauth.test.ts`
- Create: `packages/cli/test/runtime/mcp-oauth-callback.test.ts`
- Modify: `packages/cli/test/commands.test.ts`
- Modify: `packages/cli/test/e2e.test.ts`

**Interfaces:**

```ts
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";

export interface McpOAuthStore {
  tokens(): Promise<StoredOAuthTokens | undefined>;
  saveTokens(tokens: StoredOAuthTokens): Promise<void>;
  clientInformation(): Promise<StoredOAuthClientInformation | undefined>;
  saveClientInformation(info: StoredOAuthClientInformation): Promise<void>;
  codeVerifier(): Promise<string | undefined>;
  saveCodeVerifier(value: string): Promise<void>;
  discoveryState(): Promise<OAuthDiscoveryState | undefined>;
  saveDiscoveryState(value: OAuthDiscoveryState): Promise<void>;
  clearVerifier(): Promise<void>;
  clearAll(): Promise<void>;
}

export interface OAuthCallback {
  readonly redirectUrl: URL;
  waitForResult(expectedState: string): Promise<URLSearchParams>;
  close(): Promise<void>;
}

export interface InteractiveOAuthDeps {
  readonly openBrowser: (url: string) => Promise<unknown>;
  readonly createCallback: (port: number) => Promise<OAuthCallback>;
  readonly callbackTimeoutMs: number;
}

export async function authorizeMcpServer(
  serverId: string,
  config: McpHttpServerConfig,
  secrets: SecretStore,
  deps?: Partial<InteractiveOAuthDeps>,
): Promise<{ serverId: string; authorized: true }>;

export async function logoutMcpServer(
  serverId: string,
  config: McpHttpServerConfig,
  secrets: SecretStore,
): Promise<{ serverId: string; loggedOut: true }>;
```

- [ ] **Step 1: Write failing credential-store tests**

Use `memoryStore()` and server ID `linear`. Assert these exact secret names:

```text
mcp:linear:oauth:tokens
mcp:linear:oauth:client
mcp:linear:oauth:verifier
mcp:linear:oauth:discovery
```

Round-trip the SDK objects with `JSON.stringify` / `JSON.parse` without selecting fields. Assert an `issuer` property returned by the SDK survives for tokens, client information, and discovery state.

Assert malformed stored JSON fails as `MCP_OAUTH_CREDENTIALS_INVALID` without including the stored payload in the message.

- [ ] **Step 2: Write failing OAuthClientProvider contract tests**

For dynamic registration, assert:

```ts
provider.clientInformation() === undefined
provider.saveClientInformation(info) persists info
provider.clientMetadata.redirect_uris === [redirectUrl]
provider.clientMetadata.grant_types === ["authorization_code", "refresh_token"]
provider.clientMetadata.response_types === ["code"]
provider.clientMetadata.token_endpoint_auth_method === "none"
```

For a pre-registered client, assert `clientInformation()` returns:

```ts
{
  client_id: config.auth.clientId,
  client_secret: resolvedSecretOrUndefined,
}
```

and the configured token endpoint auth method is reflected in `clientMetadata`.

- [ ] **Step 3: Test issuer-bound persistence and refresh behavior**

Assert `saveTokens(tokens, { issuer })` and `saveClientInformation(info, { issuer })` persist the objects verbatim with the issuer stamp. `tokens()` without context must return the latest set because the transport reads it before ordinary requests. A stored object with a different issuer must be returned verbatim and left for the official SDK's issuer check; do not implement a competing issuer comparison.

Assert `invalidateCredentials("tokens")`, `("client")`, `("verifier")`, and `("discovery")` delete only the corresponding secret, while `("all")` deletes all four.

- [ ] **Step 4: Write failing loopback callback tests**

Create the callback on `127.0.0.1` and an OS-assigned port. Assert `redirectUrl` has exact form:

```text
http://127.0.0.1:<port>/oauth/callback
```

Cover:

```text
valid GET with code + matching state -> URLSearchParams returned once
state mismatch                        -> MCP_OAUTH_STATE_MISMATCH
error=access_denied                   -> MCP_OAUTH_ACCESS_DENIED
wrong path                            -> HTTP 404, listener remains active
POST callback                         -> HTTP 405, listener remains active
second callback                       -> HTTP 409
timeout                               -> MCP_OAUTH_TIMEOUT
close before callback                 -> listener closes without leaked handle
```

The success/error HTML response must be a fixed local page and must not echo `code`, `state`, `iss`, error descriptions, tokens, or query strings.

- [ ] **Step 5: Verify OAuth unit tests fail**

```powershell
bun test packages/cli/test/runtime/mcp-oauth.test.ts packages/cli/test/runtime/mcp-oauth-callback.test.ts
```

Expected: missing OAuth modules.

- [ ] **Step 6: Implement the server-scoped OAuth store**

Wrap the existing `SecretStore`; do not extend the public SDK. Parse stored JSON as objects and throw stable errors for missing verifier or malformed credentials. The store must never log, stringify into errors, or return secret values through CLI command results.

- [ ] **Step 7: Implement the official OAuthClientProvider**

Implement these SDK members directly:

```ts
redirectUrl
clientMetadata
state()
clientInformation(ctx?)
saveClientInformation(info, ctx?)
tokens(ctx?)
saveTokens(tokens, ctx?)
redirectToAuthorization(url)
saveCodeVerifier(value)
codeVerifier()
saveDiscoveryState(value)
discoveryState()
invalidateCredentials(scope)
```

Generate state with `randomBytes(32).toString("base64url")`. Preserve SDK-provided credential objects verbatim. Do not implement `skipIssuerMetadataValidation`, `validateResourceURL`, or custom token exchange logic.

- [ ] **Step 8: Implement the loopback callback server**

Bind with:

```ts
Bun.serve({ hostname: "127.0.0.1", port: configuredPortOrZero, fetch })
```

Compare state using decoded fixed-length buffers and `timingSafeEqual`; reject unequal lengths before comparison. Use a five-minute default timeout:

```ts
export const DEFAULT_OAUTH_CALLBACK_TIMEOUT_MS = 300_000;
```

Always stop the callback server in `finally`.

- [ ] **Step 9: Implement explicit interactive authorization**

Required flow:

```text
validate target is enabled Streamable HTTP with auth=oauth
start loopback callback
construct OAuthClientProvider in interactive mode
construct Client + StreamableHTTPClientTransport
try client.connect
  success -> credentials already valid; return authorized
  UnauthorizedError -> redirectToAuthorization has captured URL
open authorization URL in default browser
wait for callback and validate state/error
call firstTransport.finishAuth(callbackParams)
create a fresh Client and fresh transport using the same OAuth provider
connect to prove the saved tokens work
close both clients/transports and callback listener
clear PKCE verifier
return only { serverId, authorized: true }
```

Use `open` only after confirming the authorization URL protocol is `https:` or its host is loopback. If browser launch fails, print the safe authorization URL once and continue waiting for the callback.

- [ ] **Step 10: Implement non-interactive OAuth for ordinary sessions**

The session factory from Task 2 uses the same persistent provider with browser opening disabled. Valid tokens and refresh tokens work normally. If `redirectToAuthorization()` is reached, retain no URL and surface:

```text
MCP_AUTH_REQUIRED: MCP server '<id>' requires user authorization; run 'ohmytool mcp auth <id>'
```

Do not start a loopback listener from `search`, `describe`, or `run`.

- [ ] **Step 11: Add CLI command tests**

Add parser and dispatch coverage for:

```text
ohmytool mcp auth <server-id>
ohmytool mcp logout <server-id>
```

Reject unknown servers, disabled servers, stdio servers, `auth=none`, and `auth=bearer` with `MCP_OAUTH_NOT_CONFIGURED`.

`mcp logout` deletes local credentials without network access and returns no credential fields.

- [ ] **Step 12: Add CLI help and command implementation**

Help text:

```text
ohmytool mcp auth <server>              authorize an OAuth MCP server
ohmytool mcp logout <server>            remove locally stored OAuth credentials
```

`runMcpAuth` and `runMcpLogout` load paths/config/secrets directly; they do not initialize every provider or start unrelated MCP servers.

- [ ] **Step 13: Run OAuth, command, and type checks**

```powershell
bun test packages/cli/test/runtime/mcp-oauth.test.ts packages/cli/test/runtime/mcp-oauth-callback.test.ts packages/cli/test/commands.test.ts packages/cli/test/e2e.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 14: Commit**

```powershell
git add packages/cli/src/runtime/providers/mcp packages/cli/src/cli packages/cli/test packages/cli/package.json package-lock.json
git commit -m "feat: add interactive MCP OAuth"
```

---

### Task 4: Normalize MCP Tools Into Runtime Descriptors

**Files:**

- Create: `packages/cli/src/runtime/providers/mcp/normalize.ts`
- Create: `packages/cli/test/runtime/mcp-normalize.test.ts`

**Interfaces:**

```ts
export interface NormalizedMcpTool {
  readonly descriptor: ToolDescriptor;
  readonly remoteName: string;
}

export function normalizeMcpTool(
  serverId: string,
  namespace: string,
  providerId: string,
  tool: Tool,
): NormalizedMcpTool;
```

- [ ] **Step 1: Write failing identity tests**

Given remote tool:

```ts
{
  name: "create_issue",
  title: "Create issue",
  description: "Create a repository issue",
  inputSchema: {
    type: "object",
    required: ["title"],
    properties: { title: { type: "string" } },
  },
}
```

Assert:

```ts
{
  id: "github.create_issue",
  description: "Create a repository issue",
  provider: { id: "mcp:github", kind: "mcp" },
  source: { id: "github", kind: "mcp-server" },
}
```

and `remoteName === "create_issue"`.

- [ ] **Step 2: Write failing fallback and keyword tests**

Assert keywords contain the server ID, namespace, remote name, and title once each. Assert a missing description falls back to title and then `MCP tool <name>`.

- [ ] **Step 3: Write failing risk mapping tests**

Cover exactly:

```ts
{ annotations: { destructiveHint: true, readOnlyHint: true } } -> "admin"
{ annotations: { destructiveHint: false, readOnlyHint: true } } -> "read"
{ annotations: { readOnlyHint: false } } -> "write"
{ annotations: undefined } -> "write"
```

- [ ] **Step 4: Write failing schema tests**

Assert `inputSchema` is copied without mutation. Missing schema becomes:

```ts
{ type: "object", properties: {} }
```

- [ ] **Step 5: Verify focused tests fail**

```powershell
bun test packages/cli/test/runtime/mcp-normalize.test.ts
```

- [ ] **Step 6: Implement normalization as a pure function**

Do not import clients, transports, config loaders, secrets, filesystem APIs, or CLI modules. Preserve unknown valid JSON Schema keywords by assigning the MCP schema as `Record<string, unknown>` without rebuilding it field by field.

- [ ] **Step 7: Run focused tests**

```powershell
bun test packages/cli/test/runtime/mcp-normalize.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/cli/src/runtime/providers/mcp/normalize.ts packages/cli/test/runtime/mcp-normalize.test.ts
git commit -m "feat: normalize MCP tool descriptors"
```

---

### Task 5: Implement McpProvider Discovery, Routing, and Invocation

**Files:**

- Create: `packages/cli/src/runtime/providers/mcp/provider.ts`
- Create: `packages/cli/test/runtime/mcp-provider.test.ts`
- Modify: `packages/cli/src/runtime/errors.ts`
- Modify: `packages/cli/src/runtime/result.ts`
- Modify: `packages/cli/src/runtime/executor.ts`
- Modify: `packages/cli/src/core/result.ts`

**Interfaces:**

```ts
export interface McpProviderOptions {
  readonly serverId: string;
  readonly config: McpServerConfig;
  readonly secrets: SecretStore;
  readonly createSession?: McpSessionFactory;
}

export class McpProvider implements ToolProvider {
  readonly id: string;   // mcp:<server-id>
  readonly kind = "mcp";
  listTools(): Promise<readonly ToolDescriptor[]>;
  execute(toolId: string, input: unknown, context: ExecutionContext): Promise<ToolResult>;
  close(): Promise<void>;
}
```

Extend structured errors:

```ts
export interface ExecutionError {
  code: string;
  message: string;
  details?: unknown;
}

export class RuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    options?: ErrorOptions,
  );
}
```

- [ ] **Step 1: Write failing paginated discovery tests**

Use a fake session returning:

```text
cursor undefined -> tool alpha, nextCursor page-2
cursor page-2    -> tool beta, no nextCursor
```

Assert both descriptors are returned, both route to their exact remote names, and the session is created once.

- [ ] **Step 2: Write failing pagination-loop and duplicate tests**

Repeated cursor:

```text
undefined -> nextCursor same
same      -> nextCursor same
```

Expected: `MCP_PAGINATION_LOOP`.

Two remote definitions that normalize to the same exposed ID must fail with `MCP_DUPLICATE_TOOL_ID` before descriptors are returned.

- [ ] **Step 3: Write a failing undiscovered-tool routing test**

Calling `github.not_listed` must not send a request. Expected:

```text
MCP_TOOL_NOT_FOUND
```

- [ ] **Step 4: Write failing successful-result tests**

For:

```ts
{
  content: [{ type: "text", text: "created" }],
  structuredContent: { number: 42 },
}
```

expect:

```ts
{
  data: {
    content: [{ type: "text", text: "created" }],
    structuredContent: { number: 42 },
  },
  meta: { mcpServer: "github", remoteTool: "create_issue" },
}
```

When `structuredContent` is absent, omit that property and preserve `content` exactly.

- [ ] **Step 5: Write failing MCP tool-error tests**

For `isError: true`, assert the final `ExecutionResult` is:

```ts
{
  ok: false,
  toolId: "github.create_issue",
  error: {
    code: "MCP_TOOL_ERROR",
    message: "MCP tool 'github.create_issue' reported an error",
    details: {
      content: [{ type: "text", text: "permission denied" }],
      structuredContent: { retryable: false },
    },
  },
}
```

- [ ] **Step 6: Verify focused tests fail**

```powershell
bun test packages/cli/test/runtime/mcp-provider.test.ts packages/cli/test/runtime/executor.test.ts
```

- [ ] **Step 7: Implement cached discovery and the route map**

Use private state:

```ts
private session?: McpSession;
private descriptors?: readonly ToolDescriptor[];
private readonly routes = new Map<string, string>();
private closePromise?: Promise<void>;
```

`listTools()` returns the same immutable descriptor snapshot after the first successful discovery. A failed first discovery must clear the session after closing it so a newly constructed runtime may retry on the next CLI invocation.

- [ ] **Step 8: Implement invocation and result normalization**

Require `input` to be a non-null, non-array object after runtime schema validation. Call:

```ts
await session.callTool(remoteName, input as Record<string, unknown>);
```

On `isError`, throw `RuntimeError` with structured details. On success, return the exact envelope from Step 4.

- [ ] **Step 9: Preserve structured details through runtime and CLI layers**

Update `executeRuntimeTool`, `ExecutionResult`, and `OmtErr` so `RuntimeError.details` is copied to `error.details`. Existing native errors without details must serialize exactly as before.

- [ ] **Step 10: Implement idempotent provider close**

Close the session once, clear private references, and let later `close()` calls await the same promise. Closing an unconnected provider resolves immediately.

- [ ] **Step 11: Run focused tests and typecheck**

```powershell
bun test packages/cli/test/runtime/mcp-provider.test.ts packages/cli/test/runtime/executor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

```powershell
git add packages/cli/src/runtime packages/cli/src/core/result.ts packages/cli/test/runtime
git commit -m "feat: add MCP tool provider"
```

---

### Task 6: Add Runtime Shutdown and Compose Configured MCP Providers

**Files:**

- Modify: `packages/cli/src/runtime/provider.ts`
- Modify: `packages/cli/src/runtime/runtime.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Modify: `packages/cli/src/cli/commands/search.ts`
- Modify: `packages/cli/src/cli/commands/describe.ts`
- Modify: `packages/cli/src/cli/commands/run.ts`
- Modify: `packages/cli/test/runtime/runtime.test.ts`
- Modify: `packages/cli/test/commands.test.ts`

**Interfaces:**

```ts
export interface ToolProvider {
  readonly id: string;
  readonly kind: string;
  listTools(): Promise<readonly ToolDescriptor[]>;
  execute(toolId: string, input: unknown, context: ExecutionContext): Promise<ToolResult>;
  close?(): Promise<void>;
}

export class ToolRuntime {
  // existing search/describe/run
  close(): Promise<void>;
}

export async function withRuntime<T>(
  operation: (runtime: ToolRuntime) => Promise<T>,
): Promise<T>;
```

- [ ] **Step 1: Write failing runtime shutdown tests**

Assert reverse registration order:

```text
close second provider
close first provider
```

Assert all providers are attempted when the second provider throws. Assert two `runtime.close()` calls invoke each provider once.

- [ ] **Step 2: Write a failing partial-initialization cleanup test**

Provider A lists successfully and implements `close`; provider B throws from `listTools`. Assert `createToolRuntime()` closes both provider B and already initialized provider A before rejecting with provider B's original error.

- [ ] **Step 3: Write failing CLI composition tests**

Given one enabled stdio server and one disabled HTTP server, inject an MCP provider factory and assert:

```text
providers = [native, mcp:enabled-server]
disabled server factory not called
same SecretsManager passed to MCP provider and execution contexts
```

- [ ] **Step 4: Write failing command-finally tests**

Inject `withRuntime` or runtime creation into each command. Assert `runtime.close()` runs after:

```text
successful search
failed describe
successful run
failed run
```

- [ ] **Step 5: Verify focused tests fail**

```powershell
bun test packages/cli/test/runtime/runtime.test.ts packages/cli/test/commands.test.ts
```

- [ ] **Step 6: Implement runtime close**

Store providers in registration order inside `ToolRuntime`. Close in reverse order with `Promise.allSettled` semantics. Throw the first close error only when the caller operation itself succeeded; `withRuntime` must not replace an existing operation error with a close error.

- [ ] **Step 7: Clean up atomic initialization failures**

Wrap provider registration/listing in `try/catch`. On failure, close every provider supplied in `options.providers`, including the provider whose discovery failed, then rethrow the discovery error.

- [ ] **Step 8: Compose providers in CLI context**

Conceptually:

```ts
const secrets = new SecretsManager();
const providers: ToolProvider[] = [new NativeExtensionProvider(paths)];

for (const [serverId, server] of Object.entries(config.mcp.servers)) {
  if (!server.enabled) continue;
  providers.push(new McpProvider({ serverId, config: server, secrets }));
}

return createToolRuntime({ providers, policy, createExecutionContext });
```

Sort MCP entries by server ID before provider construction so discovery and collision failures are deterministic.

- [ ] **Step 9: Make policy provider-aware**

In `preflight`, apply the existing limit mutation and connection validation only when:

```ts
descriptor.provider.kind === "native"
```

For MCP descriptors, do not add, remove, or rewrite any argument. Schema validation in `executeRuntimeTool` still runs before provider invocation.

- [ ] **Step 10: Wrap all runtime commands**

Implement:

```ts
export async function withRuntime<T>(operation: (runtime: ToolRuntime) => Promise<T>): Promise<T> {
  const runtime = await createRuntime();
  try {
    return await operation(runtime);
  } finally {
    await runtime.close();
  }
}
```

If `createRuntime()` fails during provider discovery, `createToolRuntime()` owns cleanup from Step 7.

- [ ] **Step 11: Run focused and full tests**

```powershell
bun test packages/cli/test/runtime packages/cli/test/commands.test.ts
bun test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

```powershell
git add packages/cli/src/runtime packages/cli/src/cli packages/cli/test
git commit -m "feat: route configured MCP servers through ToolRuntime"
```

---

### Task 7: Prove Stdio, Streamable HTTP, and OAuth End to End

**Files:**

- Create: `packages/cli/test/fixtures/mcp/stdio-server.ts`
- Create: `packages/cli/test/runtime/mcp-stdio.test.ts`
- Create: `packages/cli/test/runtime/mcp-http.test.ts`
- Create: `packages/cli/test/runtime/mcp-oauth-e2e.test.ts`
- Modify: `packages/cli/test/e2e.test.ts`

**Interfaces:**

The deterministic fixture exposes:

```text
remote name: echo
description: Echo input through MCP
risk: readOnlyHint=true
input: { value: string }
success structuredContent: { echoed: value }
success text content: echoed:<value>
```

- [ ] **Step 1: Create a failing stdio integration test**

Write a real MCP server fixture using the server utilities already included transitively by the official client only if they are public exports. If not, add exact dev dependency `@modelcontextprotocol/server@2.0.0` and update the lockfile.

Start it through the production `StdioClientTransport` using:

```toml
[mcp.servers.fixture]
transport = "stdio"
command = "bun"
args = ["packages/cli/test/fixtures/mcp/stdio-server.ts"]
namespace = "fixture"
```

Assert real `initialize/discover`, `tools/list`, `tools/call`, and clean child shutdown through public client/server APIs.

- [ ] **Step 2: Add stdio secret-environment coverage**

Set a memory secret `mcp:fixture:token`, map it to `FIXTURE_TOKEN`, and have the fixture return only `{ tokenPresent: true }`. Assert the secret value itself is absent from captured stdout, stderr, results, and errors.

- [ ] **Step 3: Create a failing Streamable HTTP integration test**

Start an in-process HTTP server on port `0`, obtain its assigned loopback URL, and connect through the production `StreamableHTTPClientTransport`. Require:

```text
Authorization: Bearer <test token>
X-Tenant: engineering
X-Gateway-Key: <secret header value>
```

Return `401` for missing bearer auth and assert the authenticated production path succeeds.

- [ ] **Step 4: Add a real interactive OAuth integration test**

Run an in-process loopback MCP resource server plus OAuth authorization server with RFC 9728 protected-resource metadata, RFC 8414 authorization metadata, dynamic client registration, authorization, and token endpoints. The test server must validate PKCE and the RFC 8707 `resource` value.

Inject `openBrowser(url)` so the test follows the authorization URL, auto-consents, and follows the redirect into the production callback listener without launching a real GUI. Assert:

```text
runMcpAuth returns authorized=true
tokens and dynamically registered client information exist in memoryStore
stored credential objects retain issuer
a fresh non-interactive McpSession connects with the stored token
search/describe/run succeed without openBrowser being called again
```

- [ ] **Step 5: Add OAuth refresh, denial, and logout coverage**

Issue an expired/invalid access token with a valid refresh token, then assert the official client refreshes it and the replacement token is saved. Also cover authorization denial as `MCP_OAUTH_ACCESS_DENIED`, wrong callback state as `MCP_OAUTH_STATE_MISMATCH`, and `mcp logout` followed by a normal command as `MCP_AUTH_REQUIRED`.

- [ ] **Step 6: Add pagination coverage to the HTTP fixture**

Serve two `tools/list` pages and assert `search` can find a tool from the second page.

- [ ] **Step 7: Add command-level parity tests**

With the stdio fixture configured, assert:

```ts
await runSearch("echo")
await runDescribe("fixture.echo")
await runTool("fixture.echo", { value: "hello" }, false)
```

match native command envelopes:

```text
search: name, description, source, risk, provider; no inputSchema
describe: name, description, risk, inputSchema, source
run: ok, tool, data, meta
```

- [ ] **Step 8: Add collision tests at the runtime boundary**

Cover:

```text
two MCP servers with namespace shared and remote tool echo -> DUPLICATE_TOOL_ID
native tool fixture.echo plus MCP fixture.echo          -> DUPLICATE_TOOL_ID
```

Assert runtime creation fails before `search`, `describe`, or `run` can execute.

- [ ] **Step 9: Run transport integration tests**

```powershell
bun test packages/cli/test/runtime/mcp-stdio.test.ts packages/cli/test/runtime/mcp-http.test.ts packages/cli/test/runtime/mcp-oauth-e2e.test.ts packages/cli/test/e2e.test.ts
```

Expected: PASS with no orphan child process and no open server handle.

- [ ] **Step 10: Run the complete suite repeatedly**

```powershell
bun test
bun test
```

Expected: both runs PASS. The second run detects leaked ports, processes, or global listeners that the first run left behind.

- [ ] **Step 11: Commit**

```powershell
git add packages/cli/test packages/cli/package.json package-lock.json
git commit -m "test: cover MCP transports and OAuth end to end"
```

---

### Task 8: Update User Configuration, Agent Skill, and Product Documentation

**Files:**

- Modify: `docs/configuration.md`
- Modify: `docs/roadmap.md`
- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/cli/assets/skills/oh-my-tool/SKILL.md`
- Modify: `packages/cli/test/integration.test.ts`

**Interfaces:**

Documented protocol remains:

```text
ohmytool search -> ohmytool describe -> ohmytool run
```

Provider origin becomes visible through existing descriptor fields:

```text
native: provider.kind=native, source.kind=extension
MCP:    provider.kind=mcp,    source.kind=mcp-server
```

- [ ] **Step 1: Add failing documentation assertions**

Assert documentation and bundled Skill contain:

```text
[mcp.servers.<server-id>]
transport = "stdio"
transport = "streamable-http"
namespace
auth = "bearer"
bearerTokenSecret
auth = "oauth"
oauthScopes
oauthCallbackPort
ohmytool mcp auth
ohmytool mcp logout
secretEnv
```

Assert they do not advertise MCP resources, prompts, serving, device-code auth, client-credentials auth, token revocation, or legacy SSE as implemented v0.3 capabilities.

- [ ] **Step 2: Verify documentation tests fail**

```powershell
bun test packages/cli/test/integration.test.ts
```

- [ ] **Step 3: Document stdio configuration**

Include a copyable example:

```toml
[mcp.servers.filesystem]
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "C:/workspace"]
namespace = "fs"

[mcp.servers.filesystem.secretEnv]
FILESYSTEM_TOKEN = "mcp:filesystem:token"
```

Explain that the right-hand value is a secret name stored with:

```powershell
"token-value" | ohmytool secret set mcp:filesystem:token
```

- [ ] **Step 4: Document Streamable HTTP configuration**

Include:

```toml
[mcp.servers.github]
transport = "streamable-http"
url = "https://mcp.example.com/mcp"
namespace = "github"
auth = "bearer"
bearerTokenSecret = "mcp:github:token"

[mcp.servers.github.headers]
X-Tenant = "engineering"

[mcp.servers.github.secretHeaders]
X-Gateway-Key = "mcp:github:gateway-key"
```

State that this mode is for a token managed outside OMT and stored by secret name.

- [ ] **Step 5: Document interactive OAuth configuration and commands**

Include the dynamic-registration default:

```toml
[mcp.servers.linear]
transport = "streamable-http"
url = "https://mcp.linear.example/mcp"
namespace = "linear"
auth = "oauth"
oauthScopes = ["mcp:read", "mcp:write"]
```

And an optional pre-registered client:

```toml
oauthCallbackPort = 8765
oauthClientId = "oh-my-tool"
oauthClientSecretSecret = "mcp:linear:client-secret"
oauthTokenEndpointAuthMethod = "client_secret_basic"
```

Document:

```powershell
ohmytool mcp auth linear
ohmytool mcp logout linear
```

Explain that `auth` opens the default browser, listens only on `127.0.0.1`, validates PKCE/state/issuer, and saves credentials in the platform secret store. Explain that normal commands never open a browser; `MCP_AUTH_REQUIRED` tells the user when authorization must be performed again.

- [ ] **Step 6: Document discovery side effects and namespacing**

State explicitly:

```text
Native search/describe reads static manifests only.
MCP search/describe connects to every enabled MCP server to obtain tools/list.
MCP tools are exposed as <namespace>.<remote-name>.
One unavailable enabled server makes runtime initialization fail.
Set enabled=false to exclude a server temporarily.
```

- [ ] **Step 7: Update roadmap status without claiming release completion**

While implementation is in progress, keep v0.3 marked in progress. Update the v0.3 details only to reference this implementation plan. Change status to complete only as part of an actual v0.3 release after Task 9 passes.

- [ ] **Step 8: Update the Agent Skill**

Teach the agent that provider origin does not change the command sequence. It must use the exact exposed namespaced ID from search/describe and must never place bearer tokens, OAuth tokens, authorization codes, client secrets, or secret environment values in tool arguments. If a command returns `MCP_AUTH_REQUIRED`, the agent must ask the user to run or approve the interactive `ohmytool mcp auth <server-id>` flow rather than attempting to collect credentials in chat.

- [ ] **Step 9: Run documentation and full tests**

```powershell
bun test packages/cli/test/integration.test.ts
bun test
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add README.md docs packages/cli/README.md packages/cli/assets/skills packages/cli/test/integration.test.ts
git commit -m "docs: document MCP provider integration"
```

---

### Task 9: Run the v0.3 Release and Regression Gates

**Files:**

Only modify implementation or tests when a gate reveals a real defect.

Independent repositories:

```text
../omt-mysql
../omt-redis
```

- [ ] **Step 1: Verify the working tree and dependency lock**

```powershell
git status --short
npm ci
git diff -- package-lock.json
```

Expected: dependency install succeeds and does not modify the lockfile.

- [ ] **Step 2: Run all static and package gates**

```powershell
npm run check
```

Expected: typecheck, tests, and both npm pack dry runs PASS. Confirm the packed CLI includes MCP provider source files and the official client dependency is declared rather than copied into the tarball.

- [ ] **Step 3: Run independent native extension regressions**

```powershell
Set-Location ..\omt-mysql
bun install --frozen-lockfile
bun test

Set-Location ..\omt-redis
bun install --frozen-lockfile
bun test
```

Expected: both repositories PASS without manifest, handler, or SDK contract changes.

- [ ] **Step 4: Create an isolated v0.3 gate home**

From the main repository:

```powershell
$v03GateHome = Join-Path $env:TEMP "oh-my-tool-v03-gate"
if (Test-Path -LiteralPath $v03GateHome) {
  Remove-Item -LiteralPath $v03GateHome -Recurse -Force
}
New-Item -ItemType Directory -Path $v03GateHome | Out-Null
$env:OH_MY_TOOL_HOME = $v03GateHome
```

Expected: real user state is not read or changed.

- [ ] **Step 5: Configure and verify a real stdio MCP fixture**

Write only non-secret fixture configuration to `$v03GateHome/config.toml`, store any token through `ohmytool secret set`, then run:

```powershell
bun packages/cli/bin/ohmytool.ts search "echo"
bun packages/cli/bin/ohmytool.ts describe fixture.echo
'{"value":"hello"}' | bun packages/cli/bin/ohmytool.ts run fixture.echo --stdin
```

Expected:

```text
search finds fixture.echo without inputSchema
describe returns the complete MCP inputSchema
run returns ok=true and echoed=hello
the stdio child exits after each command
```

- [ ] **Step 6: Verify a real Streamable HTTP fixture**

Run the deterministic test server from Task 7 on a loopback ephemeral port and repeat search, describe, and run with Bearer auth plus one secret header.

Expected:

```text
all three commands succeed
missing bearer secret fails MCP_SECRET_NOT_FOUND
wrong bearer value fails MCP_CONNECTION_FAILED without printing the value
```

- [ ] **Step 7: Verify the complete interactive OAuth flow**

Configure the deterministic OAuth fixture with `auth = "oauth"` and dynamic registration, then run:

```powershell
bun packages/cli/bin/ohmytool.ts mcp auth oauth-fixture
bun packages/cli/bin/ohmytool.ts search "oauth echo"
bun packages/cli/bin/ohmytool.ts describe oauth-fixture.echo
'{"value":"hello"}' | bun packages/cli/bin/ohmytool.ts run oauth-fixture.echo --stdin
```

Expected:

```text
browser authorization uses a 127.0.0.1 callback and PKCE
auth returns only serverId + authorized=true
ordinary commands reuse stored credentials without opening a browser
forced access-token expiry refreshes and persists a replacement token
captured output contains no code, verifier, client secret, access token, or refresh token
```

Run:

```powershell
bun packages/cli/bin/ohmytool.ts mcp logout oauth-fixture
bun packages/cli/bin/ohmytool.ts search "oauth echo"
```

Expected: logout succeeds without a network call; the next search fails with `MCP_AUTH_REQUIRED` and the exact reauthorization command.

- [ ] **Step 8: Verify collision and disabled-server behavior**

Add a second configured fixture with the same namespace and assert `DUPLICATE_TOOL_ID`. Then set it to `enabled = false` and assert the first provider and native providers work normally.

- [ ] **Step 9: Re-run native CLI discovery in the mixed-provider home**

Install the unchanged deterministic native echo fixture and both independent extensions, then verify:

```powershell
bun packages/cli/bin/ohmytool.ts search "mysql"
bun packages/cli/bin/ohmytool.ts describe mysql.query
bun packages/cli/bin/ohmytool.ts search "redis"
bun packages/cli/bin/ohmytool.ts describe redis.get
```

Expected: native descriptors remain unchanged while MCP descriptors remain namespaced.

- [ ] **Step 10: Scan outputs and repository diff for secrets**

Search captured gate output and the repository diff for the test token values. Expected: zero matches.

Then run:

```powershell
git diff --check
git status --short
```

Expected: no gate home, generated credentials, logs, caches, or unrelated files in the repository.

- [ ] **Step 11: Clean the isolated gate state**

```powershell
Remove-Item -LiteralPath $v03GateHome -Recurse -Force
Remove-Item Env:OH_MY_TOOL_HOME
```

Expected: temporary state removed.

- [ ] **Step 12: Run the final suite**

```powershell
npm run check
```

Expected: PASS.

- [ ] **Step 13: Commit regression fixes only when needed**

If the gates exposed and the implementation fixed a real defect:

```powershell
git add packages docs README.md package-lock.json
git commit -m "test: verify v0.3 MCP provider gates"
```

Do not create an empty commit.

---

## Definition of Done

- [ ] `@modelcontextprotocol/client` 2.0.0 is an exact CLI dependency.
- [ ] `open` 11.0.0 is an exact CLI dependency.
- [ ] Missing MCP config preserves all v0.2 behavior.
- [ ] Multiple enabled MCP server definitions are loaded deterministically.
- [ ] Disabled MCP servers are not connected.
- [ ] Stdio and Streamable HTTP both pass real transport integration tests.
- [ ] Bearer tokens, OAuth credentials, client secrets, secret headers, and secret environment variables resolve through `SecretStore`.
- [ ] `ohmytool mcp auth <server-id>` completes authorization code + PKCE through a loopback callback.
- [ ] `ohmytool mcp logout <server-id>` removes every locally stored OAuth credential for that server without a network call.
- [ ] OAuth supports dynamic registration and optional pre-registered clients.
- [ ] OAuth token and client records preserve the SDK issuer stamp verbatim.
- [ ] OAuth callbacks validate state, path, method, timeout, and authorization errors.
- [ ] OAuth callback listeners bind only to `127.0.0.1` and always close.
- [ ] Normal commands silently reuse/refresh OAuth credentials but never open a browser.
- [ ] Missing interactive authorization fails with `MCP_AUTH_REQUIRED` and an exact remediation command.
- [ ] Secret values never appear in configuration output, descriptors, errors, logs, snapshots, or normal CLI output.
- [ ] Every configured MCP server has provider ID `mcp:<server-id>`.
- [ ] Every MCP tool has exposed ID `<namespace>.<remote-tool-name>`.
- [ ] Remote names are routed through a private map, not parsed from exposed IDs.
- [ ] `tools/list` pagination is complete and repeated cursors are rejected.
- [ ] Tool descriptions, keywords, schemas, provider metadata, source metadata, and risk are normalized deterministically.
- [ ] Destructive MCP tools map to `admin`; declared read-only tools map to `read`; all others map to `write`.
- [ ] Duplicate MCP tool IDs fail before the runtime serves commands.
- [ ] Cross-provider collisions continue to fail with `DUPLICATE_TOOL_ID`.
- [ ] `tools/call` receives the unmodified validated MCP arguments.
- [ ] Native-only limit and connection fields are not added to MCP arguments.
- [ ] Successful MCP content and structured content are preserved.
- [ ] MCP tool-level errors preserve structured details with `MCP_TOOL_ERROR`.
- [ ] Transport and protocol errors use stable OMT error codes and retain safe causes.
- [ ] Runtime initialization cleans up partially connected providers on failure.
- [ ] Runtime and provider shutdown are idempotent.
- [ ] Search, describe, run success, and run failure leave no child process or open HTTP session.
- [ ] `ohmytool search`, `describe`, and `run` have command-envelope parity for native and MCP providers.
- [ ] The bundled Agent Skill documents namespaced MCP usage and never instructs agents to pass secret values.
- [ ] README and configuration docs state that MCP discovery connects to enabled servers.
- [ ] MCP resources, prompts, northbound serving, non-authorization-code OAuth grants, legacy SSE fallback, workflows, GUI, daemon, marketplace, and dynamic tool-list refresh remain absent.
- [ ] Existing native provider tests remain green.
- [ ] Independent `omt-mysql` and `omt-redis` tests remain green unchanged.
- [ ] `npm run check` passes.
- [ ] Final diff contains no credentials, temporary homes, generated logs, caches, or unrelated edits.

---

## Explicitly Deferred Beyond v0.3

```text
MCP resources and subscriptions
MCP prompts and completions
MCP roots
sampling and elicitation
MCP tasks
server-initiated tool-list refresh
legacy HTTP+SSE fallback
device-code flow
client-credentials and private-key JWT flows
Cross-App Access and token exchange
custom OAuth authorization-server adapters
remote token revocation during logout
northbound MCP server support
MCP proxying
provider routing or failover
tool catalog persistence or offline cache
approval UI and interactive policy prompts
v0.4 governance metadata and audit redesign
v0.5 local runtime discovery
GUI, daemon, workflow engine, agent orchestration, marketplace
```

## Implementation References

- [Official MCP TypeScript client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md)
- [Official MCP client connection guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md)
- [Official MCP OAuth client contract](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/auth.ts)
- [Official MCP SDK v2 OAuth migration notes](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP schema reference for `tools/list` and `tools/call`](https://modelcontextprotocol.io/specification/2025-06-18/schema)
