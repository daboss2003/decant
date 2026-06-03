import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * A minimal static-shared-secret bearer guard for the HTTP transport.
 *
 * We deliberately do NOT use the SDK's `requireBearerAuth` middleware: it is
 * Express-coupled and built for OAuth 2.1 access tokens (it mandates a numeric,
 * non-expired `expiresAt`), which is overkill for a single shared secret. The
 * full MCP authorization framework (OAuth 2.1 + RFC 9728 resource metadata)
 * applies to HTTP transports; a static secret is a deliberate simplification.
 *
 * Security properties:
 *  - constant-time comparison (hash both sides to a fixed length, then
 *    `timingSafeEqual`) so neither token length nor a matching prefix leaks via
 *    response timing;
 *  - fail-closed: an empty configured token is a programmer error and throws;
 *  - correct RFC 6750 semantics: 401 + `WWW-Authenticate: Bearer ...`, with
 *    `invalid_request` for a missing/malformed header and `invalid_token` for a
 *    present-but-wrong token. The token value is never logged or echoed.
 */
export type BearerGuard = (req: IncomingMessage, res: ServerResponse) => boolean;

function challenge(res: ServerResponse, code: 'invalid_request' | 'invalid_token', desc: string): false {
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', `Bearer error="${code}", error_description="${desc}"`);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: code, error_description: desc }));
  return false;
}

/** Build a guard that returns true (and tags `req.auth`) when the request carries the expected bearer token. */
export function makeBearerGuard(token: string): BearerGuard {
  if (!token) throw new Error('makeBearerGuard: a non-empty token is required (fail closed)');
  const expected = createHash('sha256').update(token).digest();

  return (req, res) => {
    const header = req.headers.authorization;
    if (!header) return challenge(res, 'invalid_request', 'Missing Authorization header');

    // RFC 6750 credentials are exactly `Bearer <token68>` — reject anything with
    // a different scheme, an empty token, or trailing garbage.
    const parts = header.split(' ');
    if (parts.length !== 2 || (parts[0] ?? '').toLowerCase() !== 'bearer' || !parts[1]) {
      return challenge(res, 'invalid_request', "Expected 'Bearer <token>'");
    }

    // Hash both sides to a fixed 32 bytes so timingSafeEqual never throws on a
    // length mismatch (which would itself leak the expected length).
    const got = createHash('sha256').update(parts[1]).digest();
    if (!timingSafeEqual(got, expected)) return challenge(res, 'invalid_token', 'Invalid token');

    // Tag the request as authenticated for tool handlers (MessageExtraInfo.authInfo).
    // Never carry the live secret forward — store an opaque marker, not the token.
    (req as IncomingMessage & { auth?: AuthInfo }).auth = { token: 'redacted', clientId: 'mcp-bearer', scopes: [] };
    return true;
  };
}
