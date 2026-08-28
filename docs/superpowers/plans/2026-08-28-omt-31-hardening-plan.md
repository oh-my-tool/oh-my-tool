# OMT 3.1 Hardening and Capability Plan

**Goal:** Harden the Core, MySQL, and Redis extensions, complete the promised limits and connection diagnostics, improve output reliability, and publish all three packages as version 0.3.1.

**Architecture:** Keep the existing provider/extension boundary. Core owns strict generic configuration validation, common CLI formatting, connection listing/checking, and runtime lifecycle; MySQL and Redis own protocol-specific limits, metadata, and safe read operations. Preserve the approved row-matrix default and `--json` escape hatch.

**Tech Stack:** TypeScript, Bun 1.4+, Bun test, npm package scripts, TOML configuration, native OMT extension manifests.

**Spec:** The approved review items in the conversation: effective limits/timeouts, safe identifiers and SQL policy, Redis bounded scans, strict config validation, unified execution/output, connection diagnostics, schema/query improvements, and 3.1 release.

## Global Constraints

- Do not expose passwords, secret names, or secret values in instance listings, errors, audit output, or JSON output.
- Agent-supplied connection credentials remain forbidden; agents select configured connection names only.
- Read-only tools remain read-only and reject multiple SQL statements.
- MySQL default query output remains a row matrix with the first row containing column names; `--json` remains machine-readable JSON.
- Limits must be enforced before unbounded reads; timeout failures must not leave a protocol connection reusable.
- All changed source must have a regression test written and observed failing before implementation.
- Publish only after Core, Redis, and MySQL full checks, packaging checks, diff checks, and final review pass.

---

### Task 1: Core configuration and execution foundations

**Files:**
- Modify: `packages/cli/src/config/config.ts`
- Modify: `packages/cli/src/cli/context.ts`
- Modify: `packages/cli/src/core/executor.ts`
- Modify: `packages/cli/src/runtime/executor.ts`
- Modify: `packages/cli/src/runtime/providers/native/provider.ts`
- Test: `packages/cli/test/config.test.ts`, `packages/cli/test/executor.test.ts`, runtime/native tests

- [ ] Add strict connection validation for host, port, database, username, secret, and boolean TLS values.
- [ ] Add a shared sanitized connection summary including extension, name, and secret-reference status without the secret name.
- [ ] Consolidate or clearly delegate the legacy executor to the runtime executor so policy and context behavior cannot diverge.
- [ ] Preserve extension version in native descriptors and `describe` results.
- [ ] Add lazy/isolated handling for unavailable MCP providers so an unrelated MCP failure does not prevent local native discovery and instance listing.

### Task 2: CLI diagnostics and output reliability

**Files:**
- Modify: `packages/cli/src/cli/index.ts`
- Modify: `packages/cli/src/cli/parseArgs.ts`
- Modify: `packages/cli/src/cli/output.ts`
- Add/modify: `packages/cli/src/cli/commands/connections.ts`
- Test: CLI command, parser, output, and end-to-end tests

- [ ] Add `ohmytool connection list` and `ohmytool connection check` with bounded concurrent checks and redacted failures.
- [ ] Reject unknown flags, duplicate conflicting inputs, malformed stdin roots, and unsupported value forms with stable error codes.
- [ ] Support `--format text|json|table|csv` while keeping `--json` as an alias for JSON.
- [ ] Use a JSON replacer for BigInt, Date, Buffer-like values, and circular/unserializable values.
- [ ] Keep all result formats deterministic and preserve the MySQL row-matrix contract.

### Task 3: MySQL safety, limits, and metadata

**Files:**
- Modify: `omt-mysql/src/query.ts`
- Modify: `omt-mysql/src/execute.ts`
- Modify: `omt-mysql/src/client.ts`
- Modify: `omt-mysql/src/schema.ts`
- Modify: `omt-mysql/src/readonly.ts`
- Modify: `omt-mysql/omt.manifest.json`, `omt-mysql/README.md`
- Test: `omt-mysql/test/mysql.test.ts`

- [ ] Enforce `maxRows`, mark truncation, and apply a server-side limit where the statement type permits it.
- [ ] Enforce `timeoutMs`, close timed-out clients, and return a stable timeout error.
- [ ] Escape backticks in table identifiers and reject empty/invalid identifiers.
- [ ] Replace duplicated permissive SQL filtering with a shared, tested read-only statement policy or a strict statement-head whitelist.
- [ ] Preserve column metadata for empty results when the driver provides it; otherwise document the explicit empty-column behavior.
- [ ] Extend schema metadata with field types, keys, defaults, and indexes without making extra unbounded reads.
- [ ] Validate parameter shape and add query truncation/timeout regression coverage.

### Task 4: Redis protocol safety and bounded reads

**Files:**
- Modify: `omt-redis/src/client.ts`
- Modify: `omt-redis/src/get.ts`
- Modify: `omt-redis/src/scan.ts`
- Modify: `omt-redis/src/instances.ts`
- Modify: `omt-redis/omt.manifest.json`, `omt-redis/README.md`
- Test: `omt-redis/test/client.test.ts`, `omt-redis/test/handlers.test.ts`

- [ ] Close and fail all pending commands after command timeout, socket errors, or protocol parse errors.
- [ ] Use certificate verification by default and add an explicit CA/insecure compatibility option only if needed.
- [ ] Replace unbounded `SMEMBERS` with bounded `SSCAN`; use cursors for hash and sorted-set truncation detection.
- [ ] Add optional connection checks and stable latency/status output.
- [ ] Cover large-key, timeout, malformed-response, and TLS configuration behavior.

### Task 5: Documentation, versioning, and release

**Files:**
- Modify: all three `package.json` files, manifests, READMEs, and release documentation
- Modify: generated `dist/index.js` files
- Test: all package checks and smoke tests

- [ ] Update all package and manifest versions consistently to `0.3.1` and update SDK/API compatibility metadata deliberately.
- [ ] Document new diagnostics, formats, limits, truncation behavior, and security defaults.
- [ ] Run Core `npm run check`, Redis `npm run check`, and MySQL `npm run check` with isolated npm caches if needed.
- [ ] Run `git diff --check`, inspect all staged files, commit with a release message, push `main`, and push the `v0.3.1` tags only after final verification.
