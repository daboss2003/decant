'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ReviewAction } from '@decant/schemas';
import { reviewService } from '../../../lib/db';
import type { CorrectionState } from './types';

/**
 * The single human-write path (plan §8): validate untrusted FormData, then call
 * PrismaReviewService.applyCorrection (Correction + AuditEvent). Returns a
 * structured result for useActionState so the reviewer gets feedback and a bad
 * input never crashes to a 500. The same service the MCP elicitation will call.
 */
const FormSchema = z
  .object({
    documentId: z.string().min(1),
    fieldPath: z.string().min(1),
    action: ReviewAction, // runtime-validated against accept|decline|cancel
    correctedValue: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((d) => d.action !== 'accept' || (d.correctedValue?.trim().length ?? 0) > 0, {
    message: 'Enter a corrected value before saving.',
  });

export async function applyCorrectionAction(
  _prev: CorrectionState,
  formData: FormData,
): Promise<CorrectionState> {
  const parsed = FormSchema.safeParse({
    documentId: formData.get('documentId'),
    fieldPath: formData.get('fieldPath'),
    action: formData.get('action'),
    correctedValue: formData.get('correctedValue') ?? undefined,
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  try {
    await reviewService.applyCorrection({
      documentId: d.documentId,
      fieldPath: d.fieldPath,
      action: d.action,
      correctedValue: d.action === 'accept' ? d.correctedValue : undefined,
      note: d.note,
      // TODO(auth): derive actor from the authenticated session once auth lands (plan §8);
      // before exposing this path via the remote MCP adapter, require the bearer guard.
      actor: 'reviewer',
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not save the correction.' };
  }

  revalidatePath(`/documents/${d.documentId}`);
  return { ok: true, message: d.action === 'accept' ? 'Correction saved.' : 'Marked for review.' };
}
