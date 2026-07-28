import type { ExecutorConfig } from "../types.js";
import { ClientError } from "graphql-request";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeOperation } from "../executor.js";

const baseConfig: ExecutorConfig = { apiUrl: "https://api.example.com/graphql", headers: {}, maxRetries: 0, secrets: [] };

function makeClientError(status: number, headers: Record<string, string> = {}): ClientError {
  return new ClientError(
    { status, headers: new Headers(headers), body: "", errors: [{ message: "boom" }] as never },
    { query: "query {}" },
  );
}

describe("executeOperation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns formatted JSON on success", async () => {
    const client = { request: vi.fn().mockResolvedValue({ foo: "bar" }) };
    const result = await executeOperation(client as never, "query {}", {}, baseConfig);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('"foo": "bar"');
  });

  it("returns isError true and the message on failure", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("Field not found")) };
    const result = await executeOperation(client as never, "query {}", {}, baseConfig);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Field not found");
  });

  it("redacts the configured token from error text", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("failed, token ghp_supersecret123 was rejected")) };
    const config: ExecutorConfig = { ...baseConfig, secrets: ["ghp_supersecret123"] };
    const result = await executeOperation(client as never, "query {}", {}, config);
    expect(result.content[0].text).not.toContain("ghp_supersecret123");
    expect(result.content[0].text).toContain("[REDACTED]");
  });

  it("fully redacts a secret even when a shorter secret is a literal prefix of it", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("token abcdef was rejected, expected abc")) };
    const config: ExecutorConfig = { ...baseConfig, secrets: ["abc", "abcdef"] };
    const result = await executeOperation(client as never, "query {}", {}, config);
    expect(result.content[0].text).not.toContain("def");
    expect(result.content[0].text).not.toContain("abcdef");
  });

  it("redacts per-call override secrets even though they aren't in the base config", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("bad token per-call-secret-xyz")) };
    const result = await executeOperation(client as never, "query {}", {}, baseConfig, {
      bearerToken: "per-call-secret-xyz",
    });
    expect(result.content[0].text).not.toContain("per-call-secret-xyz");
  });

  it("passes bearer_token override as an Authorization header on the request call", async () => {
    const client = { request: vi.fn().mockResolvedValue({}) };
    await executeOperation(client as never, "query {}", {}, baseConfig, { bearerToken: "override-token" });
    const [, , requestHeaders] = client.request.mock.calls[0] as [string, unknown, Record<string, string>];
    expect(requestHeaders.Authorization).toBe("Bearer override-token");
  });

  it("does not retry when maxRetries is 0 (default)", async () => {
    const client = { request: vi.fn().mockRejectedValue(makeClientError(429)) };
    await executeOperation(client as never, "query {}", {}, baseConfig);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 up to maxRetries and returns the eventual success", async () => {
    vi.useFakeTimers();
    const client = {
      request: vi.fn().mockRejectedValueOnce(makeClientError(429, { "retry-after": "0" })).mockResolvedValueOnce({ ok: true }),
    };
    const config: ExecutorConfig = { ...baseConfig, maxRetries: 2 };
    const promise = executeOperation(client as never, "query {}", {}, config);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeFalsy();
  });

  it("gives up after maxRetries and returns the last error", async () => {
    vi.useFakeTimers();
    const client = { request: vi.fn().mockRejectedValue(makeClientError(503)) };
    const config: ExecutorConfig = { ...baseConfig, maxRetries: 2 };
    const promise = executeOperation(client as never, "query {}", {}, config);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(client.request).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(result.isError).toBe(true);
  });

  it("does not retry non-retryable GraphQL errors (e.g. a plain field error)", async () => {
    const client = { request: vi.fn().mockRejectedValue(makeClientError(400)) };
    const config: ExecutorConfig = { ...baseConfig, maxRetries: 3 };
    await executeOperation(client as never, "query {}", {}, config);
    expect(client.request).toHaveBeenCalledTimes(1);
  });
});
