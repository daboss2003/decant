import type { ValidationService, ExtractedDocument, ValidationOutcome } from '../services';
import type { Registry, RuleResult } from '../registry';

/**
 * Runs a registered type's domain rules over the normalized document (plan §6).
 * Generic-fallback docs have no rules, so they return an empty outcome (and stay
 * low-trust via routing).
 */
export interface ValidationConfig {
  /**
   * Flag the doc for reclassification (mis-route → re-route/review, plan §2)
   * when at least this many GATEs fail. This is a COARSE proxy for "the rule
   * profile doesn't fit the routed type" — a bad read of the *right* type can
   * also trip it. A learned mis-route detector is future work; for now the safe
   * action (routing the whole doc to review on reclassify) makes the coarseness
   * acceptable. A true "try the next-best type" loop needs top-K classification.
   */
  reclassifyMinFailedGates: number;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = { reclassifyMinFailedGates: 2 };

export class RuleValidationService implements ValidationService {
  constructor(
    private readonly registry: Registry,
    private readonly config: ValidationConfig = DEFAULT_VALIDATION_CONFIG,
  ) {}

  validate(doc: ExtractedDocument): ValidationOutcome {
    if (doc.mode === 'generic') return { results: [], reclassify: false };

    const entry = this.registry.get(doc.docType);
    if (!entry) return { results: [], reclassify: false };

    const canonical = entry.normalize(doc.raw);
    const results: RuleResult[] = entry.rules.map((rule) => rule(canonical));

    const failedGates = results.filter((r) => r.severity === 'GATE' && !r.passed).length;
    const reclassify = failedGates >= this.config.reclassifyMinFailedGates;

    return { results, reclassify };
  }
}
