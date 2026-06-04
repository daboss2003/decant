/**
 * Opaque session token = SHA-256("decant-session-v1:" + password), hex. Storing
 * this (not the raw WEB_PASSWORD) in the cookie means a leaked cookie discloses
 * only an app-scoped token, never the reusable/typeable shared secret. Uses Web
 * Crypto so the same helper runs in the Edge middleware AND the Node server action.
 */
export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`decant-session-v1:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
