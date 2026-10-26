import type { BusyEvent } from '../utils/calendarBusy';
import { layoutAllDay } from '../utils/allDaySpans';

function allDay(id: string, title: string, start = '2026-10-25T00:00:00.000Z'): BusyEvent {
  return {
    id,
    title,
    start,
    end: start,
    allDay: true,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
  };
}

describe('layoutAllDay', () => {
  const enrollment = allDay('enroll', 'Open Enrollment');
  const focus = allDay('focus', 'Focus Week 6', '2026-10-26T00:00:00.000Z');

  it('draws an event on every day as one bar across them', () => {
    const { rows, hidden } = layoutAllDay([[enrollment], [enrollment], [enrollment]], 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([{ event: enrollment, startColumn: 0, span: 3 }]);
    expect(hidden).toEqual([0, 0, 0]);
  });

  it('puts the longer bar first and the shorter one beneath it', () => {
    const { rows } = layoutAllDay([[enrollment], [enrollment, focus], [enrollment, focus]], 2);
    expect(rows[0].map(b => [b.event.id, b.startColumn, b.span])).toEqual([['enroll', 0, 3]]);
    expect(rows[1].map(b => [b.event.id, b.startColumn, b.span])).toEqual([['focus', 1, 2]]);
  });

  it('keeps one bar per run of days, not one per event', () => {
    const { rows } = layoutAllDay([[enrollment], [], [enrollment]], 2);
    expect(rows[0].map(b => [b.startColumn, b.span])).toEqual([[0, 1], [2, 1]]);
  });

  it('shares a row between bars that cover different days', () => {
    const a = allDay('a', 'A');
    const b = allDay('b', 'B');
    const { rows } = layoutAllDay([[a], [b], []], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].map(bar => bar.event.id)).toEqual(['a', 'b']);
  });

  it('counts what does not fit against each day it would have covered', () => {
    const a = allDay('a', 'A');
    const b = allDay('b', 'B');
    const c = allDay('c', 'C');
    const { rows, hidden } = layoutAllDay([[a, b, c], [a, b], [a]], 2);
    expect(rows).toHaveLength(2);
    expect(hidden).toEqual([1, 0, 0]);
  });

  it('treats the same id on another date as another event', () => {
    const next = allDay('enroll', 'Open Enrollment', '2026-10-27T00:00:00.000Z');
    const { rows } = layoutAllDay([[enrollment], [enrollment], [next]], 2);
    expect(rows[0].map(b => [b.startColumn, b.span])).toEqual([[0, 2], [2, 1]]);
  });

  it('answers an empty strip', () => {
    expect(layoutAllDay([[], [], []], 2)).toEqual({ rows: [], hidden: [0, 0, 0] });
  });
});
