import type { GqlTypeRef } from "../types.js";
import { describe, expect, it, vi } from "vitest";
import { getBaseType, isRequired, isScalar, loadSchemaViaIntrospection, typeString } from "../introspection.js";

function scalar(name: string): GqlTypeRef {
  return { kind: "SCALAR", name, ofType: null };
}

function nonNull(inner: GqlTypeRef): GqlTypeRef {
  return { kind: "NON_NULL", name: null, ofType: inner };
}

function list(inner: GqlTypeRef): GqlTypeRef {
  return { kind: "LIST", name: null, ofType: inner };
}

describe("getBaseType", () => {
  it("returns a plain scalar unchanged", () => {
    expect(getBaseType(scalar("String"))).toEqual(scalar("String"));
  });

  it("unwraps NON_NULL", () => {
    expect(getBaseType(nonNull(scalar("String")))?.name).toBe("String");
  });

  it("unwraps LIST", () => {
    expect(getBaseType(list(scalar("String")))?.name).toBe("String");
  });

  it("unwraps NON_NULL(LIST(NON_NULL(T))) — a very common real-world shape like [String!]!", () => {
    const type = nonNull(list(nonNull(scalar("String"))));
    expect(getBaseType(type).name).toBe("String");
  });

  it("returns the Unknown sentinel instead of crashing when ofType is missing (truncated by a shallow introspection query)", () => {
    const truncated: GqlTypeRef = { kind: "NON_NULL", name: null, ofType: null };
    expect(() => getBaseType(truncated)).not.toThrow();
    expect(getBaseType(truncated).name).toBe("Unknown");
  });

  it("returns the Unknown sentinel for null/undefined input", () => {
    expect(getBaseType(null).name).toBe("Unknown");
    expect(getBaseType(undefined).name).toBe("Unknown");
  });
});

describe("isRequired", () => {
  it("is true for NON_NULL", () => {
    expect(isRequired(nonNull(scalar("String")))).toBe(true);
  });

  it("is false otherwise", () => {
    expect(isRequired(scalar("String"))).toBe(false);
    expect(isRequired(list(scalar("String")))).toBe(false);
  });
});

describe("typeString", () => {
  it("renders a plain scalar", () => {
    expect(typeString(scalar("String"))).toBe("String");
  });

  it("renders NON_NULL with a trailing !", () => {
    expect(typeString(nonNull(scalar("String")))).toBe("String!");
  });

  it("renders LIST with brackets", () => {
    expect(typeString(list(scalar("String")))).toBe("[String]");
  });

  it("renders [String!]! correctly", () => {
    expect(typeString(nonNull(list(nonNull(scalar("String")))))).toBe("[String!]!");
  });

  it("does not throw and renders Unknown when truncated", () => {
    const truncated: GqlTypeRef = { kind: "NON_NULL", name: null, ofType: null };
    expect(() => typeString(truncated)).not.toThrow();
    expect(typeString(truncated)).toBe("Unknown!");
  });
});

describe("isScalar", () => {
  it("is true for known scalar names", () => {
    expect(isScalar(scalar("String"))).toBe(true);
    expect(isScalar(scalar("Int"))).toBe(true);
  });

  it("is true for SCALAR/ENUM kinds regardless of name", () => {
    expect(isScalar({ kind: "ENUM", name: "Status", ofType: null })).toBe(true);
  });

  it("is false for object types", () => {
    expect(isScalar({ kind: "OBJECT", name: "User", ofType: null })).toBe(false);
  });

  it("unwraps wrappers before checking", () => {
    expect(isScalar(nonNull(list(nonNull(scalar("String")))))).toBe(true);
  });
});

describe("loadSchemaViaIntrospection", () => {
  it("returns fields from a successful first attempt", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        __schema: {
          queryType: { fields: [{ name: "foo", description: null, args: [], type: scalar("String") }] },
          mutationType: { fields: [] },
        },
      }),
    };
    const result = await loadSchemaViaIntrospection(client as never);
    expect(result.queryFields).toHaveLength(1);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("retries at a shallower depth when the first attempt fails, and succeeds", async () => {
    const client = {
      request: vi
        .fn()
        .mockRejectedValueOnce(new Error("Query depth limit exceeded"))
        .mockResolvedValueOnce({
          __schema: {
            queryType: { fields: [] },
            mutationType: { fields: [{ name: "bar", description: null, args: [], type: scalar("Int") }] },
          },
        }),
    };
    const result = await loadSchemaViaIntrospection(client as never);
    expect(result.mutationFields).toHaveLength(1);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("throws the last error when every depth attempt fails", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("introspection disabled")) };
    await expect(loadSchemaViaIntrospection(client as never)).rejects.toThrow("introspection disabled");
    expect(client.request).toHaveBeenCalledTimes(2); // one call per configured depth
  });

  it("defaults missing queryType/mutationType to empty arrays", async () => {
    const client = { request: vi.fn().mockResolvedValue({ __schema: { queryType: null, mutationType: null } }) };
    const result = await loadSchemaViaIntrospection(client as never);
    expect(result.queryFields).toEqual([]);
    expect(result.mutationFields).toEqual([]);
  });
});
