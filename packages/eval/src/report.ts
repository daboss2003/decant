import type { EvalReport } from './evaluate';

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** Render an EvalReport as readable text (plan §4 — the headline numbers + reliability table). */
export function renderReport(r: EvalReport): string {
  const out: string[] = [];
  out.push('# Decant eval report');
  out.push(`Docs: ${r.docCount}    Field instances: ${r.fieldCount}`);
  out.push('');
  out.push('## Headline');
  out.push(`  Classification accuracy : ${pct(r.classificationAccuracy)}`);
  out.push(`  Field accuracy          : ${pct(r.fieldAccuracy)}`);
  out.push(`  Auto-approve fraction   : ${pct(r.autoApproveFraction)}`);
  out.push(`  Silent-error rate       : ${pct(r.silentErrorRate)}   (wrong AND auto-approved — minimize)`);
  out.push(`  Safe-failure rate       : ${pct(r.safeFailureRate)}   (of wrong fields, fraction caught)`);
  out.push(`  ECE                     : ${r.ece.toFixed(3)}    Brier: ${r.brier.toFixed(3)}`);
  out.push('');
  out.push('## Reliability  [conf bin | n | mean conf | accuracy]');
  for (const b of r.reliability) {
    if (b.count === 0) continue;
    const bar = '#'.repeat(Math.round(b.accuracy * 10));
    out.push(`  ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} | n=${String(b.count).padStart(3)} | conf=${b.meanConfidence.toFixed(2)} | acc=${b.accuracy.toFixed(2)} ${bar}`);
  }
  out.push('');
  out.push('## Threshold sweep  [τ | auto-approve | silent-error]');
  for (const p of r.sweep) {
    if (Math.round(p.tau * 100) % 10 !== 0) continue; // every 0.1
    out.push(`  τ=${p.tau.toFixed(1)} | auto=${pct(p.autoApproveFraction).padStart(6)} | silent=${pct(p.silentErrorRate)}`);
  }
  return out.join('\n');
}
