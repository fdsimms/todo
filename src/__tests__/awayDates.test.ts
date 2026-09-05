import {
  awayNights,
  awayListDriver,
  awayPauseDriver,
  awayNoonIso,
  awaySpanOf,
  awayStatus,
  describeAwaySpan,
  isAwayDay,
  isProjectAwayNow,
  nextAwayProject,
} from '../utils/awayDates';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }),
  },
}));

/** Midday on a plain local date, the way the columns store one. */
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();

const span = (start: string | null, end: string | null) => ({ awayStart: start, awayEnd: end });

describe('awayNoonIso', () => {
  it('lands on midday whatever time of day it is handed', () => {
    for (const hour of [0, 1, 9, 23]) {
      const iso = awayNoonIso(new Date(2026, 10, 3, hour, 37, 12, 500));
      const back = new Date(iso);
      expect(back.getHours()).toBe(12);
      expect(back.getDate()).toBe(3);
    }
  });

  it('keeps the date across a shift either side of midday', () => {
    // The point of noon: nine hours in either direction is still the 3rd.
    const iso = awayNoonIso(new Date(2026, 10, 3));
    const shifted = new Date(new Date(iso).getTime() - 9 * 60 * 60 * 1000);
    expect(shifted.getDate()).toBe(3);
    const other = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
    expect(other.getDate()).toBe(3);
  });
});

describe('awaySpanOf', () => {
  it('is null without a start', () => {
    expect(awaySpanOf(span(null, null))).toBeNull();
  });

  it('drops an end with no start rather than promoting it', () => {
    // On its own an end date is indistinguishable from `deadline`, which the
    // project already has a field and a label for.
    expect(awaySpanOf(span(null, noon(2026, 11, 10)))).toBeNull();
  });

  it('keeps a start with no end, as a real state', () => {
    const s = awaySpanOf(span(noon(2026, 11, 3), null));
    expect(s).not.toBeNull();
    expect(s!.end).toBeNull();
  });

  it('ignores an end before the start, keeping the departure', () => {
    const s = awaySpanOf(span(noon(2026, 11, 3), noon(2026, 11, 1)));
    expect(s!.start.getDate()).toBe(3);
    expect(s!.end).toBeNull();
  });

  it('ignores an end equal to the start', () => {
    // Not a zero-night trip: `start <= day < end` would make it contain no
    // days at all, which is not a span anybody entered on purpose.
    expect(awaySpanOf(span(noon(2026, 11, 3), noon(2026, 11, 3)))!.end).toBeNull();
  });

  it('keeps a well-formed span', () => {
    const s = awaySpanOf(span(noon(2026, 11, 3), noon(2026, 11, 10)));
    expect(s!.start.getDate()).toBe(3);
    expect(s!.end!.getDate()).toBe(10);
  });
});

describe('isAwayDay', () => {
  const s = awaySpanOf(span(noon(2026, 11, 3), noon(2026, 11, 10)));

  it('is false without a span', () => {
    expect(isAwayDay(null, new Date(2026, 10, 5))).toBe(false);
  });

  it('counts the day you leave', () => {
    // lookAhead's cutoff is exclusive for the same reason: the day you leave
    // is not a day you have.
    expect(isAwayDay(s, new Date(2026, 10, 3, 9))).toBe(true);
  });

  it('does not count the day you are back', () => {
    expect(isAwayDay(s, new Date(2026, 10, 10, 9))).toBe(false);
  });

  it('counts the days between', () => {
    for (const d of [4, 5, 9]) {
      expect(isAwayDay(s, new Date(2026, 10, d, 9))).toBe(true);
    }
  });

  it('is false before departure', () => {
    expect(isAwayDay(s, new Date(2026, 10, 2, 23))).toBe(false);
  });

  it('anchors the span bounds, not just the day asked about', () => {
    // A span built straight from two picked dates carries their time of day.
    // Compared raw, an anchored day sits before its own departure and the day
    // you leave stops counting.
    const raw = { start: new Date(2026, 10, 3, 12), end: new Date(2026, 10, 10, 12) };
    expect(isAwayDay(raw, new Date(2026, 10, 3, 0, 30))).toBe(true);
    expect(isAwayDay(raw, new Date(2026, 10, 9, 23, 30))).toBe(true);
    expect(isAwayDay(raw, new Date(2026, 10, 10, 0, 30))).toBe(false);
  });

  it('knows only the departure day when there is no return date', () => {
    // The alternative reading — away forever — would have every reader treat
    // an unfinished span as an open-ended absence.
    const open = awaySpanOf(span(noon(2026, 11, 3), null));
    expect(isAwayDay(open, new Date(2026, 10, 3, 9))).toBe(true);
    expect(isAwayDay(open, new Date(2026, 10, 4, 9))).toBe(false);
  });
});

describe('awayNights', () => {
  it('counts nights, matching what answerFromDates means by the word', () => {
    // The 3rd to the 10th is 7 nights and 8 days.
    expect(awayNights(awaySpanOf(span(noon(2026, 11, 3), noon(2026, 11, 10))))).toBe(7);
  });

  it('is null without an end', () => {
    expect(awayNights(awaySpanOf(span(noon(2026, 11, 3), null)))).toBeNull();
    expect(awayNights(null)).toBeNull();
  });
});

describe('awayStatus', () => {
  const s = awaySpanOf(span(noon(2026, 11, 3), noon(2026, 11, 10)));

  it('is null without a span', () => {
    expect(awayStatus(null, new Date(2026, 10, 1))).toBeNull();
  });

  it('reads as before while the departure is ahead', () => {
    const st = awayStatus(s, new Date(2026, 9, 28, 9))!;
    expect(st.phase).toBe('before');
    expect(st.daysUntilStart).toBe(6);
    expect(st.daysUntilEnd).toBe(13);
  });

  it('reads as during from the departure day', () => {
    expect(awayStatus(s, new Date(2026, 10, 3, 9))!.phase).toBe('during');
    expect(awayStatus(s, new Date(2026, 10, 9, 9))!.phase).toBe('during');
  });

  it('reads as over from the day you are back', () => {
    expect(awayStatus(s, new Date(2026, 10, 10, 9))!.phase).toBe('over');
    expect(awayStatus(s, new Date(2026, 10, 20, 9))!.phase).toBe('over');
  });

  it('never reads as over without an end date', () => {
    const open = awaySpanOf(span(noon(2026, 11, 3), null));
    expect(awayStatus(open, new Date(2027, 0, 1))!.phase).toBe('during');
  });
});

describe('describeAwaySpan', () => {
  const trip = span(noon(2026, 11, 3), noon(2026, 11, 10));

  it('says nothing without a span', () => {
    expect(describeAwaySpan(span(null, null), new Date(2026, 10, 1))).toBeNull();
  });

  it('counts down to departure', () => {
    expect(describeAwaySpan(trip, new Date(2026, 9, 28, 9))).toBe('Leaves in 6 days');
  });

  it('says tomorrow rather than in 1 days', () => {
    expect(describeAwaySpan(trip, new Date(2026, 10, 2, 9))).toBe('Leaves tomorrow');
  });

  it('names the return once you have gone', () => {
    expect(describeAwaySpan(trip, new Date(2026, 10, 4, 9))).toBe('Back Nov 10');
  });

  it('says only that you are away when there is no return date', () => {
    expect(describeAwaySpan(span(noon(2026, 11, 3), null), new Date(2026, 10, 4, 9))).toBe('Away');
  });

  it('says nothing once the trip is over', () => {
    // A card captioned with a date that has been and gone is noise on every
    // project that ever went anywhere.
    expect(describeAwaySpan(trip, new Date(2026, 10, 11, 9))).toBeNull();
  });
});

describe('nextAwayProject', () => {
  const p = (
    id: string,
    awayStart: string | null,
    awayEnd: string | null,
    extra: Partial<{ archived: boolean; completed: boolean; sortOrder: number }> = {},
  ) => ({
    id,
    title: id,
    awayStart,
    awayEnd,
    archived: false,
    completed: false,
    sortOrder: 0,
    ...extra,
  });

  const now = new Date(2026, 10, 1, 9);

  it('is null with nothing to find', () => {
    expect(nextAwayProject([], now)).toBeNull();
    expect(nextAwayProject([p('none', null, null)], now)).toBeNull();
  });

  it('finds the one upcoming trip', () => {
    const found = nextAwayProject([p('japan', noon(2026, 11, 3), noon(2026, 11, 10))], now);
    expect(found!.project.id).toBe('japan');
    expect(found!.span.end!.getDate()).toBe(10);
  });

  it('skips a trip that is already over', () => {
    expect(nextAwayProject([p('past', noon(2026, 10, 1), noon(2026, 10, 8))], now)).toBeNull();
  });

  it('skips archived and completed projects', () => {
    const trip = noon(2026, 11, 3);
    expect(nextAwayProject([p('a', trip, null, { archived: true })], now)).toBeNull();
    expect(nextAwayProject([p('c', trip, null, { completed: true })], now)).toBeNull();
  });

  it('prefers the trip you are on over the next one', () => {
    // Standing inside a span, the reader is not asking about the one after it.
    const found = nextAwayProject(
      [
        p('next', noon(2026, 12, 1), noon(2026, 12, 5)),
        p('current', noon(2026, 10, 28), noon(2026, 11, 4)),
      ],
      now,
    )!;
    expect(found.project.id).toBe('current');
  });

  it('takes the earlier departure among upcoming trips', () => {
    const found = nextAwayProject(
      [
        p('later', noon(2026, 12, 1), noon(2026, 12, 5)),
        p('sooner', noon(2026, 11, 3), noon(2026, 11, 10)),
      ],
      now,
    )!;
    expect(found.project.id).toBe('sooner');
  });

  it('breaks a same-day tie on sortOrder, the only ranking the user made', () => {
    const found = nextAwayProject(
      [
        p('second', noon(2026, 11, 3), noon(2026, 11, 10), { sortOrder: 5 }),
        p('first', noon(2026, 11, 3), noon(2026, 11, 10), { sortOrder: 1 }),
      ],
      now,
    )!;
    expect(found.project.id).toBe('first');
  });

  it('finds a departure with no return date', () => {
    const found = nextAwayProject([p('open', noon(2026, 11, 3), null)], now)!;
    expect(found.span.end).toBeNull();
  });
});

describe('awayPauseDriver', () => {
  // Standing inside the 3rd-to-10th trip.
  const now = new Date(2026, 10, 5, 9, 0, 0);
  const start = noon(2026, 11, 3);
  const end = noon(2026, 11, 10);

  const trip = (extra: Partial<{
    awayPauses: boolean;
    awayPauseDeclinedFor: string | null;
    archived: boolean;
    completed: boolean;
    awayStart: string | null;
    awayEnd: string | null;
  }> = {}) => ({
    id: 'trip',
    awayStart: start,
    awayEnd: end,
    awayPauses: true,
    awayPauseDeclinedFor: null,
    archived: false,
    completed: false,
    ...extra,
  });

  it('names the nominated trip covering today', () => {
    expect(awayPauseDriver([trip()], now)?.id).toBe('trip');
  });

  it('ignores a trip that never nominated a pause', () => {
    expect(awayPauseDriver([trip({ awayPauses: false })], now)).toBeNull();
  });

  it('ignores a trip whose pause was turned off by hand', () => {
    expect(awayPauseDriver([trip({ awayPauseDeclinedFor: start })], now)).toBeNull();
  });

  it('honours a refusal recorded against a different departure', () => {
    // The user declined last month's trip; this one has not been asked about.
    const stale = awayPauseDriver([trip({ awayPauseDeclinedFor: noon(2026, 9, 1) })], now);
    expect(stale?.id).toBe('trip');
  });

  it('ignores a span that has not started or is already over', () => {
    expect(awayPauseDriver([trip()], new Date(2026, 10, 1))).toBeNull();
    expect(awayPauseDriver([trip()], new Date(2026, 10, 20))).toBeNull();
  });

  it('ignores archived and completed projects', () => {
    expect(awayPauseDriver([trip({ archived: true })], now)).toBeNull();
    expect(awayPauseDriver([trip({ completed: true })], now)).toBeNull();
  });

  it('ignores a project with no span at all', () => {
    expect(awayPauseDriver([trip({ awayStart: null, awayEnd: null })], now)).toBeNull();
  });

  it('counts the departure day itself, the day the sweep first sees a backlog', () => {
    expect(awayPauseDriver([trip()], new Date(2026, 10, 3, 8, 0, 0))?.id).toBe('trip');
  });

  it('does not count the return day', () => {
    expect(awayPauseDriver([trip()], new Date(2026, 10, 10, 8, 0, 0))).toBeNull();
  });
});

describe('isProjectAwayNow', () => {
  const live = { awayStart: noon(2026, 11, 3), awayEnd: noon(2026, 11, 10), archived: false, completed: false };

  it('is true inside the span and false either side of it', () => {
    expect(isProjectAwayNow(live, new Date(2026, 10, 5))).toBe(true);
    expect(isProjectAwayNow(live, new Date(2026, 10, 2))).toBe(false);
    expect(isProjectAwayNow(live, new Date(2026, 10, 11))).toBe(false);
  });

  it('is false for a project that is history rather than schedule', () => {
    expect(isProjectAwayNow({ ...live, archived: true }, new Date(2026, 10, 5))).toBe(false);
    expect(isProjectAwayNow({ ...live, completed: true }, new Date(2026, 10, 5))).toBe(false);
  });
});

describe('awayListDriver', () => {
  const now = new Date(2026, 10, 5, 9, 0, 0);
  const start = noon(2026, 11, 3);

  const trip = (extra: Record<string, unknown> = {}) => ({
    id: 'trip',
    awayStart: start,
    awayEnd: noon(2026, 11, 10),
    awayListId: 'l1',
    awayListDeclinedFor: null,
    archived: false,
    completed: false,
    ...extra,
  });

  it('names the trip that nominated a list and covers today', () => {
    expect(awayListDriver([trip()], now)?.id).toBe('trip');
  });

  it('ignores a trip that nominated none', () => {
    expect(awayListDriver([trip({ awayListId: null })], now)).toBeNull();
  });

  it('ignores a trip whose list switch was undone by hand', () => {
    expect(awayListDriver([trip({ awayListDeclinedFor: start })], now)).toBeNull();
  });

  it('is independent of the pause nomination, which is a separate opt-in', () => {
    // A trip you shop for is not necessarily one you pause tasks for.
    const shopsOnly = trip({ awayPauses: false, awayPauseDeclinedFor: null });
    expect(awayListDriver([shopsOnly], now)?.id).toBe('trip');
    expect(awayPauseDriver([shopsOnly as any], now)).toBeNull();
  });

  it('ignores a span that is over', () => {
    expect(awayListDriver([trip()], new Date(2026, 10, 20))).toBeNull();
  });
});
