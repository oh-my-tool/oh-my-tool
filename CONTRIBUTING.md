# Contributing to Oh My Tool

Thanks for contributing. Oh My Tool is a local-first runtime for agent tools;
changes must preserve the `search → describe → run` progressive-disclosure
contract and the existing extension SDK compatibility.

## Development setup

1. Install Node.js 20 or newer and Bun 1.4 or newer.
2. Run `npm ci`.
3. Run `npm run check` before opening a pull request.

Use a focused branch and explain the user-visible behavior in the pull request.
Do not commit credentials, local state, generated archives, or `node_modules`.

For npm releases, follow [docs/releasing.md](docs/releasing.md). A release tag
must not be pushed until the `main` CI workflow has passed.

## Change expectations

- Add or update tests for behavior changes.
- Keep `search` and `describe` static: they must not load handlers, access
  secrets, open network connections, or start processes.
- Keep policy checks before secret-capable execution context creation.
- Preserve the public `ToolManifest → ExtensionManifest → ToolHandler` SDK
  contract unless the pull request explicitly proposes a versioned change.
- Update the README or relevant documentation when installation, configuration,
  extension authoring, or security behavior changes.

## Pull requests

Please use the pull request template, keep each pull request reviewable, and
link any relevant issue. Maintainers may ask for a regression test, migration
notes, or a security review before merging.

## Reporting bugs and security issues

Use the bug report form for ordinary defects. Do not disclose suspected
vulnerabilities in a public issue; follow [SECURITY.md](SECURITY.md) instead.
