import { z } from 'zod';
import { GenericExtraction } from '@decant/schemas';
import {
  toGeminiSchema,
  type Registry,
  type ExtractionService,
  type ExtractedDocument,
  type DocumentSegment,
} from '@decant/core';
import type { GeminiClient } from './client';
import type { PageImageStore } from './images';
import { typedExtractPrompt, GENERIC_EXTRACT_PROMPT } from './prompts';

/**
 * Real ExtractionService (plan §2 stage 4). Registered types use that type's
 * schema (entry.toGeminiJsonSchema); unregistered/generic segments use the open
 * GenericExtraction schema. Fail-safe: unparseable output becomes an empty
 * object (typed) or an empty fields list (generic) — downstream normalize +
 * rules then flag everything for review, never a throw.
 */
export interface GeminiExtractionConfig {
  model?: string;
  temperature?: number;
}

function parseJsonSafe(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rangeInclusive([a, b]: [number, number]): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** A page with at least this much extracted text is treated as born-digital. */
const MIN_PAGE_TEXT_CHARS = 12;

export class GeminiExtractionService implements ExtractionService {
  private readonly model: string;
  private readonly genericSchema: unknown;

  constructor(
    private readonly client: GeminiClient,
    private readonly images: PageImageStore,
    private readonly registry: Registry,
    private readonly config: GeminiExtractionConfig = {},
  ) {
    this.model = config.model ?? 'gemini-2.5-flash';
    this.genericSchema = toGeminiSchema(z.toJSONSchema(GenericExtraction));
  }

  async extract(segment: DocumentSegment, uploadId: string): Promise<ExtractedDocument> {
    const pageIndices = rangeInclusive(segment.pageRange);
    const documentId = `${uploadId}:${segment.pageRange[0]}-${segment.pageRange[1]}`;
    const entry = segment.isGeneric ? undefined : this.registry.get(segment.docType);

    // Prefer the born-digital TEXT layer (exact, cheap, no vision) when present;
    // fall back to sending the page image to the vision model (scanned/image docs).
    const texts = (this.images.loadText ? await this.images.loadText(uploadId, pageIndices) : []).map((t) => t.trim());
    // Only take the text path when EVERY page in the segment is born-digital — a
    // mixed PDF (some scanned pages) falls back to vision so no page is dropped.
    const useText = texts.length === pageIndices.length && texts.every((t) => t.length >= MIN_PAGE_TEXT_CHARS);
    const docText = texts.join('\n\n--- page break ---\n\n');
    const images = useText ? [] : await this.images.loadByUpload(uploadId, pageIndices);
    const withText = (prompt: string): string =>
      useText ? `${prompt}\n\nThe document's exact text layer follows (no OCR needed); extract from it:\n"""\n${docText}\n"""` : prompt;

    if (!entry) {
      const text = await this.client.generateJson({
        model: this.model,
        userText: withText(GENERIC_EXTRACT_PROMPT),
        images,
        responseJsonSchema: this.genericSchema,
        temperature: this.config.temperature,
      });
      const raw = parseJsonSafe(text);
      const parsed = GenericExtraction.safeParse(raw);
      return {
        documentId,
        docType: 'unknown',
        mode: 'generic',
        raw: parsed.success ? parsed.data : (raw ?? { type: 'unknown', fields: [] }),
      };
    }

    const text = await this.client.generateJson({
      model: this.model,
      userText: withText(typedExtractPrompt(segment.docType)),
      images,
      responseJsonSchema: entry.toGeminiJsonSchema(),
      temperature: this.config.temperature,
    });
    const raw = parseJsonSafe(text) ?? {};
    const parsed = entry.extractionSchema.safeParse(raw);
    return {
      documentId,
      docType: segment.docType,
      mode: 'typed',
      raw: parsed.success ? parsed.data : raw,
    };
  }
}
