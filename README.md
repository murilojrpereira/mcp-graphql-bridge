# mcp-graphql-bridge

[![npm version](https://img.shields.io/npm/v/mcp-graphql-bridge.svg)](https://www.npmjs.com/package/mcp-graphql-bridge)
[![CI](https://github.com/murilopereira/mcp-graphql-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/murilopereira/mcp-graphql-bridge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

A generic MCP (Model Context Protocol) server that bridges any GraphQL API to Claude Code. It introspects your GraphQL schema and exposes each query and mutation as an individual tool, letting Claude interact with your API directly.

## How it works

On startup the server will:

1. Look for a `schema-introspection.json` file in the working directory (fast, no network call)
2. If not found, run live introspection against `GRAPHQL_INTROSPECTION_URL`
3. Register one tool per query (`query__<name>`) and one per mutation (`mutation__<name>`)
4. Always register a generic `execute_graphql` fallback tool and a `get_type_details` explorer tool

## Requirements

- Node.js >= 18

## Setup

### Step 1: Install

#### Option A: Install from npm (recommended)

```bash
npm install -g mcp-graphql-bridge
```

#### Option B: Clone and build from source

```bash
git clone https://github.com/murilopereira/mcp-graphql-bridge.git
cd mcp-graphql-bridge
npm install
npm run build
```

### Step 2: Configure environment variables

| Variable | Required | Description |
|---|---|---|
| `GRAPHQL_API_URL` | Yes | Endpoint used for queries and mutations |
| `GRAPHQL_INTROSPECTION_URL` | Yes | Endpoint used for schema introspection (can be the same as above) |
| `GRAPHQL_TOKEN` | Yes | Bearer token for authentication |

You can set these in a `.env` file at the project root:

```env
GRAPHQL_API_URL=https://your-api.example.com/graphql
GRAPHQL_INTROSPECTION_URL=https://your-api.example.com/graphql
GRAPHQL_TOKEN=your-bearer-token
```

Or pass them directly via the `claude mcp add` command (see below).

### Step 3: (Optional) Pre-generate schema snapshot

By default the server introspects your schema live on startup — no file needed. Use this step only if your API has introspection disabled in production, or you want faster startup times:

```bash
curl -s -X POST https://your-api.example.com/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-bearer-token" \
  -d '{"query":"{ __schema { queryType { fields { name description args { name description defaultValue type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } type { kind name ofType { kind name ofType { kind name } } } } } mutationType { fields { name description args { name description defaultValue type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } type { kind name ofType { kind name ofType { kind name } } } } } } }"}' \
  > schema-introspection.json
```

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

## Available tools

| Tool | Description |
|---|---|
| `query__<name>` | One tool per GraphQL query field |
| `mutation__<name>` | One tool per GraphQL mutation field |
| `execute_graphql` | Generic fallback — run any query or mutation |
| `get_type_details` | Explore fields of a specific GraphQL type |

All per-operation tools accept a special `__fields` argument where you can provide a custom GraphQL selection set (e.g. `{ id name status }`). If omitted, only scalar fields are returned.

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
3. Check that all required environment variables are set (`GRAPHQL_API_URL`, `GRAPHQL_INTROSPECTION_URL`, `GRAPHQL_TOKEN`)
