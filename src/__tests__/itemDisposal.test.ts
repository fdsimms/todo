import {
  REPEAT_WASTE_THRESHOLD,
  describeDisposalHistory,
  disposalAnswerCount,
  wantsShelfLifePrompt,
} from '../utils/itemDisposal';

const NOW = new Date('2026-08-23T12:00:00.000Z');

function record(overrides: Partial<{ usedUpCount: number; spoiledCount: number; lastSpoiledAt: string | null }> = {}) {
  return { usedUpCount: 0, spoiledCount: 0, lastSpoiledAt: null, ...overrides };
}

describe('disposalAnswerCount', () => {
  it('is both sides together', () => {
    expect(disposalAnswerCount(record({ usedUpCount: 4, spoiledCount: 2 }))).toBe(6);
  });

  it('is zero for a row nobody has answered for', () => {
    expect(disposalAnswerCount(record())).toBe(0);
  });
});

describe('describeDisposalHistory', () => {
  it('says nothing at all about a row that has never gone bad', () => {
    // The silence is the point: a line congratulating someone on eating their
    // food is the editorialising describeOutcome refuses.
    expect(describeDisposalHistory(record({ usedUpCount: 5 }), NOW)).toBe('');
  });

  it('says nothing for a row nobody has answered for', () => {
    expect(describeDisposalHistory(record(), NOW)).toBe('');
  });

  it('counts the spoiled side against every answer given', () => {
    expect(
      describeDisposalHistory(
        record({ usedUpCount: 1, spoiledCount: 2, lastSpoiledAt: '2026-08-12T09:00:00.000Z' }),
        NOW
      )
    ).toBe('Went bad 2 of 3 times, last on Aug 12.');
  });

  it('singularises a lone answer', () => {
    expect(
      describeDisposalHistory(record({ spoiledCount: 1, lastSpoiledAt: '2026-08-12T09:00:00.000Z' }), NOW)
    ).toBe('Went bad 1 of 1 time, last on Aug 12.');
  });

  it('drops the date and keeps the count when the stamp is unusable', () => {
    // describeFrozenSince's two cases: a stamp from a restored backup that
    // won't parse, and one in the future because the clock was moved back.
    expect(describeDisposalHistory(record({ spoiledCount: 2, lastSpoiledAt: 'nonsense' }), NOW))
      .toBe('Went bad 2 of 2 times.');
    expect(
      describeDisposalHistory(record({ spoiledCount: 2, lastSpoiledAt: '2027-01-01T00:00:00.000Z' }), NOW)
    ).toBe('Went bad 2 of 2 times.');
  });

  it('keeps the count for a row with no stamp at all', () => {
    expect(describeDisposalHistory(record({ spoiledCount: 3 }), NOW)).toBe('Went bad 3 of 3 times.');
  });
});

describe('wantsShelfLifePrompt', () => {
  it('says nothing the first time something goes bad', () => {
    expect(wantsShelfLifePrompt({ spoiledCount: 1 })).toBe(false);
  });

  it('fires on the second', () => {
    expect(wantsShelfLifePrompt({ spoiledCount: REPEAT_WASTE_THRESHOLD })).toBe(true);
  });

  it('keeps firing above the threshold rather than only landing on it', () => {
    // An offer waved away in a hurry would otherwise be an offer never made,
    // and by the fourth waste it's more true rather than less.
    expect(wantsShelfLifePrompt({ spoiledCount: 4 })).toBe(true);
  });

  it('never fires off a clean record', () => {
    expect(wantsShelfLifePrompt({ spoiledCount: 0 })).toBe(false);
  });
});
