import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  canTimeBlock,
  proposeTimeBlockStart,
  timeBlockFieldsFor,
  timeBlockUpdateFor,
  type TimeBlockContext,
} from '../utils/timeBlock';

// A local minimum rather than importing a fixture: these tests only care about
// a handful of fields, and the cast keeps the file readable.
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Write the report',
    notes: '',
    completed: false,
    archived: false,
    parentId: null,
    dueDate: null,
    windowStart: null,
    estimatedMinutes: null,
    effort: 0,
    chainEnabled: false,
    chainItems: [],
    chainIndex: 0,
    ...overrides,
  } as unknown as Task;
}

function event(start: string, end: string, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: `e-${start}`,
    title: 'Meeting',
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

/** 2026-08-13 is a Thursday; every test anchors to it. */
function ctx(overrides: Partial<TimeBlockContext> = {}): TimeBlockContext {
  return {
    now: new Date(2026, 7, 13, 8, 0),
    activeHoursStart: '09:00',
    activeHoursEnd: '17:00',
    events: null,
    ...overrides,
  };
}

describe('canTimeBlock', () => {
  it('needs a length to block out', () => {
    expect(canTimeBlock(makeTask())).toBe(false);
    expect(canTimeBlock(makeTask({ estimatedMinutes: 30 }))).toBe(true);
  });

  it('accepts an effort bucket as the length', () => {
    // effort 3 is the canonical 30-minute bucket — a task nobody gave a
    // precise estimate still has a length worth blocking.
    expect(canTimeBlock(makeTask({ effort: 3 }))).toBe(true);
  });

  it('refuses subtasks, completed and archived tasks', () => {
    expect(canTimeBlock(makeTask({ estimatedMinutes: 30, parentId: 'p' }))).toBe(false);
    expect(canTimeBlock(makeTask({ estimatedMinutes: 30, completed: true }))).toBe(false);
    expect(canTimeBlock(makeTask({ estimatedMinutes: 30, archived: true }))).toBe(false);
  });
});

describe('proposeTimeBlockStart', () => {
  it('opens at the start of active hours on an empty future day', () => {
    const task = makeTask({ dueDate: new Date(2026, 7, 20, 12, 0).toISOString() });
    const start = proposeTimeBlockStart(task, 60, ctx());
    expect(start).toEqual(new Date(2026, 7, 20, 9, 0));
  });

  it('honours the task\'s own windowStart over any gap search', () => {
    const task = makeTask({
      dueDate: new Date(2026, 7, 20).toISOString(),
      windowStart: '14:30',
    });
    // A wide-open morning that the gap search would otherwise pick.
    const start = proposeTimeBlockStart(task, 60, ctx({ events: [] }));
    expect(start).toEqual(new Date(2026, 7, 20, 14, 30));
  });

  it('ignores a windowStart that has already passed today', () => {
    const task = makeTask({ windowStart: '07:00' });
    // now is 08:00, so 07:00 is behind us — never propose the past.
    const start = proposeTimeBlockStart(task, 30, ctx());
    expect(start).toEqual(new Date(2026, 7, 13, 9, 0));
  });

  it('takes the first gap long enough to hold the task', () => {
    const events = [
      event(new Date(2026, 7, 13, 9, 0).toISOString(), new Date(2026, 7, 13, 10, 0).toISOString()),
      // A 30-minute crack, then a long afternoon.
      event(new Date(2026, 7, 13, 10, 30).toISOString(), new Date(2026, 7, 13, 12, 0).toISOString()),
    ];
    // 30 minutes fits the crack at 10:00.
    expect(proposeTimeBlockStart(makeTask(), 30, ctx({ events }))).toEqual(
      new Date(2026, 7, 13, 10, 0)
    );
    // 90 minutes does not, so it waits for the noon opening.
    expect(proposeTimeBlockStart(makeTask(), 90, ctx({ events }))).toEqual(
      new Date(2026, 7, 13, 12, 0)
    );
  });

  it('does not guess a free slot when the calendar could not be read', () => {
    const events = [
      event(new Date(2026, 7, 13, 9, 0).toISOString(), new Date(2026, 7, 13, 12, 0).toISOString()),
    ];
    // events: null is "we know nothing" — it must not be treated as an empty
    // day, but it also can't produce a gap, so it falls back to the span start.
    expect(proposeTimeBlockStart(makeTask(), 60, ctx({ events: null }))).toEqual(
      new Date(2026, 7, 13, 9, 0)
    );
    // With the same day actually read, the block lands after the meeting.
    expect(proposeTimeBlockStart(makeTask(), 60, ctx({ events }))).toEqual(
      new Date(2026, 7, 13, 12, 0)
    );
  });

  it('never proposes a time in the past, and rounds now up to a quarter hour', () => {
    const start = proposeTimeBlockStart(
      makeTask(),
      30,
      ctx({ now: new Date(2026, 7, 13, 11, 7) })
    );
    expect(start).toEqual(new Date(2026, 7, 13, 11, 15));
  });

  it('falls back to the rounded-up now once the day\'s active hours are over', () => {
    const start = proposeTimeBlockStart(
      makeTask(),
      30,
      ctx({ now: new Date(2026, 7, 13, 22, 40) })
    );
    expect(start).toEqual(new Date(2026, 7, 13, 22, 45));
  });

  it('still answers when active hours cross midnight', () => {
    const start = proposeTimeBlockStart(
      makeTask(),
      30,
      ctx({ activeHoursStart: '22:00', activeHoursEnd: '02:00' })
    );
    // The span can't resolve on one day; it must not invert into nonsense.
    expect(start).toEqual(new Date(2026, 7, 13, 22, 0));
  });

  it('blocks a dateless task today', () => {
    const start = proposeTimeBlockStart(makeTask({ dueDate: null }), 30, ctx());
    expect(start).toEqual(new Date(2026, 7, 13, 9, 0));
  });
});

describe('timeBlockFieldsFor', () => {
  it('sizes the block from the estimate and names it after the task', () => {
    const task = makeTask({ estimatedMinutes: 45, dueDate: new Date(2026, 7, 20).toISOString() });
    const fields = timeBlockFieldsFor(task, ctx());
    expect(fields).toEqual({
      title: 'Write the report',
      start: new Date(2026, 7, 20, 9, 0),
      end: new Date(2026, 7, 20, 9, 45),
    });
  });

  it('uses the live chain step, not the whole chain', () => {
    const task = makeTask({
      estimatedMinutes: 240,
      chainEnabled: true,
      chainIndex: 1,
      chainItems: [
        { id: 'a', title: 'Draft', estimatedMinutes: 60 },
        { id: 'b', title: 'Review', estimatedMinutes: 20 },
      ],
      dueDate: new Date(2026, 7, 20).toISOString(),
    });
    const fields = timeBlockFieldsFor(task, ctx());
    expect(fields?.title).toBe('Review');
    expect(fields?.end).toEqual(new Date(2026, 7, 20, 9, 20));
  });

  it('returns null for a task that cannot be blocked', () => {
    expect(timeBlockFieldsFor(makeTask(), ctx())).toBeNull();
  });
});

describe('timeBlockUpdateFor', () => {
  const start = new Date(2026, 7, 13, 14, 0);

  it('re-ends the event from wherever the user moved it to', () => {
    const moved = new Date(2026, 7, 15, 10, 0);
    const update = timeBlockUpdateFor(makeTask({ estimatedMinutes: 90 }), {
      title: 'Write the report',
      start: moved,
      end: new Date(2026, 7, 15, 10, 30),
      allDay: false,
    });
    // The start it was dragged to is kept; only the end moves out to 90 min.
    expect(update).toEqual({ title: 'Write the report', endDate: new Date(2026, 7, 15, 11, 30) });
  });

  it('pushes a renamed task onto the event even when the length is unchanged', () => {
    const update = timeBlockUpdateFor(makeTask({ title: 'New name', estimatedMinutes: 30 }), {
      title: 'Old name',
      start,
      end: new Date(2026, 7, 13, 14, 30),
      allDay: false,
    });
    expect(update).toEqual({ title: 'New name', endDate: new Date(2026, 7, 13, 14, 30) });
  });

  it('writes nothing when the event already says this', () => {
    const update = timeBlockUpdateFor(makeTask({ estimatedMinutes: 30 }), {
      title: 'Write the report',
      start,
      end: new Date(2026, 7, 13, 14, 30),
      allDay: false,
    });
    expect(update).toBeNull();
  });

  it('leaves an event the user turned into an all-day one alone', () => {
    const update = timeBlockUpdateFor(makeTask({ title: 'Renamed', estimatedMinutes: 30 }), {
      title: 'Write the report',
      start,
      end: new Date(2026, 7, 14, 14, 0),
      allDay: true,
    });
    expect(update).toBeNull();
  });

  it('has nothing to say once the task has no length', () => {
    const update = timeBlockUpdateFor(makeTask(), {
      title: 'Write the report',
      start,
      end: new Date(2026, 7, 13, 14, 30),
      allDay: false,
    });
    expect(update).toBeNull();
  });
});
