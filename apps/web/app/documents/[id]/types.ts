/** Result of a correction submission, surfaced to the reviewer via useActionState. */
export interface CorrectionState {
  ok: boolean;
  message: string;
}

export const INITIAL_CORRECTION_STATE: CorrectionState = { ok: false, message: '' };
