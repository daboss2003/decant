import type { RoutingService, FieldConfidence, ValidationOutcome, FieldStatus } from '../services';
import { fieldKey } from '../field-key';

/**
 * Threshold routing — plan §2 stage 7 / §6.
 * A field auto-approves only when ALL of these hold:
 *   - it's a typed (registered) extraction, not the generic fallback (§6.0)
 *   - the document was not flagged for reclassification (mis-route, §2)
 *   - no GATE implicating the field failed
 *   - its calibrated confidence ≥ the per-field-type threshold τ
 * Otherwise it routes to the human review queue. Per-field routing (plan §6
 * decision) — only implicated fields need review, not the whole doc.
 */
export interface RoutingConfig {
  /** Default per-field threshold τ. */
  defaultThreshold: number;
  /** Per-field-type overrides, keyed by `fieldKey` (e.g. an account number is stricter). */
  thresholds?: Record<string, number>;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  defaultThreshold: 0.9,
  thresholds: {},
};

export class ThresholdRoutingService implements RoutingService {
  constructor(private readonly config: RoutingConfig = DEFAULT_ROUTING_CONFIG) {}

  route(
    fields: FieldConfidence[],
    validation: ValidationOutcome,
    mode: 'typed' | 'generic',
  ): Map<string, FieldStatus> {
    const failedGateKeys = new Set<string>();
    for (const r of validation.results) {
      if (r.severity === 'GATE' && !r.passed) {
        for (const f of r.fields) failedGateKeys.add(fieldKey(f));
      }
    }

    const out = new Map<string, FieldStatus>();
    for (const f of fields) {
      const key = fieldKey(f.fieldPath);
      const threshold = this.config.thresholds?.[key] ?? this.config.defaultThreshold;

      let status: FieldStatus;
      if (mode === 'generic' || validation.reclassify) status = 'needs_review';
      else if (failedGateKeys.has(key)) status = 'needs_review';
      else if (f.confidence >= threshold) status = 'auto_approved';
      else status = 'needs_review';

      out.set(f.fieldPath, status);
    }
    return out;
  }
}
