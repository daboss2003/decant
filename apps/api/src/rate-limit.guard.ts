import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { clientIp, type IpRequest } from './client-ip';

/**
 * In-memory per-IP sliding-window rate limit. The API is intentionally open (no
 * auth), so this is the abuse guard. `RATE_LIMIT_RPM` requests/minute/IP (default
 * 120; 0 disables). Single-instance; a multi-instance deploy would back this with
 * Redis. An idle sweeper keeps the IP map from growing unbounded.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly limit = Number(process.env.RATE_LIMIT_RPM ?? 120);
  private readonly windowMs = 60_000;

  constructor() {
    if (this.limit > 0) {
      const sweeper = setInterval(() => {
        const cutoff = Date.now() - this.windowMs;
        for (const [ip, ts] of this.hits) {
          const live = ts.filter((t) => t > cutoff);
          if (live.length) this.hits.set(ip, live);
          else this.hits.delete(ip);
        }
      }, this.windowMs);
      sweeper.unref?.();
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!Number.isFinite(this.limit) || this.limit <= 0) return true;
    const req = ctx.switchToHttp().getRequest<IpRequest>();
    const ip = clientIp(req, process.env.TRUST_PROXY === '1');
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.hits.set(ip, recent);
    return true;
  }
}
