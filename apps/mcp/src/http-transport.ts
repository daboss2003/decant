import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { makeBearerGuard } from './auth';

export interface HttpMcpOptions {
  /** Fresh McpServer per session (elicitation binds to its transport). */
  buildServer: () => McpServer;
  /** Static shared secret required as `Authorization: Bearer <token>`. */
  token: string;
  /** Loopback host the server is bound to (used for Host/Origin allow-lists). Default 127.0.0.1. */
  host?: string;
  /** Max concurrent sessions before new `initialize`s are refused with 503. Default 64. */
  maxSessions?: number;
}

const MAX_BODY_BYTES = 1 << 20; // 1 MiB — a JSON-RPC message is tiny; cap to bound memory.
const IDLE_MS = 10 * 60_000; // reap sessions with no traffic for 10 min.
const MAX_CONNECTIONS = 256; // socket ceiling for a single-user loopback tool.

class BodyTooLargeError extends Error {}

/** Read the body into a string with a hard byte cap (covers chunked bodies with no Content-Length). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      bytes += Buffer.byteLength(c, 'utf8');
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

/**
 * A bearer-guarded Streamable-HTTP MCP server (plan §8 + the auth roadmap item).
 *
 * Returns a not-yet-listening http.Server so the caller (or a test) chooses the
 * port/host — `server.listen(0, '127.0.0.1')` works because the Host/Origin
 * allow-lists are computed per request from the bound address.
 *
 * Design (verified against @modelcontextprotocol/sdk 1.29.0):
 *  - Stateful: one transport + one McpServer per session, keyed by the
 *    `Mcp-Session-Id` header — required so server→client elicitation reaches the
 *    right client over its standalone GET SSE stream.
 *  - The bearer guard runs on EVERY request before the transport sees it; a
 *    session id alone is never sufficient.
 *  - DNS-rebinding protection on (the SDK defaults it OFF), Host/Origin pinned to
 *    the loopback bind. `enableJsonResponse` left false (JSON mode would kill the
 *    SSE stream elicitation rides).
 *  - Hardened against resource exhaustion: a 1 MiB body cap, a concurrent-session
 *    cap, a connection ceiling, and — because the SDK frees a session only on an
 *    explicit DELETE that clients rarely send — session teardown bound to the GET
 *    socket closing plus an idle sweeper.
 */
export function createHttpMcpServer({ buildServer, token, host = '127.0.0.1', maxSessions = 64 }: HttpMcpOptions): Server {
  const guard = makeBearerGuard(token);
  const sessions = new Map<string, Session>();

  const drop = (id: string): void => {
    const s = sessions.get(id);
    if (!s) return; // already gone — avoids double-close
    sessions.delete(id);
    s.transport.close().catch(() => {});
  };

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.lastSeen > IDLE_MS) drop(id);
  }, 60_000);
  sweeper.unref(); // never keep the process alive on the sweeper alone

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!guard(req, res)) return; // 401 already written

      const port = (server.address() as AddressInfo | null)?.port ?? 0;
      const allowedHosts = [`${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`];
      const allowedOrigins = allowedHosts.map((h) => `http://${h}`);

      const sidHeader = req.headers['mcp-session-id'];
      const sessionId = typeof sidHeader === 'string' ? sidHeader : undefined;

      if (req.method === 'POST') {
        // Early reject on a declared oversize body before reading anything.
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          sendJson(res, 413, { error: 'payload_too_large' });
          return;
        }

        // Read the body ourselves (capped) for ALL POSTs and hand it to the
        // transport as parsedBody — so even existing-session messages are bounded
        // (the SDK's own req.json() is uncapped).
        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req));
        } catch (e) {
          if (e instanceof BodyTooLargeError) {
            sendJson(res, 413, { error: 'payload_too_large' });
            return;
          }
          parsed = undefined; // malformed JSON
        }

        if (sessionId) {
          const s = sessions.get(sessionId);
          if (!s) {
            sendJson(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
            return;
          }
          if (parsed === undefined) {
            sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
            return;
          }
          s.lastSeen = Date.now();
          await s.transport.handleRequest(req, res, parsed);
          return;
        }

        // No session header → must be an `initialize` request to open one.
        if (parsed !== undefined && isInitializeRequest(parsed)) {
          if (sessions.size >= maxSessions) {
            sendJson(res, 503, { error: 'too_many_sessions' });
            return;
          }
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(), // CSPRNG, unguessable
            enableDnsRebindingProtection: true, // OFF by default in the SDK — must be explicit
            allowedHosts,
            allowedOrigins,
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, lastSeen: Date.now() });
            },
            onsessionclosed: (id) => {
              sessions.delete(id); // SDK closes the transport itself on DELETE
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
          };
          transport.onerror = (e: unknown) => console.error('[mcp transport]', e instanceof Error ? e.message : String(e));
          const mcp = buildServer();
          await mcp.connect(transport); // calls transport.start()
          await transport.handleRequest(req, res, parsed);
          return;
        }

        sendJson(res, 400, {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: no valid session id (initialize first)' },
          id: null,
        });
        return;
      }

      // GET opens the server→client SSE stream (carries elicitation); DELETE ends the session.
      if (req.method === 'GET' || req.method === 'DELETE') {
        const s = sessionId ? sessions.get(sessionId) : undefined;
        if (!sessionId || !s) {
          sendJson(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
          return;
        }
        s.lastSeen = Date.now();
        // The GET SSE stream's lifetime IS the session's liveness; the SDK frees a
        // session only on explicit DELETE, so bind teardown to the socket closing.
        if (req.method === 'GET') res.on('close', () => drop(sessionId));
        await s.transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { Allow: 'GET, POST, DELETE' }).end();
    } catch (e) {
      console.error('[mcp http]', e instanceof Error ? e.message : String(e));
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
    }
  });

  server.maxConnections = MAX_CONNECTIONS;
  server.on('close', () => clearInterval(sweeper));
  return server;
}
