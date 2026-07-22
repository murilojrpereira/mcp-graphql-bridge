# mcp-graphql-bridge

[![npm version](https://img.shields.io/npm/v/mcp-graphql-bridge.svg)](https://www.npmjs.com/package/mcp-graphql-bridge)
[![CI](https://github.com/murilojrpereira/mcp-graphql-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/murilojrpereira/mcp-graphql-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

A generic MCP (Model Context Protocol) server that bridges any GraphQL API to Claude Code. It introspects your GraphQL schema and exposes each query and mutation as an individual tool, letting Claude interact with your API directly.

## How it works

On startup the server will:

1. Look for a `schema-introspection.json` file in the working directory (fast, no network call)
2. If not found, run live introspection against `GRAPHQL_INTROSPECTION_URL`
3. Register one tool per query (`query__<name>`) and one per mutation (`mutation__<name>`)
4. Always register a generic `execute_graphql` fallback tool and a `get_type_details` explorer tool

## Requirements

- Node.js >= 20

## Setup

### Step 1: Install

#### Option A: Install from npm (recommended)

```bash
npm install -g mcp-graphql-bridge
```

#### Option B: Clone and build from source

```bash
git clone https://github.com/murilojrpereira/mcp-graphql-bridge.git
cd mcp-graphql-bridge
npm install
npm run build
```

### Step 2: Configure environment variables

| Variable | Required | Description |
|---|---|---|
| `GRAPHQL_API_URL` | No | Endpoint used for queries and mutations. Defaults to a public demo API ([countries.trevorblades.com](https://countries.trevorblades.com/graphql)) if unset — replace with your own for real use. |
| `GRAPHQL_INTROSPECTION_URL` | No | Endpoint used for schema introspection. Defaults to `GRAPHQL_API_URL` if unset. |
| `GRAPHQL_TOKEN` | No | Bearer token for GraphQL authentication (used for query/mutation execution). Omit for public APIs. |
| `GRAPHQL_INTROSPECTION_TOKEN` | No | Bearer token for schema introspection, if it requires different credentials than execution (e.g. a separate schema registry). Defaults to `GRAPHQL_TOKEN` if unset. |
| `MCP_AUTH_TOKEN` | No | Bearer token required by the hosted `/mcp` HTTP endpoint when `MCP_TRANSPORT=http` |
| `GRAPHQL_MAX_TOOLS` | No | Maximum number of query/mutation tools to register. Queries are prioritized over mutations when truncating. Default `128`. |
| `GRAPHQL_INCLUDE_MUTATIONS` | No | Set to `false` to exclude every mutation field entirely, for a read-only deployment. Default `true`. |
| `GRAPHQL_MAX_RETRIES` | No | Retries (0–5) for `429`/`502`/`503`/`504` responses, honoring `Retry-After` when present. Default `0` (disabled). |

For schemas with hundreds of fields (GitHub's GraphQL API has 284 root fields — 32 queries, 252
mutations), `GRAPHQL_MAX_TOOLS` and `GRAPHQL_INCLUDE_MUTATIONS` are what keep registration bounded
and predictable. If the cap truncates the schema, stderr logs exactly how many queries/mutations
were registered vs. available.

No configuration is required to try the server — with nothing set, it starts
against the public demo API above and logs that it's doing so. See
[`docs/architecture.md`](docs/architecture.md) for the full token model and
why the GraphQL endpoint is fixed per deployment rather than a per-request
parameter.

You can set these in a `.env` file at the project root:

```env
GRAPHQL_API_URL=https://your-api.example.com/graphql
GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql
GRAPHQL_TOKEN=your-bearer-token
```

Or pass them directly via the `claude mcp add` command (see below).

### Step 3: (Optional) Pre-generate schema snapshot

By default the server introspects your schema live on startup — no file needed, and it
automatically retries at a shallower query depth if your API rejects the full-depth attempt (some
APIs, especially CDN-fronted ones, enforce a query depth limit). Use this step only if your API
has introspection disabled entirely in production, or you want faster startup times:

```bash
curl -s -X POST https://your-api.example.com/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-bearer-token" \
  -d '{"query":"{ __schema { queryType { fields { name description args { name description defaultValue type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } } type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } } } mutationType { fields { name description args { name description defaultValue type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } } type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } } } } }"}' \
  > schema-introspection.json
```

If your API rejects this with a depth/complexity-limit error, shrink the `ofType { ... }` nesting
(each level resolves one more `NonNull`/`List` wrapper — most real-world types need 2-3 levels;
only doubly-wrapped lists like `[[Int!]!]!` need more).

## Adding to Claude Code

### Option A: User scope (just for you)

**If installed from npm:**
```bash
claude mcp add --transport stdio \
  --env GRAPHQL_API_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_TOKEN=your-bearer-token \
  graphql-bridge -- mcp-graphql-bridge
```

**If cloned from source:**
```bash
claude mcp add --transport stdio \
  --env GRAPHQL_API_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_TOKEN=your-bearer-token \
  graphql-bridge -- node /absolute/path/to/mcp-graphql-bridge/dist/index.js
```

> **Important:** Make sure to use `mcp-graphql-bridge/dist/index.js` (the compiled output), not `mcp-graphql-bridge/index.js`. The TypeScript source must be built first with `npm run build`, and the entry point is in the `dist/` folder.

### Option B: Project scope (shared with your team via `.mcp.json`)

```bash
claude mcp add --transport stdio --scope project \
  --env GRAPHQL_API_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_TOKEN=your-bearer-token \
  graphql-bridge -- mcp-graphql-bridge
```

> **Note:** Use absolute paths. All `--env` and `--transport` flags must come before the server name.

### Verify the connection

```bash
claude mcp list
```

Then in a Claude Code session, run `/mcp` to see available servers and tools.

## Examples

Two worked walkthroughs — a small public schema with no configuration needed, then a large,
real enterprise-scale schema requiring auth and tool-count limits.

### Example 1: Countries API (small schema, no auth)

This is the zero-config default — nothing to install or configure beyond the server itself.

1. Add the server with no environment variables at all:

   ```bash
   claude mcp add --transport stdio graphql-countries -- mcp-graphql-bridge
   ```

2. Restart Claude Code (or run `/mcp` to confirm `graphql-countries` is connected). You should see
   tools like `query__country`, `query__countries`, and `query__continents`.
3. Ask Claude:

   > Using graphql-countries, find the country with code "BR", then list its continent's other countries.

   Claude calls `query__country({ code: "BR", __fields: "{ name continent { code name } }" })`,
   then `query__continent` or `query__countries({ __fields: "{ name }" })` filtered by the result.
4. Try an invalid code to see error passthrough:

   > Look up the country with code "ZZZ".

   Returns the GraphQL API's own error text — the bridge passes it through rather than masking it.

### Example 2: GitHub GraphQL API (large schema, auth + tool limits)

GitHub's GraphQL API has **284 root fields** (32 queries, 252 mutations) — far more than the
`GRAPHQL_MAX_TOOLS` default of 128, and it needs a token for every request, including
introspection (unlike GitHub's REST API, which allows some anonymous reads).

1. Add the server, scoped to read-only access:

   ```bash
   export GH_TOKEN=ghp_your_personal_access_token  # or: source a gitignored .env file first

   claude mcp add --transport stdio graphql-github \
     --env GRAPHQL_API_URL=https://api.github.com/graphql \
     --env GRAPHQL_INTROSPECTION_URL=https://api.github.com/graphql \
     --env GRAPHQL_TOKEN=$GH_TOKEN \
     --env GRAPHQL_INCLUDE_MUTATIONS=false \
     graphql-bridge -- mcp-graphql-bridge
   ```

   `GRAPHQL_INCLUDE_MUTATIONS=false` registers all 32 (read-only) queries and zero mutations —
   comfortably under the cap, and a meaningfully safer default for an AI agent than exposing all
   252 write operations.
2. Ask Claude:

   > Using graphql-github, look up the repository facebook/react and tell me its star count.

   Claude calls
   `query__repository({ owner: "facebook", name: "react", __fields: "{ name stargazerCount }" })`.
3. To also reach mutations, drop `GRAPHQL_INCLUDE_MUTATIONS=false` and raise the cap
   (`GRAPHQL_MAX_TOOLS=400`), understanding that this exposes write access to your GitHub account
   scoped to whatever permissions your token has.

## Available tools

| Tool | Description |
|---|---|
| `query__<name>` | One tool per GraphQL query field |
| `mutation__<name>` | One tool per GraphQL mutation field |
| `execute_graphql` | Generic fallback — run any query or mutation (mutations rejected if `GRAPHQL_INCLUDE_MUTATIONS=false`) |
| `get_type_details` | Explore fields of a specific GraphQL type |

All per-operation tools accept a special `__fields` argument where you can provide a custom GraphQL selection set (e.g. `{ id name status }`). If omitted, only scalar fields are returned.

**Per-call auth override**: every tool (including `execute_graphql`) also accepts `bearer_token`
and `custom_headers` arguments. If provided, they override `GRAPHQL_TOKEN`/no-auth for that single
request only, letting Claude switch credentials per call without restarting the server.

## Security

- **The target API is fixed per deployment, never a per-request parameter.** Individual tool calls
  can override *credentials* (`bearer_token`, `custom_headers`) but never the destination host —
  `GRAPHQL_API_URL` is set once at deployment time. A shared server that let callers redirect it to
  an arbitrary destination would be a Server-Side Request Forgery (SSRF) primitive; this design
  rules that out by construction.
- **Configured and per-call secrets are redacted from every response** before it reaches the
  calling LLM.
- **`GRAPHQL_INCLUDE_MUTATIONS=false`** excludes every mutation field from registration for a
  genuinely read-only deployment — a meaningful trust boundary GraphQL's type system already
  encodes, rather than relying on token scope alone. This is enforced for `execute_graphql` too:
  it parses the query and rejects any mutation when this flag is off, rather than only omitting
  the convenience `mutation__*` tools while leaving the generic fallback able to run anything.
- **`MCP_AUTH_TOKEN`** gates the HTTP transport's `/mcp` endpoint for public-routable deployments;
  requests are capped at 10MB.

See [`docs/architecture.md`](docs/architecture.md) for the full design rationale and
[`SECURITY.md`](SECURITY.md) to report a vulnerability.

## Docker

### Build the image

```bash
docker build -t mcp-graphql-bridge .
```

### Add to Claude Code via Docker

```bash
claude mcp add --transport stdio \
  --env GRAPHQL_API_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql \
  --env GRAPHQL_TOKEN=your-bearer-token \
  graphql-bridge -- docker run -i --rm \
  -e GRAPHQL_API_URL -e GRAPHQL_INTROSPECTION_URL -e GRAPHQL_TOKEN \
  mcp-graphql-bridge
```

> **Note:** The `-i` flag (no `-t`) is required — it keeps stdin open for the MCP stdio protocol.

## HTTP deployment

For hosted MCP access, run the HTTP transport instead of stdio:

```bash
docker build -f Dockerfile.http -t mcp-graphql-bridge-http .
docker run --rm -p 8080:8080 \
  -e GRAPHQL_API_URL=https://your-api.example.com/graphql \
  -e GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql \
  -e GRAPHQL_TOKEN=your-bearer-token \
  mcp-graphql-bridge-http
```

Health checks are available at `/health`; MCP requests are served at `/mcp`.

For public-routable deployments, set `MCP_AUTH_TOKEN` and configure clients to send `Authorization: Bearer <token>` to `/mcp`.

See [`docs/deployment.md`](docs/deployment.md) for AWS, Cloudflare, and other container hosting options.

## Development

```bash
npm run dev   # watch mode: rebuilds and restarts on file changes
npm run build # one-off TypeScript compile
npm start     # run the compiled server
```

## Troubleshooting

### Error: Cannot find module '.../index.js'

If you see an error like:
```
Error: Cannot find module '/path/to/mcp-graphql-bridge/index.js'
```

You are pointing to the wrong file. The TypeScript source must be compiled first, and the entry point is in the `dist/` folder:

**Correct path:** `/path/to/mcp-graphql-bridge/dist/index.js`
**Wrong path:** `/path/to/mcp-graphql-bridge/index.js`

**Fix:**
1. Ensure you ran `npm run build` (creates the `dist/` folder)
2. Update your MCP configuration to use the full path ending in `/dist/index.js`

### Schema introspection fails

If the server starts but shows "Schema introspection failed", your GraphQL API may have introspection disabled in production. Use the curl command in step 3 of Setup to pre-generate a `schema-introspection.json` file.

### Tools not appearing in Claude Code

1. Run `claude mcp list` to verify the server is registered
2. Run `/mcp` in a Claude Code session to see available tools
3. Check that your GraphQL API's environment variables are set correctly (`GRAPHQL_API_URL`, `GRAPHQL_INTROSPECTION_URL`, `GRAPHQL_TOKEN`) — these are optional and default to a public demo API, so if tools still aren't appearing with your own API configured, check its credentials and endpoint URLs
