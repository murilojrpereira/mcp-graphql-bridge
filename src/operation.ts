import type { GqlArg } from "./types.js";
import { Kind, parse } from "graphql";
import { typeString } from "./introspection.js";

/** Build the GraphQL operation string for a single query or mutation field. */
export function buildOperation(kind: "mutation" | "query", fieldName: string, args: GqlArg[], fields: string): string {
  const varDefs = args.map((a) => `$${a.name}: ${typeString(a.type)}`).join(", ");
  const argPairs = args.map((a) => `${a.name}: $${a.name}`).join(", ");

  const varDefStr = varDefs ? `(${varDefs})` : "";
  const argStr = argPairs ? `(${argPairs})` : "";

  return `
    ${kind} ${fieldName}Op${varDefStr} {
      ${fieldName}${argStr} ${fields}
    }
  `;
}

/**
 * Whether an arbitrary GraphQL document string contains a mutation operation. Used to enforce
 * GRAPHQL_INCLUDE_MUTATIONS=false against `execute_graphql`, which — unlike the generated
 * `mutation__*` tools — accepts a raw query string and would otherwise let a caller run any
 * mutation regardless of that setting, silently defeating it. A document that fails to parse is
 * treated as containing a mutation (fail closed) rather than assumed safe.
 */
export function queryContainsMutation(query: string): boolean {
  try {
    const document = parse(query);
    return document.definitions.some((def) => def.kind === Kind.OPERATION_DEFINITION && def.operation === "mutation");
  } catch {
    return true;
  }
}
