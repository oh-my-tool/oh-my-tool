# Configuration

Oh My Tool reads user configuration from:

- Windows: `%USERPROFILE%\\.oh-my-tool\\config.toml`
- Linux/macOS: `~/.oh-my-tool/config.toml`

The core runtime owns the generic connection shape and validates connection names. Each extension owns the meaning of its connection fields and should document them in its own repository.

Generic shape:

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

Agents pass only the configured connection name:

```powershell
ohmytool run <tool> connection=<name>
```

Passwords are stored separately:

```powershell
"your-password" | ohmytool secret set provider:name
```

Do not commit real connection files or secrets. See the individual extension README for provider-specific examples.
