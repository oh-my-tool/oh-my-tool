# Oh My Tool — The Agent Tool Runtime

Oh My Tool is an extensible, local-first tool runtime for AI agents. It gives Codex, OMP, Pi, Qoder, Cursor, Claude Code, and other agents one consistent way to discover and execute tools from native extensions.

Current v0.2 architecture:

```text
Agent
  ↓ Skill / CLI
ohmytool
  ↓
ToolRuntime
  ↓
ToolProvider
  ↓
NativeExtensionProvider
  ↓
Independent Extensions
```

The core principles are native-first, local-first, CLI-first, and governed by default. The runtime indexes static manifests for progressive discovery and dynamically loads extension handlers only during execution.

## Commands

The canonical executable is `ohmytool` and the canonical execution verb is `run`:

```text
ohmytool search "<task>"                search lightweight tool summaries
ohmytool describe <tool>                inspect the complete descriptor and schema
ohmytool run <tool> [key=value ...]     execute a tool
ohmytool run <tool> --stdin             execute JSON input from stdin
ohmytool extension list                 list installed extensions
ohmytool extension install <path>       install an extension from a local directory
ohmytool setup                          install the bundled Agent Skill
ohmytool integrate                       manage Agent Skill integrations
ohmytool secret set <name>              store a secret without exposing its value
ohmytool secret list                    list secret names only
ohmytool --version
```

Agent protocol:

```text
ohmytool search → ohmytool describe → ohmytool run
```

`search` and `describe` do not load handlers, access secrets, connect to databases, or start processes. `run` performs schema validation and policy preflight before creating the execution context and invoking a provider.

## Quick start

```powershell
# Install Bun, then install the published CLI from npm
npm install --global @oh-my-tool/cli
ohmytool --version

# Or clone the repository for development
npm ci

# Check the CLI
bun packages/cli/bin/ohmytool.ts --version
bun packages/cli/bin/ohmytool.ts --help

# Install an independent extension during local development
bun packages/cli/bin/ohmytool.ts extension install <path-to-extension>

# Discover and inspect tools
bun packages/cli/bin/ohmytool.ts search "query mysql data"
bun packages/cli/bin/ohmytool.ts describe mysql.query
```

The CLI package is distributed through npm, but it runs on Bun 1.4 or newer.
See [the release guide](docs/releasing.md) for maintainer publishing steps.

## State and migration

Default state lives at:

```text
Windows: %USERPROFILE%\\.oh-my-tool
Linux/macOS: ~/.oh-my-tool
```

Override the home explicitly with `OH_MY_TOOL_HOME`. When using the default home, an existing legacy `~/.omt` directory is copied to the new home without moving, deleting, or overwriting it. An explicit `OH_MY_TOOL_HOME` disables automatic legacy migration.

## Repository structure

```text
oh-my-tool/
├── packages/
│   ├── sdk/        @oh-my-tool/sdk
│   └── cli/        @oh-my-tool/cli and ohmytool
│       ├── assets/skills/oh-my-tool/
│       ├── src/runtime/                         internal ToolRuntime
│       ├── src/runtime/providers/native/        NativeExtensionProvider
│       ├── src/extension/                       manifest/discovery/install/loader
│       ├── src/policy/                          policy preflight
│       └── src/secrets/                         SecretStore integration
```

Extensions remain independent repositories, including
[`omt-mysql`](https://github.com/oh-my-tool/omt-mysql) and
[`omt-redis`](https://github.com/oh-my-tool/omt-redis), and continue using the
existing `ToolManifest → ExtensionManifest → ToolHandler` SDK contract. The
core runtime does not own concrete database or cache capabilities.

## Configuration and secrets

The runtime owns only the generic connection mechanism. Concrete connection sections are documented by each extension repository; the core repository does not define MySQL, Redis, or other service-specific configuration.

```toml
[extensions.<extension-id>.connections.<name>]
environment = "test"
host = "127.0.0.1"
port = 1234
database = "default"
username = "user"
secret = "provider:name"
tls = false
```

See the extension repository documentation for provider-specific fields and examples.
Use `ohmytool secret set <name>` to store credentials through the platform secret store. Secret values are never included in search/describe results or normal audit output.

## Testing

```powershell
npm ci
npm run check
```

The independent `omt-mysql` and `omt-redis` repositories have their own test suites. They do not require a running database for unit tests.

## Scope

Implemented in this slice:

- `ohmytool` CLI with `search`, `describe`, and `run`
- internal provider-independent ToolRuntime
- static ToolRegistry and executable ProviderRegistry
- NativeExtensionProvider with static-manifest/dynamic-handler separation
- non-destructive `~/.omt` to `~/.oh-my-tool` migration
- unchanged native extension compatibility for MySQL and Redis

Deferred intentionally:

- MCP provider and MCP host features
- JDK/local environment discovery
- workflow or agent orchestration
- daemon, GUI, marketplace, approval UI, and public runtime package

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. For
questions, use GitHub Discussions; for ordinary defects, use the bug report
form. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).
