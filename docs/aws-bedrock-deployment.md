# Deploying mcp-graphql-bridge on AWS for Amazon Bedrock

## Option A — Bedrock AgentCore Runtime (recommended)

AgentCore is AWS's managed hosting environment built specifically for MCP servers. It runs the container using the native MCP protocol over HTTP, so automatic schema introspection and tool discovery work exactly as they do locally. Billing is active-consumption only (~$0.09/hr of compute), so you pay nothing when no agent is using the server.

### Architecture

```
User / App
    │
    ▼
Amazon Bedrock Agent
    │  MCP tool call (HTTP)
    ▼
Bedrock AgentCore Runtime
    │  container
    ▼
mcp-graphql-bridge (HTTP transport)
    │
    ▼
GraphQL API
```

### What was built

| File | Purpose |
|---|---|
| `src/index.ts` | `MCP_TRANSPORT=http` switches to `StreamableHTTPServerTransport` on `PORT` (default 8080). `/mcp` handles the MCP protocol, `/health` is for container health checks. Stdio mode is unchanged. |
| `Dockerfile.agentcore` | Multi-stage build. Sets `MCP_TRANSPORT=http`, `PORT=8080`, exposes 8080, includes `HEALTHCHECK`. |
| `.github/workflows/ecr-push.yml` | Manual dispatch: builds `Dockerfile.agentcore` and pushes `:sha` + `:latest` to ECR. Inputs: `aws_region`, `ecr_repository`, `image_tag`. |

### Prerequisites

Set these secrets in the GitHub repo (Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user key with ECR push permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret |

### Step 1 — Create an ECR repository

```bash
aws ecr create-repository \
  --repository-name mcp-graphql-bridge \
  --region us-east-1
```

### Step 2 — Push the image to ECR

Go to **Actions → Push to ECR (AgentCore) → Run workflow**, fill in:

- `aws_region`: e.g. `us-east-1`
- `ecr_repository`: `mcp-graphql-bridge`
- `image_tag`: leave blank to use git SHA

### Step 3 — Host in Bedrock AgentCore

In the AWS Console:

1. **Bedrock → AgentCore → Agent Runtime → Host Agent**
2. Point to your ECR image (`<account>.dkr.ecr.<region>.amazonaws.com/mcp-graphql-bridge:latest`)
3. Set environment variables:
   - `GRAPHQL_API_URL`
   - `GRAPHQL_INTROSPECTION_URL`
   - `GRAPHQL_TOKEN`
4. AgentCore will call `/health` to confirm the container is ready, then serve MCP requests at `/mcp`

### Step 4 — Connect to a Bedrock Agent

In the Bedrock Agent settings, add the AgentCore host as an MCP tool source. The agent will auto-discover all `query__*` and `mutation__*` tools via introspection — no manual schema upload needed.

### Updating after a code change

```bash
# Push a new image (via GitHub Actions or locally):
docker build -f Dockerfile.agentcore -t <ecr-uri>:latest .
docker push <ecr-uri>:latest

# Then redeploy in AgentCore console (or update the agent alias).
```

---

## Option B — Lambda + Bedrock Agents (alternative)

This approach predates AgentCore. It requires translating between the Bedrock tool-call format and the GraphQL API manually, generating an OpenAPI schema, and hosting it in S3. More setup, no idle-cost savings. Documented below for reference.

### Architecture

```
User / App
    │
    ▼
Amazon Bedrock (Claude)
    │  tool call: query__getOrders
    ▼
Bedrock Agent Action Group
    │  invokes
    ▼
AWS Lambda  ──►  GraphQL API
(mcp-graphql-bridge logic)
```

---

## Phase 1 — Code changes

### 1.1 Refactor `src/index.ts` → extract `src/core.ts`

Create `src/core.ts` with everything that is reusable across transports:

- All TypeScript types (`GqlTypeRef`, `GqlArg`, `GqlField`, `IntrospectionResult`)
- Helper functions (`getBaseType`, `typeString`, `isScalar`, `buildOperation`)
- `loadSchema(introspectionClient)` — reads from file or live introspection, returns `{ queryFields, mutationFields }`
- `executeTool(client, schema, toolName, args)` — runs any named tool against the GraphQL API

Update `src/index.ts` to import from `core.ts`. **Behaviour is identical to today — no change for Valmet.**

### 1.2 Add `src/lambda.ts`

New file — the AWS Lambda handler:

- Receives a Bedrock Agent event: `{ actionGroup, function, parameters: [{name, value}] }`
- Converts `parameters` array to a plain args object
- Calls `executeTool()` from core
- Caches schema in module scope (reused across warm invocations)
- Reads `GRAPHQL_TOKEN` from Secrets Manager via ARN in env var
- Returns the Bedrock Agent response envelope

### 1.3 Add `@aws-sdk/client-secrets-manager` dependency

Required to fetch the token from Secrets Manager at Lambda cold start.

```bash
npm install @aws-sdk/client-secrets-manager
```

### 1.4 Verify build

```bash
npm run build
# dist/core.js, dist/index.js, dist/lambda.js should all be present
```

---

## Phase 2 — AWS prerequisites

### 2.1 Store the GraphQL token in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name mcp-graphql-bridge/graphql-token \
  --secret-string "your-bearer-token"
```

Note the ARN — you will need it in Phase 3.

### 2.2 Create the Lambda execution IAM role

The role needs two permissions:

1. Basic Lambda execution (`AWSLambdaBasicExecutionRole`)
2. Read access to the secret created above

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:mcp-graphql-bridge/graphql-token-*"
    }
  ]
}
```

### 2.3 Create an S3 bucket for the OpenAPI schema

Bedrock Action Groups require an OpenAPI 3.0 spec hosted in S3.

```bash
aws s3 mb s3://mcp-graphql-bridge-schema
```

---

## Phase 3 — Deploy the Lambda

### 3.1 Package the Lambda

```bash
npm run build
zip -r lambda.zip dist/ node_modules/ package.json
```

### 3.2 Create the Lambda function

```bash
aws lambda create-function \
  --function-name mcp-graphql-bridge \
  --runtime nodejs20.x \
  --handler dist/lambda.handler \
  --role arn:aws:iam::ACCOUNT:role/mcp-graphql-bridge-role \
  --zip-file fileb://lambda.zip \
  --timeout 30 \
  --memory-size 256 \
  --environment Variables="{
    GRAPHQL_API_URL=https://your-api.example.com/graphql,
    GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql,
    GRAPHQL_TOKEN_SECRET_ARN=arn:aws:secretsmanager:REGION:ACCOUNT:secret:mcp-graphql-bridge/graphql-token
  }"
```

### 3.3 Grant Bedrock permission to invoke the Lambda

```bash
aws lambda add-permission \
  --function-name mcp-graphql-bridge \
  --statement-id bedrock-agent-invoke \
  --action lambda:InvokeFunction \
  --principal bedrock.amazonaws.com
```

### 3.4 Upload the OpenAPI schema to S3

Generate the schema from the live introspection (or `schema-introspection.json`), then upload:

```bash
node scripts/generate-openapi.js > openapi.json
aws s3 cp openapi.json s3://mcp-graphql-bridge-schema/openapi.json
```

> `scripts/generate-openapi.js` is a script to be written as part of Phase 1 — it reads the GraphQL schema and outputs an OpenAPI 3.0 JSON with one endpoint per query/mutation.

---

## Phase 4 — Configure Bedrock Agent

### 4.1 Create the Bedrock Agent

In the AWS Console → Bedrock → Agents → Create Agent:

- **Name:** `mcp-graphql-bridge-agent`
- **Model:** Claude 3.5 Sonnet (or preferred)
- **Instructions:** describe what the agent can do with your GraphQL API

Or via CLI:

```bash
aws bedrock-agent create-agent \
  --agent-name mcp-graphql-bridge-agent \
  --foundation-model anthropic.claude-3-5-sonnet-20241022-v2:0 \
  --instruction "You have access to a GraphQL API. Use the available tools to query and mutate data."
```

Note the `agentId` returned.

### 4.2 Create the Action Group

```bash
aws bedrock-agent create-agent-action-group \
  --agent-id YOUR_AGENT_ID \
  --agent-version DRAFT \
  --action-group-name graphql-tools \
  --action-group-executor '{"lambda": "arn:aws:lambda:REGION:ACCOUNT:function:mcp-graphql-bridge"}' \
  --api-schema '{"s3": {"s3BucketName": "mcp-graphql-bridge-schema", "s3ObjectKey": "openapi.json"}}'
```

### 4.3 Prepare and deploy the Agent

```bash
aws bedrock-agent prepare-agent --agent-id YOUR_AGENT_ID

aws bedrock-agent create-agent-alias \
  --agent-id YOUR_AGENT_ID \
  --agent-alias-name production
```

Note the `agentAliasId` — this is what your application uses to call the agent.

---

## Phase 5 — Test

### 5.1 Test the Lambda directly

```bash
aws lambda invoke \
  --function-name mcp-graphql-bridge \
  --payload '{
    "actionGroup": "graphql-tools",
    "function": "query__getLines",
    "parameters": []
  }' \
  response.json && cat response.json
```

### 5.2 Test via Bedrock Agent

```bash
aws bedrock-agent-runtime invoke-agent \
  --agent-id YOUR_AGENT_ID \
  --agent-alias-id YOUR_ALIAS_ID \
  --session-id test-session-1 \
  --input-text "List all available lines"
```

### 5.3 Test via Bedrock console

Bedrock → Agents → select agent → Test tab. Type a natural language request and verify tool calls appear in the trace.

---

## Phase 6 — Updating after schema or code changes

| What changed | What to do |
|---|---|
| GraphQL schema changed | Regenerate `openapi.json`, upload to S3, re-prepare agent |
| Code changed (`src/`) | `npm run build`, repackage zip, `aws lambda update-function-code` |
| Token rotated | Update secret in Secrets Manager — Lambda picks it up on next cold start |

---

## AWS infrastructure summary

| Component | Purpose |
|---|---|
| **Lambda** (`mcp-graphql-bridge`) | Runs the GraphQL bridge handler |
| **IAM Role** | Grants Lambda basic execution + Secrets Manager read |
| **Secrets Manager** | Stores `GRAPHQL_TOKEN` securely |
| **S3 bucket** | Hosts the generated OpenAPI schema |
| **Bedrock Agent** | Orchestrates Claude + tool calls |
| **Bedrock Action Group** | Wires Lambda + OpenAPI schema into the agent |

---

## What stays the same

- `src/index.ts` stdio behaviour — Claude Code / Valmet usage unchanged
- All environment variable names
- The `__fields` selection set pattern
- npm package and Docker image are unaffected
