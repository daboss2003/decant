/**
 * Flatten a wrapped extraction object (typed OR generic) into a flat list of
 * per-field self-reports. Recognises the `extractedField` shape
 * ({ value, modelConfidence, sourceQuote }) and the generic-field shape
 * ({ name, value, modelConfidence, sourceQuote }).
 *
 * Paths are dotted with array indices, e.g. "merchantName",
 * "lineItems.0.unitPrice". Generic fields use their `name` as the path.
 */
export interface FieldSelfReport {
  fieldPath: string;
  value: unknown;
  modelConfidence: number;
}

function asRecord(n: unknown): Record<string, unknown> | null {
  return typeof n === 'object' && n !== null ? (n as Record<string, unknown>) : null;
}

function isExtractedField(n: unknown): n is { value: unknown; modelConfidence: number; name?: string } {
  const r = asRecord(n);
  return r !== null && typeof r.modelConfidence === 'number';
}

export function flattenExtraction(raw: unknown): FieldSelfReport[] {
  const out: FieldSelfReport[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((el, i) => walk(el, path ? `${path}.${i}` : String(i)));
      return;
    }
    if (isExtractedField(node)) {
      const leaf = typeof node.name === 'string' && node.name ? node.name : path;
      out.push({ fieldPath: leaf, value: node.value, modelConfidence: node.modelConfidence });
      return; // don't recurse into the field wrapper
    }
    const rec = asRecord(node);
    if (rec) {
      for (const [k, v] of Object.entries(rec)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };

  walk(raw, '');
  return out;
}
