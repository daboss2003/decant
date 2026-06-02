import { describe, it, expect } from 'vitest';
import { fieldKey } from './field-key';

describe('fieldKey', () => {
  it('strips a trailing "Minor" and lowercases (canonical → join key)', () => {
    expect(fieldKey('totalMinor')).toBe('total');
    expect(fieldKey('subtotalMinor')).toBe('subtotal');
  });

  it('takes the top path segment for nested line items', () => {
    expect(fieldKey('lineItems.0.unitPrice')).toBe('lineitems');
    expect(fieldKey('lineItems.3.lineTotal')).toBe('lineitems');
  });

  it('lowercases simple extraction names', () => {
    expect(fieldKey('merchantName')).toBe('merchantname');
    expect(fieldKey('currency')).toBe('currency');
  });
});
