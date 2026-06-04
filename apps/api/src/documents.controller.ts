import { Body, Controller, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { PrismaReviewService } from '@decant/db';
import { DocumentsService } from './documents.service';
import { REVIEW } from './db.providers';
import { ZodValidationPipe } from './zod.pipe';

const CorrectionBody = z.object({
  fieldPath: z.string().min(1),
  action: z.enum(['accept', 'decline', 'cancel']),
  correctedValue: z.unknown().optional(),
  note: z.string().optional(),
  actor: z.string().optional(),
});

/** Results + review surface. Thin HTTP over the SAME core/db services (plan §8). */
@Controller()
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly docs: DocumentsService,
    @Inject(REVIEW) private readonly review: PrismaReviewService,
  ) {}

  @Get('review-queue')
  reviewQueue(): Promise<unknown> {
    return this.docs.reviewQueue();
  }

  @Get('documents/:id')
  async getDocument(@Param('id') id: string): Promise<unknown> {
    const doc = await this.docs.document(id);
    if (!doc) throw new NotFoundException(`No document ${id}`);
    return doc;
  }

  @Get('documents/:id/audit')
  audit(@Param('id') id: string): Promise<unknown> {
    return this.docs.audit(id);
  }

  /** Apply a human correction → writes a Correction + AuditEvent (identical to web/MCP). */
  @Post('documents/:id/corrections')
  async correct(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CorrectionBody)) body: z.infer<typeof CorrectionBody>,
  ): Promise<{ ok: true }> {
    await this.review.applyCorrection({
      documentId: id,
      fieldPath: body.fieldPath,
      action: body.action,
      correctedValue: body.correctedValue,
      note: body.note,
      actor: body.actor ?? 'api',
    });
    return { ok: true };
  }
}
