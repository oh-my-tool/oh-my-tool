# Releasing Oh My Tool on npm

The public packages are `@oh-my-tool/sdk` and `@oh-my-tool/cli`. The CLI
requires Bun 1.4 or newer; npm is the distribution registry.

## One-time maintainer setup

1. Join the `oh-my-tool` npm organization with publish permission.
2. Run `npm login` locally, preferably using a browser-based login and 2FA.
3. Publish the SDK once before the CLI, because the CLI depends on it.
4. In npm package settings, configure GitHub trusted publishing for
   `oh-my-tool/oh-my-tool` and `.github/workflows/publish.yml`.
5. In the GitHub organization, require two-factor authentication and protect
   `main` with required CI and review rules.

Never commit an npm token. Use an npm Automation Token only for emergency
automation when trusted publishing is unavailable.

## Release checklist

1. Run `npm run version:release -- 0.2.1` to update both package versions and
   the CLI's exact SDK dependency together.
2. Run `npm install` and `npm run check`.
3. Commit, push, and open a pull request.
4. After merge, create and push a matching tag, for example `v0.2.1`.
5. The publish workflow verifies and publishes SDK first, then CLI.

## Manual emergency publish

```powershell
npm login
npm run check
npm publish --workspace=@oh-my-tool/sdk --access public
npm publish --workspace=@oh-my-tool/cli --access public
```

Verify with:

```powershell
npm view @oh-my-tool/sdk version
npm view @oh-my-tool/cli version
```
