import {
  MAX_MANUAL_MINUTES, MIN_MANUAL_MINUTES, describeDuration, manualBlockWanted, manualMinutesProblem,
  newManualBlock, parseManualBlock,
} from '../utils/manualBlock';

const NOW = new Date(2026, 9, 14, 14, 0);

describe('manualMinutesProblem', () => {
  it('accepts what a native window can hold', () => {
    expect(manualMinutesProblem(MIN_MANUAL_MINUTES)).toBeNull();
    expect(manualMinutesProblem(MAX_MANUAL_MINUTES)).toBeNull();
  });

  it('refuses a length iOS would swallow or a day-long one', () => {
    expect(manualMinutesProblem(5)).not.toBeNull();
    expect(manualMinutesProblem(MAX_MANUAL_MINUTES + 1)).not.toBeNull();
    expect(manualMinutesProblem(30.5)).not.toBeNull();
    expect(manualMinutesProblem(Number.NaN)).not.toBeNull();
  });
});

describe('a block', () => {
  it('ends the stated length after it starts and holds the group it started with', () => {
    const block = newManualBlock(60, 'games', NOW);
    expect(block).toEqual({ untilIso: new Date(2026, 9, 14, 15, 0).toISOString(), groupId: 'games' });
  });

  it('wants the apps blocked only until its end', () => {
    const block = newManualBlock(30, 'default', NOW);
    expect(manualBlockWanted(block, new Date(2026, 9, 14, 14, 29))).toBe(true);
    expect(manualBlockWanted(block, new Date(2026, 9, 14, 14, 30))).toBe(false);
    expect(manualBlockWanted(null, NOW)).toBe(false);
  });

  it('reads an unreadable end as not blocking', () => {
    expect(manualBlockWanted({ untilIso: 'nonsense', groupId: 'default' }, NOW)).toBe(false);
  });
});

describe('parseManualBlock', () => {
  it('round trips a stored block', () => {
    const block = newManualBlock(60, 'default', NOW);
    expect(parseManualBlock(JSON.stringify(block))).toEqual(block);
  });

  it('drops anything malformed rather than throwing', () => {
    expect(parseManualBlock('')).toBeNull();
    expect(parseManualBlock(null)).toBeNull();
    expect(parseManualBlock('nonsense')).toBeNull();
    expect(parseManualBlock('{"untilIso":"nope","groupId":"default"}')).toBeNull();
    expect(parseManualBlock('{"untilIso":"2026-10-14T15:00:00Z","groupId":"../x"}')).toBeNull();
    expect(parseManualBlock('{"untilIso":5,"groupId":"default"}')).toBeNull();
  });
});

describe('describeDuration', () => {
  it('says minutes and hours in plain words', () => {
    expect(describeDuration(15)).toBe('15 minutes');
    expect(describeDuration(60)).toBe('1 hour');
    expect(describeDuration(120)).toBe('2 hours');
    expect(describeDuration(90)).toBe('1 hour 30 minutes');
  });
});
