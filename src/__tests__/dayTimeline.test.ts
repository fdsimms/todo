import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  buildDayTimeline,
  clockToDayMinutes,
  instantToDayMinutes,
  MINUTES_IN_DAY,
} from '../utils/dayTimeline';

// A local minimum rather than a shared fixture, same as timeBlock.test.ts.
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Write the report',
    completed: false,
    archived: false,
    parentId: null,
    windowStart: null,
    windowEnd: null,
    reminderTime: null,
    estimatedMinutes: null,
    effort: 0,
    timeBlockEventId: null,
    dueDate: null,
    chainEnabled: false,
    chainItems: [],
    chainIndex: 0,
    ...overrides,
  } as unknown as Task;
}

function makeEvent(start: string, end: string, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: `e-${start}`,
    title: 'Standup',
    start,
    end,
    allDay: false,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

const MIDNIGHT = new Date(2026, 8, 15, 0, 0);
const FOUR_AM = new Date(2026, 8, 15, 4, 0);
const at = (h: number, m = 0) => new Date(2026, 8, 15, h, m).toISOString();

describe('clockToDayMinutes', () => {
  it('measures from the day start, not from midnight', () => {
    expect(clockToDayMinutes('09:00', MIDNIGHT)).toBe(9 * 60);
    expect(clockToDayMinutes('09:00', FOUR_AM)).toBe(5 * 60);
  });

  // The whole reason the origin is the day start: under a 4am reset, 2am is
  // the far end of the logical day rather than the beginning of it.
  it('wraps a clock time earlier than the reset to the end of the day', () => {
    expect(clockToDayMinutes('02:00', FOUR_AM)).toBe(22 * 60);
    expect(clockToDayMinutes('00:00', FOUR_AM)).toBe(20 * 60);
  });
});

describe('instantToDayMinutes', () => {
  it('places an instant inside the day and refuses one outside it', () => {
    expect(instantToDayMinutes(at(9, 30), MIDNIGHT)).toBe(9 * 60 + 30);
    expect(instantToDayMinutes(at(2), FOUR_AM)).toBeNull();
    expect(instantToDayMinutes(new Date(2026, 8, 16, 5).toISOString(), FOUR_AM)).toBeNull();
  });
});

describe('buildDayTimeline placement', () => {
  it('places a task at its own window, using both ends the user typed', () => {
    const task = makeTask({ windowStart: '09:00', windowEnd: '11:00' });
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ startMinutes: 540, endMinutes: 660, instant: false });
  });

  // effectiveWindowEndTime's rule: a window that doesn't close on its own day
  // is open-ended, not inverted, so it must not produce a negative block.
  it('treats a window running into the small hours as open-ended', () => {
    const task = makeTask({ windowStart: '22:00', windowEnd: '02:00', estimatedMinutes: 30 });
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries[0].startMinutes).toBe(22 * 60);
    expect(entries[0].endMinutes).toBe(22 * 60 + 30);
    expect(entries[0].endMinutes).toBeGreaterThan(entries[0].startMinutes);
  });

  it('places a task at its reminder when it has no window', () => {
    const task = makeTask({ reminderTime: at(14, 15), estimatedMinutes: 45 });
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries[0]).toMatchObject({ startMinutes: 855, endMinutes: 900, instant: false });
  });

  // "No length means no height."
  it('draws a placed task with no estimate as an instant, not a block', () => {
    const task = makeTask({ reminderTime: at(14), estimatedMinutes: null, effort: 0 });
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries[0].instant).toBe(true);
    expect(entries[0].endMinutes).toBe(entries[0].startMinutes);
  });

  it('reads the live chain step for the length, not the whole chain', () => {
    const task = makeTask({
      reminderTime: at(9),
      estimatedMinutes: 120,
      chainEnabled: true,
      chainIndex: 0,
      chainItems: [{ title: 'Step one', estimatedMinutes: 15 }, { title: 'Step two' }],
    } as Partial<Task>);
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries[0].endMinutes - entries[0].startMinutes).toBe(15);
  });

  // "No time means no position."
  it('sends a task with nothing saying when to unplaced', () => {
    const task = makeTask({ estimatedMinutes: 30 });
    const { entries, unplaced } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries).toHaveLength(0);
    expect(unplaced.map(t => t.id)).toEqual(['t1']);
  });

  // A dueDate is stored at local noon and means a day. Reading its clock would
  // put every task at midday and call that a plan.
  it('never places a task from its due date alone', () => {
    const task = makeTask({ dueDate: at(12) });
    const { entries, unplaced } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries).toHaveLength(0);
    expect(unplaced).toHaveLength(1);
  });

  it('sends a reminder that falls on another day to unplaced', () => {
    const task = makeTask({ reminderTime: new Date(2026, 8, 16, 9).toISOString() });
    const { unplaced } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(unplaced).toHaveLength(1);
  });
});

describe('buildDayTimeline events', () => {
  it('keeps all-day events off the axis entirely', () => {
    const allDay = makeEvent(at(0), at(0), { id: 'e-allday', allDay: true, title: 'Bank holiday' });
    const { entries, allDay: band } = buildDayTimeline({
      dayStart: MIDNIGHT, tasks: [], events: [allDay, makeEvent(at(10), at(11))],
    });
    expect(band.map(e => e.id)).toEqual(['e-allday']);
    expect(entries.map(e => e.kind)).toEqual(['event']);
  });

  it('clamps an event that runs past the end of the day rather than dropping it', () => {
    const late = makeEvent(at(23), new Date(2026, 8, 16, 1).toISOString());
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [], events: [late] });
    expect(entries[0].startMinutes).toBe(23 * 60);
    expect(entries[0].endMinutes).toBe(MINUTES_IN_DAY);
  });

  // The mirror of the case above, and the one that used to be dropped outright:
  // `eventsIn` selects by overlap, so a night shift reaches this builder, and
  // skipping it drew the morning it covers as free.
  it('clamps an event that began before the day rather than dropping it', () => {
    const overnight = makeEvent(
      new Date(2026, 8, 14, 22).toISOString(),
      at(6),
      { id: 'e-night', title: 'Night shift' },
    );
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [], events: [overnight] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ eventId: 'e-night', startMinutes: 0, endMinutes: 6 * 60 });
    expect(entries[0].instant).toBe(false);
  });

  it('clamps an event that straddles the day at both ends', () => {
    const through = makeEvent(
      new Date(2026, 8, 14, 20).toISOString(),
      new Date(2026, 8, 16, 3).toISOString(),
      { id: 'e-through' },
    );
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [], events: [through] });
    expect(entries[0]).toMatchObject({ startMinutes: 0, endMinutes: MINUTES_IN_DAY });
  });

  // Under a 04:00 reset, "the day" runs 04:00–04:00, so yesterday's evening is
  // genuinely before this day starts and gets the same clamp.
  it('clamps against the logical day start, not midnight', () => {
    const early = makeEvent(at(2), at(6), { id: 'e-early' });
    const { entries } = buildDayTimeline({ dayStart: FOUR_AM, tasks: [], events: [early] });
    expect(entries[0]).toMatchObject({ startMinutes: 0, endMinutes: 2 * 60 });
  });

  it('leaves out an event that finished before the day began', () => {
    const yesterday = makeEvent(
      new Date(2026, 8, 14, 9).toISOString(),
      new Date(2026, 8, 14, 10).toISOString(),
      { id: 'e-yesterday' },
    );
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [], events: [yesterday] });
    expect(entries).toEqual([]);
  });

  // Without this it failed the `end > start` test and fell through to the
  // trailing clamp, drawing a mark on the axis as a block to midnight.
  it('draws a zero-length event as an instant, not a block to midnight', () => {
    const mark = makeEvent(at(10), at(10), { id: 'e-mark', title: 'Renewal date' });
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [], events: [mark] });
    expect(entries[0]).toMatchObject({ startMinutes: 600, endMinutes: 600, instant: true });
  });

  // The event owns the time and the task is the actionable half, so a blocked
  // out task is one entry, not two.
  it('draws a time-blocked task once, at the event hours', () => {
    const event = makeEvent(at(13), at(14), { id: 'blk-1', title: 'Write the report' });
    const task = makeTask({ timeBlockEventId: 'blk-1' });
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [event] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'task', taskId: 't1', eventId: 'blk-1', startMinutes: 780, endMinutes: 840 });
  });

  it('still places the task when its block event is outside the loaded window', () => {
    const task = makeTask({ timeBlockEventId: 'missing', windowStart: '09:00', windowEnd: '10:00' });
    const { entries } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [task], events: [] });
    expect(entries[0]).toMatchObject({ startMinutes: 540, endMinutes: 600, eventId: null });
  });
});

describe('buildDayTimeline lanes', () => {
  it('gives overlapping entries their own column', () => {
    const { entries } = buildDayTimeline({
      dayStart: MIDNIGHT,
      tasks: [],
      events: [
        makeEvent(at(9), at(11), { id: 'a' }),
        makeEvent(at(10), at(12), { id: 'b' }),
      ],
    });
    expect(entries.map(e => e.lane)).toEqual([0, 1]);
    expect(entries.every(e => e.laneCount === 2)).toBe(true);
  });

  it('reuses a column once the earlier entry has finished', () => {
    const { entries } = buildDayTimeline({
      dayStart: MIDNIGHT,
      tasks: [],
      events: [
        makeEvent(at(9), at(10), { id: 'a' }),
        makeEvent(at(10), at(11), { id: 'b' }),
      ],
    });
    expect(entries.map(e => e.lane)).toEqual([0, 0]);
    expect(entries.map(e => e.laneCount)).toEqual([1, 1]);
  });

  it('sets an instant beside the block it lands inside, not on top of it', () => {
    const { entries } = buildDayTimeline({
      dayStart: MIDNIGHT,
      tasks: [makeTask({ reminderTime: at(10) })],
      events: [makeEvent(at(9), at(11), { id: 'a' })],
    });
    const lanes = entries.map(e => e.lane).sort();
    expect(lanes).toEqual([0, 1]);
  });
});

describe('buildDayTimeline span', () => {
  it('draws a sensible default span for an empty day', () => {
    const { firstMinute, lastMinute } = buildDayTimeline({ dayStart: MIDNIGHT, tasks: [], events: [] });
    expect(firstMinute).toBe(8 * 60);
    expect(lastMinute).toBe(22 * 60);
  });

  it('widens to the hour around anything outside the default span', () => {
    const { firstMinute, lastMinute } = buildDayTimeline({
      dayStart: MIDNIGHT,
      tasks: [],
      events: [makeEvent(at(6, 30), at(7)), makeEvent(at(23), at(23, 30))],
    });
    expect(firstMinute).toBe(6 * 60);
    expect(lastMinute).toBe(MINUTES_IN_DAY);
  });
});
