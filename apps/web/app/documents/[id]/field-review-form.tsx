'use client';

import { useActionState } from 'react';
import { applyCorrectionAction } from './actions';
import { INITIAL_CORRECTION_STATE } from './types';

/** Per-field correction form with inline feedback (no silent no-op on submit). */
export function FieldReviewForm({
  documentId,
  fieldPath,
  currentValue,
}: {
  documentId: string;
  fieldPath: string;
  currentValue: string;
}) {
  const [state, formAction, pending] = useActionState(applyCorrectionAction, INITIAL_CORRECTION_STATE);
  const inputId = `cv-${fieldPath}`;

  return (
    <form action={formAction} className="correct">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="fieldPath" value={fieldPath} />
      <input
        id={inputId}
        type="text"
        name="correctedValue"
        defaultValue={currentValue}
        aria-label={`corrected value for ${fieldPath}`}
      />
      <input type="text" name="note" placeholder="note (optional)" aria-label={`note for ${fieldPath}`} />
      <button className="primary" name="action" value="accept" type="submit" disabled={pending}>
        Save correction
      </button>
      <button name="action" value="decline" type="submit" disabled={pending}>
        Can&apos;t read it
      </button>
      {state.message && <span className={`status ${state.ok ? 'ok' : 'err'}`}>{state.message}</span>}
    </form>
  );
}
