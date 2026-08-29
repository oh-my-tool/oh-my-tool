# Configuration

Oh My Tool reads user configuration from:

- Windows: `%USERPROFILE%\\.oh-my-tool\\config.toml`
- Linux/macOS: `~/.oh-my-tool/config.toml`

The core runtime owns the generic connection shape and validates connection names. Each extension owns the meaning of its connection fields and should document them in its own repository.

Generic shape:

```toml
[extensions.<extension-id>.connections.<name>]
environment = "test"

[extensions.<extension-id>.connections.<name>.settings]
host = "127.0.0.1"
port = 1234
database = "default"
username = "user"
tls = false

[extensions.<extension-id>.connections.<name>.secrets]
password = "provider:name"
```

Agents pass only the configured connection name:

```powershell
ohmytool run <tool> connection=<name>
```

Inspect and validate configured connections without exposing secret names or
values:

```powershell
ohmytool connection list
ohmytool connection check
ohmytool config check
```

`connection list` lists connections for every configured extension. `connection check`
invokes the extension-declared connection check tool; extensions without one are
reported as `CHECK_UNSUPPORTED`.

Passwords are stored separately:

```powershell
"your-password" | ohmytool secret set provider:name
```

Do not commit real connection files or secrets. See the individual extension README for provider-specific examples.

## MCP servers (v0.3)

Enabled MCP servers are discovered lazily when a command needs them. Native
manifests remain local and static; MCP discovery connects to each enabled
server and calls `tools/list`. MCP tools are exposed as `<namespace>.<remote-name>`.
Set `enabled = false` to temporarily exclude a server. If an enabled server is
unavailable, native tools and other MCP providers remain usable; search reports
unavailable providers in its metadata. Disabled entries are checked only for valid
server IDs, so stale transport-specific fields cannot block startup.

### stdio

```toml
[mcp.servers.filesystem]
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "C:/workspace"]
namespace = "fs"

[mcp.servers.filesystem.secretEnv]
FILESYSTEM_TOKEN = "mcp:filesystem:token"
```

The right-hand side is a secret name, not a secret value:

```powershell
"token-value" | ohmytool secret set mcp:filesystem:token
```

### Streamable HTTP with bearer auth

```toml
[mcp.servers.github]
transport = "streamable-http"
url = "https://mcp.example.com/mcp"
namespace = "github"
auth = "bearer"
bearerTokenSecret = "mcp:github:token"

[mcp.servers.github.headers]
X-Tenant = "engineering"

[mcp.servers.github.secretHeaders]
X-Gateway-Key = "mcp:github:gateway-key"
```

Bearer tokens and secret headers are resolved by name from the platform secret
store and are never placed in tool arguments or normal output.

### Interactive OAuth 2.1 / PKCE

Dynamic client registration is the default:

```toml
[mcp.servers.linear]
transport = "streamable-http"
url = "https://mcp.linear.example/mcp"
namespace = "linear"
auth = "oauth"
oauthScopes = ["mcp:read", "mcp:write"]
```

An optional pre-registered client can use a secret-held client secret:

```toml
oauthCallbackPort = 8765
oauthClientId = "oh-my-tool"
oauthClientSecretSecret = "mcp:linear:client-secret"
oauthTokenEndpointAuthMethod = "client_secret_basic"
```

Authorize and remove local credentials with:

```powershell
ohmytool mcp list
ohmytool mcp auth linear
ohmytool mcp logout linear
```

`mcp list` reads configuration without connecting and reports enabled and
disabled servers without exposing commands, URLs, secret references, or values.

Authorization opens the default browser, listens only on `127.0.0.1`, and
validates PKCE, state, and issuer before saving credentials in the platform
secret store. Normal commands never open a browser or perform dynamic client
registration; `MCP_AUTH_REQUIRED` tells the user to run the explicit auth command.

MCP v0.3 exposes tools only. Resources, prompts, serving/northbound MCP,
device-code, client-credentials, token revocation, and legacy SSE are not
implemented capabilities.
