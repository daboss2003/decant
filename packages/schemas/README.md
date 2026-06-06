# @decant/schemas

> Zod single source of truth: shared primitives + two-layer per-type document schemas.

**What it's for** — Decant treats Zod as the one definition that feeds everything downstream (plan §5): the Gemini `responseJsonSchema`, the NestJS DTOs, the MCP tool I/O, and the MCP elicitation `requestedSchema`. Each registered document type gets **two layers** — an *Extraction* schema (model-facing; every field wrapped so Gemini self-reports `{value, modelConfidence, sourceQuote}`) and a *Canonical* schema (normalized typed values: `Money` in integer minor units, ISO dates). It is pure Zod with no runtime IO, so any adapter can depend on it cheaply.

## Public API
Grouped by source module (all re-exported from `src/index.ts`):

**Primitives** (`common`)
- `Confidence` — probability in `[0,1]`.
- `Bbox` — normalized `[0,1]` bounding box; the one geometric primitive shared across schemas, [@decant/core](../core/README.md)'s OCR alignment, and the review UI.
- `Provenance` — `{pageIndex, bbox|null}`; recovered post-extraction, not self-reported.
- `extractedField(valueSchema)` — wraps a value as `{value, modelConfidence, sourceQuote}`.
- `Money` (`{minor, currency}`), `CurrencyCode` (ISO-4217), `IsoDate` (`yyyy-mm-dd`).

**Classify** (`classify`) — `ClassifyOutput`, `PageClassification`, `UNKNOWN_DOC_TYPE`.

**Generic fallback** (`generic`) — `GenericExtraction` (open key/value, always routed to review).

**Review / correction** (`correction`) — `ReviewAction` (`accept|decline|cancel`), `FieldSpec`/`FieldKind`, `buildFieldCorrectionSchema` (flat Zod for validation) and `buildFieldCorrectionJsonSchema` (flat JSON Schema for MCP elicitation `requestedSchema`).

**Per-type schemas** (`doc-types/*`) — for `receipt`, `bank-statement`, `cac`, each exporting:
- `<Type>Extraction` + `<Type>Canonical` schemas (e.g. `ReceiptExtraction`, `ReceiptCanonical`).
- `<TYPE>_DOC_TYPE` id and `<TYPE>_REVIEW_FIELDS` (typed against `keyof <Type>Canonical`).
- Plus `CAC_ENTITY_TYPES`.

## How it's used
The extraction schema is converted to JSON Schema and handed to the model as the response schema. Gemini's dialect differs from standard JSON Schema, so [@decant/core](../core/README.md)'s `toGeminiSchema` adapter cleans `z.toJSONSchema()`'s output before it reaches the wire:

```ts
import { z } from 'zod';
import { ReceiptExtraction, RECEIPT_REVIEW_FIELDS } from '@decant/schemas';
import { toGeminiSchema } from '@decant/core'; // not consumed raw

// what the registry entry hands to Gemini as responseJsonSchema:
const responseJsonSchema = toGeminiSchema(z.toJSONSchema(ReceiptExtraction));
```

MCP elicitation builds a flat, primitives-only schema per field:

```ts
import { buildFieldCorrectionJsonSchema } from '@decant/schemas';
const requestedSchema = buildFieldCorrectionJsonSchema({ name: 'totalMinor', type: { kind: 'number' } });
```

No env vars.

## Depends on
- `zod` (^4.3.5) — only dependency; uses Zod v4's `z.toJSONSchema()`.

## Notes
- **Extraction schemas are intentionally LOOSE** (plain strings/numbers). Format constraints (`CurrencyCode`, `IsoDate`) live only in the canonical layer and are validated AFTER normalization (done in [@decant/core](../core/README.md)) — so the Gemini-facing schema stays compatible.
- `min/max` on `Confidence` become `minimum/maximum` in JSON Schema, which **Gemini does NOT enforce** — clamp/validate confidence into `[0,1]` after parsing.
- This package never normalizes or calibrates: it only defines shapes. Self-reported `modelConfidence` is one INPUT to confidence fusion, never the final score.
- Elicitation/review schemas MUST be FLAT primitives (no nested objects/arrays), so corrections are elicited one field at a time.

Tests: no dedicated tests — the schemas are exercised indirectly through [@decant/core](../core)'s rule/pipeline tests (which normalize and validate against these shapes). Run the suite with `pnpm test` from the repo root.
