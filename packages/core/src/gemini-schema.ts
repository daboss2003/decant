/**
 * Translate Zod v4's `z.toJSONSchema()` output into the dialect Gemini's
 * `responseJsonSchema` accepts (plan §5/§6).
 *
 * Zod emits `.nullable()` as either `anyOf:[X,{type:"null"}]` or
 * `type:[X,"null"]`; Gemini wants OpenAPI-style `nullable: true` and is known to
 * mishandle nullable-`anyOf` combined with object properties. This walks the
 * whole tree, rewrites both nullable forms, and drops keywords Gemini chokes on
 * (`$schema`, `$id`, `additionalProperties`).
 *
 * Invariant for a test: the output must contain no `{ type: "null" }` branch.
 */
const DROP_KEYS = new Set(['$schema', '$id', 'additionalProperties']);

export function toGeminiSchema(input: unknown): unknown {
  return clean(input);
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;

  const obj = node as Record<string, unknown>;

  // Form 1: anyOf: [X, {type:"null"}]  ->  X + nullable:true
  if (Array.isArray(obj.anyOf)) {
    const branches = obj.anyOf as Array<Record<string, unknown>>;
    const nonNull = branches.filter((b) => !(b && b.type === 'null'));
    if (nonNull.length === 1 && nonNull.length !== branches.length) {
      const merged = clean({ ...nonNull[0], nullable: true }) as Record<string, unknown>;
      if (obj.description && merged.description === undefined) merged.description = obj.description;
      return merged;
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = clean(v);
  }

  // Form 2: type: [X, "null"]  ->  type: X + nullable:true
  if (Array.isArray(out.type) && (out.type as string[]).includes('null')) {
    const nonNull = (out.type as string[]).filter((t) => t !== 'null');
    out.type = nonNull.length === 1 ? nonNull[0] : nonNull;
    out.nullable = true;
  }
  return out;
}
