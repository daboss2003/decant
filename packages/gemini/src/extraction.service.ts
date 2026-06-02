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
    const images = await this.images.loadByUpload(uploadId, rangeInclusive(segment.pageRange));
    const documentId = `${uploadId}:${segment.pageRange[0]}-${segment.pageRange[1]}`;
    const entry = segment.isGeneric ? undefined : this.registry.get(segment.docType);

    if (!entry) {
      const text = await this.client.generateJson({
        model: this.model,
        userText: GENERIC_EXTRACT_PROMPT,
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
      userText: typedExtractPrompt(segment.docType),
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
