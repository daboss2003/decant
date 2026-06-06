# @decant/core
> The transport-agnostic domain core: the trust loop plus the service contracts adapters implement.

**What it's for** — This is THE domain layer of Decant: it orchestrates the whole trust loop (classify → segment → extract → validate → score confidence → route) and defines the service INTERFACES every adapter (CLI, [REST](../../apps/api), [MCP](../../apps/mcp), [web](../../apps/web)) plugs implementations into. It is intentionally **node-free** (no `node:` builtins) and infra-free, so the same core runs identically whether driven by a Gemini call or a test fake. "One domain core, many thin adapters" — the policy decisions (what auto-approves, what routes to review) live here, exactly once.

## Public API
**Orchestrator**
- `DocumentPipeline` — the in-memory orchestrator; `.process(uploadId, pages)` → `PipelineResult`.
- `PipelineDeps` / `PipelineConfig`, and result types `PipelineResult`, `DocumentResult`, `FieldResult`.

**Service contracts** (`services.ts` — adapters implement these)
- `ClassifyService`, `ExtractionService`, `ValidationService`, `ConfidenceService`, `RoutingService`, `OcrProvider`, `ReviewService`.
- Supporting types: `PageInput`, `ExtractedDocument`, `ValidationOutcome`, `FieldConfidence`, `FieldStatus`, `CorrectionInput`.

**Default implementations**
- `HeuristicConfidenceService` (`DEFAULT_CONFIDENCE_WEIGHTS`) — fuses model confidence + rule effects + self-consistency, then applies calibration.
- `ThresholdRoutingService` (`DEFAULT_ROUTING_CONFIG`) — per-field τ threshold + GATE/generic/reclassify gating.
- `RuleValidationService` (`DEFAULT_VALIDATION_CONFIG`) — runs a type's domain rules over the normalized doc.
- `SelfConsistencyExtractionService` — wraps an extractor for N-sample agreement.

**Registry**
- `createRegistry`, `Registry`, `RegistryEntry`, `RuleResult`, `DomainRule`, `RuleSeverity`.
- `registry` (the v1 instance) + `KNOWN_DOC_TYPES` (registered type ids) from `registry.instance`.

**Calibration apply** (runtime only — fitting is the Python sidecar)
- `applyCalibration`, `resolveCalibration`; types `Calibration`, `CalibrationSet`, `PlattParams`, `IsotonicParams`.

**Provenance**
- `alignValueToTokens` + types `OcrToken`, `FieldProvenance`, `Bbox` (re-exported from [@decant/schemas](../schemas)).

**Queue seam**
- `JobQueue`, `InProcessQueue`, `JobHandler`; types `IngestJob`, `JobState`.

**Enrichment fold** (pure; MCP calls live in [@decant/enrich](../enrich))
- `applyEnrichment`, `buildVerification`, `unavailableVerification`, `compareNames`, `normalizeCompanyName`.
- Types `Enrichment`, `FxEnrichment`, `VerificationEnrichment`, `VerificationStatus`, `AuthorityRecord`; `VERIFICATION_MATCH_THRESHOLD`.

## How it's used
An adapter constructs `DocumentPipeline` by injecting concrete services over the shared `registry` (from [apps/cli/src/wiring.ts](../../apps/cli/src/wiring.ts)):

```ts
import {
  DocumentPipeline, RuleValidationService, HeuristicConfidenceService,
  ThresholdRoutingService, registry, KNOWN_DOC_TYPES,
} from '@decant/core';

const pipeline = new DocumentPipeline(
  {
    classify: new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] }),
    extraction: new GeminiExtractionService(client, store, registry),
    validation: new RuleValidationService(registry),
    confidence: new HeuristicConfidenceService({ calibration }), // calibration optional
    routing: new ThresholdRoutingService(),
    ocr: undefined, // optional OcrProvider → field provenance
  },
  { knownTypes: KNOWN_DOC_TYPES, minClassifyConfidence: 0.5 },
);

const result = await pipeline.process(uploadId, pages);
```

No env vars are read by this package (it's infra-free). Adapters own their config — e.g. `GEMINI_API_KEY` (Gemini), `REDIS_URL` (queue), and `loadCalibration()` (from [@decant/db](../db)) supply what the constructors here consume.

## Depends on
- [@decant/schemas](../schemas) — the canonical zod schemas + the single `Bbox` definition (and `ClassifyOutput`, `ReviewAction` used by the contracts).
- `zod` (extraction/canonical schemas in `RegistryEntry`), `date-fns` (date normalization in the rule helpers).

## Notes
- **Node-free by design** — never import `node:*` here. File/Redis/Gemini IO belongs in adapters; this package only sees interfaces.
- `RegistryEntry` defaults its generics to `any` so a heterogeneous registry stays assignable; each entry is fully typed at its definition site — consumers narrow by `docType`.
- Calibration here is **apply-only**: `applyCalibration`/`resolveCalibration` map a raw score → calibrated probability. The fit happens offline in [packages/calibrate](../calibrate) (Python); runtime loading of the fitted params is `loadCalibration()` in [@decant/db](../db).
- `applyEnrichment` never lowers confidence — a failed external check routes the field to review with a verifier-scoped signal, keeping the model's own certainty honest.
- `InProcessQueue` swallows handler throws (the handler records its own status); BullMQ-backed queues rely on the throw to drive retries — same `JobQueue` contract.

Tests: `core/test/` — run `pnpm test` from the repo root.
