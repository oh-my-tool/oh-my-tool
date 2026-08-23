# Task 2 Report: Transport-Neutral MCP Session Adapter

## Changed files

- `packages/cli/src/runtime/providers/mcp/session.ts` — session lifecycle adapter, injectable MCP client factory, safe connection/request error wrappers, and idempotent close.
- `packages/cli/src/runtime/providers/mcp/transport.ts` — stdio and Streamable HTTP transport construction, pre-connect secret resolution, bearer auth provider, and injected OAuth auth-provider boundary.
- `packages/cli/test/runtime/mcp-session.test.ts` — focused adapter tests with fake MCP client and transport constructors.
- `.superpowers/sdd/2026-08-23-omt-v03-mcp-provider-integration/task-2-report.md` — this report.

`packages/cli/src/runtime/errors.ts` was reviewed and already provided the required `RuntimeError` with stable `code` support, so no change was needed.

## TDD evidence

1. Wrote `mcp-session.test.ts` before creating either production adapter module. It specifies lifecycle delegation, idempotent close, stdio and HTTP secret placement, bearer and OAuth auth, missing-secret failures, and redaction.
2. Ran `bun test packages/cli/test/runtime/mcp-session.test.ts` before implementation. It failed as expected with `Cannot find module '../../src/runtime/providers/mcp/session'` and reported `0 pass, 1 fail, 1 error`.
3. Added the minimum session and transport implementation to make the specified behavior pass.
4. A first typecheck exposed only static type-narrowing issues around nested HTTP auth discriminants and test fake transports. These were corrected without changing the specified runtime behavior.
5. Re-ran focused tests and typecheck after the refactor; both pass below.

## Exact verification commands and results

```powershell
bun test packages/cli/test/runtime/mcp-session.test.ts
```

Result: `8 pass`, `0 fail`, `16 expect() calls`.

```powershell
npm run typecheck
```

Result: exited `0` (`tsc --noEmit`).

```powershell
git diff --check
```

Result: exited `0` with no whitespace errors.

## Decisions

- The session injects a narrow `McpClient` factory and delegates transport setup to `createMcpTransport`, allowing tests to avoid processes and sockets.
- OAuth is represented by `OAuthAuthProviderFactory`, which returns the MCP SDK `AuthProvider`. Task 2 does not import or implement `OAuthClientProvider`; Task 3 can supply it through this boundary.
- Stdio secret environment variables and HTTP secret headers are resolved only during transport construction. Their plaintext values are not written to config objects.
- Missing stdio, bearer, and secret-header values fail before `client.connect()` with `MCP_SECRET_NOT_FOUND`.
- Connection and request messages redact all values resolved for the connection while retaining the stable server ID, operation, SDK error code, and error message.

## Concerns

- The CLI package currently exposes version `0.2.0`; the default client factory therefore uses `0.2.0`. A future release-version centralization can replace that local value.
- There is no logger injection point in Task 2's supplied interface. The stdio transport is configured with `stderr: "pipe"` as required; a later logger-aware integration should attach a drain/listener without parsing protocol stdout.

## Fix round 1 (review findings)

### Changes

- `RuntimeError` now accepts an optional original cause using the platform `Error` cause field. Normalized MCP setup, connect, list, and call errors retain their causes without including a cause chain in their normal messages.
- `createMcpSession` now preserves `MCP_SECRET_NOT_FOUND`, normalizes other transport/OAuth setup failures to `MCP_CONNECTION_FAILED`, and closes an already-created transport if `client.connect()` fails. Literal stdio environment and HTTP header values are included in the redaction set along with resolved secret values.
- MCP config rejects `Authorization` (case-insensitive) in either header map when bearer or OAuth authentication is selected. The transport also defends the same rule for programmatic configs that bypass parsing.
- The MCP client default now uses `VERSION` from `packages/cli/src/version.ts`; runtime transport values outside stdio and streamable HTTP reject with `MCP_UNSUPPORTED_TRANSPORT` instead of falling through to HTTP handling.

### TDD evidence

1. Added focused tests for setup error normalization/cause retention/literal redaction, no connection on missing secrets, transport cleanup after connect failure, runtime Authorization rejection, unsupported runtime transports, and OAuth config Authorization rejection.
2. RED commands:

   ```powershell
   bun test packages/cli/test/runtime/mcp-session.test.ts
   bun test packages/cli/test/config.test.ts
   ```

   Result before production changes: MCP-session `9 pass, 4 fail`; config `28 pass, 1 fail`. Failures showed raw setup errors, no transport close, forwarded Authorization headers, unsupported transport falling into HTTP resolution, and OAuth Authorization configuration being accepted.
3. For the new fake-SDK literal-header regression, temporarily removed configured literal values from the session redaction set and ran:

   ```powershell
   bun test packages/cli/test/runtime/mcp-session.test.ts --test-name-pattern "redacts literal configured header values"
   ```

   Result: `0 pass, 1 fail`; the received `MCP_CONNECTION_FAILED` message contained `literal-header-value`. Restoring the configured-value redaction made the test pass.
4. GREEN verification:

   ```powershell
   bun test packages/cli/test/runtime/mcp-session.test.ts
   bun test packages/cli/test/config.test.ts
   npm run typecheck
   git diff --check
   ```

   Result: session `14 pass, 0 fail`; config `29 pass, 0 fail`; typecheck exited `0`; diff check exited `0` (only line-ending warnings).

## Fix round 2 (review findings)

### Changes

- `createMcpSession` now normalizes `createClient()` failures to `MCP_CONNECTION_FAILED` while retaining the original error as the non-enumerable `cause`.
- Session-side configured-value collection tolerates malformed runtime transport objects, so it cannot mask the original setup failure with a `TypeError`.
- HTTP transport setup wraps only post-secret-resolution setup failures in `McpTransportSetupError`, carrying the resolved values back to the session for redaction. The session unwraps the original cause before creating its `RuntimeError`; `MCP_SECRET_NOT_FOUND` continues to pass through unchanged.
- Normalized error messages and JSON serialization redact resolved bearer and secret-header values; the original raw error remains available only through `RuntimeError.cause`.

### TDD evidence

1. Added focused session tests for client-factory normalization, malformed runtime transport handling, and bearer/secret-header setup redaction (including serialized normal output).
2. RED command:

   ```powershell
   bun test packages/cli/test/runtime/mcp-session.test.ts
   ```

   Result before production changes: `14 pass, 3 fail`. The failures were the raw client-construction error, a masking `Object.values` `TypeError`, and a connection error exposing both resolved HTTP values.
3. GREEN command:

   ```powershell
   bun test packages/cli/test/runtime/mcp-session.test.ts
   ```

   Result: `17 pass, 0 fail`, `30 expect() calls`.

## Fix round 3 (review finding)

### Change

- Stdio transport construction now mirrors the existing HTTP setup-error boundary. After `secretEnv` values resolve, a synchronous `createStdioTransport()` failure is wrapped in `McpTransportSetupError` with those resolved values. The session therefore emits normalized `MCP_CONNECTION_FAILED` output with the values redacted while preserving the original raw exception as `RuntimeError.cause`.
- Secret resolution remains outside this new boundary, so `MCP_SECRET_NOT_FOUND` still passes through unchanged.

### TDD evidence

1. Added a focused session regression using the real `createMcpTransport` path and a fake stdio constructor that throws a message containing `resolved-stdio-token`.
2. RED: `bun test packages/cli/test/runtime/mcp-session.test.ts --test-name-pattern "redacts resolved stdio environment values from transport setup errors"` returned `0 pass, 1 fail`; the received `MCP_CONNECTION_FAILED` message exposed `resolved-stdio-token`.
3. GREEN: the same focused test returned `1 pass, 0 fail`, confirming output and JSON serialization omit the resolved token while `cause` is the original error.

### Final verification

`bun test packages/cli/test/runtime/mcp-session.test.ts` returned `18 pass, 0 fail`; `bun test packages/cli/test/config.test.ts` returned `29 pass, 0 fail`; `npm run typecheck` exited `0`; `git diff --check` exited `0` with no whitespace errors.
