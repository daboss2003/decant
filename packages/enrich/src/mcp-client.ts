import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * How to launch/reach an external MCP server (stdio for the bundled demo servers).
 *
 * TRUST BOUNDARY: `command`/`args` are spawned as a child process — they must be
 * operator-controlled, never derived from document content or untrusted config.
 * `env` is layered ON TOP of the SDK's safe default allowlist (PATH/HOME/…) and
 * is forwarded verbatim to the child, so pass ONLY the minimal vars that specific
 * server needs — never blanket `process.env` (it would leak unrelated secrets).
 */
export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ExternalMcpClientOptions {
  name?: string;
  /** Abort an initialize that stalls past this many ms (fail fast vs the SDK's 60s default). */
  connectTimeoutMs?: number;
  /** Per-tool-call timeout in ms. */
  callTimeoutMs?: number;
}

/**
 * A thin MCP *client* (plan §8 client role): connects to an external MCP server
 * over stdio and calls its tools, returning the first text block parsed as JSON
 * (falling back to `structuredContent`). The reusable adapter that lets Decant
 * consume OTHER MCP servers (registry, FX, …) the way an MCP host consumes Decant.
 *
 * Hardened for real/untrusted servers: connect() is idempotent under concurrency
 * (a single child is spawned), connect/call have explicit timeouts, a failed
 * connect is negatively cached (no re-spawning a known-bad server every call), and
 * a closed client refuses to silently respawn.
 */
export class ExternalMcpClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private lastError: Error | null = null;
  private closed = false;
  private readonly name: string;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;

  constructor(
    private readonly spec: McpServerSpec,
    opts: ExternalMcpClientOptions = {},
  ) {
    this.name = opts.name ?? 'decant-enrich-client';
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 5_000;
    this.callTimeoutMs = opts.callTimeoutMs ?? 15_000;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error('ExternalMcpClient: cannot connect after close()');
    if (this.client) return;
    if (this.lastError) throw this.lastError; // negative cache — don't re-spawn a known-bad server
    if (!this.connecting) {
      this.connecting = (async () => {
        const client = new Client({ name: this.name, version: '0.1.0' }, { capabilities: {} });
        await client.connect(
          new StdioClientTransport({ command: this.spec.command, args: this.spec.args, env: this.spec.env }),
          { timeout: this.connectTimeoutMs },
        );
        return client;
      })().catch((err: unknown) => {
        this.lastError = err instanceof Error ? err : new Error(String(err));
        throw this.lastError;
      });
    }
    this.client = await this.connecting;
  }

  /** Call a tool and parse its first text block (or structuredContent) as JSON of type T. */
  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (this.closed) throw new Error('ExternalMcpClient: callTool after close()');
    if (!this.client) await this.connect();
    const res = await this.client!.callTool({ name, arguments: args }, undefined, { timeout: this.callTimeoutMs });
    if (res.isError) {
      throw new Error(`tool "${name}" returned an error: ${describePayload(res)}`);
    }
    const text = firstText(res.content);
    if (!text.trim()) {
      if (res.structuredContent !== undefined) return res.structuredContent as T;
      throw new Error(`tool "${name}" returned empty/non-text content: ${describePayload(res)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`tool "${name}" returned non-JSON content: ${text.slice(0, 200)}`);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.connecting = null;
    await this.client?.close();
    this.client = null;
  }
}

function firstText(content: unknown): string {
  const arr = content as Array<{ type?: string; text?: string }> | undefined;
  return arr?.find((c) => c.type === 'text')?.text ?? '';
}

/** A short, secret-free description of a tool result for diagnostics (never throws). */
function describePayload(res: unknown): string {
  const r = (res ?? {}) as { content?: unknown; structuredContent?: unknown };
  if (r.structuredContent !== undefined) return JSON.stringify(r.structuredContent).slice(0, 200);
  const t = firstText(r.content);
  if (t.trim()) return t.slice(0, 200);
  const arr = r.content as Array<{ type?: string }> | undefined;
  return `<no text; content blocks: [${(arr ?? []).map((c) => c.type ?? '?').join(', ')}]>`;
}
