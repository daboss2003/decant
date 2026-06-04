/** Prompt builders for the Gemini services (plan §2 stage 3/4). */

/** Text-based classify: born-digital pages already have their text, so classify from it (no image). */
export function classifyTextPrompt(knownTypes: readonly string[], pages: Array<{ pageIndex: number; text: string }>): string {
  const header = [
    'You are a document classifier for a financial-document pipeline.',
    `Below is the TEXT of ${pages.length} page(s), in order.`,
    `For EACH page, choose the single best document type from: ${knownTypes.join(', ')}.`,
    'If a page does not clearly match any of those, use "unknown".',
    'Return exactly one entry per page: { pageIndex, docType, confidence }, where',
    'confidence is your 0..1 certainty. Group pages of the SAME document with the same docType.',
    '',
  ].join('\n');
  return header + pages.map((p) => `--- pageIndex ${p.pageIndex} ---\n${p.text.slice(0, 4000)}`).join('\n\n');
}

export function classifyPrompt(knownTypes: readonly string[], pageIndices: number[]): string {
  const first = pageIndices[0] ?? 0;
  const last = pageIndices.at(-1) ?? first;
  return [
    'You are a document classifier for a financial-document pipeline.',
    `The user uploaded ${pageIndices.length} page image(s), provided in order (pageIndex ${first}..${last}).`,
    `For EACH page, choose the single best document type from: ${knownTypes.join(', ')}.`,
    'If a page does not clearly match any of those, use "unknown".',
    'Return exactly one entry per page: { pageIndex, docType, confidence }, where',
    'confidence is your 0..1 certainty. Group pages of the SAME document with the',
    'same docType (a multi-page statement is all one type).',
  ].join('\n');
}

export function typedExtractPrompt(docType: string): string {
  return [
    `Extract the fields of this ${docType} from the page image(s).`,
    'For EVERY field return { value, modelConfidence, sourceQuote }:',
    '- value: the field value, or null if it is genuinely absent;',
    '- modelConfidence: your 0..1 certainty in THIS field;',
    '- sourceQuote: the exact text you read it from, or null.',
    'Do not guess — prefer null with low confidence over a fabricated value.',
  ].join('\n');
}

export const GENERIC_EXTRACT_PROMPT = [
  'Identify this document type and extract all salient fields.',
  'Return { type, fields: [{ name, value, modelConfidence, sourceQuote }] }.',
  'Prefer null values with low confidence over fabrication.',
].join('\n');
