/**
 * Join between two naming layers that must line up for confidence + routing:
 *   - canonical rule fields  (e.g. "totalMinor", "transactions.3.balanceMinor")
 *   - extraction self-report paths (e.g. "total", "transactions.3.balance")
 *
 * `normPath` lowercases and strips a trailing "Minor" from EACH dotted segment.
 * `fieldMatches(ruleField, selfPath)` is true when the rule implicates the field
 * exactly OR the rule implicates a container of it (a rule on "transactions"
 * affects every "transactions.N.*"; a rule on "transactions.3.balance" affects
 * only that one cell — which is what gives bank statements per-row localization).
 */
export function normPath(path: string): string {
  return path
    .toLowerCase()
    .split('.')
    .map((seg) => seg.replace(/minor$/, ''))
    .join('.');
}

export function fieldMatches(ruleField: string, selfPath: string): boolean {
  const r = normPath(ruleField);
  const s = normPath(selfPath);
  return s === r || s.startsWith(`${r}.`);
}
