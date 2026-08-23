---
name: oh-my-tool
description: Discover and invoke local, development, and enterprise tools through the Oh My Tool Agent Tool Runtime.
---

# Oh My Tool — The Agent Tool Runtime

Use the canonical `ohmytool` CLI to discover and execute tools exposed by
installed native extensions and enabled MCP servers.

## When to use

Use Oh My Tool when the task requires an external capability that may be available in the user's environment, such as:

- querying a database
- inspecting Redis
- reading configuration
- searching internal logs
- invoking development and operations tools

Do not assume a specific extension or tool is installed.

## Workflow

### 1. Search

When you do not know the exact tool ID:

```bash
ohmytool search "<what you need to do>"
```

Search returns lightweight summary metadata. Native discovery reads manifests;
MCP discovery connects to enabled servers and obtains `tools/list`.

### 2. Describe

Before using an unfamiliar tool, inspect its complete descriptor and input schema:

```bash
ohmytool describe <tool-name>
```

Use the returned schema, constraints, risk level, and configuration requirements to construct the input.

### 3. Run

Execute the selected tool through the runtime. Use the exact namespaced ID
returned by search/describe for MCP tools:

```bash
ohmytool run <tool-name> key=value
```

For structured or complex arguments, prefer JSON through stdin:

```bash
echo '{"connection":"iot-test","sql":"SELECT 1"}' | ohmytool run mysql.query --stdin
```

## Rules

- Prefer `ohmytool` over directly invoking an underlying database, cache, CLI, API, or service.
- Do not guess installed tools; use `ohmytool search`.
- Do not guess tool arguments; use `ohmytool describe`.
- Do not guess connection names, endpoints, credentials, tokens, or authentication details.
- Never request or expose secrets managed by Oh My Tool.
- Provider origin does not change the `search → describe → run` sequence.
- Never place bearer tokens, OAuth tokens, authorization codes, client secrets,
  or secret environment values in tool arguments.
- If a command returns `MCP_AUTH_REQUIRED`, ask the user to run or approve
  `ohmytool mcp auth <server-id>`; never collect credentials in chat.
- Respect tool risk levels, policy restrictions, and environment restrictions.
- Prefer the smallest and safest tool that can complete the task.
- Treat runtime results as structured tool output and use them to continue the task.

## Mental model

The CLI is the Agent-facing adapter. ToolRuntime indexes static descriptors and governs execution through ToolProviders; native extension handlers are loaded only when `run` executes a tool.

```text
search   → lightweight ToolDescriptor summary
describe → complete ToolDescriptor and inputSchema
run      → policy → provider → dynamic handler execution
```
