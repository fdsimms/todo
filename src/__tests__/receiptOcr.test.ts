import type { RecognizedLine } from 'todo-vision-bridge';
import {
  groupRecognizedRows,
  reconstructReceipt,
  shouldUseOcrText,
  splitRowPrice,
} from '../utils/receiptOcr';

/**
 * A recognized text run. Coordinates are normalised 0..1 with the origin at the
 * top left, which is what the bridge flips Vision's own bottom-left boxes into.
 */
function run(text: string, x: number, y: number, width = 0.3, height = 0.02): RecognizedLine {
  return { text, x, y, width, height, confidence: 0.9 };
}

/** A whole printed row: an item name on the left, its price on the right. */
function itemRow(name: string, price: string, y: number): RecognizedLine[] {
  return [run(name, 0.08, y, 0.4), run(price, 0.78, y + 0.003, 0.12, 0.015)];
}

describe('groupRecognizedRows', () => {
  it('puts an item and the price beside it on one row', () => {
    const rows = groupRecognizedRows(itemRow('GV MLK 2% GAL', '3.48', 0.1));
    expect(rows).toHaveLength(1);
    expect(rows[0].map(r => r.text)).toEqual(['GV MLK 2% GAL', '3.48']);
  });

  it('keeps separate printed lines apart', () => {
    const rows = groupRecognizedRows([
      ...itemRow('BANANAS', '1.29', 0.1),
      ...itemRow('SHRP CHDR', '4.99', 0.14),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r[0].text)).toEqual(['BANANAS', 'SHRP CHDR']);
  });

  it('groups a price set in a smaller face than the name beside it', () => {
    // Centres differ (0.110 vs 0.117) but the extents still overlap — which is
    // why this compares overlap rather than centres.
    const rows = groupRecognizedRows([
      run('BNLS SKNLS CHKN BRST', 0.08, 0.1, 0.5, 0.02),
      run('8.71', 0.78, 0.112, 0.1, 0.01),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('does not group lines that merely graze each other', () => {
    const rows = groupRecognizedRows([
      run('MILK', 0.08, 0.1, 0.3, 0.02),
      run('EGGS', 0.08, 0.118, 0.3, 0.02),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('reads top to bottom and left to right whatever order Vision returned', () => {
    const rows = groupRecognizedRows([
      run('4.99', 0.78, 0.143, 0.12, 0.015),
      run('BANANAS', 0.08, 0.1, 0.4),
      run('SHRP CHDR', 0.08, 0.14, 0.4),
      run('1.29', 0.78, 0.103, 0.12, 0.015),
    ]);
    expect(rows.map(r => r.map(f => f.text))).toEqual([
      ['BANANAS', '1.29'],
      ['SHRP CHDR', '4.99'],
    ]);
  });

  it('drops blank and zero-height runs rather than opening rows for them', () => {
    const rows = groupRecognizedRows([
      run('   ', 0.08, 0.1),
      run('MILK', 0.08, 0.1),
      run('EGGS', 0.08, 0.14, 0.3, 0),
    ]);
    expect(rows.map(r => r.map(f => f.text))).toEqual([['MILK']]);
  });
});

describe('splitRowPrice', () => {
  it('takes the price off the right and leaves the printed label', () => {
    expect(splitRowPrice(['GV MLK 2% GAL', '3.48']))
      .toEqual({ label: 'GV MLK 2% GAL', priceMinor: 348 });
  });

  it('reads a row Vision returned as one run', () => {
    expect(splitRowPrice(['SHRP CHDR 4.99']))
      .toEqual({ label: 'SHRP CHDR', priceMinor: 499 });
  });

  it('steps over a tax flag printed after the amount', () => {
    expect(splitRowPrice(['BANANAS', '1.29', 'T']))
      .toEqual({ label: 'BANANAS', priceMinor: 129 });
    expect(splitRowPrice(['CHIPS 2.50 TF']))
      .toEqual({ label: 'CHIPS', priceMinor: 250 });
  });

  it('does not read a store number as a charge', () => {
    // "#453" loses its "#" to parsePriceInput's leading-symbol strip and parses
    // perfectly well as $453.00. What says it isn't a price is that it has no
    // cents printed on it.
    expect(splitRowPrice(["TRADER JOE'S #453"]))
      .toEqual({ label: "TRADER JOE'S #453", priceMinor: null });
  });

  it('does not read a bare integer as a charge', () => {
    expect(splitRowPrice(['REGISTER 4'])).toEqual({ label: 'REGISTER 4', priceMinor: null });
  });

  it("does not read a store's street number as a charge", () => {
    expect(splitRowPrice(['STORE #453 1234 MAIN ST']))
      .toEqual({ label: 'STORE #453 1234 MAIN ST', priceMinor: null });
  });

  it('refuses the per-pound rate on a bare weight line', () => {
    // No charge on this line at all — the amount is on the row above it. A
    // lowercase unit stops the scan where a capitalised tax flag would not.
    expect(splitRowPrice(['1.32 lb @ 2.99/lb']))
      .toEqual({ label: '1.32 lb @ 2.99/lb', priceMinor: null });
  });

  it('takes the charge, not the rate, when a weighed line prints both', () => {
    expect(splitRowPrice(['PRODUCE 1.32 lb @ 2.99/lb', '3.95']))
      .toEqual({ label: 'PRODUCE 1.32 lb @ 2.99/lb', priceMinor: 395 });
  });

  it('refuses a discount line for the same reason a typed one is refused', () => {
    // parsePriceInput turns down a negative; nothing here overrides it.
    expect(splitRowPrice(['MFR COUPON', '-1.00']))
      .toEqual({ label: 'MFR COUPON -1.00', priceMinor: null });
  });

  it('leaves a row with no price alone', () => {
    expect(splitRowPrice(['THANK YOU FOR SHOPPING']))
      .toEqual({ label: 'THANK YOU FOR SHOPPING', priceMinor: null });
  });
});

describe('reconstructReceipt', () => {
  it('renders each printed row on its own line, price tab-separated', () => {
    const receipt = reconstructReceipt([
      ...itemRow('GV MLK 2% GAL', '3.48', 0.1),
      ...itemRow('BANANAS', '1.29', 0.14),
    ]);
    expect(receipt.text).toBe('GV MLK 2% GAL\t3.48\nBANANAS\t1.29');
    expect(receipt.rows.map(r => r.priceMinor)).toEqual([348, 129]);
  });

  it('sends an unpriced row as a bare label', () => {
    const receipt = reconstructReceipt([
      run("TRADER JOE'S #453", 0.2, 0.04, 0.5),
      ...itemRow('BANANAS', '1.29', 0.1),
    ]);
    expect(receipt.text).toBe("TRADER JOE'S #453\nBANANAS\t1.29");
  });

  it('keeps the printed order, which is what a receipt means by order', () => {
    const receipt = reconstructReceipt([
      ...itemRow('EGGS', '4.49', 0.18),
      ...itemRow('MILK', '3.48', 0.1),
      ...itemRow('BREAD', '2.99', 0.14),
    ]);
    expect(receipt.rows.map(r => r.label)).toEqual(['MILK', 'BREAD', 'EGGS']);
  });
});

describe('shouldUseOcrText', () => {
  const receiptOf = (count: number, priced = true) => reconstructReceipt(
    Array.from({ length: count }, (_, i) => (priced
      ? itemRow(`ITEM ${i}`, '1.00', 0.1 + i * 0.04)
      : [run(`ITEM ${i}`, 0.08, 0.1 + i * 0.04)])).flat(),
  );

  it('sends an ordinary receipt as text', () => {
    expect(shouldUseOcrText(receiptOf(8))).toBe(true);
  });

  it('falls back to the photo when barely anything was recognised', () => {
    // Out of focus, face down, or not a receipt — the image path at least gets
    // to see what happened.
    expect(shouldUseOcrText(receiptOf(3))).toBe(false);
  });

  it('falls back to the photo when nothing read as a price', () => {
    expect(shouldUseOcrText(receiptOf(9, false))).toBe(false);
  });

  it('falls back on an empty read', () => {
    expect(shouldUseOcrText(reconstructReceipt([]))).toBe(false);
  });
});
