import {
  MAX_WEIGHT_KG,
  formatWeight,
  kgToUnit,
  latestWeight,
  parseWeightInput,
  unitToKg,
  weightChange,
  weightDomain,
  weightFraction,
  weightPlotPoints,
  weightReadings,
  weightSegments,
  type WeightPoint,
} from '@/utils/weightLog';

/** A series of N days, with readings supplied by day key. */
function series(values: (number | null)[]): WeightPoint[] {
  return values.map((kilograms, i) => ({
    dayKey: `2026-09-${String(i + 1).padStart(2, '0')}`,
    kilograms,
  }));
}

describe('unit conversion', () => {
  it('leaves kilograms alone', () => {
    expect(kgToUnit(72.4, 'kg')).toBe(72.4);
    expect(unitToKg(72.4, 'kg')).toBe(72.4);
  });

  it('round-trips pounds without losing a tenth', () => {
    // The reason KG_PER_LB is written out in full rather than rounded: a typed
    // 180.0 lb must come back as 180.0, not 179.9.
    const kilograms = unitToKg(180, 'lb');
    expect(kgToUnit(kilograms, 'lb')).toBeCloseTo(180, 10);
  });

  it('converts a known pair', () => {
    expect(unitToKg(100, 'lb')).toBeCloseTo(45.359237, 6);
    expect(kgToUnit(45.359237, 'lb')).toBeCloseTo(100, 6);
  });
});

describe('formatWeight', () => {
  it('shows one decimal place in either unit', () => {
    expect(formatWeight(72.44, 'kg')).toBe('72.4 kg');
    expect(formatWeight(72, 'kg')).toBe('72.0 kg');
    expect(formatWeight(unitToKg(180.2, 'lb'), 'lb')).toBe('180.2 lb');
  });
});

describe('parseWeightInput', () => {
  it('reads a plain decimal', () => {
    expect(parseWeightInput('72.4', 'kg')).toBeCloseTo(72.4, 10);
    expect(parseWeightInput('72', 'kg')).toBe(72);
  });

  it('converts a typed pound value to kilograms', () => {
    expect(parseWeightInput('180', 'lb')).toBeCloseTo(81.6466266, 6);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseWeightInput('  72.4  ', 'kg')).toBeCloseTo(72.4, 10);
  });

  it('refuses an empty or blank field', () => {
    expect(parseWeightInput('', 'kg')).toBeNull();
    expect(parseWeightInput('   ', 'kg')).toBeNull();
  });

  it('refuses zero and negatives rather than clamping them', () => {
    // A clamp would write a number the person never typed into their Health
    // record, which is the one outcome worth refusing outright.
    expect(parseWeightInput('0', 'kg')).toBeNull();
    expect(parseWeightInput('0.0', 'kg')).toBeNull();
    expect(parseWeightInput('-5', 'kg')).toBeNull();
  });

  it('refuses anything that is not a bare decimal', () => {
    expect(parseWeightInput('72kg', 'kg')).toBeNull();
    expect(parseWeightInput('72,4', 'kg')).toBeNull();
    expect(parseWeightInput('70-75', 'kg')).toBeNull();
    expect(parseWeightInput('abc', 'kg')).toBeNull();
    expect(parseWeightInput('72.4.1', 'kg')).toBeNull();
    expect(parseWeightInput('1e3', 'kg')).toBeNull();
  });

  it('refuses an absurd value at or past the ceiling', () => {
    expect(parseWeightInput(String(MAX_WEIGHT_KG), 'kg')).toBeNull();
    expect(parseWeightInput('99999', 'kg')).toBeNull();
    // The ceiling is in kilograms, so it applies after conversion too.
    expect(parseWeightInput('99999', 'lb')).toBeNull();
  });
});

describe('weightReadings', () => {
  it('keeps only the days that have a reading, in order', () => {
    const points = series([72.1, null, 71.8, null, 71.5]);
    expect(weightReadings(points).map(r => r.kilograms)).toEqual([72.1, 71.8, 71.5]);
  });

  it('is empty for a window nobody logged in', () => {
    expect(weightReadings(series([null, null, null]))).toEqual([]);
  });
});

describe('latestWeight', () => {
  it('takes the last reading in the window, not the last day', () => {
    const points = series([72.1, 71.8, null, null]);
    expect(latestWeight(points)).toEqual({ dayKey: '2026-09-02', kilograms: 71.8 });
  });

  it('is null when nothing was logged', () => {
    expect(latestWeight(series([null, null]))).toBeNull();
  });

  it('handles a single reading', () => {
    expect(latestWeight(series([70]))).toEqual({ dayKey: '2026-09-01', kilograms: 70 });
  });
});

describe('weightDomain', () => {
  it('is null with nothing to draw', () => {
    expect(weightDomain(series([null, null]))).toBeNull();
  });

  it('never starts at zero', () => {
    // The whole reason this exists rather than reusing the bar charts' scaling:
    // a body sits in a narrow band a long way from zero.
    const domain = weightDomain(series([72, 73, 74]))!;
    expect(domain.min).toBeGreaterThan(60);
  });

  it('brackets every reading it was given', () => {
    const domain = weightDomain(series([70.2, 75.8, 72.4]))!;
    expect(domain.min).toBeLessThan(70.2);
    expect(domain.max).toBeGreaterThan(75.8);
  });

  it('widens a nearly flat run to the minimum span', () => {
    // 200g of real variation must not be drawn as a mountain range.
    const domain = weightDomain(series([72.0, 72.1, 72.2]))!;
    expect(domain.max - domain.min).toBeGreaterThanOrEqual(2);
  });

  it('centres a flat run on the reading', () => {
    const domain = weightDomain(series([72, 72, 72]))!;
    expect((domain.min + domain.max) / 2).toBeCloseTo(72, 10);
    expect(domain.max - domain.min).toBeCloseTo(2 * 1.3, 10);
  });

  it('scales past the minimum span for a genuinely wide run', () => {
    const domain = weightDomain(series([70, 90]))!;
    expect(domain.max - domain.min).toBeCloseTo(20 * 1.3, 10);
  });

  it('clamps the floor at zero rather than going negative', () => {
    const domain = weightDomain(series([0.2]))!;
    expect(domain.min).toBe(0);
  });

  it('ignores the unlogged days entirely', () => {
    expect(weightDomain(series([null, 72, null]))).toEqual(weightDomain(series([72])));
  });
});

describe('weightFraction', () => {
  const domain = { min: 70, max: 80 };

  it('places the floor at 0 and the ceiling at 1', () => {
    expect(weightFraction(70, domain)).toBe(0);
    expect(weightFraction(80, domain)).toBe(1);
  });

  it('places the middle halfway', () => {
    expect(weightFraction(75, domain)).toBeCloseTo(0.5, 10);
  });

  it('clamps a reading outside the domain into the plot', () => {
    expect(weightFraction(60, domain)).toBe(0);
    expect(weightFraction(90, domain)).toBe(1);
  });

  it('puts a zero-width domain in the middle rather than dividing by zero', () => {
    expect(weightFraction(72, { min: 72, max: 72 })).toBe(0.5);
  });
});

describe('weightPlotPoints', () => {
  it('carries each reading’s day offset', () => {
    const plotted = weightPlotPoints(series([72, null, 71, null, null, 70]));
    expect(plotted.map(p => p.index)).toEqual([0, 2, 5]);
    expect(plotted.map(p => p.kilograms)).toEqual([72, 71, 70]);
  });

  it('is empty when nothing was logged', () => {
    expect(weightPlotPoints(series([null, null]))).toEqual([]);
  });
});

describe('weightSegments', () => {
  it('keeps a run of consecutive readings in one segment', () => {
    const segments = weightSegments(series([72, 71.9, 71.8]));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
  });

  it('joins across a gap shorter than the limit', () => {
    // Weekly weigh-ins should draw one continuous line.
    const values: (number | null)[] = [72, null, null, null, null, null, null, 71];
    expect(weightSegments(series(values))).toHaveLength(1);
  });

  it('breaks the line across a gap longer than the limit', () => {
    // 20 clear days between two readings: a straight line across that would
    // draw every day nobody measured.
    const values: (number | null)[] = [72, ...Array(20).fill(null), 71];
    const segments = weightSegments(series(values));
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(1);
    expect(segments[1]).toHaveLength(1);
  });

  it('honours a custom gap limit', () => {
    const values: (number | null)[] = [72, null, null, 71];
    expect(weightSegments(series(values), 2)).toHaveLength(2);
    expect(weightSegments(series(values), 3)).toHaveLength(1);
  });

  it('is empty for a window with no readings', () => {
    expect(weightSegments(series([null, null]))).toEqual([]);
  });

  it('returns a single-point segment rather than dropping a lone reading', () => {
    expect(weightSegments(series([null, 72, null]))).toEqual([
      [{ index: 1, dayKey: '2026-09-02', kilograms: 72 }],
    ]);
  });
});

describe('weightChange', () => {
  it('is null for one reading, because one weight is not a change', () => {
    expect(weightChange(series([72]))).toBeNull();
    expect(weightChange(series([null, 72, null]))).toBeNull();
  });

  it('is null for an empty window', () => {
    expect(weightChange(series([null, null]))).toBeNull();
  });

  it('reports the first and last readings and the gap between them', () => {
    const change = weightChange(series([72.4, null, 72.0, null, 71.1]))!;
    expect(change.first).toEqual({ dayKey: '2026-09-01', kilograms: 72.4 });
    expect(change.last).toEqual({ dayKey: '2026-09-05', kilograms: 71.1 });
    expect(change.deltaKg).toBeCloseTo(-1.3, 10);
  });

  it('signs the delta positive when the later reading is heavier', () => {
    expect(weightChange(series([70, 72]))!.deltaKg).toBeCloseTo(2, 10);
  });

  it('counts the readings, not the days in the window', () => {
    // The count has to travel with the change: the same 1kg across two
    // weigh-ins and across sixty are not the same claim.
    const change = weightChange(series([72, null, null, null, 71]))!;
    expect(change.readings).toBe(2);
  });
});
