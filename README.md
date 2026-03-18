# mcp-graphql-bridge

[![npm version](https://img.shields.io/npm/v/mcp-graphql-bridge.svg)](https://www.npmjs.com/package/mcp-graphql-bridge)
[![CI](https://github.com/YOUR_USERNAME/mcp-graphql-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/mcp-graphql-bridge/actions/workflows/ci.yml)
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

### Option A: Install from npm (recommended)

```bash
npm install -g mcp-graphql-bridge
```

### Option B: Clone and build from source

```bash
git clone https://github.com/YOUR_USERNAME/mcp-graphql-bridge.git
cd mcp-graphql-bridge
npm install
npm run build
```

### 2. Configure environment variables

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

### 3. (Optional) Pre-generate schema snapshot

If your API has introspection disabled at runtime, or you want faster startup, save the schema to a file:

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

## Development

```bash
npm run dev   # watch mode: rebuilds and restarts on file changes
npm run build # one-off TypeScript compile
npm start     # run the compiled server
```
