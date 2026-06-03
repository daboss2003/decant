import { GoogleGenAI } from '@google/genai';
import type { LoadedImage } from './images';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Thrown when the API's per-DAY quota is exhausted — callers should stop, not retry. */
export class GeminiQuotaError extends Error {
  readonly dailyQuotaExhausted = true;
  constructor(message: string) {
    super(message);
    this.name = 'GeminiQuotaError';
  }
}

/** Transient statuses worth retrying: rate-limit + server overload. */
const RETRIABLE = new Set([429, 500, 503]);

/** ms to wait before a retry — honor the server's RetryInfo hint, else exponential backoff. */
function retryDelayMs(err: unknown, attempt: number): number {
  const msg = (err as { message?: string })?.message ?? '';
  const hint = msg.match(/retry(?:Delay)?["' :]+([\d.]+)s/i) ?? msg.match(/retry in ([\d.]+)\s*s/i);
  const suggested = hint?.[1] ? Math.ceil(parseFloat(hint[1]) * 1000) : 0;
  const backoff = Math.min(60_000, 1_000 * 2 ** attempt); // 2s, 4s, 8s, …
  return Math.max(suggested + 500, backoff);
}

/**
 * The minimal Gemini surface the services depend on. Depending on this
 * interface (not the SDK directly) keeps the services unit-testable with a fake
 * client — no API key, no network.
 */
export interface GeminiJsonRequest {
  model: string;
  userText: string;
  images: LoadedImage[];
  /** JSON Schema for structured output (already Gemini-dialect via toGeminiSchema). */
  responseJsonSchema: unknown;
  systemInstruction?: string;
  temperature?: number;
}

export interface GeminiClient {
  /** Returns the model's response text (a JSON string), or undefined. */
  generateJson(req: GeminiJsonRequest): Promise<string | undefined>;
}

/**
 * Real client backed by @google/genai (Gemini Developer API). The app passes
 * the key (e.g. process.env.GEMINI_API_KEY) so this package needs no node types.
 * For the optional logprobs path, construct with vertexai + project (plan §5);
 * not needed for v1.
 */
export class GoogleGenAIClient implements GeminiClient {
  private readonly ai: GoogleGenAI;
  private readonly maxAttempts: number;

  constructor(apiKey: string, opts: { maxAttempts?: number } = {}) {
    if (!apiKey) throw new Error('GoogleGenAIClient: apiKey is required (set GEMINI_API_KEY)');
    this.ai = new GoogleGenAI({ apiKey });
    this.maxAttempts = opts.maxAttempts ?? 8; // free-tier RPM limits recover quickly; retry generously
  }

  /** Retry transient 429(per-minute)/503/500 + network errors with backoff. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = (err as { status?: number }).status;
        const msg = (err as { message?: string }).message ?? '';

        // A per-DAY quota won't reset for hours — don't waste retries; fail fast + flag it
        // so callers (e.g. the eval) can stop early instead of grinding through every doc.
        if (status === 429 && /per[\s-]?day|RequestsPerDay/i.test(msg)) {
          const e = new GeminiQuotaError('Gemini daily free-tier quota exhausted (per-day limit) — use a paid key or retry tomorrow.');
          throw e;
        }

        const networkError =
          status === undefined && /fetch failed|ECONNRESET|ETIMEDOUT|socket hang ?up|network|EAI_AGAIN/i.test(msg);
        const retriable = (status !== undefined && RETRIABLE.has(status)) || networkError;
        if (!retriable || attempt >= this.maxAttempts) throw err;

        const delay = retryDelayMs(err, attempt);
        console.error(`[gemini] ${status ?? 'network'} — retry ${attempt}/${this.maxAttempts} in ${Math.round(delay / 1000)}s`);
        await sleep(delay);
      }
    }
  }

  async generateJson(req: GeminiJsonRequest): Promise<string | undefined> {
    const parts: Array<Record<string, unknown>> = [{ text: req.userText }];
    for (const img of req.images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataBase64 } });
    }

    const config: Record<string, unknown> = {
      responseMimeType: 'application/json',
      responseJsonSchema: req.responseJsonSchema,
    };
    if (req.systemInstruction) config.systemInstruction = req.systemInstruction;
    if (req.temperature !== undefined) config.temperature = req.temperature;

    // Single SDK-typed boundary — cast our generic shapes to the SDK's params.
    const resp = await this.withRetry(() =>
      this.ai.models.generateContent({
        model: req.model,
        contents: [{ role: 'user', parts }] as never,
        config: config as never,
      }),
    );
    return resp.text;
  }
}
