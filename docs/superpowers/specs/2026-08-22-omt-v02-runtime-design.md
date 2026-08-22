# Oh My Tool v0.2 Runtime Architecture Design

## Status

Approved scope: first v0.2 architecture slice, ending after native MySQL/Redis provider regression. MCP, JDK discovery, audit logging, and approval UI remain out of scope for this slice.

## Goal

Reposition Oh My Tool as an internal-first Agent Tool Runtime while preserving the existing Extension SDK and making the CLI a thin adapter over a provider-independent runtime.

## Non-goals

- Do not add a public `@oh-my-tool/runtime` package.
- Do not add a `Capability` class or interface.
- Do not implement MCP, JDK discovery, workflow, agent, GUI, daemon, marketplace, or approval UI features.
- Do not require changes to the independent `omt-mysql` or `omt-redis` extension contracts.

## Architecture

The CLI package owns an internal `ToolRuntime` under `packages/cli/src/runtime`. The runtime owns a `ToolRegistry`, a `ProviderRegistry`, schema validation, policy preflight, secret access, execution normalization, and the existing extension behavior. Providers expose normalized `ToolDescriptor` values and execute tools through a common `ToolProvider` contract.

The first provider is `NativeExtensionProvider`. It wraps the existing extension discovery, manifest, install, and dynamic loader modules. Search and describe read only static manifests and registry descriptors. Run resolves the provider, validates input, checks policy before loading secrets, dynamically loads the handler, and returns the existing result shape.

```text
CLI command -> ToolRuntime -> ToolRegistry -> ToolProvider
                                      |
                         NativeExtensionProvider
                                      |
                            Extension manifest/handler
```

## Public command contract

The canonical executable and commands are:

```text
ohmytool search "<intent>"
ohmytool describe <tool-id>
ohmytool run <tool-id> [key=value ...]
ohmytool run <tool-id> --stdin
```

The old `omt` binary and `call` command are removed from the default CLI contract. Help text, version output, bundled Agent Skill, tests, and examples use `ohmytool` and `run`.

## Filesystem paths and migration

All CLI state is derived from one `paths` module. The default home is `%USERPROFILE%\\.oh-my-tool` on Windows and `~/.oh-my-tool` elsewhere. `OH_MY_TOOL_HOME` is the supported override. The module exposes `home`, `config`, `extensions`, `integrations`, `cache`, and `audit` paths.

On setup, if the legacy `~/.omt` directory exists and the new home does not, known OMT state is copied into the new home. The legacy directory is never moved or deleted. The operation is repeatable and reports that the old directory was preserved.

## Runtime contracts

The runtime uses these internal contracts:

```ts
interface ToolDescriptor {
  id: string;
  description: string;
  keywords?: string[];
  risk: "read" | "write" | "admin";
  inputSchema?: Record<string, unknown>;
  provider: { id: string; kind: string };
}

interface ToolProvider {
  readonly id: string;
  readonly kind: string;
  listTools(): Promise<readonly ToolDescriptor[]>;
  getTool(toolId: string): Promise<ToolDescriptor | undefined>;
  execute(toolId: string, input: unknown, context: ExecutionContext): Promise<ToolResult>;
}

class ToolRuntime {
  search(query: string): Promise<ToolDescriptor[]>;
  describe(toolId: string): Promise<ToolDescriptor>;
  run(toolId: string, input: unknown): Promise<ExecutionResult>;
}
```

Tool IDs remain the existing manifest names such as `mysql.query` and `redis.get`. Native descriptors use `{ id: extensionId, kind: "native" }` as provider metadata. The registry rejects duplicate IDs with `DUPLICATE_TOOL_ID` before serving commands.

## Execution and security

The run pipeline is:

```text
resolve descriptor -> validate schema -> policy preflight -> load secrets
-> dynamic handler load -> execute -> normalize result
```

Search and describe must not dynamically import extension handlers, read secrets, connect to databases, or start processes. Policy decisions happen before secrets are accessed. Existing read-only MySQL policy remains intact; the normalized descriptor risk is the future provider-independent policy input.

## Compatibility and migration strategy

The implementation is incremental. Existing tests establish a baseline first. Core modules are moved or re-exported into `runtime` without changing behavior, then the runtime facade and provider contracts are introduced. CLI commands delegate to the facade, and old command-specific wiring is removed only after equivalent tests pass. Extension manifests and SDK types remain compatible with the independent MySQL and Redis repositories.

## Testing and gates

Each behavior change is introduced with a failing Bun test first. Required gates are:

- root SDK and CLI tests pass;
- `ohmytool --version`, `search`, `describe`, and `run` use the new names;
- path override and non-destructive legacy migration are tested;
- registry rejects duplicate tool IDs;
- search/describe do not load handlers;
- policy runs before secret access;
- fake native provider tests cover list, describe, and execute;
- `omt-mysql` and `omt-redis` install/manifest compatibility remains green.

