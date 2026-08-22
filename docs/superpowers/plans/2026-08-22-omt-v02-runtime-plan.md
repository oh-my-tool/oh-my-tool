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
- Modify: `packages/cli/src/cli/context.ts`
- Modify: all CLI modules currently calling `homeDir()` or constructing `.omt` paths
- Create: `packages/cli/test/paths.test.ts`
- Modify: `packages/cli/test/config.test.ts`
- Modify: `packages/cli/test/smoke.test.ts`

**Interfaces:**
- Produces: `createPaths(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform)` returning `home`, `config`, `extensions`, `integrations`, `cache`, and `audit`.
- Produces: `migrateLegacyHome(paths): Promise<boolean>` that copies known files/directories and preserves the legacy directory.

- [ ] **Step 1: Write failing path tests**

Cover:

```ts
expect(createPaths({ OH_MY_TOOL_HOME: "X:" }, "win32").home).toBe("X:");
expect(createPaths({}, "linux").home).toMatch(/\.oh-my-tool$/);
expect(createPaths({ OMT_HOME: "legacy" }, "linux").home).not.toBe("legacy");
```

Add a migration test with a temporary legacy directory containing configuration and an extension; assert the new directory receives copies, the old files remain, and a second migration does not overwrite newer destination files.

- [ ] **Step 2: Run the path tests to verify they fail**

```powershell
bun test packages/cli/test/paths.test.ts
```

Expected: module/function-not-found failures.

- [ ] **Step 3: Implement paths and migration**

Use `OH_MY_TOOL_HOME` as the supported override, derive the platform default, define all child paths centrally, and copy only the existing OMT state directories/files needed by config, extensions, integrations, cache, and audit. Never call move/delete for migration.

- [ ] **Step 4: Replace ad-hoc home path construction**

Update config, extension, integration, secret, search, and command modules to consume the centralized paths object or `paths.home`; retain `OMT_HOME` only as a legacy test override if required for compatibility, never as the default.

- [ ] **Step 5: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 6: Commit**

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
- Produces: `ToolDescriptor`, `ExecutionContext`, `ToolProvider`, `ProviderRegistry`, and `ToolRegistry`.
- `ToolRegistry.register(provider, descriptors)` rejects duplicate descriptor IDs with an error code `DUPLICATE_TOOL_ID`.
- `ToolRegistry.search(query)` returns descriptors ranked using the existing search semantics without exposing `inputSchema` in search results.

- [ ] **Step 1: Write failing registry tests**

Test provider registration, lookup by tool ID, duplicate rejection, and search across descriptors from two providers:

```ts
const native = provider("native-a", "native", [{ id: "mysql.query", description: "query", risk: "read" }]);
const registry = new ToolRegistry();
await registry.register(native);
await expect(registry.register(provider("native-b", "native", [{ id: "mysql.query", description: "other", risk: "read" }]))).rejects.toMatchObject({ code: "DUPLICATE_TOOL_ID" });
```

- [ ] **Step 2: Run tests and verify they fail**

```powershell
bun test packages/cli/test/runtime/registry.test.ts
```

Expected: missing runtime modules/types.

- [ ] **Step 3: Implement minimal models and registry behavior**

Use the existing risk union and result types where compatible. Keep provider metadata on every descriptor. Make registry loading explicit and asynchronous so future MCP cache providers fit without changing the runtime facade.

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

- [ ] **Step 3: Move behavior-preserving implementations**

Place schema/result/executor logic under `runtime`, keep temporary re-exports from `core` so unrelated imports remain stable, and ensure policy is evaluated before the executor asks the secret manager for values.

- [ ] **Step 4: Add a test proving policy precedes secrets**

Use an injected secret store that records access and an input rejected by policy. Assert the rejection occurs and the store was never queried.

- [ ] **Step 5: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 6: Commit**

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
- `listTools()` and `getTool()` use static manifests only.
- `execute(toolId, input, context)` loads the selected extension handler only after runtime validation and policy.

- [ ] **Step 1: Write failing provider tests**

Create a temporary fake extension with a manifest and handler. Assert list/describe return descriptors with `provider.kind === "native"`, and instrument the handler module so search/list never imports it. Assert execute imports it and returns the existing `ToolResult`.

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
bun test packages/cli/test/runtime/native-provider.test.ts
```

Expected: missing provider implementation or contract failures.

- [ ] **Step 3: Implement provider by wrapping existing extension modules**

Reuse manifest validation, discovery, install, and loader logic; do not duplicate extension semantics. Convert each manifest tool into a descriptor retaining its original ID, description, keywords, risk, and schema.

- [ ] **Step 4: Verify static/dynamic loading boundaries**

Run the provider test and confirm static operations do not import handlers, while execute does. Keep secrets and config access in the execution path only.

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
- Produces: `createToolRuntime(options): ToolRuntime` with `search(query)`, `describe(toolId)`, and `run(toolId, input)`.
- CLI command modules no longer construct registry/loader/schema/policy/executor chains directly.

- [ ] **Step 1: Write failing facade tests**

Construct a runtime with a fake provider and assert:

```ts
expect((await runtime.search("mysql"))[0].id).toBe("mysql.query");
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

Build the provider registry and tool registry once per command context, register the native provider, resolve descriptors centrally, validate input centrally, invoke provider execution centrally, and normalize results.

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
- Produces: verified native execution path through `ToolRuntime -> NativeExtensionProvider -> extension`.

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

Use the workspace package entrypoint or Bun script to verify:

```powershell
ohmytool --version
ohmytool search "mysql"
ohmytool describe mysql.query
ohmytool run mysql.query --stdin
```

Expected: version, descriptor, and execution paths use the new names; database execution may require the user's configured connection and should report a normal policy/configuration error rather than an architecture error when unavailable.

- [ ] **Step 4: Inspect the final diff**

```powershell
git diff main --check
git status --short
```

Expected: only intended source, tests, docs, and plan/spec files are changed; no generated secrets or temporary homes are tracked.

- [ ] **Step 5: Commit any final regression fix**

```powershell
git add packages README.md
git commit -m "test: verify native provider regression gates"
```

