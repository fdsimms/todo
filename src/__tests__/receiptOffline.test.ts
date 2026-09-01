import type { OcrReceipt, OcrReceiptRow } from '../utils/receiptOcr';
import {
  extractReceiptOffline,
  findPrintedDate,
  findPrintedTotal,
  guessStoreName,
  isNonItemRow,
} from '../utils/receiptOffline';

const row = (label: string, priceMinor: number | null = null, y = 0): OcrReceiptRow =>
  ({ label, priceMinor, y });

const receiptOf = (rows: OcrReceiptRow[]): OcrReceipt =>
  ({ rows: rows.map((r, i) => ({ ...r, y: 0.05 + i * 0.03 })), text: '' });

describe('isNonItemRow', () => {
  it.each([
    'SUBTOTAL', 'TOTAL', 'TAX 1', 'CASH', 'CHANGE DUE', 'VISA DEBIT',
    'AUTH CODE 04512', 'MEMBER SAVINGS', 'BAG FEE', 'BOTTLE DEPOSIT CRV',
    'CASHIER: DANA', 'REGISTER 4', 'TELL US ABOUT YOUR VISIT SURVEY',
  ])('reads %s as the till talking', label => {
    expect(isNonItemRow(label)).toBe(true);
  });

  it.each([
    'GV MLK 2% GAL', 'BANANAS', 'SHRP CHDR', 'BNLS SKNLS CHKN BRST',
    'ORG BABY SPINACH', 'SOURDOUGH LOAF',
  ])('reads %s as something that was bought', label => {
    expect(isNonItemRow(label)).toBe(false);
  });

  it('matches whole words, so a product is not caught by a substring', () => {
    // The reason the lexicon is word-bounded rather than a substring test.
    expect(isNonItemRow('TOTALLY NUTS GRANOLA')).toBe(false);
    expect(isNonItemRow('CARDAMOM PODS')).toBe(false);
    expect(isNonItemRow('BAGELS')).toBe(false);
  });
});

describe('findPrintedDate', () => {
  it('reads a slashed American date out of the header', () => {
    expect(findPrintedDate([row('08/30/2026 14:22'), row('BANANAS', 129)]))
      .toBe('2026-08-30');
  });

  it('reads a two-digit year', () => {
    expect(findPrintedDate([row('DATE 08-30-26')])).toBe('2026-08-30');
  });

  it('refuses a day that is not a day', () => {
    expect(findPrintedDate([row('02/31/2026')])).toBeNull();
  });

  it('refuses a month that is not a month', () => {
    expect(findPrintedDate([row('19/04/2026')])).toBeNull();
  });

  it('is null when nothing on the paper looks like a date', () => {
    expect(findPrintedDate([row('BANANAS', 129), row('TOTAL', 129)])).toBeNull();
  });
});

describe('findPrintedTotal', () => {
  it('takes the total rather than the subtotal above it', () => {
    expect(findPrintedTotal([
      row('BANANAS', 129),
      row('SUBTOTAL', 129),
      row('TAX', 11),
      row('TOTAL', 140),
    ])).toBe(140);
  });

  it('is not fooled by a savings line printed after the total', () => {
    expect(findPrintedTotal([
      row('TOTAL', 140),
      row('TOTAL SAVINGS', 320),
    ])).toBe(140);
  });

  it('is null when no total was read', () => {
    expect(findPrintedTotal([row('BANANAS', 129)])).toBeNull();
  });
});

describe('guessStoreName', () => {
  it('takes the name printed at the top', () => {
    expect(guessStoreName([
      row("TRADER JOE'S"),
      row('1234 MAIN ST'),
      row('BANANAS', 129),
    ])).toBe("TRADER JOE'S");
  });

  it('skips an address and a phone number', () => {
    expect(guessStoreName([
      row('555-0147'),
      row('1234 MAIN ST'),
      row('SAFEWAY'),
    ])).toBe('SAFEWAY');
  });

  it('is empty rather than wrong when the top of the paper is unreadable', () => {
    // matchReceiptShop refuses what it does not recognise, so an empty guess
    // costs one tap and a wrong one would file a trip at the wrong store.
    expect(guessStoreName([row('4471 0082 1195'), row('BANANAS', 129)])).toBe('');
  });

  it('does not read a till line as a store name', () => {
    expect(guessStoreName([row('CASHIER DANA'), row('WHOLE FOODS')])).toBe('WHOLE FOODS');
  });
});

describe('extractReceiptOffline', () => {
  const REAL = receiptOf([
    row("TRADER JOE'S #453"),
    row('1234 MAIN ST'),
    row('08/30/2026 14:22'),
    row('BANANAS', 129),
    row('GV MLK 2% GAL', 348),
    row('BNLS SKNLS CHKN BRST', 871),
    row('SUBTOTAL', 1348),
    row('TAX', 0),
    row('TOTAL', 1348),
    row('VISA DEBIT', 1348),
    row('THANK YOU FOR SHOPPING'),
  ]);

  it('keeps the purchases and drops the till lines', () => {
    expect(extractReceiptOffline(REAL).lines.map(l => l.label))
      .toEqual(['BANANAS', 'GV MLK 2% GAL', 'BNLS SKNLS CHKN BRST']);
  });

  it('names each line with its printed text rather than guessing at it', () => {
    // The one thing this path deliberately does not attempt — see the note on
    // ReceiptLine.name. "BANANAS" matches on its own; the chicken does not, and
    // comes back for the user to file rather than filed wrongly.
    const lines = extractReceiptOffline(REAL).lines;
    expect(lines.map(l => l.name)).toEqual(lines.map(l => l.label));
  });

  it('leaves quantity empty rather than reading it off a column that is not there', () => {
    expect(extractReceiptOffline(REAL).lines.every(l => l.quantity === '')).toBe(true);
  });

  it('reads the prices, the total, the date and the store', () => {
    const result = extractReceiptOffline(REAL);
    expect(result.lines.map(l => l.priceMinor)).toEqual([129, 348, 871]);
    expect(result.totalMinor).toBe(1348);
    expect(result.date).toBe('2026-08-30');
    expect(result.storeName).toBe("TRADER JOE'S #453");
  });

  it('drops a row whose price was never read', () => {
    // Unpriced rows are the header, the footer, and the occasional item whose
    // amount was missed. None is something to tick a purchase off against.
    const result = extractReceiptOffline(receiptOf([
      row('BANANAS', 129),
      row('SOMETHING UNREADABLE'),
    ]));
    expect(result.lines.map(l => l.label)).toEqual(['BANANAS']);
  });

  it('returns an empty reading rather than throwing on an empty one', () => {
    expect(extractReceiptOffline({ rows: [], text: '' }))
      .toEqual({ storeName: '', lines: [], totalMinor: null, date: null });
  });
});
