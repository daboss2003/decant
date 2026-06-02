import type { ConfidenceService, ExtractedDocument, ValidationOutcome, FieldConfidence } from '../services';
import type { RuleResult } from '../registry';
import { fieldMatches } from '../field-match';
import { flattenExtraction } from './flatten';

/**
 * Heuristic confidence fusion — plan §3.2 Option A (the day-one baseline).
 * Produces a per-field RAW score in [0,1]; mapping that score to a true
 * probability is the calibration step (Python sidecar, §3.3/§4), not done here.
 *
 * Fusion (per field):
 *   base = model self-reported confidence
 *   a failed GATE implicating the field  -> floor it (strong distrust)
 *   else a passed GATE implicating it    -> boost it (the reconciliation math vouches, §6.1)
 *   a failed SIGNAL implicating it        -> scale it down
 *   then multiply by the doc-level classification confidence (mis-route drag)
 *   then, in generic mode, cap it (low-trust fallback, §6.0)
 */
export interface ConfidenceWeights {
  /** Max confidence allowed for generic-fallback extractions. */
  genericMaxConfidence: number;
  /** Cap when a GATE implicating the field failed. */
  gateFailFloor: number;
  /** Floor-raise when a GATE implicating the field passed. */
  gatePassBoost: number;
  /** Multiplier when a SIGNAL implicating the field failed. */
  signalFailFactor: number;
}

export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  genericMaxConfidence: 0.5,
  gateFailFloor: 0.15,
  gatePassBoost: 0.9,
  signalFailFactor: 0.6,
};

interface KeyEffects {
  gateFailed: boolean;
  gatePassed: boolean;
  signalFailed: boolean;
}

/** Which rule outcomes implicate this field (path-prefix match → per-row precision). */
function effectsForField(selfPath: string, results: RuleResult[]): KeyEffects {
  const e: KeyEffects = { gateFailed: false, gatePassed: false, signalFailed: false };
  for (const r of results) {
    if (!r.fields.some((f) => fieldMatches(f, selfPath))) continue;
    if (r.severity === 'GATE') {
      if (r.passed) e.gatePassed = true;
      else e.gateFailed = true;
    } else if (!r.passed) {
      e.signalFailed = true;
    }
  }
  return e;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export class HeuristicConfidenceService implements ConfidenceService {
  constructor(private readonly weights: ConfidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS) {}

  async score(
    doc: ExtractedDocument,
    validation: ValidationOutcome,
    classifyConfidence: number,
  ): Promise<FieldConfidence[]> {
    const w = this.weights;

    return flattenExtraction(doc.raw).map((f) => {
      const eff = effectsForField(f.fieldPath, validation.results);
      let c = f.modelConfidence;

      if (eff.gateFailed) c = Math.min(c, w.gateFailFloor);
      else if (eff.gatePassed) c = Math.max(c, w.gatePassBoost);
      if (eff.signalFailed) c *= w.signalFailFactor;

      c *= classifyConfidence;
      if (doc.mode === 'generic') c = Math.min(c, w.genericMaxConfidence);

      return {
        fieldPath: f.fieldPath,
        confidence: clamp01(c),
        signals: {
          modelConfidence: f.modelConfidence,
          classifyConfidence,
          gateFailed: eff.gateFailed,
          gatePassed: eff.gatePassed,
          signalFailed: eff.signalFailed,
          generic: doc.mode === 'generic',
        },
      };
    });
  }
}
