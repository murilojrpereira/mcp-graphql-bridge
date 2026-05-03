# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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