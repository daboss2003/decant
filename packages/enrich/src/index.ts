import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// @decant/enrich — the MCP *client* role: consume external sources (registry, FX)
// to enrich + verify extracted documents (plan §8). The verification adapter
// (`makeVerifier`) lets anyone add a source by implementing one lookup function.
export * from './mcp-client';
export * from './enrichers';
export * from './verifier';
export * from './verifiers/registry';
export * from './enrichment.service';

const here = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the bundled demo FX MCP server (deterministic; run with tsx). */
export const FX_DEMO_SERVER = resolve(here, 'demo/fx-server.ts');
/** Absolute path to the bundled demo company-registry MCP server (deterministic; run with tsx). */
export const REGISTRY_DEMO_SERVER = resolve(here, 'demo/registry-server.ts');
/** Absolute path to the LIVE FX MCP server (open.er-api.com; run with tsx). */
export const FX_LIVE_SERVER = resolve(here, 'servers/fx-live-server.ts');
/** Absolute path to the LIVE registry MCP server (GLEIF; run with tsx). */
export const REGISTRY_GLEIF_SERVER = resolve(here, 'servers/registry-gleif-server.ts');
