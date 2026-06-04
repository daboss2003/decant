import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { sessionToken } from '../../lib/session';

export const dynamic = 'force-dynamic';

async function login(formData: FormData): Promise<void> {
  'use server';
  const password = process.env.WEB_PASSWORD;
  const entered = String(formData.get('password') ?? '');
  if (password && entered === password) {
    // Store a derived token, not the raw password (see lib/session.ts).
    (await cookies()).set('decant_session', await sessionToken(password), { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
    redirect('/');
  }
  redirect('/login?error=1');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>Decant — sign in</h1>
      <form className="card correct" action={login}>
        <input type="password" name="password" placeholder="Review password" autoFocus aria-label="password" />
        <button type="submit">Sign in</button>
        {error ? <span className="why">Incorrect password.</span> : null}
      </form>
    </main>
  );
}
