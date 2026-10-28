import { glanceEvents } from '../utils/todayGlance';
import type { BusyEvent } from '../utils/calendarBusy';

const event = (id: string, start: string, end: string, extra: Partial<BusyEvent> = {}): BusyEvent => ({
  id,
  title: `Event ${id}`,
  start,
  end,
  allDay: false,
  calendarId: 'cal',
  location: null,
  status: 'confirmed',
  availability: 'busy',
  ...extra,
});

const NOW = new Date(2026, 9, 28, 11, 0);
const at = (hour: number, minute = 0) => new Date(2026, 9, 28, hour, minute).toISOString();
const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const none = () => false;

describe('glanceEvents', () => {
  it('lists what is still ahead, in the order given, with its start time', () => {
    const list = glanceEvents([event('a', at(13), at(14)), event('b', at(15, 30), at(16))], NOW, none, clock);
    expect(list.map(e => [e.title, e.time])).toEqual([['Event a', '13:00'], ['Event b', '15:30']]);
  });

  it('keeps one that is on now and drops one that has ended', () => {
    const list = glanceEvents([event('over', at(9), at(10)), event('now', at(10, 30), at(11, 30))], NOW, none, clock);
    expect(list.map(e => e.title)).toEqual(['Event now']);
  });

  it('drops one that ends at this very minute', () => {
    expect(glanceEvents([event('edge', at(10), at(11))], NOW, none, clock)).toEqual([]);
  });

  it('keeps an all-day event, and says so instead of giving a clock time', () => {
    const allDay = event('d', at(0), at(0), { allDay: true });
    expect(glanceEvents([allDay], NOW, none, clock)).toEqual([{ key: `d-${at(0)}`, title: 'Event d', time: 'All day' }]);
  });

  it('leaves out an event the person hid from Today', () => {
    const list = glanceEvents([event('a', at(13), at(14)), event('b', at(15), at(16))], NOW, e => e.id === 'a', clock);
    expect(list.map(e => e.title)).toEqual(['Event b']);
  });

  it('stops at the limit, counting only what is shown', () => {
    const many = ['a', 'b', 'c', 'd'].map((id, i) => event(id, at(12 + i), at(13 + i)));
    const list = glanceEvents([event('hidden', at(11, 30), at(12)), ...many], NOW, e => e.id === 'hidden', clock, 3);
    expect(list.map(e => e.title)).toEqual(['Event a', 'Event b', 'Event c']);
  });

  it('gives two occurrences of one repeating event different keys', () => {
    const list = glanceEvents([event('r', at(12), at(13)), event('r', at(15), at(16))], NOW, none, clock);
    expect(new Set(list.map(e => e.key)).size).toBe(2);
  });

  it('is empty for no events', () => {
    expect(glanceEvents([], NOW, none, clock)).toEqual([]);
  });
});
