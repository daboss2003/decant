/** Minimal request shape we need to derive a client IP (avoids an Express dep here). */
export interface IpRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Resolve the client IP used as the rate-limit key. X-Forwarded-For is
 * client-supplied and trivially spoofable, so varying it per request would mint a
 * fresh bucket each time and defeat the limit. Honor it ONLY behind a trusted
 * proxy, and then take the RIGHT-most hop (the address our proxy actually
 * observed), never the left-most client-supplied value. Otherwise key on the
 * socket peer (req.ip).
 */
export function clientIp(req: IpRequest, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const chain = (Array.isArray(fwd) ? fwd.join(',') : fwd ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return req.ip || 'unknown';
}
