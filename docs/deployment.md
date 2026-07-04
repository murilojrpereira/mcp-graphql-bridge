# Deployment Guide

This service is ready for container-based deployment using the HTTP transport.

## Runtime Modes

| Mode | Use case | Command/config |
|---|---|---|
| `stdio` | Local Claude Code MCP server | default `npm start` or `Dockerfile` |
| `http` | Hosted MCP endpoint | `MCP_TRANSPORT=http`, `PORT=8080`, or `Dockerfile.http` |

Hosted platforms should use `Dockerfile.http`. It exposes:

| Path | Purpose |
|---|---|
| `/health` | Container/platform health check |
| `/mcp` | MCP Streamable HTTP endpoint |

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GRAPHQL_API_URL` | No | Endpoint used for queries and mutations. Defaults to a public demo API if unset — always set this for a real deployment. |
| `GRAPHQL_INTROSPECTION_URL` | No | Endpoint used for schema introspection. Defaults to `GRAPHQL_API_URL` if unset. |
| `GRAPHQL_TOKEN` | No | Bearer token for query/mutation execution. Omit for public GraphQL APIs. |
| `GRAPHQL_INTROSPECTION_TOKEN` | No | Bearer token for introspection, if different from execution. Defaults to `GRAPHQL_TOKEN`. |
| `MCP_TRANSPORT` | Yes for hosting | Set to `http` |
| `PORT` | Platform-dependent | Defaults to `8080` |
| `MCP_AUTH_TOKEN` | Recommended | Bearer token required by `/mcp` when set |

Set `MCP_AUTH_TOKEN` for any public-routable deployment. Health checks remain unauthenticated at `/health`, while `/mcp` requires `Authorization: Bearer <token>` when this variable is configured.

`GRAPHQL_API_URL` is fixed per deployment rather than a per-request or
per-client parameter — this is a deliberate SSRF-avoidance decision, not a
limitation. See [`docs/architecture.md`](architecture.md) for the full
reasoning, the token model, and how stdio and HTTP transports differ in
what's isolated per client.

## AWS

Recommended AWS targets:

| Target | Status | Notes |
|---|---|---|
| Bedrock AgentCore Runtime | Ready | Existing `Dockerfile.agentcore` is tailored for this. |
| ECS/Fargate | Ready | Use `Dockerfile.http`, port `8080`, health check `/health`. |
| App Runner | Ready | Use `Dockerfile.http`; set env vars in App Runner service settings. |
| Lambda | Not currently implemented | Needs a Lambda handler or adapter. See `docs/aws-bedrock-deployment.md` for the planned alternative. |

Local AWS-style container test:

```bash
docker build -f Dockerfile.http -t mcp-graphql-bridge-http .
docker run --rm -p 8080:8080 \
  -e GRAPHQL_API_URL=https://your-api.example.com/graphql \
  -e GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql \
  -e GRAPHQL_TOKEN=your-bearer-token \
  -e MCP_AUTH_TOKEN=your-mcp-access-token \
  mcp-graphql-bridge-http
```

## Cloudflare

Recommended Cloudflare target:

| Target | Status | Notes |
|---|---|---|
| Cloudflare Containers | Ready | Use `Dockerfile.http`, port `8080`, health check `/health`. |
| Cloudflare Workers | Not directly ready | Workers do not run this Node HTTP server as-is. A Worker-specific adapter would be needed. |

For Cloudflare Containers, publish the image built from `Dockerfile.http`, set the GraphQL environment variables as secrets, and route traffic to port `8080`.

## Other Hosts

The same HTTP image should work on any container platform that supports inbound HTTP:

| Platform | Notes |
|---|---|
| Fly.io | Expose internal port `8080`; use secrets for GraphQL config. |
| Render | Use Docker deployment; health check path `/health`. |
| Railway | Use Dockerfile deployment; set `PORT` if Railway injects one. |
| Google Cloud Run | Use `Dockerfile.http`; Cloud Run will set `PORT`. |
| Azure Container Apps | Use `Dockerfile.http`; expose target port `8080`. |

## Readiness Checklist

1. Build passes: `npm run build`.
2. Tests pass: `npm test`.
3. HTTP mode starts with `MCP_TRANSPORT=http`.
4. `/health` returns JSON with `status: "ok"`.
5. `/mcp` is reachable by your MCP client.
6. `MCP_AUTH_TOKEN` is set for public-routable deployments.
7. GraphQL credentials are configured as platform secrets, not committed files.
