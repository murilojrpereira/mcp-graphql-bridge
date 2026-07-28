#!/usr/bin/env node
import type { ExecutorConfig, GqlField, IntrospectionResult, SchemaFilters } from "./types.js";
import { existsSync, readFileSync } from "fs";
import { createServer, type IncomingMessage } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import "dotenv/config";
import { GraphQLClient } from "graphql-request";
import { z } from "zod";
import { isAuthorized } from "./auth.js";
import { executeOperation } from "./executor.js";
import { loadSchemaViaIntrospection } from "./introspection.js";
import { queryContainsMutation } from "./operation.js";
import { applySchemaFilters, registerTools } from "./tools.js";

const DEFAULT_GRAPHQL_URL = "https://countries.trevorblades.com/graphql";

const GRAPHQL_URL = process.env.GRAPHQL_API_URL || DEFAULT_GRAPHQL_URL;
const INTROSPECTION_URL = process.env.GRAPHQL_INTROSPECTION_URL || GRAPHQL_URL;
const BEARER_TOKEN = process.env.GRAPHQL_TOKEN ?? "";
const INTROSPECTION_TOKEN = process.env.GRAPHQL_INTROSPECTION_TOKEN || BEARER_TOKEN;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
const MAX_MCP_BODY_BYTES = 10 * 1024 * 1024; // 10MB

if (!process.env.GRAPHQL_API_URL) {
  console.error(`[mcp-graphql-bridge] No GRAPHQL_API_URL set — using public demo API: ${DEFAULT_GRAPHQL_URL}`);
  console.error("[mcp-graphql-bridge] Replace with your own API via GRAPHQL_API_URL for real use.");
}

const headers: Record<string, string> = BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {};
const introspectionHeaders: Record<string, string> = INTROSPECTION_TOKEN
  ? { Authorization: `Bearer ${INTROSPECTION_TOKEN}` }
  : {};

const client = new GraphQLClient(GRAPHQL_URL, { headers });
const introspectionClient = new GraphQLClient(INTROSPECTION_URL, { headers: introspectionHeaders });

/** Read the full request body, enforcing a size cap. Returns null if the body is too large. */
async function readRequestBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_MCP_BODY_BYTES) {
      req.destroy();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function main() {
  let queryFields: GqlField[] = [];
  let mutationFields: GqlField[] = [];

  try {
    if (existsSync("schema-introspection.json")) {
      const raw = JSON.parse(readFileSync("schema-introspection.json", "utf-8")) as {
        __schema?: IntrospectionResult["__schema"];
        data?: IntrospectionResult;
      };
      const schema = raw.data ?? (raw as IntrospectionResult);
      queryFields = schema.__schema.queryType?.fields ?? [];
      mutationFields = schema.__schema.mutationType?.fields ?? [];
      console.error(
        `[mcp-graphql-bridge] Loaded schema from file: ${String(queryFields.length)} queries, ${String(mutationFields.length)} mutations`,
      );
    } else {
      console.error("[mcp-graphql-bridge] No schema-introspection.json found, trying live introspection...");
      const schema = await loadSchemaViaIntrospection(introspectionClient);
      queryFields = schema.queryFields;
      mutationFields = schema.mutationFields;
      console.error(
        `[mcp-graphql-bridge] Live introspection: ${String(queryFields.length)} queries, ${String(mutationFields.length)} mutations`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mcp-graphql-bridge] Schema introspection failed: ${msg}`);
    console.error(
      "[mcp-graphql-bridge] Falling back to generic query tool only. To enable per-query tools, run the curl command in the README to generate schema-introspection.json.",
    );
  }

  const filters: SchemaFilters = {
    maxTools: parseInt(process.env.GRAPHQL_MAX_TOOLS ?? "128", 10),
    includeMutations: process.env.GRAPHQL_INCLUDE_MUTATIONS !== "false",
  };
  const { queryFields: filteredQueries, mutationFields: filteredMutations } = applySchemaFilters(
    queryFields,
    mutationFields,
    filters,
  );

  const maxRetries = Math.max(0, Math.min(5, parseInt(process.env.GRAPHQL_MAX_RETRIES ?? "0", 10) || 0));
  const executorConfig: ExecutorConfig = {
    apiUrl: GRAPHQL_URL,
    headers,
    maxRetries,
    secrets: [BEARER_TOKEN, INTROSPECTION_TOKEN].filter((s) => s.length > 0),
  };

  console.error(
    `[mcp-graphql-bridge] Registering ${String(filteredQueries.length)} query tools and ${String(filteredMutations.length)} mutation tools...`,
  );

  // Builds a fresh McpServer with all tools registered. The stateless HTTP
  // transport requires a new server+transport pair per request, so this is
  // called once for stdio and once per request for HTTP.
  function buildServer(): McpServer {
    const server = new McpServer({
      name: "mcp-graphql-bridge",
      version: "2.0.0",
    });

    registerTools(server, client, filteredQueries, filteredMutations, executorConfig);

    server.tool(
      "execute_graphql",
      "Execute any GraphQL query or mutation against the API. Use this when no specific tool exists for your operation.",
      {
        query: z.string().describe("Full GraphQL query or mutation string including selection set"),
        variables: z.record(z.unknown()).optional().describe("Variables for the operation"),
        bearer_token: z
          .string()
          .optional()
          .describe("Bearer token to authenticate this request (overrides GRAPHQL_TOKEN)"),
        custom_headers: z
          .record(z.string())
          .optional()
          .describe('Additional request headers as key-value pairs, e.g. {"X-Tenant-ID": "abc"}'),
      },
      async ({ query, variables, bearer_token, custom_headers }) => {
        if (!filters.includeMutations && queryContainsMutation(query)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: mutations are disabled on this deployment (GRAPHQL_INCLUDE_MUTATIONS=false). This request contains a mutation operation and was blocked.",
              },
            ],
            isError: true,
          };
        }
        return executeOperation(client, query, variables ?? {}, executorConfig, {
          bearerToken: bearer_token,
          customHeaders: custom_headers,
        });
      },
    );

    server.tool(
      "get_type_details",
      "Get fields of a specific GraphQL type to know what to put in __fields",
      {
        typeName: z.string().describe("GraphQL type name, e.g. 'Repository', 'User', 'Issue'"),
      },
      async ({ typeName }) => {
        const query = `
          query GetType($name: String!) {
            __type(name: $name) {
              name kind description
              fields {
                name description
                type { kind name ofType { kind name ofType { kind name } } }
              }
              inputFields {
                name description
                type { kind name ofType { kind name } }
              }
              enumValues { name description }
            }
          }
        `;
        return executeOperation(introspectionClient, query, { name: typeName }, executorConfig);
      },
    );

    return server;
  }

  if (process.env.MCP_TRANSPORT === "http") {
    const port = parseInt(process.env.PORT ?? "8080", 10);

    if (!MCP_AUTH_TOKEN) {
      console.error(
        "[mcp-graphql-bridge] Warning: MCP_AUTH_TOKEN is not set — the /mcp endpoint is unauthenticated. Set MCP_AUTH_TOKEN to protect public-routable deployments.",
      );
    }

    const httpServer = createServer((req, res) => {
      const handle = async (): Promise<void> => {
        if (req.url === "/" || req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", mcpEndpoint: "/mcp" }));
          return;
        }
        if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
          if (req.method !== "POST") {
            res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
            res.end(
              JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }),
            );
            return;
          }
          const body = await readRequestBody(req);
          if (body === null) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload too large" }));
            return;
          }
          if (!isAuthorized(req, MCP_AUTH_TOKEN)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          let parsed: unknown;
          try {
            parsed = body.length ? JSON.parse(body.toString()) : undefined;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          const requestServer = buildServer();
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          await requestServer.connect(transport);
          res.on("close", () => {
            void transport.close();
            void requestServer.close();
          });
          await transport.handleRequest(req, res, parsed);
          return;
        }
        res.writeHead(404).end();
      };

      handle().catch((err: unknown) => {
        console.error("[mcp-graphql-bridge] Error handling HTTP request:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    });

    httpServer.listen(port, () => {
      console.error(`[mcp-graphql-bridge] HTTP server listening on port ${String(port)}`);
    });
  } else {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-graphql-bridge] Running on stdio transport");
  }
}

main().catch((err: unknown) => {
  console.error("[mcp-graphql-bridge] Fatal error:", err);
  process.exit(1);
});
