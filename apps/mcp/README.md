# @decant/mcp

> MCP server adapter exposing Decant's review queue, corrections, and extraction as tools/resources.

**What it's for** — A thin [Model Context Protocol](https://modelcontextprotocol.io) adapter over the SAME [`@decant/core`](../../packages/core) domain logic and [`@decant/db`](../../packages/db) persistence the web UI and REST API use, so a correction made by an MCP client writes an identical `Correction` + `AuditEvent`. The marquee feature is `review_document`: the human-in-the-loop review step is implemented as MCP **elicitation** — the server asks the client's human for each flagged field's correct value. Runs over stdio (default) or a bearer-guarded Streamable HTTP transport.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_review_queue` | Documents with at least one field flagged `needs_review`. |
| `get_document` | A document and its extracted fields by `documentId`. |
| `correct_field` | Apply one correction non-interactively (`documentId`, `fieldPath`, `value`); writes a `Correction` + `AuditEvent`. |
| `review_document` | **Marquee** — walk a document's flagged fields and elicit each correct value from the human, then record it. |
| `extract_document` | Run the Gemini extraction pipeline on a local image/PDF `path` and return structured fields. |

## Resources

- `decant://documents/{id}` — a document and its fields (JSON).
- `decant://audit/{id}` — append-only audit events for a document (JSON).

## Scripts

- `serve` — start the server (`tsx src/server.ts`). stdio by default; set `MCP_TRANSPORT=http` for Streamable HTTP.
- `client` — a demo MCP client (`tsx src/client.ts`) that lists tools + the queue; pass a `documentId` to also read its resource and drive `review_document`.

## How it's used

```bash
# Server over stdio (default) — the host process launches it; logs go to stderr only.
pnpm --filter @decant/mcp run serve

# Server over bearer-guarded Streamable HTTP (loopback).
MCP_TRANSPORT=http MCP_AUTH_TOKEN=secret pnpm --filter @decant/mcp run serve

# Demo client: spawns the server over stdio, lists tools, prints the review queue.
pnpm --filter @decant/mcp run client
# ...and over HTTP, driving review for one document:
MCP_SERVER_URL=http://127.0.0.1:3333 MCP_AUTH_TOKEN=secret \
  pnpm --filter @decant/mcp run client <documentId>
```

The server is a factory (`createDecantMcp(prisma)`) — one `McpServer` per HTTP session, since server→client elicitation binds to a single transport; the stdio path calls it once.

**Env vars**
- `DATABASE_URL` — Prisma connection string (defaults to the shared `packages/db/prisma/dev.db`).
- `MCP_TRANSPORT` — `stdio` (default) or `http`.
- `MCP_AUTH_TOKEN` — bearer secret required for the HTTP transport; the server fails closed if `http` is set without it.
- `MCP_HOST` / `MCP_PORT` — HTTP bind (default `127.0.0.1:3333`).
- `GEMINI_API_KEY` — required by `extract_document` (lives in [`packages/gemini/.env`](../../packages/gemini)).
- `MCP_SERVER_URL` — client-only: HTTP server URL; when set, the client connects over HTTP instead of spawning stdio.

## Depends on

- [`@decant/core`](../../packages/core) — `DocumentPipeline` + the validation/confidence/routing services and `registry`.
- [`@decant/db`](../../packages/db) — `createPrismaClient`, `PrismaReviewService`, `loadCalibration` (the same fitted calibrator the CLI/API use, so routing is on calibrated probabilities).
- [`@decant/gemini`](../../packages/gemini) — `GoogleGenAIClient` + classify/extract services for `extract_document`.
- [`@decant/schemas`](../../packages/schemas), `@modelcontextprotocol/sdk`, `zod`.

## Notes

- **stdio carries the protocol on stdout** — never `console.log` on the stdio path; all logs go to stderr.
- The HTTP transport uses a deliberately minimal static-shared-secret bearer guard (constant-time compare, RFC 6750 challenges) — NOT the SDK's OAuth-coupled `requireBearerAuth`. It is hardened with DNS-rebinding protection (off by default in the SDK), a 1 MiB body cap, session/connection caps, and an idle sweeper.
- `review_document` widens the elicitation timeout to 5 min (a human is answering). If the client doesn't support elicitation it fails gracefully and points you at `correct_field`.

Tests: `apps/mcp/test/` — run `pnpm test` from the repo root.
