# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `GRAPHQL_MAX_TOOLS` (default 128) caps how many query/mutation tools get registered, prioritizing queries over mutations when truncating. Previously every root field registered with no cap at all — GitHub's GraphQL API alone has 284 (32 queries, 252 mutations).
- `GRAPHQL_INCLUDE_MUTATIONS` (default `true`) — set to `false` to exclude every mutation field for a read-only deployment.
- `GRAPHQL_MAX_RETRIES` (default `0`, disabled) — opt-in retry with exponential backoff (honoring `Retry-After`) for `429`/`502`/`503`/`504` responses.
- Secret redaction: configured and per-call tokens/headers are scrubbed from error text and response bodies before reaching the calling LLM.
- Per-call `bearer_token`/`custom_headers` argument overrides on every tool, mirroring the OpenAPI bridge's multi-tenant credential model.
- Real unit tests (65 across 6 new test files) for schema introspection, type resolution, Zod arg mapping, operation building, execution/retries, and HTTP auth — the source was refactored from one 468-line file into `introspection.ts`/`zod.ts`/`operation.ts`/`executor.ts`/`auth.ts`/`tools.ts` to make this possible. The previous test suite only asserted that certain strings appeared in the source file, not that any function behaved correctly.
- Step-by-step README examples (Countries API + GitHub's GraphQL API) verified against the real APIs.
- Updated `SECURITY.md` and a README "Security" section describing the fixed-target-URL (no SSRF) and secret-redaction design properties.

### Fixed
- Fixed a crash (`TypeError: Cannot read properties of undefined (reading 'kind')`) that brought down the entire server on startup when registering a schema with a field type wrapped deeper than the introspection query's fixed depth — e.g. GitHub's `marketplaceCategories: [MarketplaceCategory!]!`, an extremely common shape. `getBaseType`/`typeString` now treat a truncated wrapper chain as an `Unknown` type instead of dereferencing `undefined`.
- Schema introspection against the public Countries demo API (this project's zero-config default) previously failed outright — its CDN-hosted endpoint enforces a query depth limit that the introspection query exceeded — silently falling back to only the two generic tools with the real error swallowed behind a generic message. Introspection now retries at a shallower, verified-safe depth and succeeds; the real upstream error is logged at every attempt.
- **Security**: `GRAPHQL_INCLUDE_MUTATIONS=false` only excluded the generated `mutation__*` tools; `execute_graphql` still accepted and executed arbitrary mutations with the full configured token, silently defeating the read-only setting it was documented as providing. `execute_graphql` now parses the query (via the `graphql` package) and rejects it when it contains a mutation and mutations are disabled; unparseable input is treated as a mutation (fails closed) rather than assumed safe.
- Hardened `redactSecrets` against a latent prefix-collision case: if one configured secret happened to be a literal prefix of another, redacting the shorter one first could fragment and leak a plaintext suffix of the longer one. Secrets are now redacted longest-first.

## [2.0.0] - 2026-07-05

**Breaking:** minimum supported Node.js version raised from 18 to 20 (see below).

### Added

- HTTP (Streamable HTTP) transport (`MCP_TRANSPORT=http`) for hosted/remote deployments, alongside the existing stdio transport.
- `Dockerfile.http` for generic HTTP container deployments (AWS ECS/Fargate, App Runner, Cloudflare Containers, and other container hosts) and `Dockerfile.agentcore` tailored for AWS Bedrock AgentCore Runtime.
- `MCP_AUTH_TOKEN` to protect the `/mcp` HTTP endpoint on public-routable deployments.
- `docs/deployment.md` covering AWS, Cloudflare, and other container hosting targets; AgentCore-specific deployment guide.
- `ecr-push.yml` and `bump-version.yml` GitHub Actions for pushing container images to ECR and driving releases.
- `GRAPHQL_INTROSPECTION_TOKEN` for deployments where schema introspection requires different credentials than query/mutation execution. Falls back to `GRAPHQL_TOKEN` if unset.
- Fallback to a public demo GraphQL API (`https://countries.trevorblades.com/graphql`) when `GRAPHQL_API_URL` is unset, so the server can be tried with zero configuration.
- `docs/architecture.md` documenting the stdio vs. HTTP transport model, the token model, and why the GraphQL endpoint is fixed per deployment rather than a runtime parameter.

### Changed

- `GRAPHQL_TOKEN` is now optional — omit it for public GraphQL APIs instead of sending an empty `Authorization` header.
- `GRAPHQL_API_URL` and `GRAPHQL_INTROSPECTION_URL` are no longer hard-required at startup — they default to the public demo API instead of exiting the process.
- Minimum supported Node.js version raised from 18 to 20. CI and the release pipeline now test Node 20.x and 22.x only. Node 18 was dropped because `vitest`'s `rolldown` dependency requires `node:util`'s `styleText` export (Node 20.12+), which broke CI on Node 18.x.
- The stdio `Dockerfile` now builds on `node:20-alpine` (previously `node:18-alpine`), matching `Dockerfile.http`/`Dockerfile.agentcore`, and installs with `--ignore-scripts` to fix a build failure where `npm ci` triggered the `prepare`/`build` script before source files were copied in.

### Fixed

- Correct GitHub username in README/CONTRIBUTING.md URLs.
- The HTTP transport no longer crashes the whole process on a malformed JSON request body (was an unhandled promise rejection).
- Request bodies to `/mcp` are now capped at 10MB to prevent memory-exhaustion DoS.
- `MCP_AUTH_TOKEN` comparisons are now constant-time instead of a plain string comparison.
- Fixed the stateless HTTP transport being reused across requests, which violated the MCP SDK's contract and caused every request after the first to fail. Each `/mcp` request now gets its own server + transport instance.

### Security

- `/mcp` now returns 405 instead of crashing on GET/DELETE requests in stateless mode.
- Docker images now run as a non-root user (`Dockerfile.http`).

## [1.0.1] - 2026-05-04

### Fixed

- Correct GitHub username in all URLs (`murilojrpereira`)
- Update `server.json` to match official MCP registry schema format
- Exclude test files from TypeScript compilation output

## [1.0.0] - 2026-03-21

### Added

- Initial release of mcp-graphql-bridge
- Generic MCP server that bridges any GraphQL API to Claude Code
- Automatic schema introspection via `GRAPHQL_INTROSPECTION_URL`
- File-based schema loading from `schema-introspection.json` for faster startup
- One tool per GraphQL query (`query__<name>`)
- One tool per GraphQL mutation (`mutation__<name>`)
- Generic `execute_graphql` tool for any custom query or mutation
- `get_type_details` tool for exploring GraphQL type fields
- Support for custom field selection via `__fields` parameter
- Environment variable configuration (`GRAPHQL_API_URL`, `GRAPHQL_INTROSPECTION_URL`, `GRAPHQL_TOKEN`)
- Docker support with included Dockerfile
- AWS Lambda deployment guide for Bedrock integration
- Comprehensive documentation with troubleshooting guide
- Vitest test framework with integration tests

### Features

- TypeScript implementation with strict mode
- Zod schema validation for all tool parameters
- Automatic GraphQL type to Zod schema conversion
- Bearer token authentication support
- Support for scalars: String, Int, Float, Boolean, ID, Long, JSON
- List and NonNull type wrapper handling
- Graceful fallback when introspection is disabled
- Error boundary for uncaught exceptions

## Template

### Added

- New features

### Changed

- Changes in existing functionality

### Deprecated

- Soon-to-be removed features

### Removed

- Now removed features

### Fixed

- Bug fixes

### Security

- Security improvements

[unreleased]: https://github.com/murilopereira/mcp-graphql-bridge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/murilopereira/mcp-graphql-bridge/releases/tag/v1.0.0