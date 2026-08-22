# Oh My Tool v0.2 Runtime Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the first-party CLI from `omt`/extension-specific wiring to `ohmytool` backed by an internal provider-independent ToolRuntime, while preserving native extension compatibility.

**Architecture:** Keep runtime code inside `packages/cli/src/runtime`. Normalize static extension manifests into `ToolDescriptor` values, register them through `ToolProvider`, and make `search`, `describe`, and `run` delegate through `ToolRuntime`. Preserve dynamic handler loading only on execution.

**Tech Stack:** Bun, TypeScript, Bun test, existing `@oh-my-tool/sdk`, Node filesystem/path APIs.

**Spec:** `docs/superpowers/specs/2026-08-22-omt-v02-runtime-design.md`

## Global Constraints

- Canonical CLI is `ohmytool`; do not expose `omt` as the default binary.
- Canonical execution verb is `run`; remove the default `call` command.
- Runtime remains internal under `packages/cli/src/runtime`; do not create a runtime workspace package.
- Do not add a `Capability` abstraction.
- Search and describe must not load handlers, secrets, databases, processes, or MCP servers.
- Policy must run before secret access.
- Preserve `ToolManifest -> ExtensionManifest -> ToolHandler` SDK compatibility.
- Legacy `~/.omt` migration copies known data and never moves or deletes the old directory.
- `OH_MY_TOOL_HOME` is the only supported home override; an explicit override disables automatic legacy migration.
- `ToolRegistry` is the single source of truth for normalized descriptors; providers do not expose `getTool`.
- `descriptor.provider.id` identifies a registered provider; extension/package identity is represented by separate `source` metadata.
- Runtime initialization completes provider discovery and duplicate detection before any CLI command is served.
- Search returns summary metadata only; describe returns the full descriptor including `inputSchema`.
- Runtime execution is `resolve -> validate -> policy -> prepare context -> provider.execute`; native providers load handlers only inside `execute`.
- Every production behavior change requires a failing Bun test before implementation.
- MCP, JDK discovery, audit logging, approval UI, workflows, agents, GUI, daemon, and marketplace are out of scope.

---

### Task 1: Establish and record the baseline

**Files:**
- Create: `docs/superpowers/baselines/2026-08-22-v01-baseline.md`
- Test: existing root and extension tests only

**Interfaces:**
- Produces: documented commands and observed results for later regression checks.

- [ ] **Step 1: Run the root test suite**

Run:

```powershell
bun install
bun test
```

Expected: the existing SDK and CLI tests pass; record the exact summary and any environment-specific skips.

- [ ] **Step 2: Run the MySQL and Redis test suites**

Run:

```powershell
Set-Location ..\omt-mysql; bun install; bun test
Set-Location ..\omt-redis; bun install; bun test
```

Expected: both extension suites pass.

- [ ] **Step 3: Write the baseline record**

Record the commands, pass/fail summaries, current package versions, and the fact that the current CLI uses `omt`, `call`, and `OMT_HOME`.

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/baselines/2026-08-22-v01-baseline.md
git commit -m "test: record v0.1 baseline"
```

---

### Task 2: Rename the CLI entry point and execution verb

**Files:**
- Create: `packages/cli/bin/ohmytool.ts`
- Delete: `packages/cli/bin/omt.ts`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/cli/index.ts`
- Create: `packages/cli/src/cli/commands/run.ts`
- Delete: `packages/cli/src/cli/commands/call.ts`
- Modify: `packages/cli/test/parseArgs.test.ts`
- Modify: `packages/cli/test/commands.test.ts`
- Modify: `packages/cli/test/smoke.test.ts`

**Interfaces:**
- Consumes: existing `runCall` behavior and command tests.
- Produces: `runTool(toolId: string, keyValues: Record<string,string>, stdin: boolean)` and CLI dispatch for `run`.

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```ts
expect(await main(["run", "mysql.query", "connection=iot-test"])).toBe(0);
expect(await main(["call", "mysql.query"])).toBe(1);
expect(await main(["--version"])).toBe(0);
```

Also assert version output contains `name: "ohmytool"`, help output contains `ohmytool run`, and `package.json` exposes only the `ohmytool` bin.

- [ ] **Step 2: Run the focused tests and verify they fail**

```powershell
bun test packages/cli/test/commands.test.ts packages/cli/test/smoke.test.ts
```

Expected: failures identify the missing `run` dispatch and old binary/help text.

- [ ] **Step 3: Implement the minimal rename**

Copy the existing bin wrapper to `bin/ohmytool.ts`, rename `runCall` to `runTool` in a new `commands/run.ts`, update imports and dispatch, update help/examples/version name, and change the package `bin` map to:

```json
{ "ohmytool": "./bin/ohmytool.ts" }
```

- [ ] **Step 4: Run focused tests**

```powershell
bun test packages/cli/test/commands.test.ts packages/cli/test/smoke.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/cli/bin packages/cli/package.json packages/cli/src/cli packages/cli/test
git commit -m "refactor: rename CLI to ohmytool and call to run"
```

---

### Task 3: Centralize filesystem paths and add non-destructive migration

**Files:**
- Create: `packages/cli/src/paths.ts`
- Create: `packages/cli/src/migration.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Modify: all CLI modules currently calling `homeDir()` or constructing `.omt` paths
- Create: `packages/cli/test/paths.test.ts`
- Modify: `packages/cli/test/config.test.ts`
- Modify: `packages/cli/test/smoke.test.ts`

**Interfaces:**
- Produces: `createPaths(options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; userHome?: string })` returning `home`, `config`, `extensions`, `integrations`, `cache`, `audit`, and `isCustomHome`.
- Produces: `migrateLegacyHome(paths): Promise<boolean>` in `migration.ts`; `paths.ts` remains pure and has no filesystem side effects.

- [ ] **Step 1: Write failing path tests**

Cover:

```ts
expect(createPaths({ env: { OH_MY_TOOL_HOME: "X:" }, platform: "win32", userHome: "U:" }).home).toBe("X:");
expect(createPaths({ env: {}, platform: "linux", userHome: "/users/test" }).home).toBe("/users/test/.oh-my-tool");
expect(createPaths({ env: { OH_MY_TOOL_HOME: "custom" }, platform: "linux", userHome: "/users/test" }).isCustomHome).toBe(true);
```

Add a migration test with a temporary legacy directory containing configuration and an extension; assert the new directory receives copies, the old files remain, and a second migration does not overwrite newer destination files.

- [ ] **Step 2: Run the path tests to verify they fail**

```powershell
bun test packages/cli/test/paths.test.ts
```

Expected: module/function-not-found failures.

- [ ] **Step 3: Implement pure paths and migration**

Use `OH_MY_TOOL_HOME` as the only supported override, accept injected `userHome` and `platform`, derive the platform default, and define all child paths centrally. Put copy side effects in `migration.ts`; copy only the existing OMT state directories/files needed by config, extensions, integrations, cache, and audit. Never call move/delete for migration.

- [ ] **Step 4: Test migration ordering and custom-home behavior**

Assert migration runs before new-home directory creation, and that an explicit `OH_MY_TOOL_HOME` skips scanning or copying from the real legacy home. Use injected `userHome` and temporary paths so tests never inspect the developer's actual profile.

- [ ] **Step 5: Replace ad-hoc home path construction**

Update config, extension, integration, secret, search, and command modules to consume the centralized paths object or `paths.home`; remove production reads of `OMT_HOME`.

- [ ] **Step 6: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/cli/src packages/cli/test
git commit -m "refactor: centralize Oh My Tool filesystem paths"
```

---

### Task 4: Introduce normalized runtime models and registries

**Files:**
- Create: `packages/cli/src/runtime/tool.ts`
- Create: `packages/cli/src/runtime/provider.ts`
- Create: `packages/cli/src/runtime/provider-registry.ts`
- Create: `packages/cli/src/runtime/tool-registry.ts`
- Create: `packages/cli/src/runtime/result.ts`
- Create: `packages/cli/test/runtime/registry.test.ts`

**Interfaces:**
- Produces: `ToolDescriptor`, `ToolSearchResult`, `ExecutionContext`, `ToolResult`, `ExecutionResult`, `ToolProvider`, `ProviderRegistry`, and `ToolRegistry`.
- `ToolDescriptor` includes `provider: { id: "native", kind: "native" }` and `source: { id: "omt-mysql", kind: "extension" }` for native MySQL; the provider ID must match a registered provider.
- `ToolProvider` exposes only `listTools()` and `execute()`; `ToolRegistry` is the descriptor single source of truth and has no provider-specific lookup path.
- `ProviderRegistry.register(provider)` and `ProviderRegistry.get(id)` manage provider instances; duplicate providers fail with `DUPLICATE_PROVIDER_ID`, and `require(id)` fails with `PROVIDER_NOT_FOUND`.
- `ToolRegistry.register(descriptors)`, `get(toolId)`, and `search(query)` manage descriptors; duplicate tools fail with `DUPLICATE_TOOL_ID`.
- `ToolSearchResult = Omit<ToolDescriptor, "inputSchema">`; search returns summaries and describe returns full descriptors.
- `ExecutionResult` is the normalized runtime shape: `{ ok: boolean; toolId: string; output?: unknown; error?: { code: string; message: string } }`.

The frozen provider contract is:

```ts
interface ToolProvider {
  readonly id: string;
  readonly kind: string;
  listTools(): Promise<readonly ToolDescriptor[]>;
  execute(toolId: string, input: unknown, context: ExecutionContext): Promise<ToolResult>;
}
```

`ExecutionContext` carries the already-approved execution dependencies (logger, config, and secret access); constructing that context is a Runtime responsibility, not a Native Provider policy decision.

- [ ] **Step 1: Write failing registry tests**

Test provider registration, duplicate provider rejection, missing-provider behavior, descriptor registration, duplicate rejection, provider/source identity invariants, and search across descriptors from two providers:

```ts
const providers = new ProviderRegistry();
providers.register(nativeProvider("native"));
expect(() => providers.register(nativeProvider("native"))).toThrow(/DUPLICATE_PROVIDER_ID/);
expect(providers.get("missing")).toBeUndefined();
expect(() => providers.require("missing")).toThrow(/PROVIDER_NOT_FOUND/);

const registry = new ToolRegistry();
registry.register([{ id: "mysql.query", description: "query", risk: "read", provider: { id: "native", kind: "native" }, source: { id: "omt-mysql", kind: "extension" } }]);
expect(() => registry.register([{ id: "mysql.query", description: "other", risk: "read", provider: { id: "native", kind: "native" }, source: { id: "other", kind: "extension" } }])).toThrow(/DUPLICATE_TOOL_ID/);
expect(registry.search("query")[0]).not.toHaveProperty("inputSchema");
expect(registry.get("mysql.query")).toHaveProperty("provider.id", "native");
```

- [ ] **Step 2: Run tests and verify they fail**

```powershell
bun test packages/cli/test/runtime/registry.test.ts
```

Expected: missing runtime modules/types.

- [ ] **Step 3: Implement minimal models and registry behavior**

Use the existing risk union and result types where compatible. Keep provider and source metadata on every descriptor, enforce `descriptor.provider.id === registeredProvider.id` during runtime initialization, and keep discovery explicit and asynchronous in the future runtime factory rather than making `ToolRegistry` own providers.

- [ ] **Step 4: Run focused and existing search tests**

```powershell
bun test packages/cli/test/runtime/registry.test.ts packages/cli/test/search.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/cli/src/runtime packages/cli/test/runtime
git commit -m "feat: add provider-independent runtime registries"
```

---

### Task 5: Migrate core behavior into runtime modules

**Files:**
- Create: `packages/cli/src/runtime/schema.ts`
- Create: `packages/cli/src/runtime/executor.ts`
- Create: `packages/cli/src/runtime/errors.ts`
- Modify: `packages/cli/src/core/schema.ts`
- Modify: `packages/cli/src/core/executor.ts`
- Modify: `packages/cli/src/core/registry.ts`
- Modify: imports in command/search/test modules
- Create: `packages/cli/test/runtime/executor.test.ts`

**Interfaces:**
- Consumes: existing schema validation, policy, secret manager, and executor behavior.
- Produces: runtime-local equivalents with behavior-preserving exports during migration.

- [ ] **Step 1: Add characterization tests before changing implementation**

Move or duplicate the existing schema/executor assertions into `test/runtime`; assert defaults, type errors, policy errors, secret lookup ordering, and normalized success/failure result shapes.

- [ ] **Step 2: Run the new characterization tests**

```powershell
bun test packages/cli/test/runtime/executor.test.ts packages/cli/test/schema.test.ts packages/cli/test/executor.test.ts
```

Expected: the new tests pass against compatibility exports; if any fail, correct the test setup before moving code.

- [ ] **Step 3: Add the failing execution-order invariant test**

Use an injected secret store and handler loader that record access. Give the runtime input that policy must reject; assert policy rejects and neither the secret store nor handler loader is touched.

- [ ] **Step 4: Run the invariant test and verify it fails**

```powershell
bun test packages/cli/test/runtime/executor.test.ts
```

Expected: failure because the new runtime pipeline does not yet enforce both boundaries.

- [ ] **Step 5: Move behavior-preserving implementations**

Place schema/result/executor logic under `runtime`, keep temporary re-exports from `core` so unrelated imports remain stable, and implement `resolve -> validate -> policy -> prepare context -> provider.execute`. Secret access and handler loading occur only after policy succeeds.

- [ ] **Step 6: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/cli/src/core packages/cli/src/runtime packages/cli/test
git commit -m "refactor: move core execution behavior into runtime"
```

---

### Task 6: Implement NativeExtensionProvider

**Files:**
- Create: `packages/cli/src/runtime/providers/native/provider.ts`
- Create: `packages/cli/src/runtime/providers/native/discovery.ts`
- Create: `packages/cli/src/runtime/providers/native/loader.ts`
- Create: `packages/cli/src/runtime/providers/native/manifest.ts`
- Create: `packages/cli/src/runtime/providers/native/install.ts`
- Modify: existing `packages/cli/src/extension/*.ts` to re-export or delegate
- Create: `packages/cli/test/runtime/native-provider.test.ts`

**Interfaces:**
- Produces: `NativeExtensionProvider` implementing `ToolProvider`.
- `id === "native"` and `kind === "native"`.
- `listTools()` uses static manifests only and returns descriptors with `provider: { id: "native", kind: "native" }` and `source: { id: manifest.id, kind: "extension" }`.
- `execute(toolId, input, context)` assumes runtime preflight succeeded; it locates the extension, dynamically imports the handler, and executes it using the supplied `ExecutionContext`. It is not a policy decision point.

- [ ] **Step 1: Write failing provider tests**

Create a temporary fake extension whose handler module immediately throws `HANDLER_IMPORTED`. Assert `listTools()`, runtime search, and runtime describe all succeed without importing it. Assert only execute dynamically imports the handler and returns the existing `ToolResult` when the handler is non-poisoned.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
bun test packages/cli/test/runtime/native-provider.test.ts
```

Expected: missing provider implementation or contract failures.

- [ ] **Step 3: Implement provider by wrapping existing extension modules**

Reuse manifest validation, discovery, install, and loader logic; do not duplicate extension semantics. Convert each manifest tool into a descriptor retaining its original ID, description, keywords, risk, and schema.

- [ ] **Step 4: Verify static/dynamic loading boundaries and provider identity**

Run the provider test and confirm static operations do not import handlers, while execute does. Assert every descriptor has provider ID `native`, source ID equal to the extension manifest ID, and no provider method performs policy or secret decisions.

- [ ] **Step 5: Run CLI and SDK tests**

```powershell
bun test packages/cli/test packages/sdk/test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/cli/src packages/cli/test
git commit -m "refactor: add native extension provider"
```

---

### Task 7: Add ToolRuntime facade and route CLI commands through it

**Files:**
- Create: `packages/cli/src/runtime/runtime.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Modify: `packages/cli/src/cli/commands/search.ts`
- Modify: `packages/cli/src/cli/commands/describe.ts`
- Modify: `packages/cli/src/cli/commands/run.ts`
- Modify: `packages/cli/src/cli/commands/extension.ts`
- Create: `packages/cli/test/runtime/runtime.test.ts`
- Modify: `packages/cli/test/smoke.test.ts`

**Interfaces:**
- Produces: `async createToolRuntime(options): Promise<ToolRuntime>` with `search(query): Promise<ToolSearchResult[]>`, `describe(toolId): Promise<ToolDescriptor>`, and `run(toolId, input): Promise<ExecutionResult>`.
- Factory initialization registers providers, awaits each `listTools()`, enforces provider identity, registers all descriptors, rejects duplicate IDs, and only then returns a serving runtime.
- CLI command modules no longer construct registry/loader/schema/policy/executor chains directly.

- [ ] **Step 1: Write failing facade tests**

Construct a runtime with a fake provider and assert:

```ts
const runtime = await createToolRuntime({ providers: [fakeProvider] });
expect((await runtime.search("mysql"))[0].id).toBe("mysql.query");
expect((await runtime.search("mysql"))[0]).not.toHaveProperty("inputSchema");
expect((await runtime.describe("mysql.query")).provider.kind).toBe("native");
expect((await runtime.run("mysql.query", { connection: "iot-test" })).ok).toBe(true);
```

Add an unknown tool test with a stable not-found error.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
bun test packages/cli/test/runtime/runtime.test.ts
```

Expected: missing facade or incomplete provider routing.

- [ ] **Step 3: Implement the facade**

Build the provider registry and tool registry during the async factory, register the native provider, await static discovery, resolve descriptors centrally, validate input centrally, apply policy before preparing secret-capable context, invoke provider execution centrally, and normalize raw `ToolResult` into `ExecutionResult`.

- [ ] **Step 4: Replace command wiring**

Make search/describe/run call only the runtime facade. Keep extension list/install commands as management operations, but make them use the same centralized paths and provider setup.

- [ ] **Step 5: Run all tests**

```powershell
bun test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/cli/src packages/cli/test
git commit -m "refactor: route CLI commands through ToolRuntime"
```

---

### Task 8: Update bundled Agent Skill and project documentation

**Files:**
- Modify: `packages/cli/assets/skills/oh-my-tool/SKILL.md`
- Modify: `README.md`
- Modify: `packages/cli/test/integration.test.ts` or relevant skill integration assertions

**Interfaces:**
- Produces: documented agent protocol `search -> describe -> run` using `ohmytool`.

- [ ] **Step 1: Write failing documentation assertions**

Assert the bundled skill contains `ohmytool search`, `ohmytool describe`, and `ohmytool run`, and does not contain executable examples using `omt call`.

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
bun test packages/cli/test/integration.test.ts
```

Expected: failure while old CLI wording remains.

- [ ] **Step 3: Update skill and README**

Position the project as “Oh My Tool — The Agent Tool Runtime”, document native extensions and the internal runtime/provider model, and use only the canonical command names.

- [ ] **Step 4: Run all tests**

```powershell
bun test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add README.md packages/cli/assets/skills packages/cli/test
git commit -m "docs: update Agent Tool Runtime positioning"
```

---

### Task 9: Run the native extension regression gates

**Files:**
- Modify only if regression fixes are required: `packages/cli/test`, `omt-mysql`, `omt-redis`

**Interfaces:**
- Produces: verified unchanged `omt-mysql` and `omt-redis` install/discovery/describe compatibility through `ToolRuntime -> NativeExtensionProvider -> extension`.

- [ ] **Step 1: Run root tests**

```powershell
Set-Location .\oh-my-tool
bun test
```

Expected: PASS with no unhandled errors or warnings.

- [ ] **Step 2: Run extension tests**

```powershell
Set-Location ..\omt-mysql; bun test
Set-Location ..\omt-redis; bun test
```

Expected: both PASS.

- [ ] **Step 3: Run CLI command gates**

Use a temporary injected `OH_MY_TOOL_HOME` and the workspace package entrypoint or Bun script. Install both independent repositories without modifying their manifests or SDK contracts:

```powershell
$env:OH_MY_TOOL_HOME = Join-Path $PWD ".gate-home"
ohmytool extension install ..\omt-mysql
ohmytool extension install ..\omt-redis
ohmytool search "mysql"
ohmytool describe mysql.query
ohmytool search "redis"
ohmytool describe redis.get
```

Expected: both existing extensions install unchanged, appear in search, and expose full descriptors through describe. No database or Redis server is required for this gate.

- [ ] **Step 4: Run deterministic execution gate**

Use the poison/fake extension fixture from Task 6 to run a complete command path:

```powershell
'{"value":"hello"}' | ohmytool run test.echo --stdin
```

Expected: `ExecutionResult.ok === true`; this gate does not depend on local MySQL or Redis credentials. If a configured local database is available, an additional optional read-only smoke may be run, but it is not a release requirement.

- [ ] **Step 5: Inspect the final diff**

```powershell
git diff main --check
git status --short
```

Expected: only intended source, tests, docs, and plan/spec files are changed; no generated secrets or temporary homes are tracked.

- [ ] **Step 6: Commit any final regression fix**

```powershell
git add packages README.md
git commit -m "test: verify native provider regression gates"
```
