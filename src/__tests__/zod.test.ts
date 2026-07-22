import type { GqlArg, GqlTypeRef } from "../types.js";
import { describe, expect, it } from "vitest";
import { argToZod, buildArgsSchema } from "../zod.js";

function scalar(name: string): GqlTypeRef {
  return { kind: "SCALAR", name, ofType: null };
}

function nonNull(inner: GqlTypeRef): GqlTypeRef {
  return { kind: "NON_NULL", name: null, ofType: inner };
}

function list(inner: GqlTypeRef): GqlTypeRef {
  return { kind: "LIST", name: null, ofType: inner };
}

describe("argToZod", () => {
  it("maps String/ID to z.string()", () => {
    expect(argToZod(nonNull(scalar("String"))).safeParse("hi").success).toBe(true);
    expect(argToZod(nonNull(scalar("ID"))).safeParse("abc123").success).toBe(true);
  });

  it("maps Int/Long to an integer number", () => {
    const zodType = argToZod(nonNull(scalar("Int")));
    expect(zodType.safeParse(5).success).toBe(true);
    expect(zodType.safeParse(5.5).success).toBe(false);
  });

  it("maps Float to a number", () => {
    expect(argToZod(nonNull(scalar("Float"))).safeParse(5.5).success).toBe(true);
  });

  it("maps Boolean to z.boolean()", () => {
    expect(argToZod(nonNull(scalar("Boolean"))).safeParse(true).success).toBe(true);
  });

  it("maps JSON to a record", () => {
    expect(argToZod(nonNull(scalar("JSON"))).safeParse({ a: 1 }).success).toBe(true);
  });

  it("maps unknown named types (input objects/enums) to a permissive union", () => {
    const zodType = argToZod(nonNull(scalar("SomeEnum")));
    expect(zodType.safeParse("VALUE").success).toBe(true);
    expect(zodType.safeParse({ nested: true }).success).toBe(true);
  });

  it("makes non-NON_NULL types optional", () => {
    const zodType = argToZod(scalar("String"));
    expect(zodType.safeParse(undefined).success).toBe(true);
  });

  it("maps LIST types to z.array()", () => {
    const zodType = argToZod(nonNull(list(nonNull(scalar("String")))));
    expect(zodType.safeParse(["a", "b"]).success).toBe(true);
    expect(zodType.safeParse("not-a-list").success).toBe(false);
  });

  it("does not throw when a wrapper type has a truncated (missing) ofType", () => {
    const truncated: GqlTypeRef = { kind: "NON_NULL", name: null, ofType: null };
    expect(() => argToZod(truncated)).not.toThrow();
  });
});

describe("buildArgsSchema", () => {
  it("includes one shape entry per arg plus __fields", () => {
    const args: GqlArg[] = [
      { name: "id", description: "The ID", type: nonNull(scalar("ID")), defaultValue: null },
      { name: "limit", description: null, type: scalar("Int"), defaultValue: null },
    ];
    const shape = buildArgsSchema(args);
    expect(Object.keys(shape).sort()).toEqual(["__fields", "id", "limit"]);
  });

  it("describes args with their GraphQL type string", () => {
    const args: GqlArg[] = [{ name: "id", description: "desc", type: nonNull(scalar("ID")), defaultValue: null }];
    const shape = buildArgsSchema(args);
    expect(shape.id.description).toContain("ID!");
    expect(shape.id.description).toContain("desc");
  });

  it("__fields is always optional", () => {
    const shape = buildArgsSchema([]);
    expect(shape.__fields.safeParse(undefined).success).toBe(true);
  });
});
