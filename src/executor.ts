import type { ExecutorConfig, McpToolResult } from "./types.js";
import { ClientError, GraphQLClient } from "graphql-request";

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_BACKOFF_MS = 8000;
const BASE_BACKOFF_MS = 500;

export interface CallOverrides {
  bearerToken?: string;
  customHeaders?: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a Retry-After header, which per RFC 9110 is either a delay in seconds or an HTTP-date. */
function parseRetryAfter(headers: Headers | undefined): number | undefined {
  const header = headers?.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
}

function buildRequestHeaders(overrides?: CallOverrides): Record<string, string> | undefined {
  if (!overrides) return undefined;
  const headers: Record<string, string> = {};
  if (overrides.bearerToken) headers.Authorization = `Bearer ${overrides.bearerToken}`;
  Object.assign(headers, overrides.customHeaders ?? {});
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Retries on 429/502/503/504 — status codes that conventionally mean the request never reached
 * business logic (rate-limited or a gateway hiccup). Honors `Retry-After` when the API sends one,
 * otherwise falls back to exponential backoff with jitter. `maxRetries` defaults to 0 (disabled).
 */
async function requestWithRetry<T>(
  client: GraphQLClient,
  query: string,
  variables: Record<string, unknown>,
  maxRetries: number,
  requestHeaders?: Record<string, string>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await client.request<T>(query, variables, requestHeaders);
    } catch (err) {
      const status = err instanceof ClientError ? err.response.status : undefined;
      if (attempt >= maxRetries || status === undefined || !RETRYABLE_STATUS_CODES.has(status)) {
        throw err;
      }
      const retryAfterMs = err instanceof ClientError ? parseRetryAfter(err.response.headers) : undefined;
      const backoffMs = retryAfterMs ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) + Math.random() * 250;
      await sleep(backoffMs);
      attempt++;
    }
  }
}

/**
 * Scrubs known secret values out of text before it's returned as tool output. Secrets are sorted
 * longest-first so that if one configured secret happens to be a literal prefix of another (e.g.
 * two independently-set tokens that overlap), redacting the shorter one first can't fragment and
 * leak a plaintext suffix of the longer one.
 */
function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

/**
 * Executes a GraphQL query or mutation and formats the result as MCP tool output. Errors and
 * response text are scrubbed of every known secret (configured token, per-call overrides) before
 * being returned to the calling LLM, so a misconfigured API that echoes request details in an
 * error can't leak credentials through the tool output.
 */
export async function executeOperation<T>(
  client: GraphQLClient,
  query: string,
  variables: Record<string, unknown>,
  config: ExecutorConfig,
  overrides?: CallOverrides,
): Promise<McpToolResult> {
  const secrets = [
    ...config.secrets,
    ...(overrides?.bearerToken ? [overrides.bearerToken] : []),
    ...Object.values(overrides?.customHeaders ?? {}),
  ].filter((s) => s.length > 0);

  try {
    const data = await requestWithRetry<T>(
      client,
      query,
      variables,
      config.maxRetries,
      buildRequestHeaders(overrides),
    );
    return { content: [{ type: "text", text: redactSecrets(JSON.stringify(data, null, 2), secrets) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: redactSecrets(`Error: ${msg}`, secrets) }], isError: true };
  }
}
