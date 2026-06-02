import { z } from 'zod';

/**
 * Per-field correction schema for the human-review step.
 *
 * MCP elicitation `requestedSchema` (plan §8) MUST be a FLAT object of
 * PRIMITIVES only — no nested objects, no arrays. So we elicit ONE field at a
 * time and build a flat schema per field. The Next.js review form posts the
 * same shape, so the two interfaces share one contract.
 */
export type FieldKind =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: [string, ...string[]] };

export interface FieldSpec {
  /** Canonical field path, e.g. "totalMinor". */
  name: string;
  type: FieldKind;
}

/** Build a FLAT, primitives-only elicitation/review schema for a single field. */
export function buildFieldCorrectionSchema(spec: FieldSpec) {
  const value =
    spec.type.kind === 'string'
      ? z.string()
      : spec.type.kind === 'number'
        ? z.number()
        : spec.type.kind === 'boolean'
          ? z.boolean()
          : z.enum(spec.type.values);

  // FLAT: top-level primitives only (elicitation constraint).
  return z.object({
    correctedValue: value,
    note: z.string().optional(),
  });
}

/**
 * The same flat schema as a JSON Schema — MCP elicitation's `requestedSchema`
 * needs JSON Schema, NOT a Zod object. Use this when calling `elicitInput`;
 * keep `buildFieldCorrectionSchema` for validating the response.
 * TODO(M3): titled enums (label≠value) per the elicitation spec once the client
 * lib (@rekog/mcp-nest) confirms support.
 */
export function buildFieldCorrectionJsonSchema(spec: FieldSpec): Record<string, unknown> {
  const json = z.toJSONSchema(buildFieldCorrectionSchema(spec)) as Record<string, unknown>;
  delete json.$schema;
  delete json.additionalProperties;
  return json;
}

/** The three MCP elicitation outcomes — each handled distinctly (plan §8). */
export const ReviewAction = z.enum(['accept', 'decline', 'cancel']);
export type ReviewAction = z.infer<typeof ReviewAction>;
