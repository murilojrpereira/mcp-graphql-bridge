# Architecture & Design Decisions

This document explains how the two transports (stdio and HTTP) differ in
practice, what each environment variable actually protects, and why certain
things that might look like limitations are deliberate design choices.

## Transport comparison: stdio vs. HTTP

| | stdio | HTTP |
|---|---|---|
| **Process model** | One process **per user**, spawned locally by their own MCP client (`claude mcp add --transport stdio`) | One process **shared by all callers**, running remotely (a container on AWS/Cloudflare/etc.) |
| **`GRAPHQL_API_URL` / `GRAPHQL_INTROSPECTION_URL`** | Set via that user's own `--env` flags, scoped to their process only. Different users can point at different APIs for free. | Fixed once at container startup by whoever deployed it. Same for every caller — see "Why the GraphQL endpoint is fixed per deployment" below. |
| **`GRAPHQL_TOKEN` / `GRAPHQL_INTROSPECTION_TOKEN`** | Scoped to that one user's process — since there's exactly one user per process, there's no cross-user sharing to worry about. | Fixed once at container startup. Every caller's tool calls execute under these same credentials — there is currently no per-caller GraphQL identity. |
| **`MCP_AUTH_TOKEN`** | Not used — only relevant to the HTTP transport. The OS process boundary is the access control. | Gates access to `/mcp` itself. One shared static secret for the whole deployment — anyone with the value gets in; there's no per-client revocation or attribution. |
| **Schema introspection** | Runs once at process startup, using that one user's token. | Runs once at server startup, using the fixed introspection token, cached in memory for the process's lifetime and shared by all callers. |
| **Query/mutation execution** | Uses that user's own token — correct by construction. | Uses the one shared execution client for every request, from every caller. |

The short version: stdio gets multi-tenant token isolation for free, because
"one process per user" means there's nothing to share across users in the
first place. HTTP collapses that isolation the moment many callers share one
process — the server access gate (`MCP_AUTH_TOKEN`) exists, but there is no
equivalent for the GraphQL credentials themselves.

## The token model

Three distinct tokens exist, protecting three distinct things:

| Token | Protects | Set by | Falls back to |
|---|---|---|---|
| `GRAPHQL_TOKEN` | Auth to the GraphQL API for query/mutation execution | Deployer | — (defaults to no `Authorization` header) |
| `GRAPHQL_INTROSPECTION_TOKEN` | Auth to the GraphQL API for schema introspection | Deployer | `GRAPHQL_TOKEN`, if unset |
| `MCP_AUTH_TOKEN` | Access to the MCP server's `/mcp` endpoint at all (HTTP only) | Deployer | — (endpoint is unauthenticated if unset) |

`GRAPHQL_TOKEN` and `GRAPHQL_INTROSPECTION_TOKEN` exist as separate settings
because introspection and execution can legitimately be different systems —
for example, a schema registry or gateway that requires its own credential,
separate from the live API used for actual queries. Most deployments only
need to set `GRAPHQL_TOKEN`; the introspection token is an escape hatch for
when they diverge.

## Why the GraphQL endpoint is fixed per deployment, not a runtime parameter

It might seem natural for a single hosted server to accept the target
GraphQL endpoint (and its token) as a per-request or per-client parameter —
that would let one deployment serve many different backends. This was
deliberately not built, because of Server-Side Request Forgery (SSRF): if
the server accepts an arbitrary caller-supplied URL and fetches it
server-side, anyone who can reach `/mcp` could point it at internal-only
network destinations — cloud metadata endpoints, private VPC services, admin
panels — and read the response back through the MCP client. `MCP_AUTH_TOKEN`
only gates *who can reach the server*, not *what the server is allowed to
call on the caller's behalf*, so it doesn't mitigate this.

Three options were considered for supporting multiple backends/clients:

1. **One deployment per client (recommended, and the current model)** — each
   client/team gets their own container with its own `GRAPHQL_API_URL` and
   tokens baked in. No SSRF risk, because the server never accepts a
   caller-supplied destination. The cost is operational (N clients means N
   deployments), but that's scriptable and matches how the existing
   Dockerfiles/deployment docs are already structured.
2. **One shared server, deployer-controlled host allowlist** — the server
   accepts per-caller tokens but the *deployer* (not the caller) configures
   an explicit allowlist of GraphQL hosts it's willing to call. Closes the
   SSRF hole while still letting one process serve several known backends.
   Doesn't scale to arbitrary/unknown APIs, since the deployer must know the
   hosts in advance.
3. **Fully open proxy, any host, any caller** — real SSRF hardening (blocking
   private/link-local/metadata IP ranges, re-resolving and re-checking IPs to
   prevent DNS rebinding) plus rate limiting and abuse controls, since the
   server becomes an arbitrary outbound proxy. This is a materially
   different product (a public GraphQL-to-MCP gateway) with meaningfully
   more ongoing security surface to own.

Given the goals of this project, option 1 is the current design:
`GRAPHQL_API_URL` stays fixed per deployment. If a genuine need for option 2
emerges (a small, known set of clients sharing one deployment), that's a
scoped addition worth revisiting — see the token model above for why it
would only need to vary the *token*, not the *endpoint*.

## Tool count cap and the query/mutation trust boundary

Unlike a REST-to-MCP bridge, this project has no OpenAPI-style tags to filter
by, but GraphQL's own type system already draws a meaningful boundary: query
fields read, mutation fields write. `GRAPHQL_MAX_TOOLS` (default 128, mirrored
from the equivalent OpenAPI-bridge setting) caps how many tools get
registered against a large schema (GitHub's GraphQL API has 284 root fields —
32 queries, 252 mutations — with no cap at all before this was added).
`applySchemaFilters` (`src/tools.ts`) registers all queries first and only
fills remaining budget with mutations, rather than cutting off in raw schema
order, so a truncated deployment is more likely to still expose safe reads
than to expose an arbitrary half of the schema. `GRAPHQL_INCLUDE_MUTATIONS=false`
excludes mutations entirely for a genuinely read-only deployment. Either way,
hitting the cap logs exactly how many queries/mutations were registered vs.
available, instead of silently truncating with no indication of what's
missing.

## Retries

`GRAPHQL_MAX_RETRIES` (default `0`, disabled) retries on HTTP `429`/`502`/
`503`/`504` — status codes that conventionally mean the request never reached
the API's business logic — honoring `Retry-After` when present and falling
back to exponential backoff with jitter otherwise. This applies to mutations
as well as queries, on the same reasoning as the OpenAPI bridge's equivalent
setting: these specific statuses mean the request was rejected before being
processed, not that it partially succeeded. As with that project, if the
GraphQL API you're bridging supports an idempotency mechanism for mutations,
prefer using it over relying on this being risk-free for every possible
upstream.

## The default demo API

If `GRAPHQL_API_URL` isn't set, the server falls back to a public demo API
(`https://countries.trevorblades.com/graphql`) instead of refusing to start.
This exists purely to lower the barrier to trying the project — a fresh
`git clone` + `npm start` (or `docker run` with no `-e` flags) demonstrates
real GraphQL connectivity immediately, rather than requiring a GraphQL API
on hand before you can see anything work. The server logs clearly when this
default is in effect, and it's expected to be replaced with your own API for
real use.

Note: the demo API's hosting CDN enforces a query-depth limit that this
project's original introspection query (intentionally deep, to correctly
resolve `NonNull`/`List` wrapper combinations like `[String!]!`) exceeded.
That used to mean a default install would silently fall back to registering
only `execute_graphql`/`get_type_details` instead of typed per-field tools —
degradation that worked, but meant the zero-config quickstart never actually
demonstrated the project's main feature.

`loadSchemaViaIntrospection` (`src/introspection.ts`) now retries at a
shallower, verified-safe query depth when the deep attempt is rejected, so
introspection against the demo API succeeds instead of falling back. The
generic-tools-only fallback still exists as a last resort if every depth
attempt fails (e.g. introspection is genuinely disabled), and the real
upstream error is now logged at each attempt instead of being swallowed
behind a generic "introspection failed" message.

Separately, no introspection depth is guaranteed to cover every real schema
— a type wrapped deeper than whichever attempt succeeds will have its
`ofType` chain truncated by the query itself. `getBaseType`/`typeString`
(`src/introspection.ts`) treat a truncated chain as an `Unknown` type rather
than crashing on `undefined`. This was previously a real crash: GitHub's
GraphQL API (`marketplaceCategories: [MarketplaceCategory!]!`) wraps one
level deeper than the old field-type query depth resolved, and registering
that schema brought down the whole process with
`TypeError: Cannot read properties of undefined (reading 'kind')` before a
single tool was ever served.
