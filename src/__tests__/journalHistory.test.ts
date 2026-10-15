import {
  canOfferJournalHistory,
  journalHistoryAt,
  journalHistoryTitle,
} from '../utils/journalHistory';

describe('canOfferJournalHistory', () => {
  const base = { kind: 'journal' as const, editing: false, sealed: false, personCount: 1 };

  it('offers a new, open journal entry that names somebody', () => {
    expect(canOfferJournalHistory(base)).toBe(true);
  });

  it('stays quiet with nobody named, on an edit, on a dream and on a sealed note', () => {
    expect(canOfferJournalHistory({ ...base, personCount: 0 })).toBe(false);
    expect(canOfferJournalHistory({ ...base, editing: true })).toBe(false);
    expect(canOfferJournalHistory({ ...base, kind: 'dream' })).toBe(false);
    expect(canOfferJournalHistory({ ...base, sealed: true })).toBe(false);
  });
});

describe('journalHistoryTitle', () => {
  it('names everybody once, in the past tense', () => {
    expect(journalHistoryTitle('hangout', ['Gideon'])).toBe('Hung out with Gideon');
    expect(journalHistoryTitle('catchup', ['Gideon', 'Tessa'])).toBe('Caught up with Gideon and Tessa');
    expect(journalHistoryTitle('hangout', ['A', 'B', 'C'])).toBe('Hung out with A, B and C');
  });
});

describe('journalHistoryAt', () => {
  const now = new Date(2026, 9, 15, 18, 30);

  it('is now for today', () => {
    expect(journalHistoryAt(new Date(2026, 9, 15), true, now)).toBe(now);
  });

  it('is noon on a backdated day', () => {
    const at = journalHistoryAt(new Date(2026, 9, 10, 3, 15), false, now);
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(10);
    expect(at.getHours()).toBe(12);
    expect(at.getMinutes()).toBe(0);
  });
});
