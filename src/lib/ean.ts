/**
 * Barcodes on foods: EAN-13, EAN-8, UPC-A, UPC-E.
 * The check digit is verified, so misreads by the scanner do not count as a product.
 */

/** Check digit per GS1 for 8, 12, 13 or 14 digits. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  let sum = 0;
  // From the right: the digit left of the check digit counts triple, then alternating.
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/** Expands an eight-digit UPC-E code to twelve-digit UPC-A. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const system = code[0]!;
  const d = code.slice(1, 7);
  const check = code[7]!;
  const last = d[5]!;
  let body: string;
  if (last === '0' || last === '1' || last === '2') body = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  else if (last === '3') body = d.slice(0, 3) + '00000' + d.slice(3, 5);
  else if (last === '4') body = d.slice(0, 4) + '00000' + d[4];
  else body = d.slice(0, 5) + '0000' + last;
  return system + body + check;
}

/**
 * Brings a scanned or typed number into the form under which products
 * are stored and queried: 13 digits, EAN-8 stays eight digits.
 * Returns null if the number is not a valid barcode.
 */
export function normalizeBarcode(raw: string, format?: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return null;

  if (digits.length === 13) return hasValidCheckDigit(digits) ? digits : null;
  if (digits.length === 12) return hasValidCheckDigit(digits) ? '0' + digits : null;
  if (digits.length === 8) {
    if (format !== 'upc_e' && hasValidCheckDigit(digits)) return digits;
    const upcA = expandUpcE(digits);
    return upcA && hasValidCheckDigit(upcA) ? '0' + upcA : null;
  }
  return null;
}

/**
 * Requires two identical reads in a row before a code counts.
 * One-dimensional codes are occasionally misread from the live camera image.
 */
export class StableReader {
  private last: string | null = null;

  /** Returns the code as soon as it has been read a second time in a row. */
  push(code: string | null): string | null {
    if (code === null) return null;
    const stable = code === this.last;
    this.last = code;
    return stable ? code : null;
  }

  reset(): void {
    this.last = null;
  }
}
