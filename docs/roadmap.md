# Oh My Tool Roadmap

This document is the product and architecture direction for Oh My Tool. It is
organized around outcomes and exit criteria rather than fixed dates.

## Released — v0.2 Provider-independent Tool Runtime

Goal: provide a local-first runtime that lets agents discover and execute tools
through a stable CLI and provider contract.

Why: the runtime needs a dependable foundation before it can consume remote
tool ecosystems or expose richer governance controls.

Scope:

- provider-independent `ToolRuntime`, registries, and CLI discovery flow
- native extension loading with static-manifest and dynamic-handler separation
- schema validation, policy preflight, secrets, and audit-safe output
- independent extension compatibility for MySQL and Redis

Non-goals:

- MCP consumption or serving
- local JDK/environment discovery
- workflow orchestration, GUI, marketplace, or daemon features

Exit criteria: agents can use `ohmytool search`, `ohmytool describe`, and
`ohmytool run` without depending on a concrete database or cache implementation.

## Released — v0.3 MCP Provider Integration

Goal: allow OMT to consume existing MCP servers as first-class `ToolProvider`s.

Why: MCP is the next provider boundary, and the agent should not need to know
whether a tool comes from a native extension or an MCP server.

Scope:

- MCP provider configuration and multiple server definitions
- stdio and Streamable HTTP transports
- `tools/list` and `tools/call`
- MCP tool to `ToolDescriptor` normalization
- tool namespaces and collision handling
- MCP authentication and secret integration
- end-to-end integration tests
- OAuth 2.1 authorization-code + PKCE, dynamic/pre-registered clients, and
  explicit `mcp list` / `mcp auth` / `mcp logout` commands

Non-goals:

- MCP resources or prompts
- MCP server / northbound MCP support
- GUI or workflow orchestration

Exit criteria: `ohmytool search`, `ohmytool describe`, and `ohmytool run` work
the same way for native and MCP-backed tools. These capabilities are released in
v0.3.3; subsequent hardening and provider additions are tracked separately.

## Planned — v0.4 Governance Foundation

Goal: make tool execution governable and explainable as the number of providers
and capabilities grows.

Scope:

- explicit capability and risk metadata
- policy decisions that are inspectable before execution
- consistent audit events and redaction rules
- provider-level trust and configuration boundaries
- tests covering denied, approved, and secret-bearing executions

Non-goals:

- hosted policy management
- approval UI
- organization-wide identity and billing

Exit criteria: maintainers can explain why an execution was allowed or denied,
and audit output does not disclose secret values.

## Planned — v0.5 Local Capability Discovery

Goal: discover compatible local runtimes and capabilities without making local
environment setup part of every extension.

Scope:

- JDK and other supported local runtime discovery
- capability detection and normalized metadata
- clear diagnostics for missing or incompatible prerequisites
- opt-in discovery behavior with predictable performance

Non-goals:

- automatic installation of system runtimes
- cloud resource discovery
- a general-purpose package manager

Exit criteria: an agent can determine which locally available capabilities can
support a requested tool before attempting execution.

## Exploring — v0.6+ Northbound Adapters

Potential directions include northbound MCP serving, SDK integrations, and
additional agent adapters. These remain exploratory until the provider,
governance, and discovery foundations are stable.

## Delivery tracking

GitHub Projects tracks live status, while repository milestones group work for
each version. Releases record completed history; this roadmap describes intended
direction and is not a changelog.
