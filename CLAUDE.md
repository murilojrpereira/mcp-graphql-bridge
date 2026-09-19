# CLAUDE.md

MCP server that bridges any GraphQL API to MCP clients: it introspects the schema and registers one
tool per query and mutation. Published to npm and the MCP Registry as `mcp-graphql-bridge`. See
`README.md` for usage and `docs/architecture.md` for design rationale.

## Commands

```bash
npm run build        # tsc → dist/
npm test             # vitest
npm run dev          # watch mode
npm start            # run the compiled server (stdio)
npm run start:http   # run with MCP_TRANSPORT=http
```

There is no lint or format script; CI runs `npm ci`, `npm run build` and `npm test`.

## Layout (`src/`)

| File | Responsibility |
|---|---|
| `index.ts` | Entry point. stdio by default; `MCP_TRANSPORT=http` starts the HTTP transport |
| `introspection.ts` | Schema introspection and type helpers (`getBaseType`, `typeString`) |
| `tools.ts` | Applies schema filters and registers the tools (`registerTools`) |
| `operation.ts` | Builds GraphQL operation strings (`buildOperation`), detects mutations in raw queries |
| `zod.ts` | GraphQL argument types → Zod (`argToZod`, `buildArgsSchema`) |
| `executor.ts` | Executes operations against the endpoint, incl. per-call overrides |
| `auth.ts` | Authorization for the HTTP transport (`isAuthorized`) |
| `types.ts` | Shared types |

Tests live in `src/__tests__/`, one file per module.

## Conventions

- TypeScript strict mode, ESM with `module: Node16`: relative imports **must** end in `.js`
  (`import ... from "./tools.js"`). No `any` without justification.
- Secrets (configured and per-call tokens/headers) are redacted from error text and response bodies
  before they reach the calling LLM. Keep it that way when touching `executor.ts`.
- `GRAPHQL_INCLUDE_MUTATIONS=false` must keep every mutation unreachable, including through the
  generic query tool (`queryContainsMutation`). Do not weaken that path.
- If you add, remove or rename an environment variable, update the README table **and**
  `environmentVariables` in `server.json`.
- Add a `## [Unreleased]` entry to `CHANGELOG.md` for user-visible changes.

## Releasing: do not do this unprompted

Publishing to npm and the MCP Registry is irreversible (npm versions cannot be reused). Never run
`npm publish`, `mcp-publisher publish`, or trigger the **Bump Version** / **Release** workflows unless
the user explicitly asks.

- Never hand-edit `version` in `package.json`, `package-lock.json` or `server.json`. The Bump Version
  workflow changes all three together.
- Put release notes in `CHANGELOG.md` under `## [X.Y.Z] - date` **before** bumping; the release notes
  are extracted from that heading, so the bump type must produce exactly `X.Y.Z`.
- Full procedure, failure recovery and the github.com/mcp onboarding step: `CONTRIBUTING.md` →
  **Releasing**.
