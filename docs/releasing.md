# Releasing Oh My Tool on npm

This is the release runbook for the core packages and official extensions.
GitHub Actions publishes packages after a matching `v*` tag is pushed.

## Rules

- Never create or push a release tag while `main` CI is failing or running.
  A tag starts the publish workflow immediately.
- Never hand-edit `package-lock.json`. Change versions with the release script,
  then regenerate the lockfile with `npm install --package-lock-only`.
- Every release must pass `npm ci --registry=https://registry.npmjs.org`,
  `npm run check`, and all package/version consistency checks before tagging.
- npm versions are immutable. If publishing partially succeeds, release the
  next patch version instead of reusing the failed version.

## One-time setup

1. Configure npm trusted publishing for each package and its repository's
   `.github/workflows/publish.yml`.
2. Keep `id-token: write` in publish workflows for npm provenance.
3. Protect `main` and require the repository CI check before merge.

## Core release

From `oh-my-tool/oh-my-tool`:

```powershell
npm run version:release -- 0.3.3
npm install --package-lock-only --registry=https://registry.npmjs.org
npm ci --registry=https://registry.npmjs.org
npm run check
```

Confirm the SDK, CLI, root package, and lockfile versions match. Commit and
push the change, wait for `main` CI to pass, then create and push the tag:

```powershell
git tag -a v0.3.3 -m "Release v0.3.3"
git push origin v0.3.3
```

The core workflow publishes the SDK before the CLI. If an extension is
changed to depend on the new SDK version, wait until that SDK is visible on
npm before releasing the extension.

## Extension release

Run this in `omt-redis` or `omt-mysql`:

```powershell
npm run version:release -- 0.3.3
npm install --package-lock-only --registry=https://registry.npmjs.org
npm ci --registry=https://registry.npmjs.org
npm run check
```

Confirm that `package.json`, `omt.manifest.json`, and the lockfile root match.
Commit and push the change, wait for `main` CI to pass, then push the matching
annotated tag.

## Post-release verification

Check the GitHub Actions publish workflow, then verify the public registry:

```powershell
npm view @oh-my-tool/sdk version --registry=https://registry.npmjs.org
npm view @oh-my-tool/cli version --registry=https://registry.npmjs.org
npm view @oh-my-tool/redis version --registry=https://registry.npmjs.org
npm view @oh-my-tool/mysql version --registry=https://registry.npmjs.org
```

If `npm ci` reports a package/lock mismatch, do not publish or retag. Fix and
commit the lockfile, rerun all checks, and use a new patch version if npm has
already received any package from that release.
