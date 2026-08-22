# Oh My Tool v0.2 Runtime Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the first-party CLI from `omt` / extension-specific wiring to `ohmytool`, backed by an internal provider-independent `ToolRuntime`, while preserving the existing native Extension SDK contract and independent `omt-mysql` / `omt-redis` compatibility.

**Architecture:** Keep runtime code internal under `packages/cli/src/runtime`. Static native extension manifests are normalized into provider-independent `ToolDescriptor` values and indexed by `ToolRegistry`; executable providers are stored separately in `ProviderRegistry`. `search`, `describe`, and `run` delegate through `ToolRuntime`. Search and describe remain static-only; policy completes before secret-capable execution context creation; native handler code is dynamically imported only inside `NativeExtensionProvider.execute()`.

**Tech Stack:** Bun, TypeScript, Bun test, existing `@oh-my-tool/sdk`, Node filesystem/path APIs.

**Spec:** `docs/superpowers/specs/2026-08-22-omt-v02-runtime-design.md`

**Plan:** `docs/superpowers/plans/2026-08-22-omt-v02-runtime-architecture.md`

## Global Constraints

- Canonical CLI executable is `ohmytool`; do not expose `omt` as the default binary.
- Canonical execution verb is `run`; remove the default `call` command.
- Runtime remains internal under `packages/cli/src/runtime`; do not create `@oh-my-tool/runtime` or another runtime workspace package.
- Do not add a `Capability` class, interface, or parallel capability model.
- Runtime modules must not depend on CLI argument parsing, terminal rendering, help formatting, or command modules.
- Search and describe must not dynamically import handlers.
- Search and describe must not access secrets.
- Search and describe must not connect to databases.
- Search and describe must not start child processes or MCP servers.
- Policy preflight must complete successfully before any secret-capable execution context is created or used.
- Preserve existing `ToolManifest -> ExtensionManifest -> ToolHandler` SDK compatibility.
- Do not require manifest or SDK changes in independent `omt-mysql` or `omt-redis` repositories.
- `ToolRegistry` is the single source of truth for normalized tool descriptors.
- Providers do not expose `getTool()`.
- `ProviderRegistry` manages executable provider instances only.
- `descriptor.provider.id` must identify a registered `ToolProvider`.
- Native extension/package identity is separate from provider identity and is represented through descriptor `source` metadata.
- Runtime initialization completes provider registration, static discovery, provider/descriptor identity validation, and duplicate tool detection before returning a serving runtime.
- Search returns summary metadata only.
- Describe returns the complete normalized descriptor including `inputSchema`.
- Runtime execution order is:

```text
resolve descriptor
-> validate schema
-> policy preflight
-> create approved ExecutionContext
-> provider.execute
-> normalize ToolResult
```

- Native execution order inside `NativeExtensionProvider.execute()` is:

```text
resolve native extension
-> dynamically import selected handler
-> execute handler
```

- Native providers are not policy decision points.
- Existing MySQL read-only SQL protection remains intact; normalized descriptor risk does not replace existing SQL-specific enforcement in v0.2.
- `OH_MY_TOOL_HOME` is the only supported home override.
- Production code must not read `OMT_HOME`.
- Explicit `OH_MY_TOOL_HOME` disables automatic `~/.omt` migration.
- Legacy migration is copy-only.
- Legacy migration never moves or deletes `~/.omt`.
- Legacy migration never overwrites an already-existing destination home.
- Filesystem migration happens before creation of the new default home.
- Every production behavior change requires a failing Bun test before its implementation.
- MCP, JDK discovery, audit logging behavior, approval UI, workflows, agents, GUI, daemon, marketplace, and public runtime packages are out of scope.

---

# Target File Structure

The intended structure after this slice is:

```text
packages/cli/
├─ bin/
│  └─ ohmytool.ts
│
├─ src/
│  ├─ cli/
│  │  ├─ context.ts
│  │  ├─ index.ts
│  │  └─ commands/
│  │     ├─ search.ts
│  │     ├─ describe.ts
│  │     ├─ run.ts
│  │     └─ extension.ts
│  │
│  ├─ paths.ts
│  ├─ migration.ts
│  │
│  ├─ runtime/
│  │  ├─ tool.ts
│  │  ├─ provider.ts
│  │  ├─ result.ts
│  │  ├─ errors.ts
│  │  ├─ provider-registry.ts
│  │  ├─ tool-registry.ts
│  │  ├─ schema.ts
│  │  ├─ policy.ts
│  │  ├─ executor.ts
│  │  ├─ runtime.ts
│  │  │
│  │  └─ providers/
│  │     └─ native/
│  │        ├─ provider.ts
│  │        ├─ discovery.ts
│  │        ├─ manifest.ts
│  │        ├─ loader.ts
│  │        └─ install.ts
│  │
│  ├─ core/
│  │  └─ ... temporary compatibility re-exports where required
│  │
│  └─ extension/
│     └─ ... temporary compatibility re-exports/delegates where required
│
└─ test/
   ├─ runtime/
   │  ├─ registry.test.ts
   │  ├─ executor.test.ts
   │  ├─ native-provider.test.ts
   │  └─ runtime.test.ts
   │
   └─ fixtures/
      └─ extensions/
         ├─ test-echo/
         └─ poison-handler/
```

Dependency direction must remain:

```text
CLI commands
    |
    v
ToolRuntime
    |
    +-------------------+
    |                   |
ToolRegistry      ProviderRegistry
                        |
                        v
                   ToolProvider
                        |
                        v
              NativeExtensionProvider
                        |
                        v
              Existing Extension SDK
```

Forbidden dependency:

```text
runtime/* -> cli/*
```

---

# Task 1: Establish and Record the v0.1 Baseline

**Files:**

- Create: `docs/superpowers/baselines/2026-08-22-v01-baseline.md`
- Test: existing root, CLI, SDK, `omt-mysql`, and `omt-redis` tests only

**Interfaces:**

- Produces a reproducible record of current behavior before architecture changes.
- Establishes the regression baseline for CLI naming, paths, extension compatibility, and test counts.

- [ ] **Step 1: Verify the working tree before baseline execution**

Run:

```powershell
git status --short
```

Expected: understand and record any pre-existing user changes before making plan-related modifications. Do not discard unrelated work.

- [ ] **Step 2: Install root dependencies without modifying the lockfile**

Run:

```powershell
bun install --frozen-lockfile
```

Expected: install succeeds without changing the lockfile.

- [ ] **Step 3: Run the root test suite**

Run:

```powershell
bun test
```

Expected: existing SDK and CLI tests pass. Record exact totals, failures, skips, and environment-specific warnings.

- [ ] **Step 4: Run the MySQL extension baseline**

Run:

```powershell
Set-Location ..\omt-mysql
bun install --frozen-lockfile
bun test
```

Expected: PASS.

Record:

- package version
- SDK dependency version
- manifest format
- exact test summary

- [ ] **Step 5: Run the Redis extension baseline**

Run:

```powershell
Set-Location ..\omt-redis
bun install --frozen-lockfile
bun test
```

Expected: PASS.

Record:

- package version
- SDK dependency version
- manifest format
- exact test summary

- [ ] **Step 6: Record current CLI behavior**

Document that v0.1 currently uses:

```text
binary: omt
execution command: call
home override: OMT_HOME
legacy default home: ~/.omt
```

Also record current extension install/search/describe/call behavior that later gates must preserve semantically.

- [ ] **Step 7: Write the baseline document**

Create:

```text
docs/superpowers/baselines/2026-08-22-v01-baseline.md
```

Include:

- root commit SHA
- root package version
- SDK version
- CLI version
- `omt-mysql` version and commit SHA
- `omt-redis` version and commit SHA
- commands executed
- pass/fail totals
- skipped tests
- current CLI names
- current home path behavior
- environment-specific warnings

- [ ] **Step 8: Commit**

```powershell
git add docs/superpowers/baselines/2026-08-22-v01-baseline.md
git commit -m "test: record v0.1 baseline"
```

---

# Task 2: Rename the CLI Entry Point and Execution Verb

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

Produces:

```ts
runTool(
  toolId: string,
  keyValues: Record<string, string>,
  stdin: boolean,
): Promise<number>
```

The exact return type should preserve the current `runCall` command contract if it already differs; this task is a rename only, not an execution redesign.

Produces canonical dispatch:

```text
ohmytool search
ohmytool describe
ohmytool run
```

- [ ] **Step 1: Add failing parser tests for `run`**

Add assertions equivalent to:

```ts
const parsed = parseArgs([
  "run",
  "mysql.query",
  "connection=iot-test",
]);

expect(parsed.command).toBe("run");
expect(parsed.toolId).toBe("mysql.query");
```

Add a test proving `call` is no longer a recognized canonical command.

- [ ] **Step 2: Add failing CLI metadata tests**

Assert:

```ts
const pkg = await Bun.file(
  new URL("../package.json", import.meta.url),
).json();

expect(pkg.bin).toEqual({
  ohmytool: "./bin/ohmytool.ts",
});
```

Assert help contains:

```text
ohmytool search
ohmytool describe
ohmytool run
```

Assert help does not advertise:

```text
omt call
```

Assert version output identifies the executable as `ohmytool`.

- [ ] **Step 3: Add a failing dispatch test without executing MySQL**

Use the existing command-test spy/mock mechanism already used in `commands.test.ts`.

Verify:

```text
main(["run", "mysql.query", ...])
```

dispatches to `runTool`.

Do not require an installed MySQL extension, credentials, or database in Task 2.

- [ ] **Step 4: Run the focused tests and verify failure**

Run:

```powershell
bun test packages/cli/test/parseArgs.test.ts packages/cli/test/commands.test.ts packages/cli/test/smoke.test.ts
```

Expected failures:

- `run` not recognized
- `call` still recognized
- `omt` binary still present
- old help/version text remains

- [ ] **Step 5: Implement the minimal binary rename**

Copy the existing bin wrapper semantics into:

```text
packages/cli/bin/ohmytool.ts
```

Remove:

```text
packages/cli/bin/omt.ts
```

Change `package.json` binary map to:

```json
{
  "ohmytool": "./bin/ohmytool.ts"
}
```

Do not expose an `omt` alias in the default CLI contract.

- [ ] **Step 6: Rename the command implementation**

Move current `call` behavior into:

```text
packages/cli/src/cli/commands/run.ts
```

Rename the exported command function from `runCall` to `runTool`.

This step must not redesign execution behavior.

- [ ] **Step 7: Update dispatch/help/version output**

Change CLI routing from:

```text
call
```

to:

```text
run
```

Update user-facing examples and usage strings.

- [ ] **Step 8: Run focused tests**

```powershell
bun test packages/cli/test/parseArgs.test.ts packages/cli/test/commands.test.ts packages/cli/test/smoke.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add packages/cli/bin packages/cli/package.json packages/cli/src/cli packages/cli/test
git commit -m "refactor: rename CLI to ohmytool and call to run"
```

---

# Task 3: Centralize Filesystem Paths and Implement Safe Legacy Migration

**Files:**

- Create: `packages/cli/src/paths.ts`
- Create: `packages/cli/src/migration.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Modify: modules currently calling `homeDir()` directly
- Modify: modules constructing `.omt` paths
- Modify: config modules
- Modify: extension modules
- Modify: integration modules
- Modify: secret modules
- Modify: search modules where path state is accessed
- Create: `packages/cli/test/paths.test.ts`
- Modify: `packages/cli/test/config.test.ts`
- Modify: `packages/cli/test/smoke.test.ts`

## Interfaces

Define:

```ts
export interface CreatePathsOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  userHome?: string;
}

export interface OhMyToolPaths {
  readonly userHome: string;
  readonly home: string;
  readonly legacyHome: string;

  readonly config: string;
  readonly extensions: string;
  readonly integrations: string;
  readonly cache: string;
  readonly audit: string;

  readonly isCustomHome: boolean;
}

export function createPaths(
  options?: CreatePathsOptions,
): OhMyToolPaths;
```

Use the existing config filename from the current implementation; only centralize its path. Do not silently invent a new config format.

Define:

```ts
export type MigrationStatus =
  | "migrated"
  | "skipped-custom-home"
  | "skipped-no-legacy"
  | "skipped-destination-exists";

export interface MigrationResult {
  readonly status: MigrationStatus;
  readonly legacyHome: string;
  readonly home: string;
  readonly legacyPreserved: true;
}

export function migrateLegacyHome(
  paths: OhMyToolPaths,
): Promise<MigrationResult>;

export function prepareHome(
  paths: OhMyToolPaths,
): Promise<MigrationResult>;
```

`paths.ts` must remain pure.

`migration.ts` owns filesystem side effects.

`prepareHome()` owns lifecycle ordering:

```text
migrateLegacyHome
-> ensure new home/directories
```

- [ ] **Step 1: Write failing path-resolution tests**

Cover:

```ts
expect(
  createPaths({
    env: { OH_MY_TOOL_HOME: "X:" },
    platform: "win32",
    userHome: "U:",
  }).home,
).toBe("X:");
```

Cover:

```ts
expect(
  createPaths({
    env: {},
    platform: "linux",
    userHome: "/users/test",
  }).home,
).toBe("/users/test/.oh-my-tool");
```

Cover:

```ts
expect(
  createPaths({
    env: {},
    platform: "linux",
    userHome: "/users/test",
  }).legacyHome,
).toBe("/users/test/.omt");
```

Cover:

```ts
expect(
  createPaths({
    env: { OH_MY_TOOL_HOME: "/custom/omt" },
    platform: "linux",
    userHome: "/users/test",
  }).isCustomHome,
).toBe(true);
```

- [ ] **Step 2: Add a failing test proving `OMT_HOME` is ignored**

Example:

```ts
const paths = createPaths({
  env: {
    OMT_HOME: "/legacy-override",
  },
  platform: "linux",
  userHome: "/users/test",
});

expect(paths.home).toBe("/users/test/.oh-my-tool");
```

Production code must not implement:

```ts
OH_MY_TOOL_HOME ?? OMT_HOME ?? defaultHome
```

- [ ] **Step 3: Add failing migration tests**

Using temporary directories only, test:

### Default migration

```text
legacy ~/.omt exists
new ~/.oh-my-tool does not exist
```

Expected:

```text
status = migrated
known state copied
legacy remains
```

### Existing destination

```text
legacy exists
new home already exists
```

Expected:

```text
status = skipped-destination-exists
destination untouched
legacy untouched
```

### Custom home

```text
OH_MY_TOOL_HOME explicitly set
```

Expected:

```text
status = skipped-custom-home
legacy directory is not scanned/copied
```

### No legacy

Expected:

```text
status = skipped-no-legacy
```

- [ ] **Step 4: Add a failing migration-order test**

Create:

```text
legacy exists
new home does not exist
```

Call:

```ts
await prepareHome(paths);
```

Assert legacy state appears in the new home.

This test must fail if `ensureDirectories()` creates the new home before migration.

- [ ] **Step 5: Run path tests and verify failure**

```powershell
bun test packages/cli/test/paths.test.ts
```

Expected: missing modules/functions or old path behavior.

- [ ] **Step 6: Implement pure `createPaths()`**

Rules:

```text
OH_MY_TOOL_HOME present
    -> home = explicit value
    -> isCustomHome = true

OH_MY_TOOL_HOME absent
    -> home = <userHome>/.oh-my-tool
    -> isCustomHome = false

legacyHome always derives from injected userHome:
    <userHome>/.omt
```

No filesystem access is allowed in `createPaths()`.

- [ ] **Step 7: Implement migration**

Migration applies only when:

```text
isCustomHome === false
legacyHome exists
home does not exist
```

Copy only known current OMT state:

```text
config
extensions
integrations
cache
audit
```

where those entries actually exist.

Rules:

```text
copy
never move
never delete source
never overwrite an existing destination home
```

- [ ] **Step 8: Implement `prepareHome()`**

Required order:

```ts
const migration = await migrateLegacyHome(paths);
await ensureDirectories(paths);
return migration;
```

Do not reverse this order.

- [ ] **Step 9: Replace ad-hoc home/path construction**

All production modules must derive state from `OhMyToolPaths`.

Remove production reads of:

```text
OMT_HOME
```

- [ ] **Step 10: Run path and config tests**

```powershell
bun test packages/cli/test/paths.test.ts packages/cli/test/config.test.ts packages/cli/test/smoke.test.ts
```

Expected: PASS.

- [ ] **Step 11: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 12: Commit**

```powershell
git add packages/cli/src packages/cli/test
git commit -m "refactor: centralize Oh My Tool filesystem paths"
```

---

# Task 4: Freeze Runtime Contracts and Introduce Registries

**Files:**

- Create: `packages/cli/src/runtime/tool.ts`
- Create: `packages/cli/src/runtime/provider.ts`
- Create: `packages/cli/src/runtime/result.ts`
- Create: `packages/cli/src/runtime/errors.ts`
- Create: `packages/cli/src/runtime/provider-registry.ts`
- Create: `packages/cli/src/runtime/tool-registry.ts`
- Create: `packages/cli/test/runtime/registry.test.ts`

## Interfaces

### Tool descriptor

Define:

```ts
export interface ToolProviderRef {
  readonly id: string;
  readonly kind: string;
}

export interface ToolSourceRef {
  readonly id: string;
  readonly kind: string;
}

export interface ToolDescriptor {
  readonly id: string;
  readonly description: string;
  readonly keywords?: readonly string[];
  readonly risk: "read" | "write" | "admin";
  readonly inputSchema?: Record<string, unknown>;

  readonly provider: ToolProviderRef;
  readonly source?: ToolSourceRef;
}

export type ToolSearchResult =
  Omit<ToolDescriptor, "inputSchema">;
```

Native MySQL normalization must look conceptually like:

```ts
{
  id: "mysql.query",
  description: "...",
  risk: "read",

  provider: {
    id: "native",
    kind: "native",
  },

  source: {
    id: "omt-mysql",
    kind: "extension",
  },
}
```

`source.id` is extension identity.

`provider.id` is execution adapter identity.

They must not be conflated.

### Provider contract

Use the existing SDK `ToolResult` type where compatible.

Define:

```ts
export interface ToolProvider {
  readonly id: string;
  readonly kind: string;

  listTools(): Promise<readonly ToolDescriptor[]>;

  execute(
    toolId: string,
    input: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult>;
}
```

There is deliberately no:

```ts
getTool()
```

### ExecutionContext

`ExecutionContext` represents dependencies made available only after policy approval.

Use existing internal logger/config/secret types where they already exist rather than redesigning those systems.

Its semantic requirement is:

```text
ExecutionContext may provide approved secret access,
but no secret-capable context may be created before policy allows execution.
```

### Execution result

Prefer the internal normalized discriminated result:

```ts
export type ExecutionResult =
  | {
      readonly ok: true;
      readonly toolId: string;
      readonly output: unknown;
    }
  | {
      readonly ok: false;
      readonly toolId: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };
```

If preserving the existing internal result structure requires an optional-field representation, preserve behavior while keeping `ok`, `toolId`, and stable error codes mandatory.

### Runtime errors

Define an internal error type carrying a stable `code`.

Required initial codes:

```text
DUPLICATE_PROVIDER_ID
PROVIDER_NOT_FOUND
DUPLICATE_TOOL_ID
TOOL_NOT_FOUND
PROVIDER_DESCRIPTOR_MISMATCH
```

Tests must assert `.code`, not error-message wording.

### ProviderRegistry

Define:

```ts
export class ProviderRegistry {
  register(provider: ToolProvider): void;

  get(
    providerId: string,
  ): ToolProvider | undefined;

  require(
    providerId: string,
  ): ToolProvider;
}
```

Responsibilities:

```text
provider instance registration
provider ID uniqueness
provider resolution
```

It must not index tool descriptors.

### ToolRegistry

Define:

```ts
export class ToolRegistry {
  register(
    descriptors: readonly ToolDescriptor[],
  ): void;

  get(
    toolId: string,
  ): ToolDescriptor | undefined;

  search(
    query: string,
  ): ToolSearchResult[];
}
```

Responsibilities:

```text
descriptor registration
global tool ID uniqueness
descriptor lookup
search/ranking
```

It must not own provider instances.

- [ ] **Step 1: Write failing ProviderRegistry tests**

Cover:

```ts
const providers = new ProviderRegistry();

providers.register(nativeProvider);

expect(providers.get("native"))
  .toBe(nativeProvider);
```

Duplicate:

```ts
try {
  providers.register(anotherNativeProvider);
  throw new Error("expected duplicate provider failure");
} catch (error) {
  expect(error).toMatchObject({
    code: "DUPLICATE_PROVIDER_ID",
  });
}
```

Missing:

```ts
expect(
  providers.get("missing"),
).toBeUndefined();
```

And:

```ts
try {
  providers.require("missing");
  throw new Error("expected provider-not-found failure");
} catch (error) {
  expect(error).toMatchObject({
    code: "PROVIDER_NOT_FOUND",
  });
}
```

- [ ] **Step 2: Write failing ToolRegistry tests**

Register:

```ts
registry.register([
  {
    id: "mysql.query",
    description: "Run a read-only MySQL query",
    risk: "read",
    inputSchema: {
      type: "object",
    },
    provider: {
      id: "native",
      kind: "native",
    },
    source: {
      id: "omt-mysql",
      kind: "extension",
    },
  },
]);
```

Assert:

```ts
expect(
  registry.get("mysql.query"),
).toHaveProperty(
  "provider.id",
  "native",
);
```

Duplicate ID must throw:

```text
DUPLICATE_TOOL_ID
```

- [ ] **Step 3: Write a failing progressive-disclosure search test**

Given a descriptor with `inputSchema`, assert:

```ts
const result =
  registry.search("mysql")[0];

expect(result.id)
  .toBe("mysql.query");

expect(result)
  .not.toHaveProperty("inputSchema");
```

- [ ] **Step 4: Add ranking compatibility tests**

Move or reuse representative existing search semantics so normalized descriptor search does not unintentionally change ranking behavior.

- [ ] **Step 5: Run tests and verify failure**

```powershell
bun test packages/cli/test/runtime/registry.test.ts
```

Expected: runtime contracts/registries do not yet exist.

- [ ] **Step 6: Implement runtime types and stable errors**

Implement only the contracts needed by the tests.

Do not add:

```text
Capability
permissions ontology
effects model
workflow metadata
MCP metadata
approval model
```

- [ ] **Step 7: Implement ProviderRegistry**

Enforce provider ID uniqueness.

- [ ] **Step 8: Implement ToolRegistry**

Enforce global tool ID uniqueness.

Reuse existing search/ranking behavior where possible.

Search must produce summary objects without mutating or truncating the stored full descriptor.

- [ ] **Step 9: Run focused tests**

```powershell
bun test packages/cli/test/runtime/registry.test.ts packages/cli/test/search.test.ts
```

Expected: PASS.

- [ ] **Step 10: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add packages/cli/src/runtime packages/cli/test/runtime
git commit -m "feat: add provider-independent runtime contracts"
```

## Gate After Task 4

Do not begin Task 5 until this checkpoint is reviewed.

The following contracts must be considered frozen for the remainder of v0.2:

```text
ToolDescriptor
ToolSearchResult
ToolProvider
ExecutionContext
ExecutionResult

ProviderRegistry.register/get/require
ToolRegistry.register/get/search

provider ID semantics
source ID semantics
runtime error codes
```

---

# Task 5: Move Schema, Policy, and Execution Orchestration into Runtime

**Files:**

- Create: `packages/cli/src/runtime/schema.ts`
- Create: `packages/cli/src/runtime/policy.ts`
- Create: `packages/cli/src/runtime/executor.ts`
- Modify: `packages/cli/src/runtime/errors.ts`
- Modify: `packages/cli/src/core/schema.ts`
- Modify: `packages/cli/src/core/executor.ts`
- Modify: `packages/cli/src/core/registry.ts`
- Modify: imports in affected tests/modules
- Create: `packages/cli/test/runtime/executor.test.ts`

## Interfaces

Expose runtime-local schema validation while preserving existing behavior.

Define an internal policy request containing at least:

```ts
export interface PolicyRequest {
  readonly descriptor: ToolDescriptor;
  readonly input: unknown;
}
```

Wrap/reuse the existing policy implementation behind:

```ts
export interface PolicyPreflight {
  check(
    request: PolicyRequest,
  ): Promise<void>;
}
```

Policy rejection throws an internal runtime error with a stable policy code already used by the existing implementation where possible.

Define:

```ts
export interface ApprovedExecutionRequest {
  readonly descriptor: ToolDescriptor;
  readonly input: unknown;
}

export type CreateExecutionContext =
  (
    request: ApprovedExecutionRequest,
  ) => Promise<ExecutionContext>;
```

Define execution orchestration:

```ts
export interface ExecuteToolOptions {
  readonly descriptor: ToolDescriptor;
  readonly provider: ToolProvider;
  readonly input: unknown;
  readonly policy: PolicyPreflight;
  readonly createExecutionContext:
    CreateExecutionContext;
}

export function executeTool(
  options: ExecuteToolOptions,
): Promise<ExecutionResult>;
```

`executeTool()` owns:

```text
schema validation
-> policy preflight
-> ExecutionContext creation
-> provider.execute
-> result normalization
```

It does not know about:

```text
native manifests
extension directories
handler loaders
dynamic imports
CLI output
```

- [ ] **Step 1: Add behavior-preserving characterization tests**

Move or duplicate existing assertions covering:

```text
schema defaults
required fields
type validation
existing policy failures
existing successful execution result
existing failure normalization
```

These tests should initially pass against compatibility exports.

- [ ] **Step 2: Run characterization tests before moving code**

```powershell
bun test packages/cli/test/runtime/executor.test.ts packages/cli/test/schema.test.ts packages/cli/test/executor.test.ts
```

Expected: existing-behavior assertions PASS.

If a characterization test fails, correct the test before moving production code.

- [ ] **Step 3: Add a failing policy-before-context test**

Create:

```ts
const calls: string[] = [];
```

Use a policy that records:

```text
policy
```

then rejects.

Use:

```ts
createExecutionContext
```

that would record:

```text
context
```

Use a provider whose `execute()` would record:

```text
provider.execute
```

Run execution with policy-denied input.

Assert:

```ts
expect(calls).toEqual([
  "policy",
]);
```

Therefore:

```text
ExecutionContext was not created
provider.execute was not called
```

No handler loader belongs in this test.

- [ ] **Step 4: Add a failing schema-before-policy test**

Use invalid input.

Assert:

```text
policy not called
context not created
provider not called
```

- [ ] **Step 5: Add a failing success-order test**

With valid allowed input, record:

```text
policy
context
provider.execute
```

Assert exact order:

```ts
expect(calls).toEqual([
  "policy",
  "context",
  "provider.execute",
]);
```

- [ ] **Step 6: Run runtime executor tests and verify the new invariants fail**

```powershell
bun test packages/cli/test/runtime/executor.test.ts
```

Expected: new pipeline-order tests FAIL before implementation.

- [ ] **Step 7: Move schema behavior into `runtime/schema.ts`**

Preserve current validation semantics.

Keep temporary compatibility re-exports from old `core` locations where necessary.

- [ ] **Step 8: Move/wrap policy behavior into `runtime/policy.ts`**

Do not remove existing MySQL SQL-specific read-only safeguards.

Descriptor:

```ts
risk: "read"
```

does not by itself authorize arbitrary SQL.

- [ ] **Step 9: Implement generic runtime executor**

Required structure:

```ts
validateInput(
  descriptor.inputSchema,
  input,
);

await policy.check({
  descriptor,
  input,
});

const context =
  await createExecutionContext({
    descriptor,
    input,
  });

const toolResult =
  await provider.execute(
    descriptor.id,
    input,
    context,
  );

return normalizeToolResult(
  descriptor.id,
  toolResult,
);
```

- [ ] **Step 10: Keep compatibility exports temporarily**

Existing unrelated imports should continue to work until commands are migrated in Task 7.

Do not maintain two independent execution implementations.

- [ ] **Step 11: Run focused tests**

```powershell
bun test packages/cli/test/runtime/executor.test.ts packages/cli/test/schema.test.ts packages/cli/test/executor.test.ts
```

Expected: PASS.

- [ ] **Step 12: Run all CLI tests**

```powershell
bun test packages/cli/test
```

Expected: PASS.

- [ ] **Step 13: Commit**

```powershell
git add packages/cli/src/core packages/cli/src/runtime packages/cli/test
git commit -m "refactor: move execution orchestration into runtime"
```

---

# Task 6: Implement NativeExtensionProvider

**Files:**

- Create: `packages/cli/src/runtime/providers/native/provider.ts`
- Create: `packages/cli/src/runtime/providers/native/discovery.ts`
- Create: `packages/cli/src/runtime/providers/native/manifest.ts`
- Create: `packages/cli/src/runtime/providers/native/loader.ts`
- Create: `packages/cli/src/runtime/providers/native/install.ts`
- Modify: `packages/cli/src/extension/*.ts` to re-export or delegate where required
- Create: `packages/cli/test/runtime/native-provider.test.ts`
- Create persistent fixture: `packages/cli/test/fixtures/extensions/test-echo/`
- Create persistent fixture: `packages/cli/test/fixtures/extensions/poison-handler/`

## Interfaces

Define:

```ts
export class NativeExtensionProvider
  implements ToolProvider {
  readonly id = "native";
  readonly kind = "native";

  listTools():
    Promise<readonly ToolDescriptor[]>;

  execute(
    toolId: string,
    input: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult>;
}
```

Native descriptors must normalize:

```ts
provider: {
  id: "native",
  kind: "native",
}
```

and:

```ts
source: {
  id: extensionManifest.id,
  kind: "extension",
}
```

`listTools()` is static-only.

`execute()` assumes runtime validation and policy approval have already succeeded.

The Native Provider must not:

```text
perform generic policy checks
decide approval
create global secret stores
read secrets during listTools
load handlers during listTools
```

- [ ] **Step 1: Create the persistent `test-echo` extension fixture**

Use the exact current Extension SDK/manifest schema.

Expose a tool:

```text
test.echo
```

with a simple object input such as:

```json
{
  "value": "hello"
}
```

The handler returns the existing valid SDK `ToolResult` representation containing the input value.

This fixture must remain usable by Task 9.

- [ ] **Step 2: Create the persistent poison extension fixture**

Expose a tool such as:

```text
test.poison
```

The handler module must throw at module evaluation time:

```ts
throw new Error(
  "HANDLER_IMPORTED",
);
```

The static manifest itself remains valid.

- [ ] **Step 3: Write failing `listTools()` tests**

Point `NativeExtensionProvider` at the poison fixture.

Call:

```ts
await provider.listTools();
```

Assert:

```text
descriptor returned successfully
HANDLER_IMPORTED not thrown
```

Also assert:

```ts
descriptor.provider
```

equals:

```ts
{
  id: "native",
  kind: "native",
}
```

and:

```ts
descriptor.source.id
```

equals the fixture extension manifest ID.

- [ ] **Step 4: Write a failing execution-loading test**

Using the poison extension:

```ts
await provider.execute(
  "test.poison",
  {},
  approvedContext,
);
```

Expected: `HANDLER_IMPORTED` is observed.

This proves dynamic import happens only during execution.

- [ ] **Step 5: Write a failing successful execution test**

Using `test-echo`:

```ts
const result =
  await provider.execute(
    "test.echo",
    {
      value: "hello",
    },
    approvedContext,
  );
```

Expected: existing SDK-compatible `ToolResult` is returned.

- [ ] **Step 6: Run focused tests and verify failure**

```powershell
bun test packages/cli/test/runtime/native-provider.test.ts
```

Expected: provider is missing or still coupled to old extension wiring.

- [ ] **Step 7: Move/wrap static extension discovery**

Reuse current extension discovery logic.

Do not redesign:

```text
manifest schema
install format
extension directory layout
SDK interfaces
```

- [ ] **Step 8: Move/wrap manifest handling**

Normalize existing static manifest tools into `ToolDescriptor`.

Preserve:

```text
tool ID
description
keywords
risk
input schema
```

- [ ] **Step 9: Move/wrap dynamic loader**

Dynamic import must happen only when:

```ts
NativeExtensionProvider.execute()
```

is invoked for the selected tool.

- [ ] **Step 10: Move/wrap install behavior**

Preserve existing extension install semantics under the new centralized paths.

- [ ] **Step 11: Keep extension compatibility modules as delegates/re-exports**

Do not leave duplicated implementations.

- [ ] **Step 12: Run focused provider tests**

```powershell
bun test packages/cli/test/runtime/native-provider.test.ts
```

Expected: PASS.

- [ ] **Step 13: Run CLI and SDK tests**

```powershell
bun test packages/cli/test packages/sdk/test
```

Expected: PASS.

- [ ] **Step 14: Commit**

```powershell
git add packages/cli/src packages/cli/test
git commit -m "refactor: add native extension provider"
```

---

# Task 7: Add ToolRuntime and Route the CLI Through It

**Files:**

- Create: `packages/cli/src/runtime/runtime.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Modify: `packages/cli/src/cli/commands/search.ts`
- Modify: `packages/cli/src/cli/commands/describe.ts`
- Modify: `packages/cli/src/cli/commands/run.ts`
- Modify: `packages/cli/src/cli/commands/extension.ts`
- Create: `packages/cli/test/runtime/runtime.test.ts`
- Modify: `packages/cli/test/smoke.test.ts`

## Interfaces

Define:

```ts
export interface ToolRuntimeOptions {
  readonly providers:
    readonly ToolProvider[];

  readonly policy:
    PolicyPreflight;

  readonly createExecutionContext:
    CreateExecutionContext;
}
```

Define:

```ts
export class ToolRuntime {
  search(
    query: string,
  ): Promise<ToolSearchResult[]>;

  describe(
    toolId: string,
  ): Promise<ToolDescriptor>;

  run(
    toolId: string,
    input: unknown,
  ): Promise<ExecutionResult>;
}
```

Define async factory:

```ts
export async function createToolRuntime(
  options: ToolRuntimeOptions,
): Promise<ToolRuntime>;
```

The factory is provider-independent.

It must not hardcode:

```text
NativeExtensionProvider
McpProvider
```

CLI composition owns provider selection.

## Factory Initialization

For each supplied provider:

```text
register provider
-> await provider.listTools()
-> validate every descriptor.provider.id
-> validate descriptor.provider.kind
-> register descriptors
```

Only after all supplied providers succeed does the factory return `ToolRuntime`.

If:

```ts
descriptor.provider.id !== provider.id
```

or provider kind mismatches, fail initialization with:

```text
PROVIDER_DESCRIPTOR_MISMATCH
```

Duplicate providers fail with:

```text
DUPLICATE_PROVIDER_ID
```

Duplicate tool IDs across providers fail with:

```text
DUPLICATE_TOOL_ID
```

- [ ] **Step 1: Write failing fake-provider facade tests**

Create a fake provider exposing:

```text
mysql.query
```

Assert:

```ts
const runtime =
  await createToolRuntime({
    providers: [fakeProvider],
    policy: allowPolicy,
    createExecutionContext,
  });

expect(
  (await runtime.search("mysql"))[0].id,
).toBe("mysql.query");

expect(
  (await runtime.search("mysql"))[0],
).not.toHaveProperty(
  "inputSchema",
);

expect(
  await runtime.describe(
    "mysql.query",
  ),
).toHaveProperty(
  "inputSchema",
);
```

- [ ] **Step 2: Add failing tool-not-found tests**

Search:

```ts
expect(
  await runtime.search(
    "does-not-exist",
  ),
).toEqual([]);
```

Describe must reject with:

```text
TOOL_NOT_FOUND
```

Run must reject or normalize according to the chosen runtime error boundary, but the stable internal code must be:

```text
TOOL_NOT_FOUND
```

- [ ] **Step 3: Add failing provider-descriptor mismatch test**

Supply provider:

```text
id = native
```

whose descriptor incorrectly says:

```text
provider.id = another-provider
```

Factory creation must fail with:

```text
PROVIDER_DESCRIPTOR_MISMATCH
```

before returning a runtime.

- [ ] **Step 4: Add failing duplicate-across-providers test**

Provider A and Provider B both expose:

```text
same.tool
```

Expected factory failure:

```text
DUPLICATE_TOOL_ID
```

before commands can be served.

- [ ] **Step 5: Add failing Runtime + Native static-discovery test**

Construct a real `NativeExtensionProvider` against the poison fixture.

Use:

```ts
let contextCreated = false;
```

Search:

```ts
await runtime.search("poison");
```

Describe:

```ts
await runtime.describe(
  "test.poison",
);
```

Expected:

```text
no HANDLER_IMPORTED
contextCreated === false
```

This proves Runtime search/describe remain static-only.

- [ ] **Step 6: Add failing full run-pipeline test**

Using fake provider, record:

```text
policy
context
provider.execute
```

Expected order:

```text
policy
context
provider.execute
```

Result:

```ts
{
  ok: true,
  toolId: "test.echo",
  ...
}
```

- [ ] **Step 7: Run runtime tests and verify failure**

```powershell
bun test packages/cli/test/runtime/runtime.test.ts
```

Expected: facade/factory missing.

- [ ] **Step 8: Implement provider-independent async factory**

Pseudo-structure:

```ts
export async function createToolRuntime(
  options: ToolRuntimeOptions,
): Promise<ToolRuntime> {
  const providers =
    new ProviderRegistry();

  const tools =
    new ToolRegistry();

  for (
    const provider of options.providers
  ) {
    providers.register(provider);

    const descriptors =
      await provider.listTools();

    for (
      const descriptor of descriptors
    ) {
      assertProviderIdentity(
        provider,
        descriptor,
      );
    }

    tools.register(descriptors);
  }

  return new ToolRuntime({
    providers,
    tools,
    policy: options.policy,
    createExecutionContext:
      options.createExecutionContext,
  });
}
```

- [ ] **Step 9: Implement Runtime search**

Use only:

```text
ToolRegistry.search
```

No provider call is allowed during normal search after runtime initialization.

- [ ] **Step 10: Implement Runtime describe**

Use only:

```text
ToolRegistry.get
```

Missing descriptor:

```text
TOOL_NOT_FOUND
```

Do not call:

```text
provider.listTools
provider.execute
```

during describe.

- [ ] **Step 11: Implement Runtime run**

Required flow:

```ts
const descriptor =
  tools.get(toolId);

if (!descriptor) {
  throw toolNotFound(toolId);
}

const provider =
  providers.require(
    descriptor.provider.id,
  );

return executeTool({
  descriptor,
  provider,
  input,
  policy,
  createExecutionContext,
});
```

- [ ] **Step 12: Compose Native Provider in CLI context**

`runtime/runtime.ts` must not instantiate Native Provider.

`cli/context.ts` should conceptually do:

```ts
const paths =
  createPaths(...);

await prepareHome(paths);

const nativeProvider =
  new NativeExtensionProvider({
    paths,
    ...
  });

const runtime =
  await createToolRuntime({
    providers: [
      nativeProvider,
    ],
    policy,
    createExecutionContext,
  });
```

- [ ] **Step 13: Replace search command wiring**

Command responsibilities become:

```text
parse args
-> runtime.search()
-> format output
```

The command must no longer construct:

```text
registry
extension loader
schema validator
secret manager
executor chain
```

- [ ] **Step 14: Replace describe command wiring**

Command responsibilities:

```text
parse tool ID
-> runtime.describe()
-> format output
```

- [ ] **Step 15: Replace run command wiring**

Command responsibilities:

```text
parse key=value or stdin input
-> runtime.run()
-> format result
-> map result/error to CLI exit code
```

- [ ] **Step 16: Keep extension management outside runtime execution facade**

Extension install/list commands remain management operations.

They may use Native Provider/native install infrastructure and centralized paths directly.

Do not force installation into:

```text
ToolRuntime.search/describe/run
```

- [ ] **Step 17: Add an architecture dependency test**

Scan TypeScript files below:

```text
packages/cli/src/runtime
```

and fail if they import:

```text
../cli
/cli/
src/cli
```

This protects:

```text
runtime -> CLI
```

from appearing later.

- [ ] **Step 18: Run runtime tests**

```powershell
bun test packages/cli/test/runtime
```

Expected: PASS.

- [ ] **Step 19: Run all tests**

```powershell
bun test
```

Expected: PASS.

- [ ] **Step 20: Commit**

```powershell
git add packages/cli/src packages/cli/test
git commit -m "refactor: route CLI commands through ToolRuntime"
```

---

# Task 8: Update the Bundled Agent Skill and Project Documentation

**Files:**

- Modify: `packages/cli/assets/skills/oh-my-tool/SKILL.md`
- Modify: `README.md`
- Modify: relevant skill/integration tests
- Prefer: `packages/cli/test/integration.test.ts` if that is the existing location

## Interfaces

The documented agent protocol becomes:

```text
search
-> describe
-> run
```

with the executable:

```text
ohmytool
```

Positioning:

```text
Oh My Tool — The Agent Tool Runtime
```

The documentation must distinguish:

```text
ToolRuntime
ToolProvider
Native Extension
Agent Skill
CLI adapter
```

without introducing MCP implementation details in v0.2.

- [ ] **Step 1: Add failing skill-content assertions**

Assert bundled Skill contains executable examples using:

```text
ohmytool search
ohmytool describe
ohmytool run
```

- [ ] **Step 2: Add a failing obsolete-command assertion**

Reject executable command lines starting with:

```text
omt 
```

or using:

```text
omt call
```

Do not reject legitimate migration documentation containing:

```text
~/.omt
```

- [ ] **Step 3: Run documentation integration tests**

```powershell
bun test packages/cli/test/integration.test.ts
```

Expected: FAIL while old command examples remain.

- [ ] **Step 4: Update bundled Agent Skill**

The Skill should instruct an Agent to use:

```text
1. ohmytool search "<intent>"
2. ohmytool describe <tool-id>
3. ohmytool run <tool-id> ...
```

Explain that search is intentionally lightweight and describe is used before execution when schema details are needed.

- [ ] **Step 5: Update README positioning**

Use:

```text
Oh My Tool — The Agent Tool Runtime
```

Explain current v0.2 model:

```text
Agent
  |
Skill / CLI
  |
ToolRuntime
  |
ToolProvider
  |
NativeExtensionProvider
  |
Existing Extensions
```

Document that Runtime is internal for now.

Do not advertise:

```text
MCP implementation
JDK discovery
workflow engine
daemon
marketplace
approval UI
```

as completed features.

- [ ] **Step 6: Document CLI migration**

Canonical:

```text
omt call
    ->
ohmytool run
```

Home:

```text
~/.omt
    ->
~/.oh-my-tool
```

Override:

```text
OH_MY_TOOL_HOME
```

State explicitly that the legacy home is preserved during automatic migration.

- [ ] **Step 7: Run documentation tests**

```powershell
bun test packages/cli/test/integration.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run all tests**

```powershell
bun test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add README.md packages/cli/assets/skills packages/cli/test
git commit -m "docs: update Agent Tool Runtime positioning"
```

---

# Task 9: Run Final Native Extension Regression and Architecture Gates

**Files:**

Only modify implementation/tests if a real regression is discovered.

Independent repositories:

```text
../omt-mysql
../omt-redis
```

must remain contract-compatible.

## Interfaces

This task proves the complete architecture:

```text
unchanged native extension
        |
        v
NativeExtensionProvider
        |
        v
ToolRuntime
        |
        v
ohmytool search
ohmytool describe
ohmytool run
```

- [ ] **Step 1: Run final root install with frozen lockfile**

From `oh-my-tool`:

```powershell
bun install --frozen-lockfile
```

Expected: PASS with no lockfile modifications.

- [ ] **Step 2: Run complete root tests**

```powershell
bun test
```

Expected: PASS.

Record final exact totals.

- [ ] **Step 3: Re-run independent MySQL tests**

```powershell
Set-Location ..\omt-mysql
bun install --frozen-lockfile
bun test
```

Expected: PASS without changing the independent extension contract.

- [ ] **Step 4: Re-run independent Redis tests**

```powershell
Set-Location ..\omt-redis
bun install --frozen-lockfile
bun test
```

Expected: PASS.

- [ ] **Step 5: Create an isolated gate home outside the repository**

From the `oh-my-tool` repository:

```powershell
$gateHome = Join-Path `
  $env:TEMP `
  "oh-my-tool-v02-gate"

if (Test-Path $gateHome) {
  Remove-Item `
    -Recurse `
    -Force `
    $gateHome
}

$env:OH_MY_TOOL_HOME = $gateHome
```

Expected:

```text
no real ~/.oh-my-tool touched
no real ~/.omt migration attempted
```

because explicit home override disables automatic migration.

- [ ] **Step 6: Verify CLI identity**

Run:

```powershell
bun packages/cli/bin/ohmytool.ts --version
```

Expected:

```text
command succeeds
output uses canonical ohmytool identity
```

Run help:

```powershell
bun packages/cli/bin/ohmytool.ts --help
```

Expected canonical commands:

```text
search
describe
run
```

Expected no default:

```text
call
```

- [ ] **Step 7: Install unchanged MySQL extension into the isolated home**

Run:

```powershell
bun packages/cli/bin/ohmytool.ts `
  extension install `
  ..\omt-mysql
```

Expected: install succeeds without modifying the extension manifest or SDK contract.

- [ ] **Step 8: Verify MySQL discovery**

Run:

```powershell
bun packages/cli/bin/ohmytool.ts `
  search "mysql"
```

Expected:

```text
mysql.query discoverable
```

Run:

```powershell
bun packages/cli/bin/ohmytool.ts `
  describe mysql.query
```

Expected:

```text
full descriptor returned
provider.id = native
provider.kind = native
source identifies omt-mysql
inputSchema present
```

No database connection is required.

- [ ] **Step 9: Install unchanged Redis extension**

Run:

```powershell
bun packages/cli/bin/ohmytool.ts `
  extension install `
  ..\omt-redis
```

Expected: install succeeds unchanged.

- [ ] **Step 10: Verify Redis discovery**

Run:

```powershell
bun packages/cli/bin/ohmytool.ts `
  search "redis"
```

Expected Redis tools appear.

Run the actual existing Redis tool ID from the unchanged manifest, for example `redis.get` if that remains the manifest ID:

```powershell
bun packages/cli/bin/ohmytool.ts `
  describe redis.get
```

Expected:

```text
full descriptor
native provider metadata
omt-redis source metadata
inputSchema present
```

No Redis server is required.

- [ ] **Step 11: Install the persistent deterministic echo fixture**

Run:

```powershell
bun packages/cli/bin/ohmytool.ts `
  extension install `
  .\packages\cli\test\fixtures\extensions\test-echo
```

Expected: install succeeds.

- [ ] **Step 12: Run the deterministic complete execution path**

Run:

```powershell
'{"value":"hello"}' |
  bun packages/cli/bin/ohmytool.ts `
    run test.echo --stdin
```

Expected:

```text
exit success
ExecutionResult.ok = true
toolId = test.echo
output contains hello
```

This is the required release execution gate.

It must not depend on:

```text
MySQL credentials
Redis credentials
network access
external process
MCP
```

- [ ] **Step 13: Optionally run real native read-only smoke tests**

Only if valid local MySQL/Redis test configuration already exists.

These checks are optional and not release requirements.

Do not weaken MySQL read-only policy merely to make an optional smoke test pass.

- [ ] **Step 14: Clean the temporary gate home**

Run:

```powershell
Remove-Item `
  -Recurse `
  -Force `
  $gateHome

Remove-Item `
  Env:OH_MY_TOOL_HOME
```

Expected: isolated test state removed.

- [ ] **Step 15: Verify no repository artifacts leaked from the gate**

Run:

```powershell
git status --short
```

Expected:

```text
no .gate-home
no generated secrets
no extension copies
no cache state
```

- [ ] **Step 16: Verify the final diff**

Run:

```powershell
git diff main --check
```

Expected: PASS.

Then:

```powershell
git diff main --stat
```

Review expected changes only:

```text
CLI rename
paths/migration
runtime contracts
registries
execution migration
NativeExtensionProvider
ToolRuntime facade
tests
Skill
README
spec/plan/baseline
```

- [ ] **Step 17: Run the final test suite one last time**

```powershell
bun test
```

Expected: PASS.

- [ ] **Step 18: Commit regression fixes only if needed**

If Task 9 discovered and fixed actual regressions:

```powershell
git add packages README.md
git commit -m "test: verify native provider regression gates"
```

Do not create an empty commit if no regression fix was necessary.

---

# Definition of Done

v0.2 is complete only when all of the following are true:

- [ ] `ohmytool` is the only default executable exposed by the CLI package.
- [ ] `run` is the canonical execution command.
- [ ] `call` is no longer part of the default CLI command contract.
- [ ] `OH_MY_TOOL_HOME` is the only production home override.
- [ ] Default state lives under `~/.oh-my-tool` or `%USERPROFILE%\.oh-my-tool`.
- [ ] Legacy `~/.omt` migration is non-destructive.
- [ ] Explicit custom home disables legacy migration.
- [ ] Migration happens before new default-home creation.
- [ ] `ToolDescriptor` is provider-independent.
- [ ] Native provider identity is `native`.
- [ ] Native extension identity is represented separately as `source`.
- [ ] `ProviderRegistry` owns providers only.
- [ ] `ToolRegistry` owns normalized descriptors only.
- [ ] Duplicate provider IDs are rejected.
- [ ] Duplicate tool IDs are rejected globally.
- [ ] Runtime initialization finishes discovery before serving commands.
- [ ] Search returns summaries without `inputSchema`.
- [ ] Describe returns the full descriptor including `inputSchema`.
- [ ] Search does not import handlers.
- [ ] Describe does not import handlers.
- [ ] Search does not create secret-capable execution context.
- [ ] Describe does not create secret-capable execution context.
- [ ] Schema validation happens before policy.
- [ ] Policy happens before execution-context creation.
- [ ] Policy denial prevents `provider.execute`.
- [ ] Native handler loading happens only in `NativeExtensionProvider.execute`.
- [ ] Runtime does not import CLI modules.
- [ ] CLI search delegates through `ToolRuntime`.
- [ ] CLI describe delegates through `ToolRuntime`.
- [ ] CLI run delegates through `ToolRuntime`.
- [ ] Existing MySQL read-only protection remains intact.
- [ ] `omt-mysql` tests remain green unchanged.
- [ ] `omt-redis` tests remain green unchanged.
- [ ] Existing MySQL extension installs unchanged through the new CLI.
- [ ] Existing Redis extension installs unchanged through the new CLI.
- [ ] Existing MySQL descriptors are discoverable through `ToolRuntime`.
- [ ] Existing Redis descriptors are discoverable through `ToolRuntime`.
- [ ] Deterministic `test.echo` execution succeeds through the complete CLI/runtime/provider/extension path.
- [ ] Root test suite passes.
- [ ] Final diff contains no secrets, temporary homes, generated caches, or unrelated changes.

---

# Explicitly Deferred to Later Versions

Do not add these while implementing this plan:

```text
McpProvider
MCP northbound adapter
MCP server lifecycle
JDK discovery
Local environment discovery
audit log implementation
approval UI
interactive approvals
daemon
GUI
workflow engine
agent orchestration
marketplace
public Runtime package
Capability abstraction
complex permission ontology
effects model
provider routing/failover
remote extension distribution
```

The architectural extension point for future work is deliberately only:

```ts
interface ToolProvider {
  readonly id: string;
  readonly kind: string;

  listTools():
    Promise<
      readonly ToolDescriptor[]
    >;

  execute(
    toolId: string,
    input: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult>;
}
```

v0.2 must prove this abstraction with the existing Native Extension ecosystem before another provider type is introduced.

---

# Recommended Execution Strategy

Use:

```text
superpowers:subagent-driven-development
```

with one implementation subagent per Task and a review checkpoint after every Task.

The strongest mandatory checkpoint is:

```text
Task 4 complete
    ↓
review Runtime contracts
    ↓
only then continue to Task 5
```

Recommended sequence:

```text
Task 1  Baseline
   ↓
Task 2  CLI rename
   ↓
Task 3  Paths + migration
   ↓
Task 4  Runtime contract freeze
   ↓
        REVIEW GATE
   ↓
Task 5  Execution orchestration
   ↓
Task 6  NativeExtensionProvider
   ↓
Task 7  ToolRuntime + CLI routing
   ↓
Task 8  Skill + README
   ↓
Task 9  Full native regression gates
```

The v0.2 architecture should be considered proven only after Task 9 demonstrates:

```text
unchanged omt-mysql
unchanged omt-redis
        |
        v
NativeExtensionProvider
        |
        v
ToolRuntime
        |
        v
ohmytool
```

with all regression gates green.