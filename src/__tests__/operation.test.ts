import type { GqlArg, GqlTypeRef } from "../types.js";
import { describe, expect, it } from "vitest";
import { buildOperation, queryContainsMutation } from "../operation.js";

function scalar(name: string): GqlTypeRef {
  return { kind: "SCALAR", name, ofType: null };
}

function nonNull(inner: GqlTypeRef): GqlTypeRef {
  return { kind: "NON_NULL", name: null, ofType: inner };
}

describe("buildOperation", () => {
  it("builds a query with no args", () => {
    const op = buildOperation("query", "countries", [], "{ code name }");
    expect(op).toContain("query countriesOp {");
    expect(op).toContain("countries { code name }");
  });

  it("builds a query with args, including variable definitions and usage", () => {
    const args: GqlArg[] = [{ name: "code", description: null, type: nonNull(scalar("ID")), defaultValue: null }];
    const op = buildOperation("query", "country", args, "{ name }");
    expect(op).toContain("query countryOp($code: ID!) {");
    expect(op).toContain("country(code: $code) { name }");
  });

  it("builds a mutation", () => {
    const op = buildOperation("mutation", "createThing", [], "{ id }");
    expect(op).toContain("mutation createThingOp {");
  });

  it("supports multiple args", () => {
    const args: GqlArg[] = [
      { name: "a", description: null, type: nonNull(scalar("String")), defaultValue: null },
      { name: "b", description: null, type: scalar("Int"), defaultValue: null },
    ];
    const op = buildOperation("mutation", "doThing", args, "{ ok }");
    expect(op).toContain("($a: String!, $b: Int)");
    expect(op).toContain("(a: $a, b: $b)");
  });
});

describe("queryContainsMutation", () => {
  it("is false for a plain query", () => {
    expect(queryContainsMutation("query { viewer { login } }")).toBe(false);
  });

  it("is true for a mutation", () => {
    expect(queryContainsMutation("mutation { addComment(input: {}) { clientMutationId } }")).toBe(true);
  });

  it("is true for a named mutation operation", () => {
    expect(queryContainsMutation("mutation DoThing($x: String) { doThing(x: $x) { ok } }")).toBe(true);
  });

  it("is true if any operation in a multi-operation document is a mutation", () => {
    const doc = "query GetThing { thing { id } } mutation ChangeThing { changeThing { ok } }";
    expect(queryContainsMutation(doc)).toBe(true);
  });

  it("fails closed (treats unparseable input as a mutation) rather than assuming it's safe", () => {
    expect(queryContainsMutation("not valid graphql {{{")).toBe(true);
  });

  it("is false for a subscription (not a mutation)", () => {
    expect(queryContainsMutation("subscription { onThing { id } }")).toBe(false);
  });
});
