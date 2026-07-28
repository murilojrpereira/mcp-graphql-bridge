import type { GqlField, SchemaFilters } from "../types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySchemaFilters } from "../tools.js";

function makeFields(n: number, prefix: string): GqlField[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `${prefix}${String(i)}`,
    description: null,
    args: [],
    type: { kind: "SCALAR", name: "String", ofType: null },
  }));
}

describe("applySchemaFilters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes everything through when under the cap", () => {
    const queries = makeFields(5, "q");
    const mutations = makeFields(5, "m");
    const filters: SchemaFilters = { maxTools: 128, includeMutations: true };
    const result = applySchemaFilters(queries, mutations, filters);
    expect(result.queryFields).toHaveLength(5);
    expect(result.mutationFields).toHaveLength(5);
  });

  it("excludes all mutations when includeMutations is false", () => {
    const queries = makeFields(5, "q");
    const mutations = makeFields(5, "m");
    const filters: SchemaFilters = { maxTools: 128, includeMutations: false };
    const result = applySchemaFilters(queries, mutations, filters);
    expect(result.queryFields).toHaveLength(5);
    expect(result.mutationFields).toHaveLength(0);
  });

  it("prioritizes queries over mutations when truncating", () => {
    const queries = makeFields(10, "q");
    const mutations = makeFields(10, "m");
    const filters: SchemaFilters = { maxTools: 15, includeMutations: true };
    const result = applySchemaFilters(queries, mutations, filters);
    expect(result.queryFields).toHaveLength(10);
    expect(result.mutationFields).toHaveLength(5);
  });

  it("caps queries alone if queries already exceed the limit", () => {
    const queries = makeFields(20, "q");
    const mutations = makeFields(5, "m");
    const filters: SchemaFilters = { maxTools: 10, includeMutations: true };
    const result = applySchemaFilters(queries, mutations, filters);
    expect(result.queryFields).toHaveLength(10);
    expect(result.mutationFields).toHaveLength(0);
  });

  it("logs a cut-off summary mentioning both counts and the relevant env vars", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queries = makeFields(200, "q");
    const mutations = makeFields(200, "m");
    applySchemaFilters(queries, mutations, { maxTools: 128, includeMutations: true });
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("GRAPHQL_MAX_TOOLS");
    expect(logged).toContain("GRAPHQL_INCLUDE_MUTATIONS");
  });

  it("does not log when nothing is cut off", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    applySchemaFilters(makeFields(2, "q"), makeFields(2, "m"), { maxTools: 128, includeMutations: true });
    expect(spy).not.toHaveBeenCalled();
  });
});
