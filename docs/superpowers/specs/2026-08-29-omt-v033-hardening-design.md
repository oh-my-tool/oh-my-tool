# OMT v0.3.3 Core Hardening Design

**Status:** Approved in chat; pending written-spec review

**Goal:** Make Core provider- and connection-generic, isolate unavailable MCP providers, make the runtime execution model the only execution model, and release the breaking v0.3.3 contract.

## Scope

v0.3.3 is a deliberate breaking release for the early-stage project. It updates the main `oh-my-tool` repository and the `omt-mysql` and `omt-redis` extension repositories so that all shipped native extensions consume the same generic connection contract.

The release includes:

- generic `settings` and `secrets` connection records;
- extension-declared `connectionSchema` validation;
- extension-declared connection check tools;
- isolated and lazy MCP discovery with unavailable-provider reporting;
- one runtime registry, executor, result model, and schema validator;
- cached native extension discovery and tool routing;
- bounded, filtered, exact/prefix-aware runtime search;
- release/version/documentation cleanup.

The release does not include Kafka, SQLite, PostgreSQL, persistent cross-process MCP descriptor caching, semantic search, MCP resources/prompts, or v0.4 governance.

## Breaking Contract

### Generic connections

Core owns this shape only:

```ts
interface ConnectionConfig {
  environment?: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
}
```

The old fields `host`, `port`, `database`, `username`, `secret`, and `tls` are invalid configuration fields in v0.3.3. Core does not assign protocol-specific defaults such as port 3306 or 6379.

The canonical TOML shape is:

```toml
[extensions.kafka.connections.prod]
environment = "prod"

[extensions.kafka.connections.prod.settings]
brokers = ["kafka01:9092", "kafka02:9092"]
clientId = "ohmytool"

[extensions.kafka.connections.prod.secrets]
password = "kafka:prod:password"
```

`settings` values are non-secret extension configuration. `secrets` values are secret-store references; neither secret names nor secret values are printed by diagnostics. The extension receives the selected connection config through `ToolContext.config` and resolves referenced values through `ToolContext.secrets`.

### Manifest metadata

The SDK `ExtensionManifest` adds:

```ts
connectionSchema?: Record<string, unknown>;
connectionCheckTool?: string;
```

`connectionSchema` validates a connection's `settings` object. The schema is optional for extensions with no structured connection requirements. Manifest validation requires the schema to be an object when present.

`connectionCheckTool`, when present, must name a declared tool in the same extension, use the extension prefix, and have read risk. Core never guesses `${extension}.ping`. A connection without a declared check tool is reported as `unsupported`.

The API compatibility version advances to `0.2.0` because `ToolContext.config` changes shape. Existing extensions declaring the old API range are incompatible and are not loaded.

## Runtime Architecture

### Single execution model

`packages/cli/src/runtime` is the only execution boundary:

- `runtime/executor.ts` owns input validation, policy preflight, context creation, provider execution, and normalized execution results;
- `runtime/result.ts` owns the discriminated result type used by runtime and CLI;
- `runtime/tool-registry.ts` owns descriptor registration and search;
- `runtime/provider-registry.ts` owns provider lookup;
- `runtime/schema.ts` owns input and connection-schema validation.

The old `src/core/registry.ts`, `src/core/executor.ts`, `src/core/result.ts`, and `src/core/schema.ts` are removed after all production imports and tests are migrated. `run.ts` and `output.ts` consume the runtime result directly; there is no `tool/data` to `toolId/output` conversion layer. Extension loading imports `RuntimeError` from the runtime package. The old standalone manifest search module is removed so search also has one implementation.

### MCP discovery lifecycle

`createToolRuntime()` registers providers without making an MCP server failure fatal to the runtime. Provider discovery is lazy:

- native target execution can skip MCP discovery;
- search discovers all configured providers concurrently and isolates each MCP failure;
- describe/run discover only the providers needed to resolve the target, with a fallback full lookup for unknown namespaces;
- each provider caches descriptors and execution routes for its runtime lifetime;
- failed MCP providers are closed and recorded as unavailable;
- runtime close attempts every provider close operation and remains idempotent.

Runtime exposes provider status records with provider id, kind, availability, and a stable redacted error code/message. Search results keep the existing array of tool descriptors and add unavailable-provider metadata at the command result boundary. A direct execution whose target provider is known to be unavailable returns `PROVIDER_UNAVAILABLE`.

Native discovery errors remain fatal because the local provider is a required runtime foundation. MCP descriptor identity and duplicate-tool checks remain enforced before a descriptor becomes executable.

### Native route cache

`NativeExtensionProvider` owns one cached discovery snapshot per provider instance. The snapshot contains installed extensions and a `toolId -> InstalledExtension` route map. `listTools()`, `execute()`, and native-target detection all reuse the snapshot. Cache lifetime is one runtime; no filesystem watcher or persistent cache is introduced.

## Connection Validation and Diagnostics

The TOML parser validates only generic structure:

- connection values must be tables;
- `environment`, when present, is a string;
- `settings` and `secrets`, when present, are tables;
- secret references are strings;
- legacy protocol-specific top-level fields are rejected;
- unknown top-level connection fields are rejected.

Installed extension manifests are loaded for `config check` and runtime startup. For an extension with `connectionSchema`, Core validates each `settings` record using the runtime schema validator and reports the extension/connection path on failure.

`connection list` returns deterministic summaries containing extension id, connection name, optional environment, sanitized settings, and secret configured booleans keyed by secret field. It never returns secret references or values. `connection check` invokes only the manifest-declared read-only check tool, passes the configured connection name, runs checks with bounded concurrency, and maps missing declarations to `CHECK_UNSUPPORTED`.

Policy continues to forbid agent-provided credentials. In the generic model it rejects `settings`, `secrets`, and known credential aliases in tool input while allowing protocol-specific non-credential tool parameters.

MySQL and Redis are updated to read `settings` for endpoint/protocol options and `secrets` for secret references. Their manifests declare connection schemas and their supported check tools.

## Search Contract

Runtime search accepts:

```ts
interface ToolSearchOptions {
  limit?: number;
  provider?: string;
  source?: string;
  risk?: "read" | "write" | "admin";
}
```

Scores prefer exact matches, then prefixes, then substrings, with name/id matches ranked above keywords and descriptions. Results use deterministic tie-breaking by tool id. Limits are bounded to prevent unbounded output. CLI search exposes `--limit`, `--provider`, `--source`, and `--risk` while retaining the existing default query behavior.

## Error Handling and Security

- Configuration errors use `CONFIG_INVALID` with a stable path and never include secret references or values.
- Schema errors use `INVALID_INPUT`.
- MCP discovery failures are isolated, redacted, and surfaced as provider status.
- Provider execution failures retain stable runtime error codes.
- Diagnostics and serialized output use the existing safe JSON replacer for BigInt, Date/Buffer-like values, circular values, and unserializable values.
- Search and connection summaries remain deterministic.

## Testing Strategy

Tests are written first and observed failing for each production behavior. Coverage must include:

- generic connection parsing, rejection of every legacy field, schema validation, and secret redaction;
- manifest connection metadata validation and API compatibility rejection;
- MySQL/Redis generic-config execution and connection checks;
- runtime-only imports and absence of `src/core` execution modules;
- runtime executor result shape with no CLI conversion;
- isolated MCP discovery failure, lazy target behavior, unavailable metadata, and close behavior;
- one-scan native discovery and cached execute routes;
- search exact/prefix scoring, limit, provider/source/risk filters, and stable ordering;
- CLI help/documentation/version assertions.

Before release, run the main repository typecheck, test suite, package dry-run, and the full check suites in both extension repositories. Run `git diff --check` and inspect all changed files. Publishing and tagging are outside implementation until all release gates are green.

