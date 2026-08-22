# Security policy

## Supported versions

Security fixes are applied to the latest released minor version of
`@oh-my-tool/cli` and `@oh-my-tool/sdk`.

## Reporting a vulnerability

Do **not** open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting for this repository. If it is not enabled,
contact an organization owner privately and include reproduction steps, impact,
affected versions, and any suggested mitigation.

We aim to acknowledge reports within five business days and will coordinate a
fix and disclosure timeline with the reporter.

## Security boundary

An installed native extension is executable local code. `search` and
`describe` use static manifests only; `run` validates input and applies policy
before creating a secret-capable context and loading a handler. Users should
install extensions only from sources they trust and review extension updates
before installing them.
