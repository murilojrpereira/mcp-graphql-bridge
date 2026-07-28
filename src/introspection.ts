import type { GqlField, GqlTypeRef, IntrospectionResult } from "./types.js";
import { GraphQLClient } from "graphql-request";

/** Sentinel returned when a type's wrapper chain (NON_NULL/LIST) is deeper than the introspection
 * query resolved — e.g. a query built at depth 2 can't fully unwrap a triple-wrapped `[[T!]!]!`.
 * Treating this as "Unknown" keeps the tool usable instead of crashing on `undefined.kind`. */
const UNKNOWN_TYPE: GqlTypeRef = { kind: "UNKNOWN", name: "Unknown", ofType: null };

/** Unwrap NonNull/List wrappers to get the base named type. */
export function getBaseType(type: GqlTypeRef | null | undefined): GqlTypeRef {
  if (!type) return UNKNOWN_TYPE;
  if (type.kind === "NON_NULL" || type.kind === "LIST") {
    return getBaseType(type.ofType);
  }
  return type;
}

/** Whether the outermost wrapper is NON_NULL (i.e. required). */
export function isRequired(type: GqlTypeRef): boolean {
  return type.kind === "NON_NULL";
}

/** Human-readable type string for tool descriptions, e.g. "[String!]!". */
export function typeString(type: GqlTypeRef | null | undefined): string {
  if (!type) return "Unknown";
  if (type.kind === "NON_NULL") return `${typeString(type.ofType)}!`;
  if (type.kind === "LIST") return `[${typeString(type.ofType)}]`;
  return type.name ?? "Unknown";
}

const SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID", "Long", "JSON"]);

export function isScalar(type: GqlTypeRef): boolean {
  const base = getBaseType(type);
  return SCALARS.has(base.name ?? "") || base.kind === "SCALAR" || base.kind === "ENUM";
}

const TYPE_FRAGMENT_FIELDS = "kind name";

/** Builds the `ofType { ... }` wrapper-unwrapping chain to the given nesting depth. */
function ofTypeChain(depth: number): string {
  let chain = TYPE_FRAGMENT_FIELDS;
  for (let i = 0; i < depth; i++) {
    chain = `${TYPE_FRAGMENT_FIELDS} ofType { ${chain} }`;
  }
  return chain;
}

function buildIntrospectionQuery(depth: number): string {
  const typeChain = ofTypeChain(depth);
  return `
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
              type { ${typeChain} }
            }
            type { ${typeChain} }
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
              type { ${typeChain} }
            }
            type { ${typeChain} }
          }
        }
      }
    }
  `;
}

/**
 * Introspection depths to try, in order. 6 gives full fidelity for the overwhelming majority of
 * real schemas (including doubly-wrapped lists like `[[Int!]!]!`). Some GraphQL endpoints —
 * notably CDN-fronted ones — enforce a query depth limit that rejects a query this deep even
 * though it's just introspecting the schema's own shape, not recursing into data. 2 is the
 * verified-safe fallback depth for those (confirmed against the public Countries demo API, whose
 * GCDN-hosted endpoint rejects depth 3 with "Query depth limit exceeded" / HTTP 413). Fields
 * wrapped deeper than whichever depth succeeds fall back to the UNKNOWN_TYPE sentinel above rather
 * than crashing.
 */
const INTROSPECTION_DEPTHS = [6, 2];

export interface LoadedSchema {
  mutationFields: GqlField[];
  queryFields: GqlField[];
}

/**
 * Runs schema introspection, retrying at a shallower query depth if the deepest attempt is
 * rejected (e.g. by a depth/complexity-limiting API gateway). Logs the real upstream error at each
 * attempt — a prior version of this logic swallowed the actual error and logged only a generic
 * "introspection failed" message, which made a depth-limit rejection indistinguishable from
 * introspection being genuinely disabled.
 */
export async function loadSchemaViaIntrospection(client: GraphQLClient): Promise<LoadedSchema> {
  let lastError: unknown;
  for (const depth of INTROSPECTION_DEPTHS) {
    try {
      const schema = await client.request<IntrospectionResult>(buildIntrospectionQuery(depth));
      return {
        queryFields: schema.__schema.queryType?.fields ?? [],
        mutationFields: schema.__schema.mutationType?.fields ?? [],
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mcp-graphql-bridge] Introspection at depth ${String(depth)} failed: ${msg}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
