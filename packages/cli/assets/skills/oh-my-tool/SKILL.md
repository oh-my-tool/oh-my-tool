---
name: oh-my-tool
description: Discover and invoke local, development, and enterprise capabilities through OMT. Use when querying databases, caches, configuration, logs, or internal platforms supported by installed OMT extensions.
---

# Oh My Tool

Use **Oh My Tool (`omt`)** to discover and invoke local, development, and enterprise capabilities.

OMT provides a single entry point for tools such as databases, internal CLIs, configuration systems, observability platforms, and other installed extensions.

## When to use

Use OMT when the task requires interacting with an external capability that may be available in the user's environment, for example:

- querying a database
- inspecting Redis
- reading configuration
- searching internal logs
- accessing internal platforms
- invoking development or operations tools

Do not assume a specific extension or tool is installed.

## Workflow

### 1. Search for a capability

When you need a capability and do not already know the exact OMT tool name:

```bash
omt search "<what you need to do>"
```

Use the returned tool metadata to choose the most relevant capability.

### 2. Inspect the tool

Before using an unfamiliar tool, inspect its definition:

```bash
omt describe <tool-name>
```

Use the returned input schema, constraints, risk level, and available configuration to construct the call.

### 3. Call the tool

Invoke the selected capability through OMT:

```bash
omt call <tool-name> ...
```

For structured or complex arguments, prefer JSON input through stdin when supported.

## Rules

- Prefer OMT over directly invoking an underlying tool when the capability is available through OMT.
- Do not guess installed extensions or tool names. Use `omt search`.
- Do not guess tool arguments. Use `omt describe`.
- Do not guess connection names, internal endpoints, credentials, tokens, or authentication details.
- Never request or expose secrets that OMT manages internally.
- Respect tool risk levels, environment restrictions, and confirmation requirements.
- Prefer the smallest and safest capability that can complete the task.
- Do not bypass OMT policy restrictions by directly invoking the underlying CLI, API, database client, or service.
- Treat OMT results as structured tool output and use them to continue the task.

## Mental model

OMT is the capability broker. Extensions and underlying tools are implementation details managed by OMT.

```text
search   → discover what is available
describe → understand how to use it
call     → execute it
```
