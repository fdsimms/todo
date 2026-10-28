import {
  REMINDER_REMOVAL_KEEP_DAYS,
  addReminderRemovals,
  defaultBoughtIds,
  liveReminderRemovals,
  parseReminderRemovals,
  purchaseGroups,
  purchaseTimeOf,
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

  it('keeps a check time only on a row that was in the cart, and only if it is a date', () => {
    const raw = JSON.stringify([
      { itemId: 'a', inCart: true, removedAt: at('2026-10-28T09:00'), checkedAt: at('2026-10-25T09:00') },
      { itemId: 'b', inCart: false, removedAt: at('2026-10-28T09:00'), checkedAt: at('2026-10-25T09:00') },
      { itemId: 'c', inCart: true, removedAt: at('2026-10-28T09:00'), checkedAt: 'Tuesday' },
    ]);
    const parsed = parseReminderRemovals(raw);
    expect(parsed[0].checkedAt).toBe(at('2026-10-25T09:00'));
    expect(parsed[1].checkedAt).toBeUndefined();
    expect(parsed[2].checkedAt).toBeUndefined();
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

  it('keeps the check time of a row that was in the cart', () => {
    const when = at('2026-10-28T12:00');
    const checkedAt = at('2026-10-25T11:00');
    expect(addReminderRemovals([], [{ itemId: 'a', checked: true, checkedAt }], when)).toEqual([
      { itemId: 'a', inCart: true, removedAt: when, checkedAt },
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

  // Dated from the check, a purchase recorded at that time has to retire it,
  // and one from before the check must not.
  it('measures "bought since" from the check time when there is one', () => {
    const list = [
      removal({ itemId: 'a', checkedAt: at('2026-10-25T11:00') }),
      removal({ itemId: 'b', checkedAt: at('2026-10-25T11:00') }),
    ];
    const items = [
      item('a', { lastPurchasedAt: at('2026-10-25T11:00') }),
      item('b', { lastPurchasedAt: at('2026-10-24T11:00') }),
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

describe('purchaseTimeOf', () => {
  it('is when the row was checked, if that is known', () => {
    expect(purchaseTimeOf(removal({ itemId: 'a', checkedAt: at('2026-10-25T11:00') }))).toBe(at('2026-10-25T11:00'));
  });

  it('falls back to when it came off the list', () => {
    expect(purchaseTimeOf(removal({ itemId: 'a' }))).toBe(at('2026-10-28T10:00'));
  });
});

describe('purchaseGroups', () => {
  it('is one purchase per day, oldest first, at the latest time that day', () => {
    const bought = [
      removal({ itemId: 'eggs', checkedAt: at('2026-10-27T10:05') }),
      removal({ itemId: 'milk', checkedAt: at('2026-10-25T11:00') }),
      removal({ itemId: 'bread', checkedAt: at('2026-10-27T10:20') }),
      removal({ itemId: 'foil', removedAt: at('2026-10-28T09:00') }),
    ];
    expect(purchaseGroups(bought, NOW)).toEqual([
      { purchasedAt: at('2026-10-25T11:00'), itemIds: ['milk'] },
      { purchasedAt: at('2026-10-27T10:20'), itemIds: ['eggs', 'bread'] },
      { purchasedAt: at('2026-10-28T09:00'), itemIds: ['foil'] },
    ]);
  });

  it('retires every row it records in liveReminderRemovals', () => {
    const bought = [
      removal({ itemId: 'a', checkedAt: at('2026-10-27T10:05') }),
      removal({ itemId: 'b', checkedAt: at('2026-10-27T10:20') }),
    ];
    const [group] = purchaseGroups(bought, NOW);
    const items = [item('a', { lastPurchasedAt: group.purchasedAt }), item('b', { lastPurchasedAt: group.purchasedAt })];
    expect(liveReminderRemovals(bought, items, NOW)).toEqual([]);
  });

  it('is never later than now', () => {
    expect(purchaseGroups([removal({ itemId: 'a', removedAt: at('2026-10-29T10:00') })], NOW)).toEqual([
      { purchasedAt: NOW.toISOString(), itemIds: ['a'] },
    ]);
  });
});

describe('defaultBoughtIds', () => {
  it('starts with the rows that were in the cart', () => {
    expect(
      defaultBoughtIds([removal({ itemId: 'a' }), removal({ itemId: 'b', inCart: false }), removal({ itemId: 'c' })])
    ).toEqual(['a', 'c']);
  });
});
