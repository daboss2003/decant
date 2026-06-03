import { segmentPages, type DocumentSegment } from './segment';
import { flattenExtraction } from './confidence/flatten';
import { alignValueToTokens, type FieldProvenance } from './provenance';
import type { RuleResult } from './registry';
import type {
  ClassifyService,
  ExtractionService,
  ValidationService,
  ConfidenceService,
  RoutingService,
  OcrProvider,
  PageInput,
  FieldStatus,
} from './services';

function rangeInclusive([a, b]: [number, number]): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/**
 * In-memory orchestrator of the whole trust loop (plan §2):
 *   classify (batched) → segment → [per document] extract → validate →
 *   score confidence → route → assemble result.
 *
 * It depends only on the service INTERFACES, so the fake classify/extract used
 * in tests and the real @google/genai-backed services swap in via the
 * constructor with zero changes here (plan §8: one core, many adapters).
 */
export interface FieldResult {
  fieldPath: string;
  value: unknown;
  confidence: number;
  status: FieldStatus;
  signals: Record<string, number | boolean>;
  /** Where on the page this value was found (OCR-aligned); null/absent if no OCR / no match. */
  provenance?: FieldProvenance | null;
}

export interface DocumentResult {
  documentId: string;
  docType: string;
  mode: 'typed' | 'generic';
  pageRange: [number, number];
  /** True when the doc looks mis-routed (plan §2) — routed wholesale to review. */
  reclassify: boolean;
  ruleResults: RuleResult[];
  fields: FieldResult[];
}

export interface PipelineResult {
  uploadId: string;
  documents: DocumentResult[];
}

export interface PipelineDeps {
  classify: ClassifyService;
  extraction: ExtractionService;
  validation: ValidationService;
  confidence: ConfidenceService;
  routing: RoutingService;
  /** Optional: when present, each field gets OCR-aligned provenance (plan §2/§5). */
  ocr?: OcrProvider;
}

export interface PipelineConfig {
  /** Registered type ids (anything else → generic fallback). */
  knownTypes: ReadonlySet<string>;
  /** Per-page classification confidence below which a page routes to generic. */
  minClassifyConfidence: number;
}

export class DocumentPipeline {
  constructor(
    private readonly deps: PipelineDeps,
    private readonly config: PipelineConfig,
  ) {}

  async process(uploadId: string, pages: PageInput[]): Promise<PipelineResult> {
    const classified = await this.deps.classify.classify(uploadId, pages);
    const segments = segmentPages(classified.pages, {
      knownTypes: this.config.knownTypes,
      minConfidence: this.config.minClassifyConfidence,
    });

    // Segments are independent → process concurrently (mirrors the BullMQ fan-out).
    const documents = await Promise.all(segments.map((s) => this.processSegment(s, uploadId)));
    return { uploadId, documents };
  }

  private async processSegment(segment: DocumentSegment, uploadId: string): Promise<DocumentResult> {
    const { extraction, validation, confidence, routing, ocr } = this.deps;

    const extracted = await extraction.extract(segment, uploadId);
    const outcome = validation.validate(extracted);
    const scored = await confidence.score(extracted, outcome, segment.confidence);
    const statuses = routing.route(scored, outcome, extracted.mode);

    const reports = flattenExtraction(extracted.raw);
    const byPath = new Map(reports.map((f) => [f.fieldPath, f]));

    // OCR-align each field to recover its bbox (best-effort; uses the model's
    // verbatim quote when available, else the value).
    const tokens = ocr ? await ocr.recognize(uploadId, rangeInclusive(segment.pageRange)) : [];
    const provenanceFor = (path: string): FieldProvenance | null => {
      if (tokens.length === 0) return null;
      const r = byPath.get(path);
      const needle = r?.sourceQuote ?? (r?.value != null ? String(r.value) : '');
      return needle ? alignValueToTokens(needle, tokens) : null;
    };

    const fields: FieldResult[] = scored.map((f) => ({
      fieldPath: f.fieldPath,
      value: byPath.get(f.fieldPath)?.value,
      confidence: f.confidence,
      status: statuses.get(f.fieldPath) ?? 'needs_review',
      signals: f.signals,
      provenance: provenanceFor(f.fieldPath),
    }));

    return {
      documentId: extracted.documentId,
      docType: extracted.docType,
      mode: extracted.mode,
      pageRange: segment.pageRange,
      reclassify: outcome.reclassify,
      ruleResults: outcome.results,
      fields,
    };
  }
}
