import type { ClassifyOutput, ReviewAction } from '@decant/schemas';
import type { DocumentSegment } from './segment';
import type { RuleResult } from './registry';
import type { OcrToken } from './provenance';

/**
 * Optional OCR source for field provenance (plan §2/§5). Returns word-level
 * tokens (with normalized bboxes) for a document's pages, which the pipeline
 * aligns extracted values to. Implemented by an adapter (e.g. tesseract.js).
 */
export interface OcrProvider {
  recognize(uploadId: string, pageIndices: number[]): Promise<OcrToken[]>;
}

/**
 * Transport-agnostic domain service CONTRACTS (plan §8: "one core, many
 * adapters"). apps/api (REST) and apps/mcp (MCP) both call THESE — neither
 * re-implements extraction or review — so a correction made via MCP elicitation
 * writes the byte-identical AuditEvent as one made in the Next.js UI.
 *
 * These are interfaces only; implementations (Gemini calls, Prisma writes,
 * BullMQ jobs) land during M0–M3.
 */

export interface PageInput {
  pageIndex: number;
  imageRef: string;
}

export interface ClassifyService {
  /** ONE batched Flash-Lite call over all pages → per-page type (plan §2). */
  classify(uploadId: string, pages: PageInput[]): Promise<ClassifyOutput>;
}

export interface ExtractedDocument {
  documentId: string;
  docType: string;
  mode: 'typed' | 'generic';
  /** Raw model output: a typed extraction object OR a GenericExtraction. */
  raw: unknown;
}

export interface ExtractionService {
  extract(segment: DocumentSegment, uploadId: string): Promise<ExtractedDocument>;
}

export interface ValidationOutcome {
  results: RuleResult[];
  /** True when the rule profile doesn't fit the routed type → reclassify (§2). */
  reclassify: boolean;
}

export interface ValidationService {
  /** Registered types only; the generic path has no rules (stays low-trust). */
  validate(doc: ExtractedDocument): ValidationOutcome;
}

export interface FieldConfidence {
  fieldPath: string;
  /** Fused + calibrated, [0,1] (plan §3). */
  confidence: number;
  signals: Record<string, number | boolean>;
}

export interface ConfidenceService {
  score(
    doc: ExtractedDocument,
    validation: ValidationOutcome,
    classifyConfidence: number,
  ): Promise<FieldConfidence[]>;
}

export type FieldStatus = 'auto_approved' | 'needs_review' | 'corrected' | 'rejected';

export interface RoutingService {
  /** Generic-mode docs + low-confidence classifications always need review (§2). */
  route(
    fields: FieldConfidence[],
    validation: ValidationOutcome,
    mode: 'typed' | 'generic',
  ): Map<string, FieldStatus>;
}

export interface CorrectionInput {
  documentId: string;
  fieldPath: string;
  action: ReviewAction;
  correctedValue?: unknown;
  note?: string;
  actor: string;
}

export interface ReviewService {
  /** Writes a Correction + AuditEvent. Same path for REST and MCP (plan §8). */
  applyCorrection(input: CorrectionInput): Promise<void>;
}
