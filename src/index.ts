#!/usr/bin/env node
import "dotenv/config";
import { createServer } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { GraphQLClient } from "graphql-request";
import { z } from "zod";

const GRAPHQL_URL = process.env.GRAPHQL_API_URL;
const INTROSPECTION_URL = process.env.GRAPHQL_INTROSPECTION_URL;
const BEARER_TOKEN = process.env.GRAPHQL_TOKEN ?? "";

if (!GRAPHQL_URL) {
  console.error("Error: GRAPHQL_API_URL environment variable is required.");
  process.exit(1);
}
if (!INTROSPECTION_URL) {
  console.error("Error: GRAPHQL_INTROSPECTION_URL environment variable is required.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${BEARER_TOKEN}` };

// Client for actual queries/mutations
const client = new GraphQLClient(GRAPHQL_URL, { headers });

// Client for schema introspection only
const introspectionClient = new GraphQLClient(INTROSPECTION_URL, { headers });

// ── Introspection types ───────────────────────────────────────────────────────

interface GqlTypeRef {
  kind: string;
  name: string | null;
  ofType: GqlTypeRef | null;
}

interface GqlArg {
  name: string;
  description: string | null;
  type: GqlTypeRef;
  defaultValue: string | null;
}

interface GqlField {
  name: string;
  description: string | null;
  args: GqlArg[];
  type: GqlTypeRef;
}

interface IntrospectionResult {
  __schema: {
    queryType: { fields: GqlField[] } | null;
    mutationType: { fields: GqlField[] } | null;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Unwrap NonNull/List wrappers to get the base named type */
function getBaseType(type: GqlTypeRef): GqlTypeRef {
  if (type.kind === "NON_NULL" || type.kind === "LIST") {
    return getBaseType(type.ofType!);
  }
  return type;
}

/** Whether the outermost wrapper is NON_NULL (i.e. required) */
function isRequired(type: GqlTypeRef): boolean {
  return type.kind === "NON_NULL";
}

/** Human-readable type string for tool descriptions */
function typeString(type: GqlTypeRef): string {
  if (type.kind === "NON_NULL") return `${typeString(type.ofType!)}!`;
  if (type.kind === "LIST") return `[${typeString(type.ofType!)}]`;
  return type.name ?? "Unknown";
}

const SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID", "Long", "JSON"]);

function isScalar(type: GqlTypeRef): boolean {
  const base = getBaseType(type);
  return SCALARS.has(base.name ?? "") || base.kind === "SCALAR" || base.kind === "ENUM";
}

/** Convert a GraphQL argument type to a Zod schema */
function argToZod(type: GqlTypeRef): z.ZodTypeAny {
  if (type.kind === "NON_NULL") {
    return argToZodInner(type.ofType!);
  }
  return argToZodInner(type).optional();
}

function argToZodInner(type: GqlTypeRef): z.ZodTypeAny {
  if (type.kind === "NON_NULL") return argToZodInner(type.ofType!);
  if (type.kind === "LIST") return z.array(argToZod(type.ofType!));

  switch (type.name) {
    case "String":
    case "ID":
      return z.string();
    case "Int":
    case "Long":
      return z.number().int();
    case "Float":
      return z.number();
    case "Boolean":
      return z.boolean();
    case "JSON":
      return z.record(z.unknown());
    default:
      // Input objects and enums → accept as a generic value
      return z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown()), z.array(z.unknown())]);
  }
}

/** Build an args shape for server.tool() from a list of GqlArgs */
function buildArgsSchema(args: GqlArg[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const arg of args) {
    const zodType = argToZod(arg.type);
    shape[arg.name] = arg.description
      ? zodType.describe(`(${typeString(arg.type)}) ${arg.description}`)
      : zodType.describe(`(${typeString(arg.type)})`);
  }
  // Always allow callers to specify which fields to return
  shape["__fields"] = z
    .string()
    .optional()
    .describe(
      "GraphQL selection set for the return type, e.g. '{ id name description }'. If omitted, only scalar/id fields are returned."
    );
  return shape;
}

/** Build the GraphQL operation string */
function buildOperation(
  kind: "query" | "mutation",
  fieldName: string,
  args: GqlArg[],
  fields: string
): string {
  const varDefs = args
    .map((a) => `$${a.name}: ${typeString(a.type)}`)
    .join(", ");
  const argPairs = args.map((a) => `${a.name}: $${a.name}`).join(", ");

  const varDefStr = varDefs ? `(${varDefs})` : "";
  const argStr = argPairs ? `(${argPairs})` : "";

  return `
    ${kind} ${fieldName}Op${varDefStr} {
      ${fieldName}${argStr} ${fields}
    }
  `;
}

// ── Schema introspection ──────────────────────────────────────────────────────

const INTROSPECTION_QUERY = `
  query IntrospectOperations {
    __schema {
      queryType {
        fields {
          name
          description
          args {
            name
            description
            defaultValue
            type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
          }
          type { kind name ofType { kind name ofType { kind name } } }
        }
      }
      mutationType {
        fields {
          name
          description
          args {
            name
            description
            defaultValue
            type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
          }
          type { kind name ofType { kind name ofType { kind name } } }
        }
      }
    }
  }
`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const server = new McpServer({
    name: "mcp-graphql-bridge",
    version: "1.0.0",
  });

  // Try to load schema from static file first, then live introspection
  let queryFields: GqlField[] = [];
  let mutationFields: GqlField[] = [];

  try {
    const { readFileSync, existsSync } = await import("fs");
    if (existsSync("schema-introspection.json")) {
      const raw = JSON.parse(readFileSync("schema-introspection.json", "utf-8"));
      const s: IntrospectionResult = raw.data ?? raw;
      queryFields = s.__schema.queryType?.fields ?? [];
      mutationFields = s.__schema.mutationType?.fields ?? [];
      console.error(`Loaded schema from file: ${queryFields.length} queries, ${mutationFields.length} mutations`);
    } else {
      console.error("No schema-introspection.json found, trying live introspection...");
      const schema = await introspectionClient.request<IntrospectionResult>(INTROSPECTION_QUERY);
      queryFields = schema.__schema.queryType?.fields ?? [];
      mutationFields = schema.__schema.mutationType?.fields ?? [];
      console.error(`Live introspection: ${queryFields.length} queries, ${mutationFields.length} mutations`);
    }
  } catch (err) {
    console.error("Schema introspection failed (API may have it disabled). Falling back to generic query tool only.");
    console.error("To enable per-query tools, run the curl command to generate schema-introspection.json");
  }

  console.error(
    `Registering ${queryFields.length} query tools and ${mutationFields.length} mutation tools...`
  );

  // Register one tool per Query field
  for (const field of queryFields) {
    const argsSchema = buildArgsSchema(field.args);
    const returnTypeName = getBaseType(field.type).name ?? "data";
    const defaultFields = isScalar(field.type)
      ? ""
      : `{ __typename }`;

    server.tool(
      `query__${field.name}`,
      `[QUERY] ${field.description ?? field.name}. Returns: ${typeString(field.type)}`,
      argsSchema,
      async (rawArgs) => {
        const { __fields, ...variables } = rawArgs as Record<string, unknown> & { __fields?: string };
        const fields = __fields ?? defaultFields;
        const operation = buildOperation("query", field.name, field.args, fields);
        try {
          const data = await client.request(operation, variables);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error: ${msg}` }],
            isError: true,
          };
        }
      }
    );
  }

  // Register one tool per Mutation field
  for (const field of mutationFields) {
    const argsSchema = buildArgsSchema(field.args);
    const defaultFields = isScalar(field.type) ? "" : `{ __typename }`;

    server.tool(
      `mutation__${field.name}`,
      `[MUTATION] ${field.description ?? field.name}. Returns: ${typeString(field.type)}`,
      argsSchema,
      async (rawArgs) => {
        const { __fields, ...variables } = rawArgs as Record<string, unknown> & { __fields?: string };
        const fields = __fields ?? defaultFields;
        const operation = buildOperation("mutation", field.name, field.args, fields);
        try {
          const data = await client.request(operation, variables);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error: ${msg}` }],
            isError: true,
          };
        }
      }
    );
  }

  // Generic fallback tool — always available
  server.tool(
    "execute_graphql",
    "Execute any GraphQL query or mutation against the API. Use this when no specific tool exists for your operation.",
    {
      query: z.string().describe("Full GraphQL query or mutation string including selection set"),
      variables: z.record(z.unknown()).optional().describe("Variables for the operation"),
    },
    async ({ query, variables }) => {
      try {
        const data = await client.request(query, variables ?? {});
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // Bonus: type explorer tool
  server.tool(
    "get_type_details",
    "Get fields of a specific GraphQL type to know what to put in __fields",
    {
      typeName: z
        .string()
        .describe("GraphQL type name, e.g. 'Machine', 'WorkOrder', 'Shift'"),
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
      try {
        const data = await client.request(query, { name: typeName });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  if (process.env.MCP_TRANSPORT === "http") {
    const port = parseInt(process.env.PORT ?? "8080", 10);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks).toString();
        await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
        return;
      }
      res.writeHead(404).end();
    });

    httpServer.listen(port, () => {
      console.error(`GraphQL MCP server (HTTP) listening on port ${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("GraphQL MCP server running");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
