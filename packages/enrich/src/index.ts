import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// @decant/enrich — the MCP *client* role: consume external MCP servers (registry,
// FX) to enrich + verify extracted documents (plan §8).
export * from './mcp-client';
export * from './enrichers';
export * from './enrichment.service';

const here = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the bundled demo FX MCP server (run with tsx). */
export const FX_DEMO_SERVER = resolve(here, 'demo/fx-server.ts');
/** Absolute path to the bundled demo company-registry MCP server (run with tsx). */
export const REGISTRY_DEMO_SERVER = resolve(here, 'demo/registry-server.ts');
