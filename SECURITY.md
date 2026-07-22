# Security Policy

## Supported versions

Only the latest published version on npm receives security fixes. There is no long-term support
branch — upgrade to the latest release to pick up fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities privately, not via a public GitHub issue.

- Preferred: open a [GitHub Security Advisory](https://github.com/murilojrpereira/mcp-graphql-bridge/security/advisories/new) for this repository.
- Alternative: email security concerns to murilo@murilopereira.com with a description of the
  issue, affected version, and reproduction steps.

You should expect an initial response within a few days. Please don't publicly disclose the issue
until a fix has been released.

## Threat model

This server executes real GraphQL queries and mutations — including authenticated ones — against
an API on behalf of an MCP client (typically an LLM agent). Two design decisions matter most for
security review:

1. **The target API (`GRAPHQL_API_URL`) is fixed per deployment, never a per-request parameter.**
   Individual tool calls can override *credentials* (`bearer_token`, `custom_headers`) but never
   the destination host. A shared server that let callers redirect it to an arbitrary destination
   would be a Server-Side Request Forgery (SSRF) primitive; this design rules that out by
   construction. See [`docs/architecture.md`](docs/architecture.md) for the full rationale,
   including the alternatives considered and why they were rejected.
2. **Configured and per-call secrets are redacted from every response.** If an API error happens
   to echo back request details, the bridge scrubs every known secret value (the configured
   token, the introspection token, and any per-call overrides) out of both error text and
   response bodies before they reach the calling LLM.

## Security recommendations for operators

- **Token scope**: use GraphQL tokens with the minimal permissions the deployment actually needs.
  This server forwards whatever token it's given — the token's own scope is your real access
  boundary, not anything this server enforces.
- **Read-only deployments**: set `GRAPHQL_INCLUDE_MUTATIONS=false` to exclude every mutation field
  from registration entirely, rather than relying on token scope alone. This also blocks mutations
  submitted through `execute_graphql`'s raw query string, not just the generated `mutation__*`
  tools — an earlier version of this flag only did the latter, which meant the generic fallback
  tool could still execute any mutation with the full configured token even with the flag set.
- **`MCP_AUTH_TOKEN`**: set this for any public-routable HTTP deployment. It's a single shared
  static secret with no per-client revocation or attribution — treat it like an API key, not a
  login system.
- **Network security**: ensure `GRAPHQL_API_URL` uses HTTPS in production.
- **Never commit tokens**: use environment variables or a secret manager (AWS Secrets Manager,
  etc.), not literal values in source control or shell history.

## Known limitations (not vulnerabilities)

- No OAuth2 token flows — only static bearer tokens are supported.
- No per-operation auth override — credentials are per-call, but every call to a given deployment
  targets the same fixed `GRAPHQL_API_URL`.
- Schema introspection results are cached in memory for the process's lifetime, not encrypted at
  rest (in-memory only; nothing is written to disk unless you provide `schema-introspection.json`
  yourself).
- Retrying on `429`/`502`/`503`/`504` (`GRAPHQL_MAX_RETRIES`) applies to mutations as well as
  queries; if the upstream API doesn't support an idempotency mechanism for writes, only enable
  retries for read-heavy or naturally idempotent APIs. See
  [`docs/architecture.md`](docs/architecture.md#retries).
