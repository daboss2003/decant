'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

// Talks directly to the open (rate-limited, no-auth) REST API. If the API is run
// with API_AUTH_TOKEN set, browser uploads would 401 — front it with a same-origin
// server route that injects the bearer instead of exposing this page to the token.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface JobState {
  status: string;
  documentId?: string;
  error?: string;
}

export default function UploadPage() {
  const [status, setStatus] = useState('');
  const [docId, setDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('files') as HTMLInputElement | null;
    if (!input?.files?.length) return;
    setBusy(true);
    setDocId(null);
    setStatus('uploading…');
    try {
      const fd = new FormData();
      for (const f of Array.from(input.files)) fd.append('files', f);
      const res = await fetch(`${API}/uploads`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
      const { jobId } = (await res.json()) as { jobId: string };
      setStatus('processing…');
      for (let i = 0; i < 180; i++) {
        const poll = await fetch(`${API}/uploads/${jobId}`);
        if (!poll.ok) throw new Error(`status check failed (HTTP ${poll.status})`);
        const s = (await poll.json()) as JobState;
        if (s.status === 'done') {
          setStatus('done');
          setDocId(s.documentId ?? null);
          return;
        }
        if (s.status === 'error') {
          setStatus(`error: ${s.error ?? 'extraction failed'}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      setStatus('still processing — check the queue');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="topbar">
        <h1>Upload a document</h1>
        <Link href="/" className="pill">← queue</Link>
      </div>
      <p className="muted">Image, PDF, or text (md / html / xml / svg / txt / csv). Sent to the REST API for extraction.</p>

      <form className="card correct" onSubmit={onSubmit}>
        <input type="file" name="files" multiple accept="image/*,.pdf,.md,.markdown,.html,.htm,.xml,.svg,.txt,.csv,.json,.yaml,.yml" />
        <button type="submit" disabled={busy}>{busy ? 'Working…' : 'Extract'}</button>
      </form>

      {status && (
        <div className="card">
          Status: {status}
          {docId && (
            <>
              {' '}·{' '}
              <Link href={`/documents/${docId}`}>open document →</Link>
            </>
          )}
        </div>
      )}
      <p className="muted">API: {API}</p>
    </main>
  );
}
