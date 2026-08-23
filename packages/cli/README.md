# @oh-my-tool/cli

The `ohmytool` command-line interface for discovering and running local agent
tools.

```powershell
npm install --global @oh-my-tool/cli
ohmytool --help
```

Requires Bun 1.4 or newer. Use `ohmytool search`, `ohmytool describe`, then
`ohmytool run` for both native and MCP-backed tools. Configure MCP servers in
`config.toml`; use `ohmytool mcp auth <server>` and `ohmytool mcp logout <server>`
for interactive OAuth credentials. See the main
[Oh My Tool repository](https://github.com/oh-my-tool/oh-my-tool) and
[`docs/configuration.md`](../../docs/configuration.md) for configuration and
secret-management guidance.
