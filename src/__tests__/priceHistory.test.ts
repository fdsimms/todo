import {
  priceRunForProduct,
  PRODUCT_RUN_MIN,
  PRICE_HISTORY_LIMIT,
  appendPriceObservation,
  mergePriceHistories,
  parsePriceHistory,
  priceBaseline,
  priceStanding,
} from '../utils/priceHistory';
import type { PriceObservation } from '../types';

function obs(
  minor: number,
  quantity: string | null = null,
  at = '2026-08-01T00:00:00.000Z',
  productId: string | null = null,
): PriceObservation {
  return { minor, quantity, at, productId };
}

// ─── parsePriceHistory ───────────────────────────────────────────────────────

describe('parsePriceHistory', () => {
  it('reads a stored run', () => {
    const raw = JSON.stringify([obs(399, '1 gal'), obs(349, '1 gal')]);
    expect(parsePriceHistory(raw)).toHaveLength(2);
  });

  it('treats an absent or unreadable blob as no history rather than throwing', () => {
    expect(parsePriceHistory(null)).toEqual([]);
    expect(parsePriceHistory('')).toEqual([]);
    expect(parsePriceHistory('not json')).toEqual([]);
    expect(parsePriceHistory('{"not":"an array"}')).toEqual([]);
  });

  it('drops entries that are not observations', () => {
    const raw = JSON.stringify([
      obs(399),
      { minor: 'lots', at: '2026-08-01T00:00:00.000Z', quantity: null },
      { minor: 0, at: '2026-08-01T00:00:00.000Z', quantity: null },
      { minor: 299, quantity: null },
      null,
    ]);
    expect(parsePriceHistory(raw)).toEqual([obs(399)]);
  });

  it('caps a run that was somehow stored over the limit', () => {
    const raw = JSON.stringify(Array.from({ length: 40 }, () => obs(399)));
    expect(parsePriceHistory(raw)).toHaveLength(PRICE_HISTORY_LIMIT);
  });
});

// ─── appendPriceObservation ──────────────────────────────────────────────────

describe('appendPriceObservation', () => {
  it('puts the newest first', () => {
    const next = appendPriceObservation([obs(349)], obs(399));
    expect(next[0].minor).toBe(399);
    expect(next[1].minor).toBe(349);
  });

  it('never grows past the cap, dropping the oldest', () => {
    let history = Array.from({ length: PRICE_HISTORY_LIMIT }, (_, i) => obs(100 + i));
    history = appendPriceObservation(history, obs(999));

    expect(history).toHaveLength(PRICE_HISTORY_LIMIT);
    expect(history[0].minor).toBe(999);
    // The one that fell off is the oldest, which was last.
    expect(history.some(o => o.minor === 100 + PRICE_HISTORY_LIMIT - 1)).toBe(false);
  });
});

// ─── priceBaseline ───────────────────────────────────────────────────────────

describe('priceBaseline', () => {
  it('has no answer for an empty run', () => {
    expect(priceBaseline([])).toBeNull();
  });

  it('answers a single observation with itself', () => {
    // The pre-history behaviour, so an install collects its first trip and
    // behaves exactly as it did before.
    expect(priceBaseline([obs(399, '1 gal')])).toEqual({ minor: 399, quantity: '1 gal' });
  });

  it('takes the median, so one sale cannot drag it', () => {
    const history = [obs(399), obs(199), obs(409), obs(389), obs(401)];
    expect(priceBaseline(history)?.minor).toBe(399);
  });

  it('averages the middle two on an even count', () => {
    expect(priceBaseline([obs(400), obs(300)])?.minor).toBe(350);
  });

  it('compares unqualified prices directly', () => {
    expect(priceBaseline([obs(300), obs(400), obs(500)])).toEqual({ minor: 400, quantity: null });
  });

  it('needs no measuring when every observation names the same amount', () => {
    // "a bunch" can't be measured, but it's consistently the same "a bunch".
    const history = [obs(300, 'a bunch'), obs(400, 'a bunch'), obs(500, 'a bunch')];
    expect(priceBaseline(history)).toEqual({ minor: 400, quantity: 'a bunch' });
  });

  it('rebases mixed sizes onto the newest observation', () => {
    // 8 oz at 4.00 and 16 oz at 8.00 are the same price per ounce; expressed
    // against the newest (8 oz) that is 4.00.
    const history = [obs(400, '8 oz'), obs(800, '16 oz'), obs(400, '8 oz')];
    expect(priceBaseline(history)).toEqual({ minor: 400, quantity: '8 oz' });
  });

  it('reports the baseline in the newest observation’s own units', () => {
    const history = [obs(800, '16 oz'), obs(400, '8 oz')];
    // Rebased to 16 oz, the 8 oz observation is 8.00 — so both are 800.
    expect(priceBaseline(history)).toEqual({ minor: 800, quantity: '16 oz' });
  });

  it('refuses a run mixing a qualified price with a bare one', () => {
    // Nothing says whether the bare price was for the same amount.
    expect(priceBaseline([obs(400, '8 oz'), obs(400, null)])).toBeNull();
  });

  it('refuses a run spanning two dimensions', () => {
    expect(priceBaseline([obs(400, '8 oz'), obs(400, '1 l')])).toBeNull();
  });

  it('refuses when the newest names an amount nothing can measure', () => {
    // The basis has to be measurable for anything to be rebased onto it.
    expect(priceBaseline([obs(400, 'a bunch'), obs(400, '8 oz')])).toBeNull();
  });
});

// ─── priceStanding ───────────────────────────────────────────────────────────

describe('priceStanding', () => {
  it('has no answer for an empty run', () => {
    expect(priceStanding({ minor: 399, quantity: null }, [])).toBeNull();
  });

  it('is the lowest when it ties or beats every observation in the run', () => {
    const history = [obs(399), obs(499), obs(449)];
    expect(priceStanding({ minor: 399, quantity: null }, history)).toBe('lowest');
    expect(priceStanding({ minor: 350, quantity: null }, history)).toBe('lowest');
  });

  it('is usual within a tenth of the median', () => {
    // Median of 400/500/450 rebased against a bare current is 450.
    const history = [obs(400), obs(500), obs(450)];
    expect(priceStanding({ minor: 470, quantity: null }, history)).toBe('usual');
  });

  it('is high a real step above the median, low a real step below', () => {
    const history = [obs(400), obs(500), obs(450)];
    expect(priceStanding({ minor: 900, quantity: null }, history)).toBe('high');
    // Above the run's own minimum (400) — otherwise it would be the lowest
    // ever paid, a stronger and more literal claim than "low".
    expect(priceStanding({ minor: 405, quantity: null }, history)).toBe('low');
  });

  it('reconciles onto the current price’s own quantity, not the run’s newest', () => {
    // The run is all in 8 oz; the current price is for the 16 oz size, so the
    // run has to be doubled (to 800/840/820) before it means anything against
    // it — a bare "410 vs 830" would misread this as roughly double the run.
    const history = [obs(400, '8 oz'), obs(420, '8 oz'), obs(410, '8 oz')];
    expect(priceStanding({ minor: 830, quantity: '16 oz' }, history)).toBe('usual');
  });

  it('refuses a run mixing a qualified price with a bare one', () => {
    expect(priceStanding({ minor: 400, quantity: '8 oz' }, [obs(400, null)])).toBeNull();
  });

  it('refuses a run spanning two dimensions', () => {
    expect(priceStanding({ minor: 400, quantity: '8 oz' }, [obs(400, '1 l')])).toBeNull();
  });
});

// ─── mergePriceHistories ─────────────────────────────────────────────────────

describe('mergePriceHistories', () => {
  it('keeps both sides, newest first', () => {
    const a = [obs(400, null, '2026-08-03T00:00:00.000Z')];
    const b = [obs(300, null, '2026-08-05T00:00:00.000Z')];

    expect(mergePriceHistories(a, b).map(o => o.minor)).toEqual([300, 400]);
  });

  it('caps the result, keeping the most recent', () => {
    const a = Array.from({ length: 10 }, (_, i) => obs(100, null, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`));
    const b = Array.from({ length: 10 }, (_, i) => obs(200, null, `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`));

    const merged = mergePriceHistories(a, b);

    expect(merged).toHaveLength(PRICE_HISTORY_LIMIT);
    // June beats January, so the newer side survives whole.
    expect(merged.filter(o => o.minor === 200)).toHaveLength(10);
  });

  it('handles an empty side', () => {
    expect(mergePriceHistories([], [obs(400)])).toEqual([obs(400)]);
    expect(mergePriceHistories([obs(400)], [])).toEqual([obs(400)]);
  });
});

// ─── priceRunForProduct ──────────────────────────────────────────────────────

describe('priceRunForProduct', () => {
  const arnolds = (minor: number) => obs(minor, '1 loaf', '2026-08-01T00:00:00.000Z', 'p-arnolds');
  const store = (minor: number) => obs(minor, '1 loaf', '2026-08-01T00:00:00.000Z', 'p-store');

  it('scopes a run to the box being asked about', () => {
    const run = [arnolds(499), store(299), arnolds(529), store(279)];
    const { history, scoped } = priceRunForProduct(run, 'p-arnolds');
    expect(scoped).toBe(true);
    expect(history.map(o => o.minor)).toEqual([499, 529]);
  });

  // The whole point: a median over both boxes describes neither.
  it('changes the baseline it hands back', () => {
    const run = [arnolds(499), store(299), arnolds(529), store(279)];
    expect(priceBaseline(priceRunForProduct(run, 'p-arnolds').history)?.minor).toBe(514);
    expect(priceBaseline(priceRunForProduct(run, 'p-store').history)?.minor).toBe(289);
  });

  // One observation is the poor baseline this whole file exists to reject, so
  // the unfiltered run — noisier about which box, but actually a run — wins.
  it('falls back to the whole run below the floor', () => {
    const run = [arnolds(499), store(299), store(279)];
    expect(PRODUCT_RUN_MIN).toBe(2);
    const { history, scoped } = priceRunForProduct(run, 'p-arnolds');
    expect(scoped).toBe(false);
    expect(history).toHaveLength(3);
  });

  // An install upgrading into this has no stamped observations at all, and a
  // run that scoped itself to nothing would turn every baseline into silence.
  it('falls back when nothing in the run is stamped', () => {
    const run = [obs(499), obs(529), obs(549)];
    expect(priceRunForProduct(run, 'p-arnolds')).toEqual({ history: run, scoped: false });
  });

  it('never filters when there is no box being asked about', () => {
    const run = [arnolds(499), store(299)];
    expect(priceRunForProduct(run, null)).toEqual({ history: run, scoped: false });
    expect(priceRunForProduct(run, undefined)).toEqual({ history: run, scoped: false });
  });

  // Resolve-or-shrug: an id naming a product deleted or merged away reads as
  // "not this box" rather than as an error.
  it('shrugs at an id nothing in the run names', () => {
    const run = [arnolds(499), arnolds(529)];
    expect(priceRunForProduct(run, 'p-gone').scoped).toBe(false);
  });
});
