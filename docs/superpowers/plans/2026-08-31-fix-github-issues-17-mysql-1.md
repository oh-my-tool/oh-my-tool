# Fix GitHub Issues #17 and MySQL #1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Windows npm extension installation in Core and the broken bounded-query call in the MySQL extension.

**Architecture:** Keep the existing extension installation and MySQL client boundaries. Core will select the Windows npm shim explicitly and preserve the underlying installation error; MySQL will exercise the real Bun client factory path and call the already-defined bounded SQL helper.

**Tech Stack:** TypeScript, Bun test, Node `child_process`, Bun SQL bundle.

**Spec:** GitHub issues [oh-my-tool#17](https://github.com/oh-my-tool/oh-my-tool/issues/17) and [omt-mysql#1](https://github.com/oh-my-tool/omt-mysql/issues/1).

## Global Constraints

- Do not weaken official-package validation or MySQL read-only SQL enforcement.
- Keep exact npm version validation and installed manifest validation unchanged.
- The MySQL published `dist/index.js` must be rebuilt from source after the fix.
- Add regression coverage for the actual failing behavior, not only helper functions.

---

### Task 1: Fix Core Windows npm extension installation

**Files:**
- Modify: `packages/cli/src/extension/install.ts`
- Test: `packages/cli/test/install.test.ts`

**Interfaces:**
- Produces `npmExecutableForPlatform(platform?: NodeJS.Platform): string`, returning `npm.cmd` for `win32` and `npm` otherwise.
- `installNpmExtension` continues to accept the existing injected high-level installer and uses the platform-specific executable for the default installer.

- [x] **Step 1: Write the failing tests**

Add tests that assert Windows resolves `npm.cmd`, non-Windows resolves `npm`, and an injected npm failure retains the underlying message in `ExtensionInstallError`.

- [x] **Step 2: Run the focused Core test and verify it fails**

Run: `bun test packages/cli/test/install.test.ts`

Expected: FAIL because the executable helper is absent and the installation error currently hides the original message.

- [x] **Step 3: Implement the minimal fix**

Export the platform resolver, call `execFile(npmExecutableForPlatform(), ...)`, and include the caught error message while retaining the generic operation context.

- [x] **Step 4: Run the focused Core test and verify it passes**

Run: `bun test packages/cli/test/install.test.ts`

Expected: PASS with all install tests green.

### Task 2: Fix the MySQL bundled client path

**Files:**
- Modify: `omt-mysql/src/client.ts`
- Modify: `omt-mysql/test/mysql.test.ts`
- Regenerate: `omt-mysql/dist/index.js`

**Interfaces:**
- `bunClientFactory` remains internal and returns the existing `SqlClient` contract.
- The regression test loads the built extension entry and verifies the real client query path no longer references the missing symbol.

- [x] **Step 1: Write the failing test**

Add a test that asserts the source client invokes `buildBoundedSql` through a real Bun SQL client or, where Bun SQL cannot connect in unit tests, verifies the built bundle contains the helper definition and does not contain a call to `addSelectLimit`.

- [x] **Step 2: Run the focused MySQL test and verify it fails**

Run: `bun test test/mysql.test.ts`

Expected: FAIL with the undefined `addSelectLimit` behavior or bundle assertion.

- [x] **Step 3: Implement the minimal fix and rebuild**

Change the client call to `buildBoundedSql`, then run `npm run build` to regenerate `dist/index.js`.

- [x] **Step 4: Run the focused MySQL test and verify it passes**

Run: `npm run build && bun test test/mysql.test.ts`

Expected: PASS with the built bundle regression covered.

### Task 3: Full verification

- [x] Run Core `npm run check`.
- [x] Run MySQL `npm run check`.
- [x] Inspect both repository diffs and confirm only issue-related files changed.
