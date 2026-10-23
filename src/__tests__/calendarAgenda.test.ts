import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  AGENDA_GAP_MINUTES,
  buildDayAgenda,
  dayEventColors,
  describeGap,
  describeUntimed,
  summarizeAgenda,
  isAgendaItemPast,
  untimedTargetFor,
} from '../utils/calendarAgenda';

// A local minimum rather than a shared fixture, same as dayTimeline.test.ts.
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

const DAY = new Date(2026, 9, 23, 0, 0);
const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m).toISOString();

describe('buildDayAgenda', () => {
  it('lists events and timed tasks together by start, and only counts the untimed ones', () => {
    const agenda = buildDayAgenda({
      dayStart: DAY,
      events: [makeEvent(at(12, 30), at(13, 30), { id: 'lunch', title: 'Lunch' }), makeEvent(at(9), at(9, 30), { id: 'standup' })],
      tasks: [
        makeTask({ id: 'call', title: 'Call Mom', windowStart: '17:00' }),
        makeTask({ id: 'ink', title: 'Order ink' }),
        makeTask({ id: 'vit', title: 'Vitamins', reminderTime: at(8) }),
      ],
    });
    expect(agenda.items.map(i => i.key)).toEqual(['task:vit', 'event:standup', 'event:lunch', 'task:call']);
    expect(agenda.items[1].event?.id).toBe('standup');
    expect(agenda.items[0].task?.id).toBe('vit');
    expect(agenda.untimed.map(t => t.id)).toEqual(['ink']);
  });

  it('leaves a finished untimed task out of the count', () => {
    const agenda = buildDayAgenda({
      dayStart: DAY,
      events: [],
      tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b', completed: true })],
    });
    expect(agenda.untimed.map(t => t.id)).toEqual(['a']);
  });

  it('keeps all-day events apart from the timed lines', () => {
    const allDay = makeEvent('2026-10-23T00:00:00.000Z', '2026-10-24T00:00:00.000Z', { id: 'bday', allDay: true });
    const agenda = buildDayAgenda({ dayStart: DAY, events: [allDay], tasks: [] });
    expect(agenda.allDay.map(e => e.id)).toEqual(['bday']);
    expect(agenda.items).toEqual([]);
  });

  it('marks a long free stretch between two lines, measured from the latest end so far', () => {
    const agenda = buildDayAgenda({
      dayStart: DAY,
      events: [
        makeEvent(at(9), at(12), { id: 'long' }),
        makeEvent(at(10), at(10, 30), { id: 'inside' }),
        makeEvent(at(13), at(14), { id: 'after' }),
      ],
      tasks: [],
    });
    const gaps = Object.fromEntries(agenda.items.map(i => [i.event?.id, i.gapBefore]));
    // The first line never has one, an event inside a longer one has none,
    // and the next one counts from noon, not from 10:30.
    expect(gaps).toEqual({ long: null, inside: null, after: 60 });
  });

  it('says nothing about a gap shorter than the threshold', () => {
    const agenda = buildDayAgenda({
      dayStart: DAY,
      events: [makeEvent(at(9), at(10), { id: 'a' }), makeEvent(at(10, 59), at(11, 30), { id: 'b' })],
      tasks: [],
    });
    expect(AGENDA_GAP_MINUTES).toBe(60);
    expect(agenda.items[1].gapBefore).toBeNull();
  });

  it('puts the now line after everything that has started', () => {
    const events = [
      makeEvent(at(9), at(10), { id: 'a' }),
      makeEvent(at(14), at(15), { id: 'b' }),
      makeEvent(at(16), at(17), { id: 'c' }),
    ];
    expect(buildDayAgenda({ dayStart: DAY, events, tasks: [], now: new Date(2026, 9, 23, 14, 10) }).nowIndex).toBe(2);
    expect(buildDayAgenda({ dayStart: DAY, events, tasks: [], now: new Date(2026, 9, 23, 8) }).nowIndex).toBe(0);
    expect(buildDayAgenda({ dayStart: DAY, events, tasks: [], now: new Date(2026, 9, 23, 20) }).nowIndex).toBe(3);
  });

  it('has no now line on another day, or with no now given', () => {
    const events = [makeEvent(at(9), at(10))];
    expect(buildDayAgenda({ dayStart: DAY, events, tasks: [], now: new Date(2026, 9, 24, 9) }).nowIndex).toBeNull();
    expect(buildDayAgenda({ dayStart: DAY, events, tasks: [] }).nowIndex).toBeNull();
  });
});

describe('isAgendaItemPast', () => {
  it('compares the end, or the start of a line with no length', () => {
    const agenda = buildDayAgenda({
      dayStart: DAY,
      events: [makeEvent(at(9), at(10))],
      tasks: [makeTask({ reminderTime: at(11) })],
    });
    const [meeting, reminder] = agenda.items;
    expect(isAgendaItemPast(meeting, 9 * 60 + 30)).toBe(false);
    expect(isAgendaItemPast(meeting, 10 * 60)).toBe(true);
    expect(isAgendaItemPast(reminder, 11 * 60)).toBe(true);
  });
});

describe('untimedTargetFor', () => {
  it('sends a day still to come to Later and anything else to Today', () => {
    expect(untimedTargetFor('2026-10-24', '2026-10-23')).toBe('later');
    expect(untimedTargetFor('2026-10-23', '2026-10-23')).toBe('today');
    expect(untimedTargetFor('2026-10-20', '2026-10-23')).toBe('today');
  });
});

describe('describeUntimed', () => {
  it('counts in words', () => {
    expect(describeUntimed(0)).toBe('');
    expect(describeUntimed(1)).toBe('1 task without a time');
    expect(describeUntimed(4)).toBe('4 tasks without a time');
  });
});

describe('dayEventColors', () => {
  it('takes one color per event up to the cap and skips a calendar with none', () => {
    const colors: Record<string, string> = { work: '#039BE5', home: '#33B679' };
    const events = ['work', 'gone', 'home', 'work', 'home'].map((calendarId, i) =>
      makeEvent(at(9 + i), at(10 + i), { id: `e${i}`, calendarId }));
    expect(dayEventColors(events, id => colors[id])).toEqual(['#039BE5', '#33B679', '#039BE5']);
    expect(dayEventColors(events, id => colors[id], 1)).toEqual(['#039BE5']);
  });
});

describe('describeGap', () => {
  it('says hours and minutes', () => {
    expect(describeGap(45)).toBe('45m free');
    expect(describeGap(60)).toBe('1h free');
    expect(describeGap(90)).toBe('1h 30m free');
  });
});

describe('summarizeAgenda', () => {
  it('counts events, all-day ones included, and timed tasks', () => {
    const agenda = buildDayAgenda({
      dayStart: DAY,
      events: [
        makeEvent(at(9), at(10), { id: 'a' }),
        makeEvent('2026-10-23T00:00:00.000Z', '2026-10-24T00:00:00.000Z', { id: 'b', allDay: true }),
      ],
      tasks: [makeTask({ id: 'c', windowStart: '17:00' }), makeTask({ id: 'd' })],
    });
    expect(summarizeAgenda(agenda)).toBe('2 events · 1 task');
  });

  it('is empty for an empty day', () => {
    expect(summarizeAgenda(buildDayAgenda({ dayStart: DAY, events: [], tasks: [] }))).toBe('');
  });
});
