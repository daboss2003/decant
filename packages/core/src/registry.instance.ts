import { createRegistry } from './registry';
import { receiptEntry } from './doc-types/receipt.entry';
import { bankStatementEntry } from './doc-types/bank-statement.entry';
import { cacEntry } from './doc-types/cac.entry';

/**
 * The v1 registry. Adding a document type = adding an entry here
 * (plan §1 / §6). The classifier may emit any type id; anything not in the
 * registry routes to the generic fallback (§6.0).
 */
export const registry = createRegistry([
  receiptEntry,
  bankStatementEntry,
  cacEntry,
  // TODO: rentReceiptEntry (easy win)
]);

/** Set of registered type ids — used by `segmentPages` to route vs. fall back. */
export const KNOWN_DOC_TYPES: ReadonlySet<string> = new Set(registry.list());
