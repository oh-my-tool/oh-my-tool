# Task 3 Report: Interactive OAuth, Credential Persistence, and CLI Commands

Date: 2026-08-23
Commit message: `feat: add interactive MCP OAuth`

## Status

Implemented Task 3 in full. The CLI now supports OAuth authorization-code + PKCE for Streamable HTTP MCP servers through `@modelcontextprotocol/client` v2, server-scoped credential persistence, exact loopback callbacks, non-interactive token reuse/refresh, and explicit `mcp auth` / `mcp logout` commands.

## Changed files

### Added

- `packages/cli/src/runtime/providers/mcp/oauth-store.ts`
  - Server-scoped `SecretStore` adapter for tokens, client information, PKCE verifier, and discovery state.
- `packages/cli/src/runtime/providers/mcp/oauth-provider.ts`
  - Persistent official `OAuthClientProvider`, interactive authorization orchestration, and local logout.
- `packages/cli/src/runtime/providers/mcp/oauth-callback.ts`
  - `127.0.0.1` callback listener at exact path `/oauth/callback` with fixed secret-free HTML responses.
- `packages/cli/src/cli/commands/mcp.ts`
  - Direct config/path/secret loading for `mcp auth` and `mcp logout` without runtime-wide provider initialization.
- `packages/cli/test/runtime/mcp-oauth.test.ts`
  - Store/provider contracts, official SDK OAuth integration fixture, authorization safety, token reuse/refresh, and auth-required behavior.
- `packages/cli/test/runtime/mcp-oauth-callback.test.ts`
  - Loopback address/path, state/error handling, method/path behavior, duplicate callback, timeout, fixed response, and cleanup coverage.
- `.superpowers/sdd/2026-08-23-omt-v03-mcp-provider-integration/task-3-report.md`
  - This report.

### Modified

- `packages/cli/src/runtime/providers/mcp/transport.ts`
  - Expanded the existing Task 2 factory boundary to accept the official `OAuthClientProvider` directly; transport construction remains centralized here.
- `packages/cli/src/runtime/providers/mcp/session.ts`
  - Installed the persistent non-interactive OAuth factory by default and preserved stable `MCP_AUTH_REQUIRED` failures.
- `packages/cli/src/cli/parseArgs.ts`
  - Added typed parsing for `mcp auth <server>` and `mcp logout <server>`.
- `packages/cli/src/cli/commands/index.ts`
  - Exported MCP commands.
- `packages/cli/src/cli/index.ts`
  - Added command dispatch, exact help entries, dependency seams for dispatch tests, and stable runtime error-code output.
- `packages/cli/test/commands.test.ts`
  - Added parser, selected-server loading, validation matrix, local deletion, and secret-free result tests.
- `packages/cli/test/e2e.test.ts`
  - Added help and auth/logout dispatch coverage.

No dependency files changed: Task 1/Task 2 had already installed pinned `@modelcontextprotocol/client` v2 and `open` dependencies on current HEAD.

## TDD RED/GREEN evidence

All production behavior was driven from observed Bun failures before implementation.

1. Credential store, provider contract, and callback listener
   - RED command:
     - `bun test packages/cli/test/runtime/mcp-oauth.test.ts packages/cli/test/runtime/mcp-oauth-callback.test.ts`
   - RED result: exit 1, 0 pass, 2 fail/2 module errors; `oauth-store` and `oauth-callback` did not exist.
   - GREEN result after minimal modules and async test-harness correction: exit 0, 18 pass, 0 fail, 72 expectations.

2. Interactive official SDK authorization
   - RED command:
     - `bun test packages/cli/test/runtime/mcp-oauth.test.ts packages/cli/test/runtime/mcp-session.test.ts`
   - RED result: exit 1; named export `authorizeMcpServer` was missing while the 18 existing session tests passed.
   - After adding the official `Client` + Task 2 `StreamableHTTPClientTransport` flow, the interactive tests passed and exposed the next intended RED for ordinary sessions.

3. Non-interactive auth-required and refresh/reuse
   - RED result: 32 pass, 2 fail; ordinary sessions reported `MCP_OAUTH_PROVIDER_UNAVAILABLE` instead of using the persistent provider.
   - GREEN command/result: the same OAuth/session command exited 0 with 34 pass, 0 fail, 108 expectations.
   - Additional RED: non-interactive first contact with callback port 0 left a dynamic client registered for `127.0.0.1:0`.
   - Additional GREEN: non-interactive redirect now clears the transient verifier and port-0 dynamic client before surfacing auth-required; OAuth test exited 0 with 17 pass, 0 fail, 80 expectations.

4. CLI parser, commands, help, and dispatch
   - RED command:
     - `bun test packages/cli/test/commands.test.ts packages/cli/test/e2e.test.ts`
   - RED result: exit 1; `runMcpAuth` export missing, help entries absent, and MCP dispatch returned exit 1.
   - GREEN result: exit 0, 27 pass, 0 fail, 60 expectations.

5. Authorization URL browser safety
   - RED command:
     - `bun test packages/cli/test/runtime/mcp-oauth.test.ts`
   - RED result: exit 1, 16 pass, 1 fail; an HTTP authorization URL on a non-loopback host reached the browser boundary and authorization resolved.
   - GREEN: restored the minimal HTTPS-or-loopback guard; the full focused suite subsequently passed.

6. Type safety
   - Initial typecheck after runtime GREEN failed only in test fixtures because OAuth configs were typed as the broader HTTP auth union and one captured URL remained optional.
   - Narrowed the fixtures to `OAuthMcpServerConfig` and made the capture definite.
   - GREEN: `npm run typecheck` exited 0.

## Final required verification

- `bun test packages/cli/test/runtime/mcp-oauth.test.ts packages/cli/test/runtime/mcp-oauth-callback.test.ts packages/cli/test/commands.test.ts packages/cli/test/e2e.test.ts`
  - Exit 0
  - 51 pass
  - 0 fail
  - 165 expectations
- `npm run typecheck`
  - Exit 0
  - `tsc --noEmit` completed without diagnostics

The full repository suite is run again immediately before commit and recorded in the task handoff.

## Implementation decisions

- Persisted each SDK credential object as a whole with `JSON.stringify`/`JSON.parse`; no field selection strips SDK extensions or issuer stamps.
- Used exact names `mcp:<server>:oauth:{tokens,client,verifier,discovery}` and never placed credential values in command results or stable error messages.
- Returned stored issuer-mismatched objects unchanged so the official SDK remains the sole issuer/resource validator.
- Implemented the official v2 `OAuthClientProvider` members directly. No custom token exchange, `skipIssuerMetadataValidation`, or `validateResourceURL` override was added.
- Reused Task 2's `OAuthAuthProviderFactory` and `createMcpTransport`; no Streamable HTTP transport/header/secret resolution logic was duplicated.
- Used a real local OAuth/MCP integration fixture to exercise SDK protected-resource discovery, authorization-server metadata validation, dynamic registration, PKCE exchange, refresh, and authenticated reconnect.
- Bound callback listeners only to `127.0.0.1`, used the exact callback path, compared decoded state buffers with `timingSafeEqual`, and kept fixed HTML independent of callback query data.
- Opened authorization URLs only for HTTPS or loopback hosts. Browser-launch failure prints the already-validated authorization URL once and continues waiting.
- Kept ordinary sessions non-interactive: valid access/refresh credentials are reused by the SDK; redirect requests retain no URL and surface `MCP_AUTH_REQUIRED`.
- Cleared transient verifier and dynamic registration created against callback port 0 when a non-interactive attempt reaches redirect, preventing stale redirect URI persistence before explicit auth.
- `mcp logout` validates config and deletes only the four local server-scoped entries; it performs no MCP or OAuth network operation.

## Security and error handling

- Malformed stored JSON throws `MCP_OAUTH_CREDENTIALS_INVALID` without including payload text or a raw parse cause.
- Missing PKCE verifier throws `MCP_OAUTH_VERIFIER_MISSING`.
- Callback failures use stable codes for state mismatch, access denial, timeout, and closed listeners.
- Callback response bodies never echo code, state, issuer, token, query string, or provider error descriptions.
- Authorization result and logout result contain only server ID and a boolean status.
- Existing Task 2 connection normalization remains in place; `MCP_AUTH_REQUIRED` is intentionally preserved rather than wrapped.

## Concerns

- The integration tests use a standards-shaped local OAuth/MCP fixture rather than a live third-party authorization server. Provider-specific deviations may still require interoperability testing against each configured service.
- No known Task 3 functional blocker remains.

## Fix round 1 — 2026-08-23

### Changes

- Moved interactive provider construction inside the authorization cleanup boundary so a callback created before missing pre-registered secret resolution is always closed.
- Kept the validated browser-launch fallback and redirected its single authorization URL message from stdout to stderr.
- Preserved `MCP_OAUTH_CREDENTIALS_INVALID`, in addition to `MCP_AUTH_REQUIRED`, when it originates during ordinary session connection. The original `RuntimeError` remains the thrown value.
- Rejected a matching-state callback that contains neither `code` nor `error` with `MCP_OAUTH_AUTHORIZATION_FAILED` and the fixed error page.

### TDD RED/GREEN evidence

1. Callback cleanup on provider-construction failure
   - RED: `bun test packages/cli/test/runtime/mcp-oauth.test.ts -t "closes the loopback callback"`
   - Result: exit 1, 0 pass, 1 fail; a fetch to the captured callback URL resolved, proving the listener remained open.
   - GREEN: the same command exited 0 with 1 pass, 0 fail, 3 expectations after provider construction entered the cleanup `try/finally`.

2. Browser fallback output channel
   - RED: `bun test packages/cli/test/runtime/mcp-oauth.test.ts -t "prints a safe authorization URL once to stderr"`
   - Result: exit 1, 0 pass, 1 fail; stdout contained the authorization URL while stderr was empty.
   - GREEN: the same command exited 0 with 1 pass, 0 fail, 6 expectations after changing the fallback to stderr.

3. Stable malformed-credential session error
   - RED: `bun test packages/cli/test/runtime/mcp-session.test.ts -t "preserves malformed OAuth credential errors"`
   - Result: exit 1, 0 pass, 1 fail; session creation returned `MCP_CONNECTION_FAILED` instead of `MCP_OAUTH_CREDENTIALS_INVALID`.
   - GREEN: the same command exited 0 with 1 pass, 0 fail, 1 expectation after preserving the original OAuth credential error.

4. Callback with neither authorization result field
   - RED: `bun test packages/cli/test/runtime/mcp-oauth-callback.test.ts -t "neither code nor error"`
   - Result: exit 1, 0 pass, 1 fail; the callback resolved with only the matching state.
   - GREEN: the same command exited 0 with 1 pass, 0 fail, 3 expectations after requiring a code when no OAuth error is present.

### Focused verification

- `bun test packages/cli/test/runtime/mcp-oauth.test.ts packages/cli/test/runtime/mcp-oauth-callback.test.ts packages/cli/test/commands.test.ts packages/cli/test/e2e.test.ts packages/cli/test/runtime/mcp-session.test.ts`
  - Exit 0
  - 72 pass
  - 0 fail
  - 205 expectations

### Final fix-round verification

- `npm test`
  - Exit 0
  - 216 pass
  - 0 fail
  - 507 expectations across 24 files
- `npm run typecheck`
  - Exit 0
  - `tsc --noEmit` completed without diagnostics
- `git diff --check`
  - Exit 0
  - No whitespace errors; Git emitted only the repository's LF-to-CRLF conversion warnings

The first post-change typecheck exposed two closure-narrowing diagnostics because the provider reference is optional for cleanup before construction but captured by transport factories after construction. A definite `activeProvider` local now supplies both factories while the optional reference remains solely for `finally`; the final typecheck above is GREEN.
