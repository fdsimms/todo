import type { BusyEvent } from '../utils/calendarBusy';
import {
  ON_CALL_MAX_WORDS,
  cleanWords,
  isOnCallEvent,
  onCallWordsProblem,
  splitTypedWords,
  onCallConfigured,
  onCallSpans,
  onCallStripLines,
  onCallWarningForDay,
  onCallWarningForDays,
  onCallWarningForTime,
  parseOnCallWords,
  spanTouches,
  type OnCallConfig,
} from '../utils/onCall';

// Saturday, November 21 2026, in local time.
const at = (h: number, m = 0, day = 21) => new Date(2026, 10, day, h, m);

function timed(title: string, from: Date, to: Date, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: `${title}-${from.getTime()}`, title, start: from.toISOString(), end: to.toISOString(), allDay: false,
    calendarId: 'work', location: null, status: 'confirmed', availability: 'busy', ...overrides,
  };
}

// An all-day event as EventKit stores it: UTC midnight of the date it names,
// ending at UTC midnight of the day after its last day.
function allDay(title: string, firstDay: number, lastDay = firstDay, overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: `${title}-${firstDay}`,
    title,
    start: new Date(Date.UTC(2026, 10, firstDay)).toISOString(),
    end: new Date(Date.UTC(2026, 10, lastDay + 1)).toISOString(),
    allDay: true, calendarId: 'work', location: null, status: 'confirmed', availability: 'free', ...overrides,
  };
}

const WORD: OnCallConfig = { calendarIds: [], words: ['on call'] };
const CAL: OnCallConfig = { calendarIds: ['oncall-cal'], words: [] };
const RESET = '04:00';

describe('cleanWords', () => {
  it('trims, drops short and repeated words and keeps the cap', () => {
    expect(cleanWords([' on call ', 'On  Call', 'pg', 5, 'pager'])).toEqual(['on call', 'pager']);
    const many = Array.from({ length: 20 }, (_, i) => `word${i}`);
    expect(cleanWords(many)).toHaveLength(ON_CALL_MAX_WORDS);
  });
  it('reads a stored list and shrugs off anything else', () => {
    expect(parseOnCallWords('["on call"]')).toEqual(['on call']);
    expect(parseOnCallWords('{"a":1}')).toEqual([]);
    expect(parseOnCallWords('not json')).toEqual([]);
    expect(parseOnCallWords(null)).toEqual([]);
  });
});

describe('the typed words field', () => {
  it('splits on commas and drops blanks', () => {
    expect(splitTypedWords(' on call, , pager ,')).toEqual(['on call', 'pager']);
  });
  it('says nothing when every word will be used', () => {
    expect(onCallWordsProblem('on call, pager')).toBeNull();
    expect(onCallWordsProblem('')).toBeNull();
    expect(onCallWordsProblem('On call, on  call')).toBeNull();
  });
  it('says why a word will not be used', () => {
    expect(onCallWordsProblem('on call, pg')).toContain('\u201cpg\u201d is too short');
    expect(onCallWordsProblem('a'.repeat(61))).toContain('at most 60');
    expect(onCallWordsProblem(Array.from({ length: 8 }, (_, i) => `word${i}`).join(', ')))
      .toBe('Only the first 6 words are used. Remove some to use the rest.');
  });
});

describe('isOnCallEvent', () => {
  it('matches a title word as a whole word, ignoring case', () => {
    expect(isOnCallEvent(timed('On Call (primary)', at(9), at(17)), WORD)).toBe(true);
    expect(isOnCallEvent(timed('Oncology review', at(9), at(17)), WORD)).toBe(false);
  });
  it('matches by calendar with no word set', () => {
    expect(isOnCallEvent(timed('Shift', at(9), at(17), { calendarId: 'oncall-cal' }), CAL)).toBe(true);
    expect(isOnCallEvent(timed('Shift', at(9), at(17)), CAL)).toBe(false);
  });
  it('accepts either when both are set', () => {
    const both: OnCallConfig = { calendarIds: ['oncall-cal'], words: ['on call'] };
    expect(isOnCallEvent(timed('Shift', at(9), at(17), { calendarId: 'oncall-cal' }), both)).toBe(true);
    expect(isOnCallEvent(timed('on call', at(9), at(17)), both)).toBe(true);
    expect(isOnCallEvent(timed('Shift', at(9), at(17)), both)).toBe(false);
  });
  it('does not count a canceled event, and counts one marked free', () => {
    expect(isOnCallEvent(timed('on call', at(9), at(17), { status: 'canceled' }), WORD)).toBe(false);
    expect(isOnCallEvent(timed('on call', at(9), at(17), { availability: 'free' }), WORD)).toBe(true);
  });
  it('is off with nothing set', () => {
    const none: OnCallConfig = { calendarIds: [], words: [] };
    expect(onCallConfigured(none)).toBe(false);
    expect(isOnCallEvent(timed('on call', at(9), at(17)), none)).toBe(false);
    expect(onCallConfigured(WORD)).toBe(true);
    expect(onCallConfigured(CAL)).toBe(true);
  });
});

describe('onCallSpans', () => {
  it('merges Saturday and Sunday written as two all-day events into one weekend', () => {
    const spans = onCallSpans([allDay('on call', 21), allDay('on call', 22)], WORD);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ start: new Date(2026, 10, 21).getTime(), end: new Date(2026, 10, 23).getTime(), allDay: true });
  });
  it('merges a shift copied onto two calendars, and keeps all-day and timed apart', () => {
    const spans = onCallSpans([
      timed('on call', at(9), at(17)),
      timed('on call', at(9), at(17), { calendarId: 'other' }),
      allDay('on call', 21),
    ], WORD);
    expect(spans.map(s => s.allDay).sort()).toEqual([false, true]);
    expect(spans.filter(s => !s.allDay)).toHaveLength(1);
  });
  it('leaves a gap between two shifts alone', () => {
    expect(onCallSpans([timed('on call', at(9), at(12)), timed('on call', at(18), at(22))], WORD)).toHaveLength(2);
  });
  it('ignores events that are not on call', () => {
    expect(onCallSpans([timed('Dentist', at(9), at(10))], WORD)).toEqual([]);
  });
});

describe('spanTouches', () => {
  const [weekend] = onCallSpans([allDay('on call', 21, 22)], WORD);
  it('puts an all-day span on the local days it names, not the day before', () => {
    expect(spanTouches(weekend, new Date(2026, 10, 20, 4), new Date(2026, 10, 21, 4))).toBe(true); // 4 AM Fri to 4 AM Sat reaches Saturday's first hours
    expect(spanTouches(weekend, new Date(2026, 10, 19), new Date(2026, 10, 20))).toBe(false);
    expect(spanTouches(weekend, new Date(2026, 10, 22, 23), new Date(2026, 10, 23, 1))).toBe(true);
    expect(spanTouches(weekend, new Date(2026, 10, 23, 1), new Date(2026, 10, 23, 2))).toBe(false);
  });
  it('treats a timed span as a moment range, back to back not overlapping', () => {
    const [shift] = onCallSpans([timed('on call', at(9), at(17))], WORD);
    expect(spanTouches(shift, at(17), at(18))).toBe(false);
    expect(spanTouches(shift, at(16), at(18))).toBe(true);
  });
});

describe('onCallStripLines', () => {
  const lines = (events: BusyEvent[], now: Date, use24 = false) =>
    onCallStripLines(onCallSpans(events, WORD), now, RESET, use24);

  it('says nothing on a day that is not on call', () => {
    expect(lines([timed('on call', at(9), at(17), {}), allDay('on call', 28)], at(10, 0, 22))).toEqual([]);
  });
  it('says all day for an all-day run, naming its last day while it goes on', () => {
    const weekend = [allDay('on call', 21), allDay('on call', 22)];
    expect(lines(weekend, at(10))).toEqual(['All day through Sun, Nov 22']);
    expect(lines(weekend, at(10, 0, 22))).toEqual(['All day']);
  });
  it('gives a shift still to come as a range, with no day words inside one day', () => {
    expect(lines([timed('on call', at(9), at(17))], at(7))).toEqual(['9:00 AM to 5:00 PM']);
    expect(lines([timed('on call', at(9), at(17))], at(7), true)).toEqual(['09:00 to 17:00']);
  });
  it('says today and tomorrow on an overnight shift', () => {
    const overnight = [timed('on call', at(17), at(8, 0, 22))];
    expect(lines(overnight, at(10))).toEqual(['5:00 PM today to 8:00 AM tomorrow']);
  });
  it('says until for a shift under way, and names tomorrow when it ends then', () => {
    expect(lines([timed('on call', at(9), at(17))], at(12))).toEqual(['Until 5:00 PM']);
    expect(lines([timed('on call', at(17), at(8, 0, 22))], at(23))).toEqual(['Until 8:00 AM tomorrow']);
  });
  it('shows the morning after an overnight shift as until, on the day it ends', () => {
    expect(lines([timed('on call', at(17), at(8, 0, 22))], at(6, 30, 22))).toEqual(['Until 8:00 AM']);
  });
  it('drops a shift that has ended', () => {
    expect(lines([timed('on call', at(9), at(12))], at(13))).toEqual([]);
  });
  it('lists two shifts one per line, earliest first', () => {
    expect(lines([timed('on call', at(18), at(22)), timed('on call', at(9), at(12))], at(7)))
      .toEqual(['9:00 AM to 12:00 PM', '6:00 PM to 10:00 PM']);
  });
  it('treats a small-hours time before the day reset as still the day before', () => {
    // 2 AM Sunday is still Saturday's app day, so Saturday's all-day span is today's.
    expect(lines([allDay('on call', 21)], at(2, 0, 22))).toEqual(['All day']);
  });
});

describe('onCallWarningForTime', () => {
  const spans = onCallSpans([timed('on call', at(9), at(17)), timed('on call', at(18), at(22))], WORD);
  it('is null when the time clears every stretch', () => {
    expect(onCallWarningForTime(spans, at(17), at(18), false)).toBeNull();
  });
  it('says when you are on call for the stretch it runs into', () => {
    expect(onCallWarningForTime(spans, at(12), at(13), false)).toBe('You’re on call 9:00 AM to 5:00 PM');
    expect(onCallWarningForTime(spans, at(16), at(19), false))
      .toBe('You’re on call 9:00 AM to 5:00 PM and 6:00 PM to 10:00 PM');
  });
  it('names the day on the far end of an overnight shift', () => {
    const night = onCallSpans([timed('on call', at(17), at(8, 0, 22))], WORD);
    expect(onCallWarningForTime(night, at(19), at(20), false)).toBe('You’re on call 5:00 PM to Sun 8:00 AM');
  });
  it('says all day for an all-day span, even for an event that straddles midnight into it', () => {
    const weekend = onCallSpans([allDay('on call', 22)], WORD);
    expect(onCallWarningForTime(weekend, at(23), at(1, 0, 22), false)).toBe('You’re on call all day');
  });
});

describe('onCallWarningForDay', () => {
  it('says all day for an all-day day and the hours for a timed one', () => {
    const spans = onCallSpans([allDay('on call', 21), timed('on call', at(9), at(17), {})], WORD);
    expect(onCallWarningForDay(spans, new Date(2026, 10, 21), RESET, false)).toBe('You’re on call all day');
    const shifts = onCallSpans([timed('on call', at(9, 0, 23), at(17, 0, 23))], WORD);
    expect(onCallWarningForDay(shifts, new Date(2026, 10, 23), RESET, false)).toBe('You’re on call 9:00 AM to 5:00 PM');
  });
  it('does not warn on the morning an overnight shift ends, only on the day it starts', () => {
    const night = onCallSpans([timed('on call', at(18, 0, 21), at(8, 0, 22))], WORD);
    expect(onCallWarningForDay(night, new Date(2026, 10, 21), RESET, false)).toBe('You’re on call 6:00 PM to Sun 8:00 AM');
    expect(onCallWarningForDay(night, new Date(2026, 10, 22), RESET, false)).toBeNull();
  });
  it('still warns on a day a multi-day shift runs all the way through', () => {
    const long = onCallSpans([timed('on call', at(17, 0, 21), at(8, 0, 24))], WORD);
    expect(onCallWarningForDay(long, new Date(2026, 10, 22), RESET, false)).not.toBeNull();
    expect(onCallWarningForDay(long, new Date(2026, 10, 24), RESET, false)).toBeNull();
  });
  it('reads a midnight date as that date, not the day before the reset', () => {
    const spans = onCallSpans([allDay('on call', 21)], WORD);
    expect(onCallWarningForDay(spans, new Date(2026, 10, 20), RESET, false)).toBeNull();
    expect(onCallWarningForDay(spans, new Date(2026, 10, 21), RESET, false)).not.toBeNull();
  });
});

describe('onCallWarningForDays', () => {
  const spans = onCallSpans([allDay('on call', 21, 22)], WORD);
  it('counts the days of a trip that are on call', () => {
    expect(onCallWarningForDays(spans, new Date(2026, 10, 20), new Date(2026, 10, 24), RESET))
      .toBe('You’re on call on 2 of these 5 days');
  });
  it('says all when every day is', () => {
    expect(onCallWarningForDays(spans, new Date(2026, 10, 21), new Date(2026, 10, 22), RESET))
      .toBe('You’re on call on all 2 of these days');
  });
  it('has its own wording for one day and none for a clear run', () => {
    expect(onCallWarningForDays(spans, new Date(2026, 10, 21), new Date(2026, 10, 21), RESET))
      .toBe('You’re on call on this day');
    expect(onCallWarningForDays(spans, new Date(2026, 10, 24), new Date(2026, 10, 26), RESET)).toBeNull();
  });
});
