import type { CallOverrides } from "./executor.js";
import type { ExecutorConfig, GqlField, SchemaFilters } from "./types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphQLClient } from "graphql-request";
import { z } from "zod";
import { executeOperation } from "./executor.js";
import { isScalar } from "./introspection.js";
import { buildOperation } from "./operation.js";
import { buildArgsSchema } from "./zod.js";

export interface FilteredSchema {
  mutationFields: GqlField[];
  queryFields: GqlField[];
}

/**
 * Caps the number of registered tools, prioritizing queries (reads) over mutations (writes) when
 * truncating — GraphQL's type system already draws this trust boundary for us, so it's a more
 * meaningful place to cut than an arbitrary schema-order cutoff. Unlike a silent cutoff, this logs
 * exactly what was cut and how to adjust it.
 */
export function applySchemaFilters(
  queryFields: GqlField[],
  mutationFields: GqlField[],
  filters: SchemaFilters,
): FilteredSchema {
  const effectiveMutations = filters.includeMutations ? mutationFields : [];
  const total = queryFields.length + effectiveMutations.length;

  if (total <= filters.maxTools) {
    return { queryFields, mutationFields: effectiveMutations };
  }

  const cappedQueryFields = queryFields.slice(0, filters.maxTools);
  const remaining = Math.max(0, filters.maxTools - cappedQueryFields.length);
  const cappedMutationFields = effectiveMutations.slice(0, remaining);

  const cutQueries = queryFields.length - cappedQueryFields.length;
  const cutMutations = effectiveMutations.length - cappedMutationFields.length;
  console.error(
    `[mcp-graphql-bridge] Reached GRAPHQL_MAX_TOOLS=${String(filters.maxTools)}. Registered ` +
      `${String(cappedQueryFields.length)}/${String(queryFields.length)} queries and ` +
      `${String(cappedMutationFields.length)}/${String(effectiveMutations.length)} mutations ` +
      `(${String(cutQueries + cutMutations)} fields cut off). Raise GRAPHQL_MAX_TOOLS, or set ` +
      `GRAPHQL_INCLUDE_MUTATIONS=false for read-only access.`,
  );

  return { queryFields: cappedQueryFields, mutationFields: cappedMutationFields };
}

const RESERVED_ARGS = new Set(["bearer_token", "custom_headers"]);

function withCallOverrides(shape: Record<string, z.ZodTypeAny>, fieldName: string): Record<string, z.ZodTypeAny> {
  const result = { ...shape };
  for (const reserved of RESERVED_ARGS) {
    if (reserved in result) {
      console.error(`[mcp-graphql-bridge] Argument "${reserved}" on "${fieldName}" collides with a reserved arg name.`);
    }
  }
  result.bearer_token = z
    .string()
    .optional()
    .describe("Bearer token to authenticate this request (overrides GRAPHQL_TOKEN)");
  result.custom_headers = z
    .record(z.string())
    .optional()
    .describe('Additional request headers as key-value pairs, e.g. {"X-Tenant-ID": "abc"}');
  return result;
}

function toCallOverrides(rawArgs: Record<string, unknown>): CallOverrides {
  const bearerToken = typeof rawArgs.bearer_token === "string" ? rawArgs.bearer_token : undefined;
  const customHeaders =
    typeof rawArgs.custom_headers === "object" && rawArgs.custom_headers !== null
      ? (rawArgs.custom_headers as Record<string, string>)
      : undefined;
  return { bearerToken, customHeaders };
}

export function registerTools(
  server: McpServer,
  client: GraphQLClient,
  queryFields: GqlField[],
  mutationFields: GqlField[],
  config: ExecutorConfig,
): void {
  for (const field of queryFields) {
    registerField(server, client, "query", field, config);
  }
  for (const field of mutationFields) {
    registerField(server, client, "mutation", field, config);
  }
}

function registerField(
  server: McpServer,
  client: GraphQLClient,
  kind: "mutation" | "query",
  field: GqlField,
  config: ExecutorConfig,
): void {
  const argsSchema = withCallOverrides(buildArgsSchema(field.args), field.name);
  const defaultFields = isScalar(field.type) ? "" : "{ __typename }";

  server.tool(
    `${kind}__${field.name}`,
    `[${kind.toUpperCase()}] ${field.description ?? field.name}`,
    argsSchema,
    async (rawArgs) => {
      // bearer_token/custom_headers are extracted via toCallOverrides() below — strip them here so
      // they aren't sent to the API as GraphQL variables.
      const {
        __fields,
        bearer_token: _bearerToken,
        custom_headers: _customHeaders,
        ...variables
      } = rawArgs as Record<string, unknown> & { __fields?: string };
      const fields = __fields ?? defaultFields;
      const operation = buildOperation(kind, field.name, field.args, fields);
      return executeOperation(client, operation, variables, config, toCallOverrides(rawArgs));
    },
  );
}
