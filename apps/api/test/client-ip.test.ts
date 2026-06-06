import { describe, it, expect } from 'vitest';
import { clientIp } from '../src/client-ip';

describe('clientIp (rate-limit key)', () => {
  it('keys on the socket peer and ignores X-Forwarded-For by default', () => {
    // Attacker rotating XFF must NOT change the key when not behind a trusted proxy.
    expect(clientIp({ ip: '10.0.0.1', headers: { 'x-forwarded-for': '1.1.1.1' } }, false)).toBe('10.0.0.1');
    expect(clientIp({ ip: '10.0.0.1', headers: { 'x-forwarded-for': '2.2.2.2' } }, false)).toBe('10.0.0.1');
  });

  it('honors the RIGHT-most XFF hop when behind a trusted proxy', () => {
    // left-most is client-supplied; the right-most is what our proxy actually saw.
    expect(clientIp({ ip: '10.0.0.1', headers: { 'x-forwarded-for': 'spoof, 9.9.9.9' } }, true)).toBe('9.9.9.9');
    expect(clientIp({ ip: '10.0.0.1', headers: { 'x-forwarded-for': ['a, b', '8.8.8.8'] } }, true)).toBe('8.8.8.8');
  });

  it('falls back to the socket peer when trusted but no XFF present', () => {
    expect(clientIp({ ip: '10.0.0.1', headers: {} }, true)).toBe('10.0.0.1');
  });

  it("returns 'unknown' when neither is available", () => {
    expect(clientIp({ headers: {} }, false)).toBe('unknown');
  });
});
