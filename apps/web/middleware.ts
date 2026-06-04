import { NextResponse, type NextRequest } from 'next/server';
import { sessionToken } from './lib/session';

/**
 * Optional auth gate. When WEB_PASSWORD is set, every page requires a session
 * cookie (set by /login); when it is unset the app is open (dev default). Simple
 * shared-secret gate for a single-reviewer deploy — not multi-user identity.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const password = process.env.WEB_PASSWORD;
  if (!password) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/login')) return NextResponse.next();
  if (req.cookies.get('decant_session')?.value === (await sessionToken(password))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

// Guard everything except Next internals + the public page images.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|uploads/).*)'] };
