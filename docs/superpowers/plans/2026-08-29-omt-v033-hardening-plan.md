# OMT v0.3.3 Core Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the breaking v0.3.3 contract with generic connections, isolated lazy MCP discovery, one runtime execution model, cached native routing, and bounded filtered search across Core, MySQL, and Redis.

**Architecture:** The SDK declares generic connection and manifest metadata contracts. CLI Core parses only generic records, validates extension-owned settings schemas, and routes all execution through `ToolRuntime`; MCP providers discover independently and report unavailable state. Native extensions consume `settings` and `secrets`, while their manifests declare connection schemas and explicit read-only check tools.

**Tech Stack:** TypeScript, Bun 1.4+, Bun test, npm workspaces, TOML configuration, JSON-schema-like runtime validation, native MySQL and Redis clients.

**Spec:** `docs/superpowers/specs/2026-08-29-omt-v033-hardening-design.md`

## Global Constraints

- v0.3.3 is a deliberate breaking release; old flat connection fields are rejected.
- Core owns only `environment?`, `settings: Record<string, unknown>`, and `secrets: Record<string, string>` for connections.
- `connectionSchema` validates extension settings; Core never assigns protocol-specific default ports.
- `connectionCheckTool` is explicit; Core never guesses `${extension}.ping`.
- `packages/cli/src/runtime` is the only execution boundary; no CLI result conversion layer remains.
- MCP discovery failures are isolated and redacted; native discovery failures remain fatal.
- Agent input selects configured connection names only and cannot supply connection credentials or settings.
- Search results are bounded, filtered, deterministically ordered, and support exact/prefix boosts.
- Secret references and secret values are never emitted by diagnostics, errors, audit output, or JSON output.
- Every behavior change follows a test-first red-green-refactor cycle and the full checks run before completion.

---

### Task 1: SDK contract, API compatibility, and generic Core configuration

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/cli/src/extension/manifest.ts`
- Modify: `packages/cli/src/config/config.ts`
- Modify: `packages/cli/src/policy/policy.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Test: `packages/cli/test/config.test.ts`, `packages/cli/test/manifest.test.ts`, `packages/cli/test/policy.test.ts`, `packages/cli/test/helpers.ts`, and every manifest fixture that declares `sdkVersion`

**Interfaces:**
- Produces `ConnectionConfig { environment?: string; settings: Record<string, unknown>; secrets: Record<string, string> }`.
- Produces manifest fields `connectionSchema?: Record<string, unknown>` and `connectionCheckTool?: string`.
- Produces `validateConfiguredConnections(config, installedExtensions): void` for config check and runtime startup.
- Consumes `validateInput(schema, input)` from `packages/cli/src/runtime/schema.ts`.

- [ ] **Step 1: Write failing tests for the breaking generic connection contract**

Add tests with these assertions:

```ts
test("loads generic settings and secret references", () => {
  writeFileSync(join(home, "config.toml"), `
[extensions.kafka.connections.prod]
environment = "prod"
[extensions.kafka.connections.prod.settings]
brokers = ["kafka01:9092", "kafka02:9092"]
clientId = "ohmytool"
[extensions.kafka.connections.prod.secrets]
password = "kafka:prod:password"
`, "utf8");
  expect(loadConfig(home).extensions.kafka.connections.prod).toEqual({
    environment: "prod",
    settings: { brokers: ["kafka01:9092", "kafka02:9092"], clientId: "ohmytool" },
    secrets: { password: "kafka:prod:password" },
  });
});

test("rejects legacy connection fields without compatibility conversion", () => {
  writeFileSync(join(home, "config.toml"), `[extensions.mysql.connections.prod]\nhost = "mysql"\n`, "utf8");
  expect(() => loadConfig(home)).toThrow(expect.objectContaining({ code: "CONFIG_INVALID" }));
});

test("validates settings with the installed extension connection schema", () => {
  const config = loadConfig(home);
  const extension = { id: "kafka", manifest: { connectionSchema: {
    type: "object", required: ["brokers"], properties: { brokers: { type: "array" } },
  } } } as any;
  expect(() => validateConfiguredConnections(config, [extension])).toThrow(/brokers/);
});
```

- [ ] **Step 2: Run the focused tests and verify the expected RED failures**

Run: `bun test packages/cli/test/config.test.ts packages/cli/test/manifest.test.ts packages/cli/test/policy.test.ts`

Expected: FAIL because the parser still requires host/port fields, the manifest has no connection metadata, and the validator is not defined.

- [ ] **Step 3: Implement the minimal generic parser and manifest validation**

Change the parser to accept only `environment`, `settings`, and `secrets`, reject all other keys, require table shapes, and validate secret references as strings. Add schema-object validation and `connectionCheckTool` validation to `validateManifest`. Set `OMT_API_VERSION` to `"0.2.0"`, update `packages/cli/test/helpers.ts` and every checked-in manifest fixture to use `sdkVersion: "^0.2.0"`, and update extension discovery tests to reject `^0.1.0`. Implement `validateConfiguredConnections` by looking up each installed extension manifest and validating its `connectionSchema` against the connection `settings` object.

- [ ] **Step 4: Update policy and execution context for generic connections**

Make `validateConnectionInput` reject `settings`, `secrets`, `host`, `port`, `database`, `username`, `password`, `secret`, and `tls` in agent input, while still requiring a configured `connection` name. Pass the selected generic connection to extensions and pass sanitized generic connection collections to connection-free tools.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `bun test packages/cli/test/config.test.ts packages/cli/test/manifest.test.ts packages/cli/test/policy.test.ts`

Expected: PASS, including explicit rejection of all legacy fields and validation of connection settings.

- [ ] **Step 6: Commit the configuration contract**

Run: `git add packages/sdk/src/index.ts packages/cli/src/extension/manifest.ts packages/cli/src/config/config.ts packages/cli/src/policy/policy.ts packages/cli/src/cli/context.ts packages/cli/test/config.test.ts packages/cli/test/manifest.test.ts packages/cli/test/policy.test.ts && git commit -m "feat: make connections generic"`

### Task 2: Unify runtime and legacy executor/registry/result/schema

**Files:**
- Modify: `packages/cli/src/runtime/result.ts`
- Modify: `packages/cli/src/runtime/executor.ts`
- Modify: `packages/cli/src/runtime/errors.ts`
- Modify: `packages/cli/src/extension/loader.ts`
- Modify: `packages/cli/src/cli/commands/run.ts`
- Modify: `packages/cli/src/cli/output.ts`
- Modify: `packages/cli/test/runtime/executor.test.ts`, `packages/cli/test/output.test.ts`, `packages/cli/test/e2e.test.ts`
- Delete: `packages/cli/src/core/executor.ts`, `packages/cli/src/core/registry.ts`, `packages/cli/src/core/result.ts`, `packages/cli/src/core/schema.ts`
- Delete or migrate: `packages/cli/src/search/search.ts`
- Delete or migrate: `packages/cli/test/executor.test.ts`, `packages/cli/test/discovery.test.ts`, `packages/cli/test/schema.test.ts`, `packages/cli/test/search.test.ts`

**Interfaces:**
- Produces one `ExecutionResult` discriminated union with `toolId`, `output`, `meta`, and normalized `error`.
- Produces one `executeRuntimeTool(deps, rawInput): Promise<ExecutionResult>` used by every CLI command.
- Consumes `ToolRuntime.run()` and `ToolRegistry`/`ProviderRegistry`.

- [ ] **Step 1: Write failing tests proving CLI uses the runtime result directly**

Add a source-boundary test and runtime result assertions:

```ts
test("CLI execution result uses runtime toolId/output fields without legacy conversion", async () => {
  const source = await Bun.file(new URL("../src/cli/commands/run.ts", import.meta.url)).text();
  expect(source).not.toContain("../../core/result");
  expect(source).not.toContain("tool: toolName");
  expect(source).toContain("runtime.run");
});

test("runtime execution returns the single result contract", async () => {
  const result = await executeRuntimeTool(deps, { value: "hello" });
  expect(result).toEqual({ ok: true, toolId: "test.echo", output: { value: "hello" }, meta: {} });
});
```

- [ ] **Step 2: Run the focused tests and verify the expected RED failures**

Run: `bun test packages/cli/test/runtime/executor.test.ts packages/cli/test/output.test.ts packages/cli/test/e2e.test.ts`

Expected: FAIL because `run.ts` and `output.ts` still import legacy result types and return `tool/data`.

- [ ] **Step 3: Migrate all production imports to runtime types**

Make `runTool` return `Promise<ExecutionResult>` and return `runtime.run()` directly. Update output formatters and CLI wrappers to use `toolId` and `output`. Move any needed legacy error alias to `runtime/errors.ts`, update `extension/loader.ts`, and remove the old core files only after imports are gone.

- [ ] **Step 4: Migrate tests and remove duplicate search implementation**

Move old registry/executor assertions to runtime registry/runtime executor tests. Replace standalone manifest search tests with `ToolRegistry.search()` tests. Add a repository source scan asserting no file under `packages/cli/src` imports `src/core` and no `packages/cli/src/core` directory exists.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `bun test packages/cli/test/runtime packages/cli/test/output.test.ts packages/cli/test/e2e.test.ts`

Expected: PASS with no `tool/data` conversion and no legacy Core imports.

- [ ] **Step 6: Commit the unified runtime execution model**

Run: `git add packages/cli/src packages/cli/test && git commit -m "refactor: make runtime the only execution model"`

### Task 3: Lazy and isolated MCP provider discovery

**Files:**
- Modify: `packages/cli/src/runtime/provider.ts`
- Modify: `packages/cli/src/runtime/provider-registry.ts`
- Modify: `packages/cli/src/runtime/runtime.ts`
- Modify: `packages/cli/src/runtime/providers/mcp/provider.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Modify: `packages/cli/src/cli/commands/search.ts`
- Test: `packages/cli/test/runtime/runtime.test.ts`, `packages/cli/test/runtime/mcp-provider.test.ts`, `packages/cli/test/runtime/mcp-http.test.ts`, `packages/cli/test/e2e.test.ts`

**Interfaces:**
- Produces `ProviderStatus { id: string; kind: string; status: "available" | "unavailable"; code?: string; message?: string }`.
- Produces `ToolRuntime.search(query: string, options?: ToolSearchOptions): Promise<ToolSearchResult[]>` and `ToolRuntime.providerStatuses(): readonly ProviderStatus[]`.
- Consumes existing `McpProvider.listTools/execute/close` and `NativeExtensionProvider`.

- [ ] **Step 1: Write failing MCP isolation and lazy discovery tests**

Add tests with these behaviors. The test file must define `failingMcp` with `listTools() { throw new Error("BROKEN_DISCOVERY") }`, `healthyMcp` with one valid descriptor, and `mcpWithDiscoveryCounter` whose `listTools()` increments a counter before returning an empty descriptor list:

```ts
test("keeps native tools available when one MCP provider discovery fails", async () => {
  const runtime = await createToolRuntime({ ...options, providers: [nativeProvider, failingMcp, healthyMcp] });
  expect((await runtime.search("echo")).map((tool) => tool.id)).toContain("test.echo");
  expect(runtime.providerStatuses()).toContainEqual(expect.objectContaining({ id: "mcp:broken", status: "unavailable" }));
});

test("does not discover MCP providers for a native target", async () => {
  const runtime = await createToolRuntime({ ...options, providers: [nativeProvider, mcpWithDiscoveryCounter] });
  await runtime.run("test.echo", {});
  expect(mcpDiscoveryCounter).toBe(0);
});
```

- [ ] **Step 2: Run the focused MCP tests and verify the expected RED failures**

Run: `bun test packages/cli/test/runtime/runtime.test.ts packages/cli/test/runtime/mcp-provider.test.ts packages/cli/test/runtime/mcp-http.test.ts`

Expected: FAIL because runtime creation currently awaits every provider listTools call and has no provider status API.

- [ ] **Step 3: Implement provider status and per-provider discovery**

Register providers without eagerly discovering MCP descriptors. Add a provider discovery state machine that caches success, records an unavailable MCP failure with a redacted stable code/message, closes the failed provider, and continues other providers. Search concurrently discovers all providers; native-target run/describe resolves native first and skips MCP; MCP targets discover the relevant namespace and return `PROVIDER_UNAVAILABLE` when its provider is unavailable.

- [ ] **Step 4: Preserve descriptor identity, route caching, and idempotent close**

Keep duplicate descriptor and provider identity checks. Ensure each successful MCP provider retains descriptors/routes for the runtime lifetime and `close()` attempts every provider exactly once, including providers that failed discovery.

- [ ] **Step 5: Run the focused MCP tests and verify GREEN**

Run: `bun test packages/cli/test/runtime/runtime.test.ts packages/cli/test/runtime/mcp-provider.test.ts packages/cli/test/runtime/mcp-http.test.ts packages/cli/test/e2e.test.ts`

Expected: PASS with healthy tools returned alongside unavailable-provider metadata and no MCP connection for native target execution.

- [ ] **Step 6: Commit MCP isolation**

Run: `git add packages/cli/src/runtime packages/cli/src/cli/context.ts packages/cli/src/cli/commands/search.ts packages/cli/test/runtime packages/cli/test/e2e.test.ts && git commit -m "feat: isolate MCP provider discovery"`

### Task 4: Native route cache, connection diagnostics, and search filters

**Files:**
- Modify: `packages/cli/src/runtime/providers/native/provider.ts`
- Modify: `packages/cli/src/runtime/tool-registry.ts`
- Modify: `packages/cli/src/cli/commands/connections.ts`
- Modify: `packages/cli/src/cli/commands/search.ts`
- Modify: `packages/cli/src/cli/parseArgs.ts`
- Modify: `packages/cli/src/cli/index.ts`
- Test: `packages/cli/test/runtime/native-provider.test.ts`, `packages/cli/test/runtime/registry.test.ts`, `packages/cli/test/search.test.ts`, `packages/cli/test/commands.test.ts`, `packages/cli/test/e2e.test.ts`

**Interfaces:**
- Produces `ToolSearchOptions { limit?: number; provider?: string; source?: string; risk?: "read" | "write" | "admin" }`.
- Produces manifest-driven `connection list` and `connection check` results using generic sanitized settings.
- Produces one cached native `toolId -> InstalledExtension` route map reused by list, execute, and native target detection.

- [ ] **Step 1: Write failing tests for cache, search, and diagnostics**

Add tests such as. Inject the existing discovery function into `NativeExtensionProvider` through a constructor argument so the test can count calls without changing filesystem behavior:

```ts
test("native execute reuses the discovery snapshot", async () => {
  const provider = new NativeExtensionProvider(home);
  await provider.listTools();
  await provider.execute("test.echo", {}, context);
  expect(discoveryCalls).toBe(1);
});

test("search applies exact/prefix ranking and filters", () => {
  const results = registry.search("mysql", { limit: 1, risk: "read", source: "mysql" });
  expect(results).toHaveLength(1);
  expect(results[0].id).toBe("mysql.query");
});

test("connection check uses a declared check tool and generic summaries", async () => {
  const result = await runConnectionCheck();
  expect(result.checks[0]).toMatchObject({ extension: "mysql", status: "ok" });
  expect(JSON.stringify(await runConnectionList())).not.toContain("mysql:prod");
});
```

- [ ] **Step 2: Run focused tests and verify the expected RED failures**

Run: `bun test packages/cli/test/runtime/native-provider.test.ts packages/cli/test/runtime/registry.test.ts packages/cli/test/search.test.ts packages/cli/test/commands.test.ts packages/cli/test/e2e.test.ts`

Expected: FAIL because native execute rescans, search has no options, and connection diagnostics still read host/port/database fields and assume `${extension}.ping`.

- [ ] **Step 3: Implement the native snapshot and runtime search contract**

Cache `discoverExtensions(home)` and a route map inside `NativeExtensionProvider`. Add exact, prefix, substring, keyword, and description scores with deterministic id tie-breaking, apply provider/source/risk filters, and clamp a positive limit to a fixed maximum. Add CLI parsing for `--limit`, `--provider`, `--source`, and `--risk`.

- [ ] **Step 4: Implement manifest-driven generic connection diagnostics**

Sanitize settings values without secret references; expose only secret field configured booleans. Load installed manifests, use `connectionCheckTool` when present, return `CHECK_UNSUPPORTED` otherwise, and execute checks with bounded concurrency. Update `config check` to validate installed extension connection schemas.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `bun test packages/cli/test/runtime/native-provider.test.ts packages/cli/test/runtime/registry.test.ts packages/cli/test/search.test.ts packages/cli/test/commands.test.ts packages/cli/test/e2e.test.ts`

Expected: PASS with one native discovery scan, deterministic filtered search, generic redacted listings, and explicit check-tool behavior.

- [ ] **Step 6: Commit native/search/diagnostics changes**

Run: `git add packages/cli/src packages/cli/test && git commit -m "feat: cache native routes and filter search"`

### Task 5: Migrate the MySQL extension to generic connections

**Files:**
- Modify: `../omt-mysql/src/client.ts`
- Modify: `../omt-mysql/src/instances.ts`
- Modify: `../omt-mysql/src/execute.ts`
- Modify: `../omt-mysql/src/query.ts`
- Modify: `../omt-mysql/src/schema.ts`
- Modify: `../omt-mysql/src/readonly.ts`
- Modify: `../omt-mysql/src/index.ts`
- Modify: `../omt-mysql/omt.manifest.json`
- Modify: `../omt-mysql/README.md`
- Modify: `../omt-mysql/package.json`, `../omt-mysql/package-lock.json`
- Test: `../omt-mysql/test/mysql.test.ts`

**Interfaces:**
- Produces MySQL `ConnectionLike` fields read from `ctx.config.settings` and password reference read from `ctx.config.secrets`.
- Produces manifest `connectionSchema` and `connectionCheckTool: "mysql.ping"` with `sdkVersion: "^0.2.0"`.

- [ ] **Step 1: Write failing generic-config extension tests**

Update the injected client factory test to call the handler with:

```ts
const ctx = {
  config: {
    environment: "prod",
    settings: { host: "mysql.test", port: 3306, database: "iot", username: "reader", tls: true },
    secrets: { password: "mysql:prod:password" },
  },
  secrets: memoryStore({ "mysql:prod:password": "pw" }),
  logger: noopLogger,
};
```

Assert that the factory receives the settings and resolved password, and that `mysql.instances` returns sanitized generic settings without the secret reference.

- [ ] **Step 2: Run the MySQL tests and verify the expected RED failures**

Run from `../omt-mysql`: `bun test test/mysql.test.ts`

Expected: FAIL because the extension currently reads top-level `host`, `port`, `database`, `username`, `tls`, and `secret` fields.

- [ ] **Step 3: Implement generic settings/secrets access**

Add typed helpers that require `ctx.config.settings`, resolve the configured password reference through `ctx.config.secrets.password` and `ctx.secrets.get`, and pass the resulting protocol config to the client. Update instances, schema, query, execute, and readonly paths without adding Core-specific defaults.

- [ ] **Step 4: Add manifest schema/check metadata and update docs/package versions**

Declare the MySQL settings schema, `connectionCheckTool`, `sdkVersion: "^0.2.0"`, and version `0.3.3`. Document the new TOML shape and the breaking migration.

- [ ] **Step 5: Run MySQL tests and verify GREEN**

Run from `../omt-mysql`: `npm run build && bun test test/mysql.test.ts && npm pack --dry-run`

Expected: PASS with the built extension consuming only generic connection data.

- [ ] **Step 6: Commit the MySQL migration**

Run from `../omt-mysql`: `git add src test omt.manifest.json README.md package.json package-lock.json dist && git commit -m "feat: migrate mysql to generic connections"`

### Task 6: Migrate the Redis extension to generic connections

**Files:**
- Modify: `../omt-redis/src/client.ts`
- Modify: `../omt-redis/src/instances.ts`
- Modify: `../omt-redis/src/execute.ts`
- Modify: `../omt-redis/src/get.ts`
- Modify: `../omt-redis/src/scan.ts`
- Modify: `../omt-redis/src/info.ts`
- Modify: `../omt-redis/src/ping.ts`
- Modify: `../omt-redis/src/index.ts`
- Modify: `../omt-redis/omt.manifest.json`
- Modify: `../omt-redis/README.md`
- Modify: `../omt-redis/package.json`, `../omt-redis/package-lock.json`
- Test: `../omt-redis/test/client.test.ts`, `../omt-redis/test/handlers.test.ts`

**Interfaces:**
- Produces Redis connection fields read from `ctx.config.settings` and password reference read from `ctx.config.secrets`.
- Produces manifest `connectionSchema` and `connectionCheckTool: "redis.ping"` with `sdkVersion: "^0.2.0"`.

- [ ] **Step 1: Write failing generic-config handler/client tests**

Pass a context whose config is:

```ts
{
  environment: "prod",
  settings: { host: "redis.test", port: 6379, database: "2", username: "default", tls: true },
  secrets: { password: "redis:prod:password" },
}
```

Assert that Redis client creation receives the settings and resolved password, and that instance listing emits no secret reference.

- [ ] **Step 2: Run Redis tests and verify the expected RED failures**

Run from `../omt-redis`: `bun test test/client.test.ts test/handlers.test.ts`

Expected: FAIL because the extension currently reads the old top-level connection fields.

- [ ] **Step 3: Implement generic settings/secrets access**

Use typed helpers for `settings` and the optional `password` secret reference, preserving existing timeout, TLS verification, RESP safety, and bounded read behavior. Update all handler paths and instance summaries.

- [ ] **Step 4: Add manifest schema/check metadata and update docs/package versions**

Declare the Redis settings schema, `connectionCheckTool`, `sdkVersion: "^0.2.0"`, and version `0.3.3`. Document the breaking generic connection migration.

- [ ] **Step 5: Run Redis tests and verify GREEN**

Run from `../omt-redis`: `npm run build && bun test test/client.test.ts test/handlers.test.ts && npm pack --dry-run`

Expected: PASS with generic connection input and existing protocol safety behavior intact.

- [ ] **Step 6: Commit the Redis migration**

Run from `../omt-redis`: `git add src test omt.manifest.json README.md package.json package-lock.json dist && git commit -m "feat: migrate redis to generic connections"`

### Task 7: Version, documentation, and release consistency

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `packages/sdk/package.json`, `packages/cli/package.json`, `packages/cli/src/version.ts`
- Modify: `README.md`, `packages/cli/README.md`, `packages/sdk/README.md`
- Modify: `docs/configuration.md`, `docs/roadmap.md`, `packages/cli/assets/skills/oh-my-tool/SKILL.md`
  - Modify: `packages/cli/src/cli/index.ts`, `scripts/set-release-version.mjs`, integration tests and help tests

- [ ] **Step 1: Write failing version and documentation assertions**

Add assertions that all main packages report `0.3.3`, `docs/roadmap.md` says v0.3 is released, generic connection sections exist, and integration tips contain `ohmytool integrate` but not `omt integrate`.

- [ ] **Step 2: Run the assertions and verify RED**

Run: `bun test packages/cli/test/e2e.test.ts packages/cli/test/integration.test.ts`

Expected: FAIL on version `0.3.2`, roadmap status, or stale command text.

- [ ] **Step 3: Apply version and documentation updates**

Run: `npm run version:release -- 0.3.3`; update `scripts/set-release-version.mjs` so it also writes the root private package version, update lockfile metadata, update help/configuration/skill examples to the generic connection contract, mark v0.3 released, and replace stale `omt` integration examples.

- [ ] **Step 4: Run documentation/version tests and verify GREEN**

Run: `bun test packages/cli/test/e2e.test.ts packages/cli/test/integration.test.ts`

Expected: PASS with no stale v0.3.2 or `omt integrate` user-facing text.

- [ ] **Step 5: Commit release metadata**

Run: `git add package.json package-lock.json packages README.md docs && git commit -m "release: v0.3.3"`

### Task 8: Full verification and final review

**Files:**
- Verify: all changed files in the three repositories

- [ ] **Step 1: Run main repository typecheck and tests**

Run from `oh-my-tool`: `npm run typecheck && npm test && npm run pack:check`

Expected: exit code 0, zero failed tests, and both workspace packages pass pack dry-run.

- [ ] **Step 2: Run extension checks**

Run from `../omt-mysql`: `npm run check`

Run from `../omt-redis`: `npm run check`

Expected: exit code 0 for both extensions.

- [ ] **Step 3: Inspect cross-repository state and diff hygiene**

Run from each repository: `git status --short` and `git diff --check`; verify there are no generated secret values, no legacy connection fields in shipped manifests/docs, no imports from `packages/cli/src/core`, and no uncommitted unrelated files.

- [ ] **Step 4: Run the final requirement checklist**

Verify from source and tests that:

```text
generic settings/secrets contract: present and legacy flat fields rejected
connectionSchema: manifest-declared and enforced
connectionCheckTool: explicit and read-only
runtime executor/registry/result/schema: sole implementation
MCP failure isolation and lazy target discovery: covered
native discovery route cache: one scan covered
search limit/filter/exact/prefix behavior: covered
MySQL and Redis generic-config execution: covered
version/documentation cleanup: covered
```

- [ ] **Step 5: Report verified results without publishing or tagging**

Do not publish packages or create/push tags in this task. Report the actual commit ids, test commands, and any remaining release-gate issue only after reading their fresh exit codes.
