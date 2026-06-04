import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGoldDir } from './gold-dir';

const here = dirname(fileURLToPath(import.meta.url));
const samples = resolve(here, '../gold-samples');

describe('loadGoldDir (real redacted-document gold set)', () => {
  it('pairs each <name>.gold.json with its source document and parses the labels', async () => {
    const entries = await loadGoldDir(samples);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const bank = entries.find((e) => e.gold.id === 'bank-redacted-001')!;
    expect(bank.gold.docType).toBe('bank_statement');
    expect(bank.source).toMatch(/bank-redacted-001\.md$/); // markdown source
    expect(bank.gold.fields.closingBalance).toEqual({ kind: 'money', expected: 73500 });
    expect(bank.gold.fields.accountNumber?.expected).toBe('********1234'); // redacted, as-is

    const receipt = entries.find((e) => e.gold.id === 'receipt-redacted-001')!;
    expect(receipt.gold.docType).toBe('receipt');
    expect(receipt.source).toMatch(/receipt-redacted-001\.txt$/);
    expect(receipt.gold.fields.total?.expected).toBe(2150);
  });

  it('errors clearly when a label file has no matching source document', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'decant-golddir-'));
    writeFileSync(join(dir, 'orphan.gold.json'), JSON.stringify({ docType: 'receipt', fields: {} }));
    await expect(loadGoldDir(dir)).rejects.toThrow(/no source document/);
  });

  it('errors when the sidecar is malformed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'decant-golddir-'));
    writeFileSync(join(dir, 'doc.txt'), 'x');
    writeFileSync(join(dir, 'doc.gold.json'), JSON.stringify({ fields: { total: { kind: 'money' } } })); // no docType, bad field
    await expect(loadGoldDir(dir)).rejects.toThrow();
  });
});
