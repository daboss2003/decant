import { z } from 'zod';
import { ClassifyOutput, type PageClassification } from '@decant/schemas';
import { toGeminiSchema, type ClassifyService, type PageInput } from '@decant/core';
import type { GeminiClient } from './client';
import type { PageImageStore } from './images';
import { classifyPrompt } from './prompts';

/**
 * Real ClassifyService (plan §2 stage 3): ONE batched Gemini Flash-Lite call
 * over all pages → per-page { docType, confidence }. Fail-safe: any parse
 * failure yields all-"unknown" (→ generic → review), never a throw.
 */
export interface GeminiClassifyConfig {
  /** Registered type ids offered to the model (plus implicit "unknown"). */
  knownTypes: readonly string[];
  model?: string;
  temperature?: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * LENIENT parse schema for the model RESPONSE: confidence has no [0,1] bound
 * here because Gemini does not enforce `minimum`/`maximum` (plan §note in
 * classify.ts) — a model returning 1.5 must be clamped, not rejected. The strict
 * `ClassifyOutput` is still what we SEND as the responseJsonSchema.
 */
const LenientClassifyOutput = z.object({
  pages: z.array(
    z.object({
      pageIndex: z.number().int(),
      docType: z.string(),
      confidence: z.number(),
    }),
  ),
});

export class GeminiClassifyService implements ClassifyService {
  private readonly model: string;
  private readonly schema: unknown;

  constructor(
    private readonly client: GeminiClient,
    private readonly images: PageImageStore,
    private readonly config: GeminiClassifyConfig,
  ) {
    this.model = config.model ?? 'gemini-2.5-flash-lite';
    this.schema = toGeminiSchema(z.toJSONSchema(ClassifyOutput));
  }

  async classify(_uploadId: string, pages: PageInput[]): Promise<ClassifyOutput> {
    const images = await Promise.all(pages.map((p) => this.images.loadByRef(p.imageRef)));
    const pageIndices = pages.map((p) => p.pageIndex);

    const text = await this.client.generateJson({
      model: this.model,
      userText: classifyPrompt(this.config.knownTypes, pageIndices),
      images,
      responseJsonSchema: this.schema,
      temperature: this.config.temperature,
    });

    return { pages: this.parse(text, pageIndices) };
  }

  /** Parse + clamp + guarantee exactly one entry per input page. */
  private parse(text: string | undefined, pageIndices: number[]): PageClassification[] {
    const fallback = (): PageClassification[] =>
      pageIndices.map((pageIndex) => ({ pageIndex, docType: 'unknown', confidence: 0 }));

    if (!text) return fallback();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fallback();
    }
    const parsed = LenientClassifyOutput.safeParse(raw);
    if (!parsed.success) return fallback();

    const byIndex = new Map(parsed.data.pages.map((p) => [p.pageIndex, p]));
    return pageIndices.map((pageIndex) => {
      const p = byIndex.get(pageIndex);
      return p
        ? { pageIndex, docType: p.docType, confidence: clamp01(p.confidence) }
        : { pageIndex, docType: 'unknown', confidence: 0 };
    });
  }
}
