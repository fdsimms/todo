import {
  EVENT_TASK_LINK_GRACE_DAYS,
  anchorsForEvent,
  eventTaskKey,
  movedLinkedEvents,
  movedEventNote,
  parseEventTaskLinks,
  pruneStaleEventTaskLinks,
  rekeyEventTasks,
  tasksForEvent,
  withEventTasks,
} from '../utils/eventTaskLinks';
import type { BusyEvent } from '../utils/calendarBusy';

// eventPeople reaches calendarHistory, which reaches dateUtils and the
// settings store. Same stub eventPeople's own tests use.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

const at = (d: number, h: number) => new Date(2026, 8, d, h).toISOString();

function event(over: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'e1',
    title: 'Dinner',
    start: at(26, 18),
    end: at(26, 20),
    allDay: false,
    calendarId: 'cal',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...over,
  };
}

const windowStart = new Date(2026, 8, 25);
const windowEnd = new Date(2026, 9, 9);

describe('withEventTasks / tasksForEvent', () => {
  it('records tasks against one occurrence, adding without repeats', () => {
    let links = withEventTasks({}, event(), ['t1']);
    links = withEventTasks(links, event(), ['t1', 't2']);
    expect(tasksForEvent(links, event())).toEqual(['t1', 't2']);
    expect(tasksForEvent(links, event({ start: at(27, 18) }))).toEqual([]);
  });

  it('adds nothing for an empty list', () => {
    expect(withEventTasks({}, event(), [])).toEqual({});
  });
});

describe('rekeyEventTasks', () => {
  it('moves the tasks onto where the event now sits', () => {
    const links = withEventTasks({}, event(), ['t1']);
    const moved = event({ start: at(28, 18), end: at(28, 20) });
    const next = rekeyEventTasks(links, eventTaskKey(event()), moved);
    expect(tasksForEvent(next, event())).toEqual([]);
    expect(tasksForEvent(next, moved)).toEqual(['t1']);
  });

  it('leaves the record alone for an unknown key', () => {
    const links = withEventTasks({}, event(), ['t1']);
    expect(rekeyEventTasks(links, 'nope', event())).toEqual(links);
  });
});

describe('movedLinkedEvents', () => {
  const links = withEventTasks({}, event(), ['t1']);

  it('finds an event whose only occurrence now has a different start', () => {
    const moved = event({ start: at(28, 18), end: at(28, 20) });
    const out = movedLinkedEvents(links, [moved], windowStart, windowEnd);
    expect(out).toHaveLength(1);
    expect(out[0].event).toBe(moved);
  });

  it('says nothing while the event is still where it was', () => {
    expect(movedLinkedEvents(links, [event()], windowStart, windowEnd)).toEqual([]);
  });

  it('refuses a series: two occurrences of the id means no guess', () => {
    const a = event({ start: at(28, 18), end: at(28, 20) });
    const b = event({ start: at(5, 18), end: at(5, 20) });
    expect(movedLinkedEvents(links, [a, b], windowStart, windowEnd)).toEqual([]);
  });

  it('says nothing when the event is gone entirely', () => {
    expect(movedLinkedEvents(links, [], windowStart, windowEnd)).toEqual([]);
  });

  it('ignores a cancelled occurrence', () => {
    const moved = event({ start: at(28, 18), end: at(28, 20), status: 'canceled' });
    expect(movedLinkedEvents(links, [moved], windowStart, windowEnd)).toEqual([]);
  });

  it('says nothing when the old start is outside the window, so its absence means nothing', () => {
    const past = withEventTasks({}, event({ start: at(20, 18), end: at(20, 20) }), ['t1']);
    const later = event({ start: at(28, 18), end: at(28, 20) });
    expect(movedLinkedEvents(past, [later], windowStart, windowEnd)).toEqual([]);
  });
});

describe('pruneStaleEventTaskLinks', () => {
  it(`keeps a link for ${EVENT_TASK_LINK_GRACE_DAYS} days past the event, then drops it`, () => {
    const links = withEventTasks({}, event(), ['t1']);
    expect(pruneStaleEventTaskLinks(links, new Date(2026, 8, 30))).toEqual(links);
    expect(pruneStaleEventTaskLinks(links, new Date(2026, 9, 10))).toEqual({});
  });
});

describe('parseEventTaskLinks', () => {
  it('reads back what was written', () => {
    const links = withEventTasks({}, event(), ['t1']);
    expect(parseEventTaskLinks(JSON.stringify(links))).toEqual(links);
  });

  it('treats malformed data as nothing', () => {
    expect(parseEventTaskLinks(null)).toEqual({});
    expect(parseEventTaskLinks('{')).toEqual({});
    expect(parseEventTaskLinks('[]')).toEqual({});
    expect(parseEventTaskLinks(JSON.stringify({ k: { eventId: 'e1' } }))).toEqual({});
  });
});

describe('anchorsForEvent', () => {
  it('anchors a timed event on its start and end', () => {
    const { start, end } = anchorsForEvent(event());
    expect(start).toEqual(new Date(2026, 8, 26, 18));
    expect(end!.getDate()).toBe(26);
  });

  it("reads an all-day event's last day before its exclusive end", () => {
    const allDay = event({ allDay: true, start: new Date(2026, 8, 26).toISOString(), end: new Date(2026, 8, 28).toISOString() });
    const { start, end } = anchorsForEvent(allDay);
    expect(start!.getDate()).toBe(26);
    expect(end!.getDate()).toBe(27);
  });
});

describe('movedEventNote', () => {
  const links = withEventTasks({}, event(), ['t1', 't2']);
  const [moved] = movedLinkedEvents(links, [event({ start: at(28, 18), end: at(28, 20) })], windowStart, windowEnd);

  it('counts the planned tasks that still exist', () => {
    expect(movedEventNote(moved, new Set(['t1', 't2']))).toBe('Moved, 2 tasks');
    expect(movedEventNote(moved, new Set(['t1']))).toBe('Moved, 1 task');
  });

  it('says nothing once none are left', () => {
    expect(movedEventNote(moved, new Set())).toBeNull();
  });
});
