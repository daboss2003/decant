import { GoogleGenAI } from '@google/genai';
import type { LoadedImage } from './images';

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

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('GoogleGenAIClient: apiKey is required (set GEMINI_API_KEY)');
    this.ai = new GoogleGenAI({ apiKey });
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
    const resp = await this.ai.models.generateContent({
      model: req.model,
      contents: [{ role: 'user', parts }] as never,
      config: config as never,
    });
    return resp.text;
  }
}
