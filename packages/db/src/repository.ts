import type { PrismaClient } from '@prisma/client';
import type { PipelineResult } from '@decant/core';
import { toJson } from './client';

/**
 * Persist a pipeline run: Upload → Documents → Fields, plus audit events
 * (plan §2). Runs in a transaction so a partial write never leaves orphans.
 * Returns the new upload id.
 */
export async function savePipelineResult(
  prisma: PrismaClient,
  params: { sourceType: string; nPages: number; result: PipelineResult; imageRef?: string },
): Promise<string> {
  const { sourceType, nPages, result, imageRef } = params;

  return prisma.$transaction(async (tx) => {
    const upload = await tx.upload.create({ data: { sourceType, nPages, imageRef: imageRef ?? null } });
    await tx.auditEvent.create({
      data: { uploadId: upload.id, type: 'extracted', actor: 'system', payload: toJson({ documents: result.documents.length }) },
    });

    for (const d of result.documents) {
      const doc = await tx.document.create({
        data: {
          uploadId: upload.id,
          docType: d.docType,
          mode: d.mode,
          pageStart: d.pageRange[0],
          pageEnd: d.pageRange[1],
          reclassify: d.reclassify,
          enrichment: toJson(d.enrichments ?? null),
        },
      });

      for (const f of d.fields) {
        await tx.field.create({
          data: {
            documentId: doc.id,
            fieldPath: f.fieldPath,
            value: toJson(f.value),
            confidence: f.confidence,
            status: f.status,
            signals: toJson(f.signals),
            provenance: toJson(f.provenance),
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          documentId: doc.id,
          type: 'routed',
          actor: 'system',
          payload: toJson({
            autoApproved: d.fields.filter((x) => x.status === 'auto_approved').length,
            total: d.fields.length,
            reclassify: d.reclassify,
          }),
        },
      });

      if (d.enrichments && d.enrichments.length > 0) {
        await tx.auditEvent.create({
          data: {
            documentId: doc.id,
            type: 'enriched',
            actor: 'system',
            payload: toJson({
              sources: d.enrichments.map((e) => (e.kind === 'verification' ? `${e.verifier}:${e.status}` : `fx:${e.field}`)),
            }),
          },
        });
      }
    }

    return upload.id;
  });
}
