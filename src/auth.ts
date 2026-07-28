import type { IncomingMessage } from "http";
import { timingSafeEqual } from "crypto";

/** Constant-time check of the `Authorization: Bearer <token>` header. */
export function isAuthorized(req: IncomingMessage, mcpAuthToken: string): boolean {
  if (!mcpAuthToken) return true;
  const expected = Buffer.from(`Bearer ${mcpAuthToken}`);
  const actual = Buffer.from(req.headers.authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
