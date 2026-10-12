import {
  rainUnitFor, rainPresetToMm, formatRain, rainSkipOptions, canSkipForRain, recentRainMm,
  shouldSkipForRain, describeRainSkip, defaultRainSkipMm,
} from '../utils/rainSkip';

const water = {
  recurrenceType: 'daily' as const,
  completed: false,
  archived: false,
  rainSkipMm: 5,
  rainSkippedOn: null,
};

describe('units', () => {
  it('shows millimetres only on metric', () => {
    expect(rainUnitFor('metric')).toBe('mm');
    expect(rainUnitFor('us')).toBe('in');
    expect(rainUnitFor('asWritten')).toBe('in');
    expect(rainUnitFor(undefined)).toBe('in');
  });

  it('stores millimetres and says either', () => {
    expect(rainPresetToMm(0.25, 'in')).toBe(6.35);
    expect(rainPresetToMm(5, 'mm')).toBe(5);
    expect(formatRain(6.35, 'in')).toBe('0.25 in');
    expect(formatRain(25.4, 'in')).toBe('1 in');
    expect(formatRain(6.35, 'mm')).toBe('6.4 mm');
    expect(formatRain(12.7, 'mm')).toBe('13 mm');
  });

  it('defaults a bare "unless it rains" to the second preset in either unit', () => {
    expect(defaultRainSkipMm('mm')).toBe(5);
    expect(defaultRainSkipMm('in')).toBe(6.35);
  });

  it('offers four thresholds in the user\'s unit', () => {
    expect(rainSkipOptions('in').map(o => o.label)).toEqual(['0.1 in', '0.25 in', '0.5 in', '1 in']);
    expect(rainSkipOptions('mm').map(o => o.label)).toEqual(['2 mm', '5 mm', '10 mm', '20 mm']);
  });
});

describe('which tasks can skip', () => {
  it('is a repeating task with days to skip', () => {
    expect(canSkipForRain(water)).toBe(true);
    expect(canSkipForRain({ ...water, recurrenceType: 'none' })).toBe(false);
    expect(canSkipForRain({ ...water, recurrenceType: 'hours' })).toBe(false);
    expect(canSkipForRain({ ...water, polarity: 'negative' })).toBe(false);
    expect(canSkipForRain({ ...water, parentId: 'p' })).toBe(false);
  });
});

describe('recent rain', () => {
  it('adds yesterday to today', () => {
    expect(recentRainMm({ yesterdayPrecipitationMm: 3, todayPrecipitationMm: 4.5 })).toBe(7.5);
  });

  it('reads one missing day as nothing more, and both missing as no answer', () => {
    expect(recentRainMm({ yesterdayPrecipitationMm: null, todayPrecipitationMm: 6 })).toBe(6);
    expect(recentRainMm({ yesterdayPrecipitationMm: null, todayPrecipitationMm: null })).toBeNull();
    expect(recentRainMm(null)).toBeNull();
  });
});

describe('shouldSkipForRain', () => {
  const today = '2026-10-08';

  it('skips today\'s occurrence once the rain reaches the threshold', () => {
    expect(shouldSkipForRain(water, 5, today, today)).toBe(true);
    expect(shouldSkipForRain(water, 4.9, today, today)).toBe(false);
  });

  it('decides nothing with no figure, never reading it as dry or wet', () => {
    expect(shouldSkipForRain(water, null, today, today)).toBe(false);
  });

  it('leaves an occurrence that isn\'t today\'s', () => {
    expect(shouldSkipForRain(water, 20, '2026-10-09', today)).toBe(false);
    expect(shouldSkipForRain(water, 20, '2026-10-07', today)).toBe(false);
    expect(shouldSkipForRain(water, 20, null, today)).toBe(false);
  });

  it('skips a row only once a day, so pulling it back sticks', () => {
    expect(shouldSkipForRain({ ...water, rainSkippedOn: today }, 20, today, today)).toBe(false);
    expect(shouldSkipForRain({ ...water, rainSkippedOn: '2026-10-06' }, 20, today, today)).toBe(true);
  });

  it('leaves a finished task, one with no threshold, and one that can\'t skip', () => {
    expect(shouldSkipForRain({ ...water, completed: true }, 20, today, today)).toBe(false);
    expect(shouldSkipForRain({ ...water, rainSkipMm: null }, 20, today, today)).toBe(false);
    expect(shouldSkipForRain({ ...water, recurrenceType: 'none' }, 20, today, today)).toBe(false);
  });
});

describe('describeRainSkip', () => {
  it('says the threshold in the user\'s unit', () => {
    expect(describeRainSkip(6.35, 'in')).toBe('skips after 0.25 in of rain');
    expect(describeRainSkip(5, 'mm')).toBe('skips after 5 mm of rain');
    expect(describeRainSkip(null, 'mm')).toBeNull();
  });
});
