'use client';

import { useState } from 'react';

export interface ViewerPage {
  pageIndex: number;
  ref: string | null;
}
export interface ViewerBox {
  id: string;
  pageIndex: number;
  num: number;
  ok: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

/** Paged scan viewer: navigate a multi-page document and overlay each page's bboxes. */
export function PageViewer({ pages, boxes, alt }: { pages: ViewerPage[]; boxes: ViewerBox[]; alt: string }) {
  const [i, setI] = useState(0);
  const page = pages[i] ?? pages[0];
  if (!page) return <div className="card muted">No page image stored for this upload.</div>;
  const pageBoxes = boxes.filter((b) => b.pageIndex === page.pageIndex);

  return (
    <div>
      {pages.length > 1 && (
        <div className="pagenav">
          <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>‹ Prev</button>
          <span className="muted">Page {i + 1} / {pages.length}</span>
          <button type="button" onClick={() => setI((n) => Math.min(pages.length - 1, n + 1))} disabled={i === pages.length - 1}>Next ›</button>
        </div>
      )}
      <div className="scan">
        {page.ref ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- local raster scan, not next/image */}
            <img className="doc-image" src={page.ref} alt={alt} />
            {pageBoxes.map((b) => (
              <div
                key={b.id}
                className={`bbox ${b.ok ? 'ok' : 'review'}`}
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                title={b.title}
              >
                <span className="bbox-num">{b.num}</span>
              </div>
            ))}
          </>
        ) : (
          <div className="card muted">No image for this page (born-digital text).</div>
        )}
      </div>
    </div>
  );
}
