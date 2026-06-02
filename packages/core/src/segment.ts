import { UNKNOWN_DOC_TYPE, type PageClassification } from '@decant/schemas';

/**
 * Group the batched per-page classifications (plan §2, stage 3) into Documents:
 * contiguous runs of the same doc_type. One upload → 1..N documents — a receipt
 * stapled to a statement → two; a 10-page statement → one.
 *
 * Pages below `minConfidence`, or whose type isn't registered, route to the
 * generic fallback (§6.0).
 *
 * Robustness: duplicate / already-covered page indices are skipped. A GAP in the
 * page sequence (a missing index) ends the current run and starts a new segment
 * — treat a gap as a possible document boundary (plan §2 open question: blank /
 * scanner-page robustness).
 */
export interface DocumentSegment {
  docType: string;
  /** Inclusive page indices [start, end]. */
  pageRange: [number, number];
  /** Weakest-link confidence across the run. */
  confidence: number;
  /** True when docType is unknown → generic fallback path. */
  isGeneric: boolean;
}

export function segmentPages(
  pages: PageClassification[],
  opts: { knownTypes: ReadonlySet<string>; minConfidence: number },
): DocumentSegment[] {
  const sorted = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const segments: DocumentSegment[] = [];

  for (const page of sorted) {
    const last = segments.at(-1);

    // Skip duplicate / already-covered indices (model may repeat a page).
    if (last && page.pageIndex <= last.pageRange[1]) continue;

    const routedType =
      opts.knownTypes.has(page.docType) && page.confidence >= opts.minConfidence
        ? page.docType
        : UNKNOWN_DOC_TYPE;

    const isContiguous = last && last.pageRange[1] === page.pageIndex - 1;

    if (last && isContiguous && last.docType === routedType) {
      last.pageRange[1] = page.pageIndex;
      last.confidence = Math.min(last.confidence, page.confidence);
    } else {
      segments.push({
        docType: routedType,
        pageRange: [page.pageIndex, page.pageIndex],
        confidence: page.confidence,
        isGeneric: routedType === UNKNOWN_DOC_TYPE,
      });
    }
  }
  return segments;
}
