# Task 1 Report: Freeze the MCP Dependency and Configuration Contract

## Status

Completed. The Task 1 MCP dependency/configuration contract is implemented and committed.

## Changed files

- `packages/cli/package.json`
  - Preserved the existing exact `@modelcontextprotocol/client` `2.0.0` dependency.
  - Added exact `open` dependency `11.0.0`.
- `package-lock.json`
  - Locked the MCP client dependency tree and `open@11.0.0` dependency tree.
- `packages/cli/src/config/config.ts`
  - Added the MCP discriminated-union configuration types.
  - Added stdio and Streamable HTTP parsing with defaults for `enabled`, `namespace`, headers, environment maps, and OAuth dynamic registration.
  - Added strict MCP validation and stable `MCP_INVALID_CONFIG` errors.
  - Preserved existing extension parsing and missing-config behavior, now returning an empty MCP server map.
- `packages/cli/test/config.test.ts`
  - Added red/green tests for stdio, HTTP bearer, OAuth, dynamic OAuth defaults, and all 16 required validation cases.
- `packages/cli/test/policy.test.ts`
  - Added the empty MCP map to the existing typed `Config` fixture so the repository typecheck remains valid after making `Config.mcp` required.

The pre-existing untracked SDD plan file was not modified or staged.

## TDD evidence

1. Added the stdio test first and ran `bun test packages/cli/test/config.test.ts`; it failed because `cfg.mcp` was undefined.
2. Added the HTTP, OAuth, and validation tests and reran the focused suite; it failed because MCP parsing/validation was absent. The first validation assertion also exposed that this Bun version does not provide `toThrowObject`; the test was corrected to capture and match the thrown error.
3. Implemented the smallest parser/validator needed by the tests.
4. The focused suite then passed: `24 pass, 0 fail`.

## Verification commands and outputs

- `npm install --workspace=@oh-my-tool/cli --save-exact open@11.0.0`
  - Passed after one sandbox cache miss was retried with approved registry access: added 12 packages and changed 13 packages.
- `bun test packages/cli/test/config.test.ts`
  - `24 pass, 0 fail`.
- `npm run typecheck`
  - Passed with exit code 0.
- `bun test`
  - `157 pass, 0 fail`, `320 expect() calls`.
- `git diff --check`
  - Passed with no whitespace errors.

## Decisions

- `Config.mcp` is required and always returned as `{ servers: {} }`, including for a missing config file, matching the brief’s interface and compatibility requirement.
- MCP names accept letters, numbers, underscores, and hyphens, must start with an alphanumeric character, and reserve `native` and `mcp` namespaces.
- HTTP URLs are restricted to `http:` and `https:` protocols.
- Secret values are retained as references in the parsed config, while validation errors contain only paths and safe reason text.
- OAuth defaults to dynamic registration (`scopes: []`, `callbackPort: 0`, `tokenEndpointAuthMethod: "none"`) and enforces the client-secret/auth-method relationships from the brief.

## Concerns

- `open@11.0.0` is required by the brief but is not used until a later integration task.
- The repository’s npm registry is configured as `registry.npmmirror.com`; the initial install was blocked by the sandbox’s cache-only network mode and succeeded after approved registry access.
