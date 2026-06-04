import Link from 'next/link';
import type { Enrichment } from '@decant/core';
import { prisma } from '../../../lib/db';
import { FieldReviewForm } from './field-review-form';
import { PageViewer, type ViewerBox, type ViewerPage } from './page-viewer';

export const dynamic = 'force-dynamic';

type Signals = Record<string, number | boolean> | null;

/** Narrow the Json `enrichment` column to the enrichment array (or []). */
function asEnrichments(v: unknown): Enrichment[] {
  return Array.isArray(v) ? (v as Enrichment[]) : [];
}

type Provenance = { pageIndex: number; bbox: { x: number; y: number; w: number; h: number } };

/** Narrow the Json `provenance` column to a usable bbox (or null). */
function asProvenance(v: unknown): Provenance | null {
  if (v && typeof v === 'object' && 'bbox' in v) {
    const p = v as Provenance;
    if (p.bbox && typeof p.bbox.x === 'number' && typeof p.bbox.w === 'number') return p;
  }
  return null;
}

function whyFlagged(signals: Signals): string {
  // NOTE: keys mirror what the confidence pipeline + enrichment emit (see @decant/core).
  if (signals && typeof signals === 'object') {
    // External-source verification verdicts (any verifier: registry/cac/taxId/…).
    // Signal keys are `<verifier><Mismatch|NotFound|Inactive|Unavailable>`.
    for (const key of Object.keys(signals)) {
      if (!signals[key]) continue;
      const m = key.match(/^(.+?)(Mismatch|NotFound|Inactive|Unavailable)$/);
      if (!m) continue;
      const who = m[1];
      switch (m[2]) {
        case 'Mismatch':
          return `${who} verification: an external authority returned a DIFFERENT value — it disagrees with the model`;
        case 'NotFound':
          return `${who} verification: not found by the authority — could not confirm`;
        case 'Inactive':
          return `${who} verification: found but NOT in good standing (e.g. inactive/dissolved)`;
        case 'Unavailable':
          return `${who} verification: the authority could not be reached — not completed`;
      }
    }
    if (signals.gateFailed) return 'a domain rule (GATE) failed — the value does not reconcile';
    if (signals.signalFailed) return 'a soft check (SIGNAL) failed';
    if (signals.generic) return 'extracted via the generic fallback (low trust)';
  }
  return 'confidence below the auto-approve threshold';
}

/** Human-readable value (no JSON quotes). Currency-aware money formatting is a follow-up. */
function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '— (absent)';
  if (typeof v === 'string') return v;
  return String(v);
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({
    where: { id },
    include: { upload: true, fields: { orderBy: { fieldPath: 'asc' } } },
  });

  if (!doc) {
    return (
      <main>
        <p><Link href="/">← queue</Link></p>
        <div className="card">Document not found.</div>
      </main>
    );
  }

  const auto = doc.fields.filter((f) => f.status === 'auto_approved').length;
  const enrichments = asEnrichments(doc.enrichment);

  // Fields we can point to on the scan, numbered so each box matches its row.
  const located = doc.fields
    .map((f) => ({ f, prov: asProvenance(f.provenance) }))
    .filter((x): x is { f: (typeof doc.fields)[number]; prov: Provenance } => x.prov !== null);
  const numberOf = new Map(located.map((x, i) => [x.f.id, i + 1]));

  // Per-page image refs (multi-page) + the boxes to overlay, for the paged viewer.
  const pageRefs = Array.isArray(doc.upload.pageImageRefs) ? (doc.upload.pageImageRefs as (string | null)[]) : null;
  const pages: ViewerPage[] = [];
  for (let p = doc.pageStart; p <= doc.pageEnd; p++) {
    pages.push({ pageIndex: p, ref: pageRefs ? (pageRefs[p] ?? null) : p === doc.pageStart ? doc.upload.imageRef ?? null : null });
  }
  const boxes: ViewerBox[] = located.map(({ f, prov }) => ({
    id: f.id,
    pageIndex: prov.pageIndex,
    num: numberOf.get(f.id) ?? 0,
    ok: f.status === 'auto_approved',
    x: prov.bbox.x,
    y: prov.bbox.y,
    w: prov.bbox.w,
    h: prov.bbox.h,
    title: `${f.fieldPath} — ${displayValue(f.value)}`,
  }));

  return (
    <main>
      <p><Link href="/">← queue</Link></p>
      <h1>{doc.docType} <span className="muted">({doc.mode})</span></h1>
      <p className="muted">
        {auto}/{doc.fields.length} auto-approved · pages {doc.pageStart}-{doc.pageEnd}
        {doc.reclassify ? ' · ⚠ flagged for reclassification' : ''}
      </p>

      {enrichments.length > 0 && (
        <div className="card enrich">
          <strong>External verification</strong> <span className="muted">(MCP client → registry / FX)</span>
          <ul>
            {enrichments.map((e, i) =>
              e.kind === 'verification' ? (
                <li key={i}>
                  {e.verifier} ({e.field}){e.source ? ` via ${e.source}` : ''}:{' '}
                  <span className={`pill ${e.status === 'verified' ? 'ok' : 'review'}`}>{e.status.replace('_', ' ')}</span>
                  {e.authoritativeValue ? ` — “${e.authoritativeValue}” vs extracted “${e.extractedValue ?? '—'}”` : ''}
                  {e.status === 'mismatch' ? ` · match ${e.matchScore.toFixed(2)}` : ''}
                  {e.standing ? ` · standing ${e.standing}` : ''}
                  {e.reference ? ` · ref ${e.reference}` : ''}
                </li>
              ) : (
                <li key={i}>
                  FX: {e.field} = {e.amount} {e.currency} ≈ <strong>{e.baseAmount} {e.base}</strong>{' '}
                  <span className="muted">(rate {e.rate}, {e.asOf})</span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      <div className="review">
        {/* OCR-aligned provenance overlaid on each page; number matches the field row (plan §2/§5). */}
        <PageViewer pages={pages} boxes={boxes} alt={`${doc.docType} scan, pages ${doc.pageStart}-${doc.pageEnd}`} />

        <div>
          {doc.fields.map((f) => {
            const flagged = f.status === 'needs_review';
            const pill =
              f.status === 'auto_approved' ? 'ok' : f.status === 'corrected' ? 'corrected' : 'review';
            return (
              <div key={f.id} className={`field${flagged ? ' flagged' : ''}`}>
                <div className="field-head">
                  <span className="field-name">
                    {f.fieldPath}
                    {numberOf.has(f.id) && <span className="loc" title="located on the scan">{numberOf.get(f.id)}</span>}
                  </span>
                  <span className={`pill ${pill}`}>{f.status.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="val">{displayValue(f.value)}</span>{' '}
                  <span className="conf">conf {f.confidence.toFixed(2)}</span>
                  {Object.keys((f.signals as Signals) ?? {})
                    .filter((k) => /Verified$/.test(k) && (f.signals as Signals)?.[k])
                    .map((k) => (
                      <span key={k} className="pill ok" title="corroborated by an external authority">
                        ✓ {k.replace(/Verified$/, '')}-verified
                      </span>
                    ))}
                </div>

                {flagged && (
                  <>
                    <div className="why">Why: {whyFlagged(f.signals as Signals)}</div>
                    <FieldReviewForm
                      documentId={doc.id}
                      fieldPath={f.fieldPath}
                      currentValue={f.value === null ? '' : String(f.value)}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
