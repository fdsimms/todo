import {
  MAX_MANUAL_MINUTES, MIN_MANUAL_MINUTES, describeDuration, endsSooner, isTimedBlock, manualBlockWanted, manualMinutesProblem,
  newManualBlock, parseManualBlock, serializeManualBlock,
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
    const block = newManualBlock(60, ['games'], NOW);
    expect(block).toEqual({ untilIso: new Date(2026, 9, 14, 15, 0).toISOString(), groupIds: ['games'] });
  });

  it('wants the apps blocked only until its end', () => {
    const block = newManualBlock(30, ['default'], NOW);
    expect(manualBlockWanted(block, new Date(2026, 9, 14, 14, 29))).toBe(true);
    expect(manualBlockWanted(block, new Date(2026, 9, 14, 14, 30))).toBe(false);
    expect(manualBlockWanted(null, NOW)).toBe(false);
  });

  it('reads an unreadable end as not blocking', () => {
    expect(manualBlockWanted({ untilIso: 'nonsense', groupIds: ['default'] }, NOW)).toBe(false);
  });
});

describe('parseManualBlock', () => {
  it('round trips a stored block', () => {
    const block = newManualBlock(60, ['default'], NOW);
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

describe('a block holding several groups', () => {
  it('keeps every group, once each, in the order given', () => {
    expect(newManualBlock(60, ['games', 'default', 'games'], NOW).groupIds).toEqual(['games', 'default']);
  });

  it('holds Default when given none', () => {
    expect(newManualBlock(60, [], NOW).groupIds).toEqual(['default']);
  });

  it('round trips through the stored form, which also names the first group as groupId', () => {
    const block = newManualBlock(60, ['games', 'social'], NOW);
    const raw = serializeManualBlock(block);
    expect(JSON.parse(raw)).toMatchObject({ groupId: 'games', groupIds: ['games', 'social'] });
    expect(parseManualBlock(raw)).toEqual(block);
  });

  it('reads a block stored before groups could be combined', () => {
    expect(parseManualBlock('{"untilIso":null,"groupId":"games"}')).toEqual({ untilIso: null, groupIds: ['games'] });
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

describe('an open-ended block', () => {
  const open = newManualBlock(null, ['games'], NOW);

  it('has no end, and holds until something ends it', () => {
    expect(open).toEqual({ untilIso: null, groupIds: ['games'] });
    expect(isTimedBlock(open)).toBe(false);
    expect(manualBlockWanted(open, new Date(2030, 0, 1))).toBe(true);
  });

  it('is accepted as a length and survives a round trip', () => {
    expect(manualMinutesProblem(null)).toBeNull();
    expect(parseManualBlock(JSON.stringify(open))).toEqual(open);
  });

  it('is the longest a block can be', () => {
    const timed = newManualBlock(240, ['games'], NOW);
    expect(endsSooner(timed, open)).toBe(true);
    expect(endsSooner(open, timed)).toBe(false);
    expect(endsSooner(open, open)).toBe(false);
    expect(endsSooner(newManualBlock(30, ['games'], NOW), timed)).toBe(true);
    expect(endsSooner(newManualBlock(480, ['games'], NOW), timed)).toBe(false);
  });

  it('is worded as until you end it', () => {
    expect(describeDuration(null)).toBe('until you end it');
  });
});
