import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DocumentPipeline,
  RuleValidationService,
  HeuristicConfidenceService,
  ThresholdRoutingService,
  registry,
  KNOWN_DOC_TYPES,
} from '@decant/core';
import { GoogleGenAIClient, GeminiClassifyService, GeminiExtractionService, type PageImageStore } from '@decant/gemini';

/** Minimal .env loader — walks up from cwd looking for .env / packages/gemini/.env. */
export function loadDotenv(): void {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    for (const rel of ['.env', 'packages/gemini/.env']) {
      const p = resolve(dir, rel);
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && m[1] && process.env[m[1]] === undefined) {
          process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
        }
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
}

export function requireApiKey(): string {
  loadDotenv();
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('GEMINI_API_KEY not set (looked in env, .env, packages/gemini/.env)');
    process.exit(1);
  }
  return key;
}

/** Wire the real Gemini-backed pipeline over a given image store (plan §8 adapters). */
export function buildPipeline(apiKey: string, store: PageImageStore): DocumentPipeline {
  const client = new GoogleGenAIClient(apiKey);
  return new DocumentPipeline(
    {
      classify: new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] }),
      extraction: new GeminiExtractionService(client, store, registry),
      validation: new RuleValidationService(registry),
      confidence: new HeuristicConfidenceService(),
      routing: new ThresholdRoutingService(),
    },
    { knownTypes: KNOWN_DOC_TYPES, minClassifyConfidence: 0.5 },
  );
}
