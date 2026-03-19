# Deploying mcp-graphql-bridge on AWS for Amazon Bedrock

## The core challenge

The current server uses **stdio transport** — Claude Code spawns it as a child process. Bedrock can't do that. It calls tools via **HTTP**. So two things are needed:

1. Re-expose the server over HTTP
2. Translate between MCP tools and Bedrock's tool use format

---

## Recommended architecture: Lambda + Bedrock Agents

```
User / App
    │
    ▼
Amazon Bedrock (Claude)
    │  tool call: query__getOrders
    ▼
Bedrock Agent Action Group
    │  HTTP POST
    ▼
AWS Lambda  ──►  GraphQL API
(mcp-graphql-bridge logic)
```

---

## What needs to change in this codebase

### 1. Extract the core logic into a library

Split `src/index.ts` into two parts:
- `src/core.ts` — schema introspection, tool building, GraphQL execution (reusable)
- `src/stdio.ts` — current stdio entry point (unchanged for Claude Code)
- `src/lambda.ts` — new Lambda handler

### 2. New Lambda handler (`src/lambda.ts`)

```ts
export const handler = async (event: BedrockAgentEvent) => {
  const { actionGroup, function: fnName, parameters } = event

  // fnName = "query__getOrders", parameters = [{name, value}]
  const args = Object.fromEntries(parameters.map(p => [p.name, p.value]))
  const result = await executeGraphQLTool(fnName, args)

  return {
    messageVersion: "1.0",
    response: {
      actionGroup,
      function: fnName,
      functionResponse: {
        responseBody: { TEXT: { body: JSON.stringify(result) } }
      }
    }
  }
}
```

### 3. OpenAPI schema generation

Bedrock Action Groups need an OpenAPI 3.0 spec. Auto-generate it from the same introspection data:
- One `POST /tools/{toolName}` endpoint per query/mutation
- Parameters derived from GraphQL args

---

## AWS infrastructure

| Component | Purpose |
|---|---|
| **Lambda** | Runs the GraphQL bridge handler |
| **IAM Role** | Grants Bedrock permission to invoke Lambda |
| **Secrets Manager** | Stores `GRAPHQL_TOKEN` (not env var) |
| **Bedrock Agent** | Orchestrates Claude + tool calls |
| **Bedrock Action Group** | Registers Lambda + OpenAPI schema |
| **S3 bucket** | Hosts the generated OpenAPI schema file |

### Lambda environment variables

```
GRAPHQL_API_URL=https://your-api.example.com/graphql
GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql
GRAPHQL_TOKEN_SECRET_ARN=arn:aws:secretsmanager:...
```

---

## Two deployment options

### Option A — One Lambda, dynamic routing (recommended)

Single Lambda handles all tools. The `function` field in the Bedrock event is the tool name (`query__getOrders`). One OpenAPI schema with all operations.

**Pros:** simple to deploy, one function to update
**Cons:** cold start loads entire schema

### Option B — One Lambda per operation

Each GraphQL operation is a separate Lambda, auto-generated at deploy time from introspection.

**Pros:** fine-grained IAM, isolated failures
**Cons:** lots of functions to manage, schema changes require redeploy

---

## What stays the same

- All the GraphQL introspection and execution logic
- The `__fields` selection set pattern
- Environment variable naming
- The stdio version for Claude Code keeps working as-is

---

## Rough implementation order

1. Refactor `src/index.ts` → extract core into `src/core.ts`
2. Add `src/lambda.ts` handler
3. Add OpenAPI schema generator script
4. Set up CDK/Terraform stack
5. Create Bedrock Agent + Action Group pointing at Lambda
6. Test via Bedrock console
