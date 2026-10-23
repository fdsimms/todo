import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import { buildWidgetCalendar, MAX_WIDGET_CALENDAR_EVENTS } from '../utils/widgetCalendar';

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
    category: null,
    chainEnabled: false,
    chainItems: [],
    chainIndex: 0,
    ...overrides,
  } as unknown as Task;
}

function makeEvent(start: Date, end: Date, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: `e-${start.toISOString()}`,
    title: 'Standup',
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    calendarId: 'work',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

const today = new Date(2026, 9, 23);
const tomorrow = new Date(2026, 9, 24);
const dayAfter = new Date(2026, 9, 25);
const at = (day: Date, h: number, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);

const days = (todayTasks: Task[] = [], tomorrowTasks: Task[] = []) => [
  { key: '2026-10-23', start: today, end: tomorrow, tasks: todayTasks },
  { key: '2026-10-24', start: tomorrow, end: dayAfter, tasks: tomorrowTasks },
];

describe('buildWidgetCalendar', () => {
  it('carries the read calendars and only their colors', () => {
    const calendar = buildWidgetCalendar({
      days: days(),
      events: [],
      calendarIds: ['work', 'home', 'blank'],
      calendarsById: { work: { color: '#039BE5' }, home: { color: '#33B679' }, blank: { color: '' }, other: { color: '#000000' } },
      hidden: [],
    });
    expect(calendar.calendarIds).toEqual(['work', 'home', 'blank']);
    expect(calendar.colors).toEqual({ work: '#039BE5', home: '#33B679' });
  });

  it('places each day\'s timed tasks as instants and counts the rest', () => {
    const calendar = buildWidgetCalendar({
      days: days(
        [
          makeTask({ id: 'call', title: 'Call Mom', windowStart: '17:00', windowEnd: '17:30', category: 'Family' }),
          makeTask({ id: 'ink', title: 'Order ink' }),
          makeTask({ id: 'done', title: 'Done already', completed: true }),
        ],
        [makeTask({ id: 'pack', title: 'Pack car', reminderTime: at(tomorrow, 9).toISOString() })],
      ),
      events: [],
      calendarIds: [],
      calendarsById: {},
      hidden: [],
    });
    const [todayDay, tomorrowDay] = calendar.days;
    expect(todayDay.tasks).toEqual([{
      id: 'call', title: 'Call Mom', start: at(today, 17).toISOString(), end: at(today, 17, 30).toISOString(),
      completed: false, category: 'Family', blockEventId: null,
    }]);
    expect(todayDay.untimed).toBe(1);
    expect(tomorrowDay.tasks.map(t => [t.id, t.start, t.end])).toEqual([['pack', at(tomorrow, 9).toISOString(), null]]);
    expect(todayDay.start).toBe(today.toISOString());
    expect(todayDay.end).toBe(tomorrow.toISOString());
  });

  it('puts a task blocked out on the calendar at its block', () => {
    const block = makeEvent(at(today, 14), at(today, 15), { id: 'block' });
    const calendar = buildWidgetCalendar({
      days: days([makeTask({ id: 'write', timeBlockEventId: 'block' })]),
      events: [block],
      calendarIds: ['work'],
      calendarsById: {},
      hidden: [],
    });
    expect(calendar.days[0].tasks.map(t => [t.start, t.blockEventId])).toEqual([[at(today, 14).toISOString(), 'block']]);
  });

  it('keeps each day\'s own events as the fallback, and none outside the two days', () => {
    const calendar = buildWidgetCalendar({
      days: days(),
      events: [
        makeEvent(at(today, 9), at(today, 10), { id: 'a', title: '  Standup ', location: ' ', videoCall: true }),
        makeEvent(at(tomorrow, 10), at(tomorrow, 11), { id: 'b', location: 'Room 4' }),
        makeEvent(at(dayAfter, 10), at(dayAfter, 11), { id: 'c' }),
        makeEvent(at(today, 12), at(today, 13), { id: 'gone', status: 'canceled' }),
      ],
      calendarIds: ['work'],
      calendarsById: {},
      hidden: [],
    });
    expect(calendar.days.map(d => d.events?.map(e => e.id))).toEqual([['a'], ['b']]);
    expect(calendar.days[0].events?.[0]).toMatchObject({ title: 'Standup', location: null, videoCall: true });
    expect(calendar.days[1].events?.[0].location).toBe('Room 4');
  });

  it('files an all-day event on its date', () => {
    const calendar = buildWidgetCalendar({
      days: days(),
      // As EventKit hands one over: UTC midnight of the date it names, whatever
      // the device's zone (see allDayRangeMs).
      events: [{ ...makeEvent(today, tomorrow, { id: 'bday', allDay: true }), start: '2026-10-24T00:00:00.000Z', end: '2026-10-25T00:00:00.000Z' }],
      calendarIds: ['work'],
      calendarsById: {},
      hidden: [],
    });
    expect(calendar.days.map(d => d.events?.map(e => e.id))).toEqual([[], ['bday']]);
  });

  it('says the calendar wasn\'t read rather than that it was empty', () => {
    const calendar = buildWidgetCalendar({ days: days(), events: null, calendarIds: ['work'], calendarsById: {}, hidden: [] });
    expect(calendar.days.map(d => d.events)).toEqual([null, null]);
  });

  it('caps how many events cross per day', () => {
    const events = Array.from({ length: MAX_WIDGET_CALENDAR_EVENTS + 5 }, (_, i) =>
      makeEvent(at(today, 0, i * 10), at(today, 0, i * 10 + 5), { id: `e${i}` }));
    const calendar = buildWidgetCalendar({ days: days(), events, calendarIds: ['work'], calendarsById: {}, hidden: [] });
    expect(calendar.days[0].events).toHaveLength(MAX_WIDGET_CALENDAR_EVENTS);
  });

  it('passes the hidden occurrences through', () => {
    const hidden = [{ id: 'x', start: at(today, 9).toISOString() }];
    const calendar = buildWidgetCalendar({ days: days(), events: [], calendarIds: [], calendarsById: {}, hidden });
    expect(calendar.hidden).toEqual(hidden);
  });
});
