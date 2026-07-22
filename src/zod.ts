import type { GqlArg, GqlTypeRef } from "./types.js";
import { z } from "zod";
import { typeString } from "./introspection.js";

/** Convert a GraphQL argument type to a Zod schema. */
export function argToZod(type: GqlTypeRef): z.ZodTypeAny {
  if (type.kind === "NON_NULL") {
    return argToZodInner(type.ofType);
  }
  return argToZodInner(type).optional();
}

function argToZodInner(type: GqlTypeRef | null): z.ZodTypeAny {
  if (!type) return z.unknown();
  if (type.kind === "NON_NULL") return argToZodInner(type.ofType);
  if (type.kind === "LIST") return z.array(argToZod(type.ofType ?? { kind: "UNKNOWN", name: null, ofType: null }));

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

/** Build an args shape for server.tool() from a list of GqlArgs. */
export function buildArgsSchema(args: GqlArg[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const arg of args) {
    const zodType = argToZod(arg.type);
    shape[arg.name] = arg.description
      ? zodType.describe(`(${typeString(arg.type)}) ${arg.description}`)
      : zodType.describe(`(${typeString(arg.type)})`);
  }
  // Always allow callers to specify which fields to return
  shape.__fields = z
    .string()
    .optional()
    .describe(
      "GraphQL selection set for the return type, e.g. '{ id name description }'. If omitted, only scalar/id fields are returned.",
    );
  return shape;
}
