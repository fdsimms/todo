import {
  CHART_GAP_DAYS,
  chartDomain,
  chartPoints,
  chartSegments,
  daysBetween,
  domainFraction,
  minTickGapDays,
  monthTicks,
  recordIndexes,
} from '../utils/exerciseChart';

const pts = (...rows: [string, number][]) => chartPoints(rows.map(([dayKey, value]) => ({ dayKey, value })));

describe('chartPoints', () => {
  it('orders by day and measures each from the first', () => {
    const p = pts(['2026-09-08', 2], ['2026-09-01', 1], ['2026-09-15', 3]);
    expect(p.map(x => [x.dayKey, x.dayIndex])).toEqual([['2026-09-01', 0], ['2026-09-08', 7], ['2026-09-15', 14]]);
  });

  it('counts whole days across a daylight-saving change', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('is empty for nothing', () => {
    expect(chartPoints([])).toEqual([]);
  });
});

describe('chartSegments', () => {
  it('keeps sessions a week or two apart on one line', () => {
    expect(chartSegments(pts(['2026-09-01', 1], ['2026-09-08', 2], ['2026-09-22', 3]))).toHaveLength(1);
  });

  it(`breaks the line after a gap longer than ${CHART_GAP_DAYS} days`, () => {
    const segments = chartSegments(pts(['2026-07-01', 1], ['2026-07-08', 2], ['2026-09-01', 3], ['2026-09-08', 4]));
    expect(segments.map(s => s.map(p => p.dayKey))).toEqual([['2026-07-01', '2026-07-08'], ['2026-09-01', '2026-09-08']]);
  });

  it('joins a gap of exactly the limit and breaks one day more', () => {
    expect(chartSegments(pts(['2026-09-01', 1], ['2026-09-22', 2]))).toHaveLength(1);
    expect(chartSegments(pts(['2026-09-01', 1], ['2026-09-23', 2]))).toHaveLength(2);
  });

  it('draws a lone session as a one-point run', () => {
    expect(chartSegments(pts(['2026-09-01', 1]))).toEqual([[expect.objectContaining({ dayKey: '2026-09-01' })]]);
  });
});

describe('recordIndexes', () => {
  it('marks a point strictly above everything before it, never the first', () => {
    expect(recordIndexes([{ dayKey: 'a', value: 5 }, { dayKey: 'b', value: 6 }, { dayKey: 'c', value: 6 }, { dayKey: 'd', value: 5 }, { dayKey: 'e', value: 7 }])).toEqual([1, 4]);
  });

  it('finds none in a line that only fell, or in one point', () => {
    expect(recordIndexes([{ dayKey: 'a', value: 5 }, { dayKey: 'b', value: 4 }])).toEqual([]);
    expect(recordIndexes([{ dayKey: 'a', value: 5 }])).toEqual([]);
  });
});

describe('chartDomain', () => {
  it('pads and rounds out to tidy numbers, away from zero', () => {
    const d = chartDomain([88, 104.5])!;
    expect(d.min).toBeLessThanOrEqual(88);
    expect(d.max).toBeGreaterThanOrEqual(104.5);
    expect(d.min).toBeGreaterThan(0);
    // Rounded to a step a person would write.
    expect(d.min % 2.5).toBe(0);
    expect(d.max % 2.5).toBe(0);
  });

  it('gives a flat series a window instead of no height', () => {
    const d = chartDomain([60, 60, 60])!;
    expect(d.max).toBeGreaterThan(d.min);
    expect(d.min).toBeLessThan(60);
    expect(d.max).toBeGreaterThan(60);
  });

  it('never goes below zero', () => {
    expect(chartDomain([1, 2])!.min).toBe(0);
    expect(chartDomain([0])!.min).toBe(0);
  });

  it('is null for no values and places a value between its bounds', () => {
    expect(chartDomain([])).toBeNull();
    const d = chartDomain([10, 50])!;
    expect(domainFraction(d.min, d)).toBe(0);
    expect(domainFraction(d.max, d)).toBe(1);
    expect(domainFraction(30, d)).toBeGreaterThan(0);
  });
});

describe('monthTicks', () => {
  it('labels the start and each month that begins inside the span', () => {
    const ticks = monthTicks('2026-07-10', '2026-10-20');
    expect(ticks.map(t => t.label)).toEqual(['Jul', 'Aug', 'Sep', 'Oct']);
    expect(ticks[1]).toMatchObject({ dayKey: '2026-08-01', dayIndex: 22 });
  });

  it('drops a month that begins right after the start', () => {
    // Aug 1 is four days after the start, too close to label beside "Jul".
    expect(monthTicks('2026-07-28', '2026-09-30').map(t => t.label)).toEqual(['Jul', 'Sep']);
    expect(monthTicks('2026-07-28', '2026-07-31').map(t => t.label)).toEqual(['Jul']);
  });

  it('spaces labels by the width they need', () => {
    expect(minTickGapDays(100, 300)).toBe(10);
    expect(minTickGapDays(365, 300)).toBe(37);
    expect(minTickGapDays(10, 300)).toBe(7);
    expect(minTickGapDays(100, 0)).toBe(7);
    const year = monthTicks('2026-01-01', '2026-12-31', minTickGapDays(364, 300));
    expect(year.length).toBeLessThan(12);
    expect(year.length).toBeGreaterThan(5);
  });

  it('crosses a year', () => {
    expect(monthTicks('2026-11-01', '2027-02-10').map(t => t.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb']);
  });

  it('is a single tick for one day', () => {
    expect(monthTicks('2026-10-14', '2026-10-14')).toEqual([{ dayKey: '2026-10-14', dayIndex: 0, label: 'Oct' }]);
  });
});
