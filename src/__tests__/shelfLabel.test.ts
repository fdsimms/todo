import { printedPricesIn, priceNearBarcode, type ScanBox, type ScanText } from '../utils/shelfLabel';

const text = (t: string, x: number, y: number, height = 0.04, width = 0.12): ScanText =>
  ({ text: t, x, y, width, height });

/** The barcode, bottom left of a shelf label sitting left of centre. */
const BARCODE: ScanBox = { x: 0.10, y: 0.60, width: 0.18, height: 0.06 };

describe('printedPricesIn', () => {
  it('reads a price with a currency symbol', () => {
    expect(printedPricesIn([text('$3.49', 0.1, 0.4)]).map(p => p.priceMinor)).toEqual([349]);
  });

  it('reads a price out of a run that says more than the price', () => {
    expect(printedPricesIn([text('$3.49 EA', 0.1, 0.4)]).map(p => p.priceMinor)).toEqual([349]);
  });

  it('ignores a per-unit rate', () => {
    expect(printedPricesIn([text('$0.22/oz', 0.1, 0.3)])).toEqual([]);
    expect(printedPricesIn([text('$1.99 per lb', 0.1, 0.3)])).toEqual([]);
  });

  it('ignores a number with no cents on it', () => {
    // A pack count or a size, not a price — the same rule receiptOcr applies.
    expect(printedPricesIn([text('12 CT', 0.1, 0.3)])).toEqual([]);
    expect(printedPricesIn([text('AISLE 7', 0.1, 0.3)])).toEqual([]);
  });

  it('finds nothing in a frame with no prices in it', () => {
    expect(printedPricesIn([text('ORGANIC WHOLE MILK', 0.1, 0.3)])).toEqual([]);
  });
});

describe('priceNearBarcode', () => {
  it('takes the price printed on the same label', () => {
    expect(priceNearBarcode(BARCODE, [text('$3.49', 0.12, 0.48, 0.07)])).toBe(349);
  });

  it('prefers the retail price over the unit price above it', () => {
    // Both are near the code; the retail one is set much larger. This is the
    // case that survives even when the recogniser splits the rate from its unit
    // and PER_UNIT can't catch it.
    expect(priceNearBarcode(BARCODE, [
      text('0.22', 0.12, 0.40, 0.02),
      text('$3.49', 0.12, 0.48, 0.08),
    ])).toBe(349);
  });

  it('ignores a price on a label across the frame', () => {
    expect(priceNearBarcode(BARCODE, [text('$8.99', 0.86, 0.10, 0.08)])).toBeNull();
  });

  it('does not let a distant larger price beat the one on this label', () => {
    // Distance filters first and size ranks second, in that order, precisely
    // for this: a neighbouring label's bigger price must not win.
    expect(priceNearBarcode(BARCODE, [
      text('$3.49', 0.12, 0.48, 0.06),
      text('$8.99', 0.88, 0.08, 0.20),
    ])).toBe(349);
  });

  it('breaks a tie on equal type size toward the nearer price', () => {
    expect(priceNearBarcode(BARCODE, [
      text('$3.49', 0.13, 0.52, 0.05),
      text('$4.99', 0.34, 0.30, 0.05),
    ])).toBe(349);
  });

  it('is null when nothing in frame reads as a price', () => {
    expect(priceNearBarcode(BARCODE, [text('ORGANIC WHOLE MILK', 0.12, 0.48)])).toBeNull();
  });

  it('is null for an empty frame', () => {
    expect(priceNearBarcode(BARCODE, [])).toBeNull();
  });
});
