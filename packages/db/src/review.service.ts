import type { PrismaClient } from '@prisma/client';
import type { ReviewService, CorrectionInput } from '@decant/core';
import { toJson } from './client';

/**
 * Coerce a human-entered correction back to the field's stored JS type so a
 * correction stays type-consistent with extraction (a numeric field must stay a
 * number — otherwise eval/reconciliation that compare values silently break, and
 * the audit diff is type-mismatched). Shared by the REST/web and MCP write paths.
 */
function coerceToFieldType(existing: unknown, incoming: unknown): unknown {
  if (typeof existing === 'number' && typeof incoming === 'string') {
    const n = Number(incoming.replace(/,/g, '').trim());
    if (Number.isNaN(n)) throw new Error('This field is numeric — please enter a valid number.');
    return n;
  }
  if (typeof existing === 'boolean' && typeof incoming === 'string') return incoming === 'true';
  return incoming;
}

/**
 * Prisma-backed ReviewService (plan §8). This is the ONE write path for human
 * corrections — the REST API and (later) the MCP elicitation handler both call
 * it, so a correction is recorded identically regardless of interface:
 *   accept  → write Correction, update Field (value + status=corrected), audit it
 *   decline/cancel → record the non-action in the audit trail, leave needs_review
 */
export class PrismaReviewService implements ReviewService {
  constructor(private readonly prisma: PrismaClient) {}

  async applyCorrection(input: CorrectionInput): Promise<void> {
    const { prisma } = this;
    const field = await prisma.field.findUnique({
      where: { documentId_fieldPath: { documentId: input.documentId, fieldPath: input.fieldPath } },
    });
    if (!field) {
      throw new Error(`field not found: ${input.documentId} / ${input.fieldPath}`);
    }

    // Coerce outside the transaction so a bad numeric input fails fast (no partial write).
    const newValue = input.action === 'accept' ? coerceToFieldType(field.value, input.correctedValue) : undefined;

    await prisma.$transaction(async (tx) => {
      if (input.action === 'accept') {
        await tx.correction.create({
          data: {
            fieldId: field.id,
            oldValue: toJson(field.value),
            newValue: toJson(newValue),
            reason: input.note ?? null,
            correctedBy: input.actor,
          },
        });
        await tx.field.update({
          where: { id: field.id },
          data: { value: toJson(newValue), status: 'corrected' },
        });
        await tx.auditEvent.create({
          data: {
            documentId: input.documentId,
            fieldId: field.id,
            type: 'corrected',
            actor: `human:${input.actor}`,
            payload: toJson({ from: field.value, to: newValue, note: input.note }),
          },
        });
      } else {
        await tx.auditEvent.create({
          data: {
            documentId: input.documentId,
            fieldId: field.id,
            type: 'flagged',
            actor: `human:${input.actor}`,
            payload: toJson({ action: input.action, note: input.note }),
          },
        });
      }
    });
  }
}
