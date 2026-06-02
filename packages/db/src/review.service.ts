import type { PrismaClient } from '@prisma/client';
import type { ReviewService, CorrectionInput } from '@decant/core';
import { toJson } from './client';

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

    await prisma.$transaction(async (tx) => {
      if (input.action === 'accept') {
        await tx.correction.create({
          data: {
            fieldId: field.id,
            oldValue: toJson(field.value),
            newValue: toJson(input.correctedValue),
            reason: input.note ?? null,
            correctedBy: input.actor,
          },
        });
        await tx.field.update({
          where: { id: field.id },
          data: { value: toJson(input.correctedValue), status: 'corrected' },
        });
        await tx.auditEvent.create({
          data: {
            documentId: input.documentId,
            fieldId: field.id,
            type: 'corrected',
            actor: `human:${input.actor}`,
            payload: toJson({ from: field.value, to: input.correctedValue, note: input.note }),
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
