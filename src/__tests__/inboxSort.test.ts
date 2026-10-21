import { inboxSortDay, inboxSortQueue } from '../utils/inboxSort';
import type { Task } from '../types';

describe('inboxSortDay', () => {
  const wednesday = new Date(2026, 9, 21);

  it('reads today, tomorrow and no date', () => {
    expect(inboxSortDay('today', wednesday)).toEqual(wednesday);
    expect(inboxSortDay('tomorrow', wednesday)).toEqual(new Date(2026, 9, 22));
    expect(inboxSortDay('none', wednesday)).toBeNull();
  });

  it('puts this weekend on Saturday, or today once Saturday has gone', () => {
    expect(inboxSortDay('weekend', wednesday)).toEqual(new Date(2026, 9, 24));
    expect(inboxSortDay('weekend', new Date(2026, 9, 24))).toEqual(new Date(2026, 9, 24));
    const sunday = new Date(2026, 9, 25);
    expect(inboxSortDay('weekend', sunday)).toEqual(sunday);
  });
});

describe('inboxSortQueue', () => {
  it('drops the skipped cards and keeps the Inbox order', () => {
    const inbox = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Task[];
    expect(inboxSortQueue(inbox, new Set(['b'])).map(t => t.id)).toEqual(['a', 'c']);
  });
});
