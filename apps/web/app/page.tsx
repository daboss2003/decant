import Link from 'next/link';
import { prisma } from '../lib/db';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const docs = await prisma.document.findMany({
    where: { fields: { some: { status: 'needs_review' } } },
    include: {
      upload: true,
      fields: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main>
      <h1>Review queue</h1>
      <p className="muted">Documents with at least one field the system flagged as low-confidence.</p>

      {docs.length === 0 && (
        <div className="card muted">
          Nothing to review. Seed some data with <code>pnpm --filter @decant/web run seed</code>.
        </div>
      )}

      {docs.map((d) => {
        const needsReview = d.fields.filter((f) => f.status === 'needs_review').length;
        return (
          <Link key={d.id} href={`/documents/${d.id}`} className="card queue-item">
            <div>
              <div className="field-name">{d.docType}</div>
              <div className="muted">
                {d.mode} · pages {d.pageStart}-{d.pageEnd}
                {d.reclassify ? ' · ⚠ possible mis-route' : ''}
              </div>
            </div>
            <div>
              <span className="pill review">{needsReview} need review</span>{' '}
              <span className="muted">of {d.fields.length}</span>
            </div>
          </Link>
        );
      })}
    </main>
  );
}
