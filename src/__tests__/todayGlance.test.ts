import { DAY_TIMELINE_MIN_HOURS, dayTimeline } from '../utils/todayGlance';

describe('dayTimeline', () => {
  const now = new Date(2026, 10, 22, 14, 20);
  const dayEnd = new Date(2026, 10, 23, 0, 0);
  const at = (h: number, m = 0, day = 22) => new Date(2026, 10, day, h, m);

  it('runs from the hour now is in, for at least the minimum, when the day is quiet', () => {
    const hours = dayTimeline([], now, dayEnd);
    expect(hours).toHaveLength(DAY_TIMELINE_MIN_HOURS);
    expect(hours[0].start).toEqual(at(14));
    expect(hours[5].start).toEqual(at(19));
  });

  it('runs on to the last hour something starts in', () => {
    const hours = dayTimeline([{ key: 'late', title: 'Call', kind: 'event', at: at(22, 30) }], now, dayEnd);
    expect(hours[hours.length - 1].start).toEqual(at(22));
    expect(hours[hours.length - 1].entries.map(e => e.key)).toEqual(['late']);
  });

  it('puts each entry in the hour it starts in, in time order', () => {
    const hours = dayTimeline([
      { key: 'b', title: 'B', kind: 'task', at: at(15, 40) },
      { key: 'a', title: 'A', kind: 'event', at: at(15, 5) },
    ], now, dayEnd);
    expect(hours[1].entries.map(e => e.key)).toEqual(['a', 'b']);
  });

  it('shows an event already under way in the current hour', () => {
    const hours = dayTimeline([{ key: 'on', title: 'Meeting', kind: 'event', at: at(13, 30) }], now, dayEnd);
    expect(hours[0].entries.map(e => e.key)).toEqual(['on']);
  });

  it('stops at the day’s end, keeping the small hours of a day that runs past midnight', () => {
    const lateEnd = new Date(2026, 10, 23, 4, 0);
    const hours = dayTimeline([
      { key: 'night', title: 'Night', kind: 'task', at: at(1, 15, 23) },
      { key: 'tomorrow', title: 'Tomorrow', kind: 'task', at: at(5, 0, 23) },
    ], new Date(2026, 10, 22, 23, 10), lateEnd);
    expect(hours).toHaveLength(5);
    expect(hours[2].entries.map(e => e.key)).toEqual(['night']);
    expect(hours.flatMap(h => h.entries).map(e => e.key)).not.toContain('tomorrow');
  });
});
