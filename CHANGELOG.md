# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `GRAPHQL_INTROSPECTION_TOKEN` for deployments where schema introspection requires different credentials than query/mutation execution. Falls back to `GRAPHQL_TOKEN` if unset.
- Fallback to a public demo GraphQL API (`https://countries.trevorblades.com/graphql`) when `GRAPHQL_API_URL` is unset, so the server can be tried with zero configuration.
- `docs/architecture.md` documenting the stdio vs. HTTP transport model, the token model, and why the GraphQL endpoint is fixed per deployment rather than a runtime parameter.

### Changed

- `GRAPHQL_API_URL` and `GRAPHQL_INTROSPECTION_URL` are no longer hard-required at startup — they default to the public demo API instead of exiting the process.
- Minimum supported Node.js version raised from 18 to 20. CI and the release pipeline now test Node 20.x and 22.x only. Node 18 was dropped because `vitest`'s `rolldown` dependency requires `node:util`'s `styleText` export (Node 20.12+), which broke CI on Node 18.x.
- The stdio `Dockerfile` now builds on `node:20-alpine` (previously `node:18-alpine`), matching `Dockerfile.http`/`Dockerfile.agentcore`, and installs with `--ignore-scripts` to fix a build failure where `npm ci` triggered the `prepare`/`build` script before source files were copied in.

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