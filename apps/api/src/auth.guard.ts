import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Optional bearer-token guard. When API_AUTH_TOKEN is set, every request must
 * carry `Authorization: Bearer <token>` (constant-time compared); when it is
 * unset the API is open (dev default). Mirrors the MCP HTTP guard's discipline.
 */
@Injectable()
export class BearerGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const token = process.env.API_AUTH_TOKEN;
    if (!token) return true;
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    const a = createHash('sha256').update(presented).digest();
    const b = createHash('sha256').update(token).digest();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
