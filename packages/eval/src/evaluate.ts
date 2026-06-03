import type { DocumentResult, FieldStatus } from '@decant/core';
import { matchField, type MatchKind } from './match';
import {
  fieldAccuracy,
  autoApproveFraction,
  silentErrorRate,
  safeFailureRate,
  ece,
  brier,
  reliabilityBins,
  thresholdSweep,
  type Scored,
  type ReliabilityBin,
  type SweepPoint,
} from './metrics';

export interface GoldField {
  kind: MatchKind;
  expected: unknown;
}
export interface GoldDoc {
  id: string;
  docType: string;
  fields: Record<string, GoldField>;
}

/** One labeled document paired with the pipeline's output for it. */
export interface EvalCase {
  gold: GoldDoc;
  predicted: DocumentResult;
}

export interface PerFieldResult {
  docId: string;
  docType: string;
  fieldPath: string;
  kind: MatchKind;
  expected: unknown;
  predicted: unknown;
  correct: boolean;
  confidence: number;
  status: FieldStatus;
}

export interface EvalReport {
  docCount: number;
  fieldCount: number;
  classificationAccuracy: number;
  fieldAccuracy: number;
  autoApproveFraction: number;
  silentErrorRate: number;
  safeFailureRate: number;
  ece: number;
  brier: number;
  reliability: ReliabilityBin[];
  sweep: SweepPoint[];
  perField: PerFieldResult[];
}

/** Score predictions against gold and compute all success-criteria metrics (plan §4). */
export function evaluate(cases: EvalCase[]): EvalReport {
  const perField: PerFieldResult[] = [];
  let classCorrect = 0;

  for (const c of cases) {
    if (c.predicted.docType === c.gold.docType) classCorrect++;
    const byPath = new Map(c.predicted.fields.map((f) => [f.fieldPath, f]));

    for (const [path, gf] of Object.entries(c.gold.fields)) {
      const pf = byPath.get(path);
      perField.push({
        docId: c.gold.id,
        docType: c.gold.docType,
        fieldPath: path,
        kind: gf.kind,
        expected: gf.expected,
        predicted: pf?.value,
        correct: matchField(gf.kind, gf.expected, pf?.value),
        confidence: pf?.confidence ?? 0,
        status: pf?.status ?? 'needs_review',
      });
    }
  }

  const scored: Scored[] = perField.map((p) => ({ confidence: p.confidence, correct: p.correct, status: p.status }));

  return {
    docCount: cases.length,
    fieldCount: perField.length,
    classificationAccuracy: cases.length ? classCorrect / cases.length : 0,
    fieldAccuracy: fieldAccuracy(scored),
    autoApproveFraction: autoApproveFraction(scored),
    silentErrorRate: silentErrorRate(scored),
    safeFailureRate: safeFailureRate(scored),
    ece: ece(scored),
    brier: brier(scored),
    reliability: reliabilityBins(scored),
    sweep: thresholdSweep(scored),
    perField,
  };
}
