'use client';

export default function DocumentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p className="muted">{error.message || 'An unexpected error occurred while loading this document.'}</p>
      <button onClick={() => reset()}>Try again</button>
    </main>
  );
}
