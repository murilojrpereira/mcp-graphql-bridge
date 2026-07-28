import type { IncomingMessage } from "http";
import { describe, expect, it } from "vitest";
import { isAuthorized } from "../auth.js";

function makeReq(authHeader?: string): IncomingMessage {
  return { headers: { authorization: authHeader } } as unknown as IncomingMessage;
}

describe("isAuthorized", () => {
  it("allows any request when no MCP_AUTH_TOKEN is configured", () => {
    expect(isAuthorized(makeReq(), "")).toBe(true);
    expect(isAuthorized(makeReq("Bearer whatever"), "")).toBe(true);
  });

  it("rejects requests with no Authorization header when a token is configured", () => {
    expect(isAuthorized(makeReq(), "secret")).toBe(false);
  });

  it("rejects requests with the wrong token", () => {
    expect(isAuthorized(makeReq("Bearer wrong-token"), "secret")).toBe(false);
  });

  it("accepts requests with the correct token", () => {
    expect(isAuthorized(makeReq("Bearer secret"), "secret")).toBe(true);
  });

  it("rejects a token that is a prefix/suffix of the real one", () => {
    expect(isAuthorized(makeReq("Bearer secre"), "secret")).toBe(false);
    expect(isAuthorized(makeReq("Bearer secretmore"), "secret")).toBe(false);
  });
});
