/**
 * Join key between two naming layers:
 *   - canonical rule fields (e.g. "totalMinor", "subtotalMinor", "lineItems")
 *   - extraction self-report paths (e.g. "total", "lineItems.0.unitPrice")
 *
 * Takes the top path segment, strips a trailing "Minor", lowercases. So a rule
 * implicating "totalMinor" lines up with the "total" self-report, and a rule on
 * "lineItems" lines up with every "lineItems.N.*" self-report.
 *
 * This is the heuristic baseline's join (plan §3.2 Option A); the learned
 * meta-model in the Python sidecar can use a cleaner feature join later.
 */
export function fieldKey(path: string): string {
  const top = path.split('.')[0] ?? path;
  return top.replace(/Minor$/, '').toLowerCase();
}
