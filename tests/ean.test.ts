import { describe, expect, it } from 'vitest';
import { expandUpcE, hasValidCheckDigit, normalizeBarcode, StableReader } from '../src/lib/ean';

describe('check digit', () => {
  it('accepts valid codes', () => {
    expect(hasValidCheckDigit('4008400402222')).toBe(true); // EAN-13
    expect(hasValidCheckDigit('96385074')).toBe(true); // EAN-8
    expect(hasValidCheckDigit('042100005264')).toBe(true); // UPC-A
  });

  it('rejects wrong check digits and wrong lengths', () => {
    expect(hasValidCheckDigit('4008400402223')).toBe(false);
    expect(hasValidCheckDigit('96385075')).toBe(false);
    expect(hasValidCheckDigit('12345')).toBe(false);
    expect(hasValidCheckDigit('40084004022a2')).toBe(false);
  });

  it('notices swapped neighbouring digits', () => {
    expect(hasValidCheckDigit('4008400402222')).toBe(true);
    expect(hasValidCheckDigit('4008400042222')).toBe(false);
  });
});

describe('UPC-E', () => {
  it('expands to UPC-A', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(expandUpcE('01234531')).toBe('012300000451');
    expect(expandUpcE('01234541')).toBe('012340000051');
    expect(expandUpcE('01234581')).toBe('012345000081');
  });

  it('rejects what does not fit', () => {
    expect(expandUpcE('24252614')).toBeNull();
    expect(expandUpcE('0425261')).toBeNull();
  });
});

describe('normalizeBarcode', () => {
  it('leaves EAN-13 and EAN-8 unchanged', () => {
    expect(normalizeBarcode('4008400402222')).toBe('4008400402222');
    expect(normalizeBarcode('96385074')).toBe('96385074');
  });

  it('pads UPC-A to 13 digits', () => {
    expect(normalizeBarcode('042100005264')).toBe('0042100005264');
  });

  it('expands UPC-E when the scanner reports the format', () => {
    expect(normalizeBarcode('04252614', 'upc_e')).toBe('0042100005264');
  });

  it('removes spaces and hyphens from typed numbers', () => {
    expect(normalizeBarcode(' 4008400 402222 ')).toBe('4008400402222');
    expect(normalizeBarcode('4-008400-402222')).toBe('4008400402222');
  });

  it('returns null for invalid input', () => {
    expect(normalizeBarcode('4008400402223')).toBeNull();
    expect(normalizeBarcode('123')).toBeNull();
    expect(normalizeBarcode('')).toBeNull();
    expect(normalizeBarcode('abc')).toBeNull();
  });
});

describe('StableReader', () => {
  it('releases a code only on the second identical read', () => {
    const reader = new StableReader();
    expect(reader.push('4008400402222')).toBeNull();
    expect(reader.push('4008400402222')).toBe('4008400402222');
  });

  it('starts over when another code comes in between', () => {
    const reader = new StableReader();
    expect(reader.push('4008400402222')).toBeNull();
    expect(reader.push('96385074')).toBeNull();
    expect(reader.push('4008400402222')).toBeNull();
    expect(reader.push('4008400402222')).toBe('4008400402222');
  });

  it('survives frames without a hit and can be reset', () => {
    const reader = new StableReader();
    expect(reader.push('96385074')).toBeNull();
    expect(reader.push(null)).toBeNull();
    expect(reader.push('96385074')).toBe('96385074');
    reader.reset();
    expect(reader.push('96385074')).toBeNull();
  });
});
