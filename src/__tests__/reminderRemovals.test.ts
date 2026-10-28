import {
  REMINDER_REMOVAL_KEEP_DAYS,
  addReminderRemovals,
  defaultBoughtIds,
  liveReminderRemovals,
  parseReminderRemovals,
  reminderPurchaseTime,
  serializeReminderRemovals,
  type ReminderRemoval,
} from '../utils/reminderRemovals';

const NOW = new Date('2026-10-28T18:00');
const at = (s: string) => new Date(s).toISOString();

const removal = (over: Partial<ReminderRemoval> & { itemId: string }): ReminderRemoval => ({
  inCart: true,
  removedAt: at('2026-10-28T10:00'),
  ...over,
});

const item = (id: string, over: { onList?: boolean; lastPurchasedAt?: string | null } = {}) => ({
  id,
  onList: false,
  lastPurchasedAt: null,
  ...over,
});

describe('parseReminderRemovals', () => {
  it('round-trips what it serializes', () => {
    const list = [removal({ itemId: 'a' }), removal({ itemId: 'b', inCart: false })];
    expect(parseReminderRemovals(serializeReminderRemovals(list))).toEqual(list);
  });

  it('reads nothing from a missing or broken record', () => {
    expect(parseReminderRemovals(null)).toEqual([]);
    expect(parseReminderRemovals('not json')).toEqual([]);
    expect(parseReminderRemovals('{"a":1}')).toEqual([]);
  });

  it('skips malformed entries and keeps the first of a duplicate', () => {
    const raw = JSON.stringify([
      { itemId: 'a', inCart: true, removedAt: at('2026-10-27T09:00') },
      { itemId: 'a', inCart: false, removedAt: at('2026-10-28T09:00') },
      { itemId: '', removedAt: at('2026-10-28T09:00') },
      { itemId: 'b', removedAt: 'whenever' },
      { itemId: 'c', inCart: 'yes', removedAt: at('2026-10-28T09:00') },
    ]);
    expect(parseReminderRemovals(raw)).toEqual([
      { itemId: 'a', inCart: true, removedAt: at('2026-10-27T09:00') },
      { itemId: 'c', inCart: false, removedAt: at('2026-10-28T09:00') },
    ]);
  });
});

describe('addReminderRemovals', () => {
  it('records whether each row was in the cart', () => {
    const when = at('2026-10-28T12:00');
    expect(addReminderRemovals([], [{ itemId: 'a', checked: true }, { itemId: 'b', checked: false }], when)).toEqual([
      { itemId: 'a', inCart: true, removedAt: when },
      { itemId: 'b', inCart: false, removedAt: when },
    ]);
  });

  it('replaces an older removal of the same row rather than listing it twice', () => {
    const older = removal({ itemId: 'a', inCart: false, removedAt: at('2026-10-20T10:00') });
    const when = at('2026-10-28T12:00');
    expect(addReminderRemovals([older, removal({ itemId: 'b' })], [{ itemId: 'a', checked: true }], when)).toEqual([
      removal({ itemId: 'b' }),
      { itemId: 'a', inCart: true, removedAt: when },
    ]);
  });
});

describe('liveReminderRemovals', () => {
  it('keeps a row that is off the list and not bought since', () => {
    const list = [removal({ itemId: 'a' })];
    expect(liveReminderRemovals(list, [item('a')], NOW)).toEqual(list);
  });

  it('drops a row that no longer exists', () => {
    expect(liveReminderRemovals([removal({ itemId: 'a' })], [], NOW)).toEqual([]);
  });

  it('drops a row that is back on the list', () => {
    expect(liveReminderRemovals([removal({ itemId: 'a' })], [item('a', { onList: true })], NOW)).toEqual([]);
  });

  it('drops a row bought at or after it was removed, and keeps one bought before', () => {
    const list = [removal({ itemId: 'a' }), removal({ itemId: 'b' })];
    const items = [
      item('a', { lastPurchasedAt: at('2026-10-28T10:00') }),
      item('b', { lastPurchasedAt: at('2026-10-21T10:00') }),
    ];
    expect(liveReminderRemovals(list, items, NOW).map(r => r.itemId)).toEqual(['b']);
  });

  it(`drops a row that has waited more than ${REMINDER_REMOVAL_KEEP_DAYS} days`, () => {
    const list = [
      removal({ itemId: 'old', removedAt: at('2026-10-13T17:00') }),
      removal({ itemId: 'recent', removedAt: at('2026-10-15T10:00') }),
    ];
    expect(liveReminderRemovals(list, [item('old'), item('recent')], NOW).map(r => r.itemId)).toEqual(['recent']);
  });
});

describe('reminderPurchaseTime', () => {
  it('is the latest removal among the bought rows', () => {
    const bought = [
      removal({ itemId: 'a', removedAt: at('2026-10-26T10:00') }),
      removal({ itemId: 'b', removedAt: at('2026-10-27T10:00') }),
    ];
    expect(reminderPurchaseTime(bought, NOW)).toBe(at('2026-10-27T10:00'));
  });

  it('retires every row it records in liveReminderRemovals', () => {
    const bought = [
      removal({ itemId: 'a', removedAt: at('2026-10-26T10:00') }),
      removal({ itemId: 'b', removedAt: at('2026-10-27T10:00') }),
    ];
    const when = reminderPurchaseTime(bought, NOW);
    const items = [item('a', { lastPurchasedAt: when }), item('b', { lastPurchasedAt: when })];
    expect(liveReminderRemovals(bought, items, NOW)).toEqual([]);
  });

  it('is never later than now', () => {
    expect(reminderPurchaseTime([removal({ itemId: 'a', removedAt: at('2026-10-29T10:00') })], NOW)).toBe(
      NOW.toISOString()
    );
  });
});

describe('defaultBoughtIds', () => {
  it('starts with the rows that were in the cart', () => {
    expect(
      defaultBoughtIds([removal({ itemId: 'a' }), removal({ itemId: 'b', inCart: false }), removal({ itemId: 'c' })])
    ).toEqual(['a', 'c']);
  });
});
