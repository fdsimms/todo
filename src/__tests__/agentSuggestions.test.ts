import {
  describeSuggestion,
  eventWhen,
  liveSuggestions,
  planTaskSuggestion,
  SUGGESTION_NO_DEADLINE_REASON,
  SUGGESTION_TASK_DONE_REASON,
  SUGGESTION_TASK_GONE_REASON,
  SUGGESTION_TIME_PASSED_REASON,
} from '../utils/agentSuggestions';
import { planCalendarRequestDrain, suggestionIsStale } from '../utils/calendarRequests';
import type { CalendarRequest, Task } from '../types';

// dateUtils reads the 12/24-hour setting off the store, which reaches SQLite.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ use24HourTime: false, dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const NOW = new Date(2026, 9, 22, 12);

const request = (over: Partial<CalendarRequest> = {}): CalendarRequest => ({
  id: 'r1',
  title: 'Dentist cleaning',
  startAt: new Date(2026, 9, 29, 15).toISOString(),
  endAt: new Date(2026, 9, 29, 16).toISOString(),
  allDay: false,
  location: 'Brightside Dental',
  notes: null,
  status: 'proposed',
  failureReason: null,
  eventExternalId: null,
  resolvedAt: null,
  createdAt: new Date(2026, 9, 22, 9).toISOString(),
  ...over,
});

const alarm = (over: Partial<CalendarRequest> = {}): CalendarRequest => request({
  kind: 'task_alarm', taskId: 't1', title: 'Take out recycling',
  startAt: new Date(0).toISOString(), endAt: new Date(0).toISOString(), location: null,
  payload: { alarmAt: new Date(2026, 9, 27, 7, 30).toISOString(), ringKind: 'alarm' },
  ...over,
});

const deadline = (over: Partial<CalendarRequest> = {}): CalendarRequest => request({
  kind: 'task_deadline', taskId: 't1', title: 'File taxes',
  startAt: new Date(0).toISOString(), endAt: new Date(0).toISOString(), location: null,
  ...over,
});

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'File taxes', completed: false, archived: false, deadline: new Date(2026, 3, 15, 12).toISOString(), deadlineOnCalendar: false, ...over }) as Task;

const ctx = (over = {}) => ({ now: NOW, deadlineCalendarId: 'cal-1', alarmKitAvailable: true, ...over });

describe('liveSuggestions', () => {
  it('keeps only proposals, oldest first', () => {
    const rows = [
      request({ id: 'b', createdAt: new Date(2026, 9, 22, 10).toISOString() }),
      request({ id: 'a', createdAt: new Date(2026, 9, 22, 8).toISOString() }),
      request({ id: 'c', status: 'pending' }),
      request({ id: 'd', status: 'cancelled' }),
    ];
    expect(liveSuggestions(rows, NOW).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('drops an event that is already over and an alarm time that has passed', () => {
    const over = request({ id: 'over', endAt: new Date(2026, 9, 22, 11).toISOString() });
    const late = alarm({ id: 'late', payload: { alarmAt: new Date(2026, 9, 22, 8).toISOString() } });
    expect(liveSuggestions([over, late, deadline({ id: 'ok' })], NOW).map(r => r.id)).toEqual(['ok']);
  });

  it('drops one nobody answered for a month, but never reads a change by its epoch times', () => {
    const old = deadline({ createdAt: new Date(2026, 8, 1).toISOString() });
    expect(suggestionIsStale(old, NOW)).toBe(true);
    const change = request({ action: 'delete', startAt: new Date(0).toISOString(), endAt: new Date(0).toISOString() });
    expect(suggestionIsStale(change, NOW)).toBe(false);
  });
});

describe('the drain and a proposal', () => {
  it('neither writes nor changes a proposal, and expires one whose moment has gone', () => {
    const waiting = request({ id: 'w' });
    const over = request({ id: 'o', endAt: new Date(2026, 9, 22, 11).toISOString() });
    const change = request({ id: 'c', action: 'update', startAt: new Date(0).toISOString(), endAt: new Date(0).toISOString() });
    const plan = planCalendarRequestDrain([waiting, over, change, alarm({ id: 'a' })], NOW);
    expect(plan.write).toEqual([]);
    expect(plan.change).toEqual([]);
    expect(plan.expire.map(r => r.id)).toEqual(['o']);
  });

  it('writes an approved one like any pending request', () => {
    expect(planCalendarRequestDrain([request({ status: 'pending' })], NOW).write).toHaveLength(1);
  });

  it('never writes a task kind, even one left pending', () => {
    expect(planCalendarRequestDrain([alarm({ status: 'pending' })], NOW).write).toEqual([]);
  });
});

describe('describeSuggestion', () => {
  const base = (t?: Task) => ({ requests: [] as CalendarRequest[], taskById: () => t, use24Hour: false, alarmKitAvailable: true });

  it('says when and where an event is', () => {
    const card = describeSuggestion(request(), base());
    expect(card).toMatchObject({ icon: 'calendar-outline', title: 'Dentist cleaning', primaryLabel: 'Add to calendar' });
    expect(card.lines).toEqual(['Thu, Oct 29 · 3:00 PM to 4:00 PM', 'Brightside Dental']);
  });

  it('reads an all-day span with its last day inclusive', () => {
    expect(eventWhen({ startAt: new Date(2026, 9, 29).toISOString(), endAt: new Date(2026, 9, 30).toISOString(), allDay: true }, false)).toBe('Thu, Oct 29 · all day');
    expect(eventWhen({ startAt: new Date(2026, 9, 29).toISOString(), endAt: new Date(2026, 10, 2).toISOString(), allDay: true }, false)).toBe('Thu, Oct 29 to Sun, Nov 1 · all day');
  });

  it('names the event a change or removal is about', () => {
    const target = request({ id: 'target', status: 'written' });
    const remove = request({ id: 'x', action: 'delete', targetRequestId: 'target', title: 'Dentist cleaning' });
    const card = describeSuggestion(remove, { ...base(), requests: [target] });
    expect(card).toMatchObject({ title: 'Remove “Dentist cleaning”', primaryLabel: 'Remove from calendar' });
    const edit = request({ id: 'y', action: 'update', targetRequestId: 'target', changes: { title: 'Dentist (moved)' } });
    expect(describeSuggestion(edit, { ...base(), requests: [target] }).lines).toEqual(['New name: Dentist (moved)']);
  });

  it('describes a deadline from the task as it is now', () => {
    const card = describeSuggestion(deadline(), base(task()));
    expect(card).toMatchObject({ icon: 'flag-outline', primaryLabel: 'Add to calendar' });
    expect(card.lines).toEqual(['Due Apr 15 · all-day event']);
    expect(describeSuggestion(deadline(), base(task({ deadlineTime: '17:00' }))).lines).toEqual(['Due Apr 15 at 5:00 PM']);
  });

  it('calls an alarm an alarm only where one can ring, and a reminder elsewhere', () => {
    const recycling = task({ title: 'Take out recycling' });
    expect(describeSuggestion(alarm(), base(recycling))).toMatchObject({ title: 'Alarm for “Take out recycling”', primaryLabel: 'Set alarm' });
    const fallback = describeSuggestion(alarm(), { ...base(recycling), alarmKitAvailable: false });
    expect(fallback).toMatchObject({ title: 'Reminder for “Take out recycling”', primaryLabel: 'Set reminder' });
    const repeating = alarm({ payload: { alarmAt: new Date(2026, 9, 27, 7, 30).toISOString(), ringKind: 'persistent' } });
    expect(describeSuggestion(repeating, base(task())).lines).toContain('Repeats until you finish the task');
    expect(describeSuggestion(repeating, { ...base(task()), alarmKitAvailable: false }).lines).not.toContain('Repeats until you finish the task');
  });
});

describe('planTaskSuggestion', () => {
  it('fails for a task that is gone or finished', () => {
    expect(planTaskSuggestion(deadline(), undefined, ctx())).toEqual({ kind: 'fail', reason: SUGGESTION_TASK_GONE_REASON });
    expect(planTaskSuggestion(deadline(), task({ completed: true }), ctx())).toEqual({ kind: 'fail', reason: SUGGESTION_TASK_DONE_REASON });
    expect(planTaskSuggestion(deadline(), task({ archived: true }), ctx())).toEqual({ kind: 'fail', reason: SUGGESTION_TASK_DONE_REASON });
  });

  it('puts a deadline on the calendar through the same field the editor sets', () => {
    expect(planTaskSuggestion(deadline(), task(), ctx())).toEqual({ kind: 'apply', patch: { deadlineOnCalendar: true } });
  });

  it('asks for a calendar first when none is picked, and does nothing if the deadline is already there', () => {
    expect(planTaskSuggestion(deadline(), task(), ctx({ deadlineCalendarId: null }))).toEqual({ kind: 'needsCalendar' });
    expect(planTaskSuggestion(deadline(), task({ deadlineOnCalendar: true }), ctx())).toEqual({ kind: 'already' });
  });

  it('fails a deadline suggestion once the deadline is gone', () => {
    expect(planTaskSuggestion(deadline(), task({ deadline: null }), ctx())).toEqual({ kind: 'fail', reason: SUGGESTION_NO_DEADLINE_REASON });
  });

  it('writes the reminder the way the editor does, replacing a rule', () => {
    const plan = planTaskSuggestion(alarm(), task(), ctx());
    const at = new Date(2026, 9, 27, 7, 30);
    expect(plan).toEqual({
      kind: 'apply',
      patch: {
        reminderTime: at.toISOString(), reminderKind: 'alarm', reminderUtcOffsetMinutes: at.getTimezoneOffset(),
        reminderTimeAnchor: 'wallClock', reminderOffsetDays: null, reminderTracksVisibility: false,
      },
    });
  });

  it('keeps a repeating alarm, and falls back to a notification where alarms are unavailable', () => {
    const repeating = alarm({ payload: { alarmAt: new Date(2026, 9, 27, 7, 30).toISOString(), ringKind: 'persistent' } });
    expect(planTaskSuggestion(repeating, task(), ctx())).toMatchObject({ patch: { reminderKind: 'persistent' } });
    expect(planTaskSuggestion(repeating, task(), ctx({ alarmKitAvailable: false }))).toMatchObject({ patch: { reminderKind: 'notification' } });
  });

  it('refuses an alarm time that passed while the card sat there', () => {
    expect(planTaskSuggestion(alarm(), task(), ctx({ now: new Date(2026, 9, 28) }))).toEqual({ kind: 'fail', reason: SUGGESTION_TIME_PASSED_REASON });
  });
});
