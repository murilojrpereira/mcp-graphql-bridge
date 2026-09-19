# Contributing

Thank you for your interest in contributing to mcp-graphql-bridge!

## Getting started

```bash
git clone https://github.com/murilojrpereira/mcp-graphql-bridge.git
cd mcp-graphql-bridge
npm install
npm run build
```

## Development workflow

```bash
npm run dev   # watch mode — rebuilds and restarts on file changes
npm run build # one-off TypeScript compile
npm test      # unit tests
```

CI builds and runs the tests on Node 20 and 22.

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Make your changes and ensure `npm run build` and `npm test` pass with no errors.
3. Add an entry under `## [Unreleased]` in `CHANGELOG.md`.
4. Open a pull request with a clear description of what you changed and why.

If you add, remove or rename an environment variable, update the README table **and**
`environmentVariables` in `server.json`, which is what the MCP Registry shows to users.

## Reporting bugs

Open an issue at the [issue tracker](https://github.com/murilojrpereira/mcp-graphql-bridge/issues) and include:

- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behaviour
- Any relevant error output

## Code style

- TypeScript strict mode is enabled — no `any` without justification.
- Keep changes focused; one concern per PR.

## Releasing

Maintainers only. Releases are cut by two GitHub Actions workflows, **Bump Version** and
**Release**. The package is published to npm and to the official
[MCP Registry](https://registry.modelcontextprotocol.io) as
`io.github.murilojrpereira/mcp-graphql-bridge`.

**Never edit the version by hand** in `package.json`, `package-lock.json` or `server.json`. Bump
Version changes all three together. A hand-edited version breaks the next bump (it skips a version
and leaves the CHANGELOG heading pointing at a release that never happened).

### Steps

1. Merge everything that should ship to `main` and wait for CI to pass.
2. In `CHANGELOG.md`, move the entries from `## [Unreleased]` under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading and merge that change. The GitHub Release notes are extracted
   from this heading, so a missing heading means empty release notes. Leave the version files alone.
3. In GitHub, go to **Actions → Bump Version → Run workflow** and choose the bump type that makes the
   new version equal `X.Y.Z`:
   - `patch`: bug fixes only (`2.1.0` → `2.1.1`)
   - `minor`: new features or dependency migrations (`2.1.0` → `2.2.0`)
   - `major`: breaking changes (`2.1.0` → `3.0.0`)
4. Bump Version updates the three version files, commits `chore: release vX.Y.Z`, pushes an annotated
   tag and dispatches **Release** explicitly. It has to, because a push made with `GITHUB_TOKEN`
   never triggers other workflows.
5. Release then runs, in order: tests (Node 20 and 22), publish to npm (`NPM_TOKEN` secret), publish
   to the MCP Registry (GitHub OIDC login, no secret, needs `id-token: write`), and create the GitHub
   Release from the CHANGELOG.

### Verify

```bash
npm view mcp-graphql-bridge version
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.murilojrpereira/mcp-graphql-bridge"
```

### Registry naming rules

- The `name` in `server.json` must equal `mcpName` in `package.json`, and must start with
  `io.github.murilojrpereira/` because publishing authenticates as that GitHub account.
- The registry only stores metadata, so the npm package must be published first. The registry checks
  that the version in `server.json` exists on npm.

### If a release fails

Open the failed **Release** run and find which step failed.

- **Failed at or before "Publish to npm"** (for example an npm outage returning `503`): nothing was
  published. Confirm with `npm view mcp-graphql-bridge version`, then use **Re-run failed jobs**. The
  tag and version files are already correct.
- **npm succeeded but a later step failed**: do **not** re-run the job. npm rejects republishing the
  same version, so it would fail again before reaching the registry. Instead, from a checkout of the
  release tag, run `mcp-publisher login github` then `mcp-publisher publish`, and create the GitHub
  Release by hand with `gh release create vX.Y.Z --notes-file <notes>`.
- **Wrong bump type and nothing was published**: run Bump Version again with the right type. The
  unpublished tag is harmless and can stay.

### Listing on github.com/mcp

The [GitHub MCP Registry](https://github.com/mcp) is curated, so being in the official registry is
not enough for a first listing. Request onboarding in
[github-mcp-server discussion #1257](https://github.com/github/github-mcp-server/discussions/1257).
Per GitHub's reply there, once a server is onboarded, new versions sync from the official registry
automatically. This server is already in the official registry; the github.com/mcp request is the
remaining manual step.
