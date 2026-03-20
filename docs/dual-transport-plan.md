# Plan: Dual Transport — stdio (Claude Code) + Lambda (Bedrock)

## Goal

Support both usage modes from the same codebase without breaking the existing Claude Code / Valmet workflow:

| Mode | Transport | Used by |
|---|---|---|
| **stdio** | stdin/stdout (current) | Claude Code on the terminal |
| **Lambda** | AWS Lambda handler | Amazon Bedrock Agents |

---

## What changes

### Current structure

```
src/
  index.ts   ← everything: types, helpers, schema loading, MCP server, stdio transport
```

### Proposed structure

```
src/
  core.ts    ← shared: types, helpers, schema loading, GraphQL execution
  index.ts   ← unchanged behaviour: MCP server + stdio transport (imports from core)
  lambda.ts  ← new: AWS Lambda handler for Bedrock (imports from core)
```

---

## What goes where

### `src/core.ts` (new, shared)
- All TypeScript types (`GqlTypeRef`, `GqlArg`, `GqlField`, `IntrospectionResult`)
- Helper functions (`getBaseType`, `typeString`, `isScalar`, `buildOperation`)
- `loadSchema()` — reads from file or live introspection
- `executeTool()` — runs a named tool against the GraphQL API

### `src/index.ts` (modified, stdio only)
- Imports core helpers
- Keeps all Zod schema building (MCP-specific, not needed in Lambda)
- Keeps McpServer setup and StdioServerTransport
- **Behaviour is identical to today** — no change for Valmet

### `src/lambda.ts` (new, Bedrock only)
- AWS Lambda handler function
- Converts Bedrock's `[{name, value}]` parameter format to plain args object
- Calls `executeTool()` from core
- Returns Bedrock Agent response envelope
- Caches schema across warm invocations (performance)

---

## What does NOT change

- `src/index.ts` behaviour — stdio transport works exactly as today
- All environment variable names (`GRAPHQL_API_URL`, `GRAPHQL_INTROSPECTION_URL`, `GRAPHQL_TOKEN`)
- The `__fields` selection set pattern
- npm package entry point (`bin.mcp-graphql-bridge` still points to `dist/index.js`)
- Docker image (still runs `dist/index.js`)

---

## Build output

`tsconfig.json` compiles all files in `src/` so the output will be:

```
dist/
  core.js       ← shared logic
  index.js      ← stdio entry point (unchanged)
  lambda.js     ← Lambda handler (new)
```

The Lambda deployment packages `dist/lambda.js` + `dist/core.js` + `node_modules`.

---

## Risks and trade-offs

| Risk | Mitigation |
|---|---|
| Refactor breaks stdio behaviour | `executeTool()` in core mirrors current logic exactly; stdio path only adds Zod wrappers on top |
| Lambda cold start (schema load) | Schema is cached in module scope after first invocation |
| `schema-introspection.json` not available in Lambda | Lambda reads env vars only — live introspection is the default; file path won't exist in Lambda environment |
| Token management | For Lambda, `GRAPHQL_TOKEN` should come from Secrets Manager, not env var directly |

---

## Open questions before implementing

1. **Token source for Lambda** — plain env var or Secrets Manager ARN?
2. **Who deploys the Lambda?** — CDK, Terraform, or manual console?
3. **Read-only vs read-write** — should the Bedrock path allow mutations, or queries only?
4. **One Lambda or many?** — single handler routing all tools (simpler) vs one Lambda per operation (more granular IAM)
