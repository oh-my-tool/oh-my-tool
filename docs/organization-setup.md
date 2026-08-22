# GitHub organization setup

Complete these settings in the `oh-my-tool` organization:

1. Require secure two-factor authentication for members, outside collaborators,
   billing managers, and automation accounts.
2. Create `maintainers`, `security`, and `release` teams; grant least-privilege
   access and keep at least two organization owners.
3. Create an organization `.github` repository with a profile README and copy
   the community health files there as defaults for extension repositories.
4. Enable Discussions and define categories for support, extension proposals,
   architecture, and announcements.
5. Apply a `main` ruleset: pull requests only, one approving review, dismiss
   stale approvals, required `CI / quality`, no force pushes, and no bypass for
   administrators except documented emergencies.
6. Enable dependency graph, Dependabot alerts, secret scanning, push
   protection, and private vulnerability reporting for public repositories.
7. Pin the core runtime, SDK, official extensions, extension template, and
   extension catalog on the organization profile.
