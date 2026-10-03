import { meetingSignature, nudgeReminderPastMeeting } from '../utils/reminderNudge';
import type { BusyEvent } from '../utils/calendarBusy';

const DAY_START = new Date('2026-08-12T00:00:00Z');

let seq = 0;
function ev(start: string, end: string, overrides: Partial<BusyEvent> = {}): BusyEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    title: `Event ${seq}`,
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

/** Minutes past midnight UTC on the test day. */
function at(hours: number, minutes = 0): string {
  const d = new Date(DAY_START);
  d.setUTCHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function atDate(hours: number, minutes = 0): Date {
  return new Date(at(hours, minutes));
}

describe('nudgeReminderPastMeeting', () => {
  it('passes a reminder through unchanged when nothing is on', () => {
    const result = nudgeReminderPastMeeting(atDate(9), []);
    expect(result).toEqual({ time: atDate(9), nudged: false, meetingTitle: null });
  });

  it('passes a reminder through unchanged when it lands outside every event', () => {
    const events = [ev(at(10), at(11))];
    const result = nudgeReminderPastMeeting(atDate(9), events);
    expect(result.nudged).toBe(false);
    expect(result.time).toEqual(atDate(9));
  });

  it('moves a reminder landing inside a meeting to the meeting\'s end', () => {
    const events = [ev(at(9), at(10), { title: 'Team sync' })];
    const result = nudgeReminderPastMeeting(atDate(9, 30), events);
    expect(result.nudged).toBe(true);
    expect(result.time).toEqual(atDate(10));
    expect(result.meetingTitle).toBe('Team sync');
  });

  it('lands exactly on a meeting start and still nudges (half-open interval)', () => {
    const events = [ev(at(9), at(10))];
    const result = nudgeReminderPastMeeting(atDate(9), events);
    expect(result.nudged).toBe(true);
    expect(result.time).toEqual(atDate(10));
  });

  it('does not nudge a reminder landing exactly on a meeting\'s end', () => {
    const events = [ev(at(9), at(10))];
    const result = nudgeReminderPastMeeting(atDate(10), events);
    expect(result.nudged).toBe(false);
  });

  it('moves to the far end of two overlapping meetings, merged', () => {
    const events = [ev(at(9), at(10)), ev(at(9, 30), at(11))];
    const result = nudgeReminderPastMeeting(atDate(9, 15), events);
    expect(result.nudged).toBe(true);
    expect(result.time).toEqual(atDate(11));
  });

  it('ignores a cancelled event', () => {
    const events = [ev(at(9), at(10), { status: 'canceled' })];
    const result = nudgeReminderPastMeeting(atDate(9, 30), events);
    expect(result.nudged).toBe(false);
  });

  it('ignores an event marked Free', () => {
    const events = [ev(at(9), at(10), { availability: 'free' })];
    const result = nudgeReminderPastMeeting(atDate(9, 30), events);
    expect(result.nudged).toBe(false);
  });

  it('ignores an all-day event', () => {
    const events = [ev(at(0), at(24), { allDay: true })];
    const result = nudgeReminderPastMeeting(atDate(9, 30), events);
    expect(result.nudged).toBe(false);
  });

  it('treats a tentative event as busy', () => {
    const events = [ev(at(9), at(10), { availability: 'tentative' })];
    const result = nudgeReminderPastMeeting(atDate(9, 30), events);
    expect(result.nudged).toBe(true);
    expect(result.time).toEqual(atDate(10));
  });

  it('never moves a reminder earlier than it was set for', () => {
    const events = [ev(at(9), at(10))];
    const result = nudgeReminderPastMeeting(atDate(9, 45), events);
    expect(result.time.getTime()).toBeGreaterThanOrEqual(atDate(9, 45).getTime());
  });
});

describe('meetingSignature', () => {
  const standup = ev(at(9), at(10), { id: 'standup' });
  const review = ev(at(14), at(15), { id: 'review' });

  it('is the same for the same meetings in another order, or a fresh array of them', () => {
    expect(meetingSignature([standup, review])).toBe(meetingSignature([{ ...review }, { ...standup }]));
  });

  it('changes when a meeting is added, removed or moved', () => {
    const base = meetingSignature([standup]);
    expect(meetingSignature([standup, review])).not.toBe(base);
    expect(meetingSignature([])).not.toBe(base);
    expect(meetingSignature([{ ...standup, end: at(10, 30) }])).not.toBe(base);
  });

  it('ignores what can never move a reminder: all-day, free and cancelled events', () => {
    const base = meetingSignature([standup]);
    expect(meetingSignature([
      standup,
      ev(at(0), at(23, 59), { allDay: true }),
      ev(at(11), at(12), { availability: 'free' }),
      ev(at(12), at(13), { status: 'canceled' }),
    ])).toBe(base);
  });
});
