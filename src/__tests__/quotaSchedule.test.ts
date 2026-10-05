import {
  quotaRunSpan,
  quotaTargetForInterval,
  quotaDueTimes,
  quotaDueTimesAfter,
  isQuotaRunOver,
  quotaWeekStart,
  quotaWeekSpan,
  proratedFrom,
  weekDaysLeft,
  proratedWeeklyTarget,
  quotaProrationPatch,
  firstWeekAnchor,
  firstWeekPatch,
} from '../utils/quotaSchedule';

const DAY = new Date('2026-08-26T00:00:00');

function span(input: Partial<Parameters<typeof quotaRunSpan>[0]> = {}) {
  return quotaRunSpan({
    windowStart: null,
    windowEnd: null,
    quotaStartedAt: null,
    activeHoursStart: '08:00',
    activeHoursEnd: '22:00',
    dayStart: DAY,
    ...input,
  });
}

const at = (hhmm: string) => new Date(`2026-08-26T${hhmm}:00`);

describe('quotaRunSpan', () => {
  it('uses the task window when it has one', () => {
    const s = span({ windowStart: '09:00', windowEnd: '17:00' });
    expect(s.start).toEqual(at('09:00'));
    expect(s.end).toEqual(at('17:00'));
  });

  it('falls back to active hours with no window', () => {
    const s = span();
    expect(s.start).toEqual(at('08:00'));
    expect(s.end).toEqual(at('22:00'));
  });

  it('takes each end from its own source', () => {
    const s = span({ windowStart: '09:00' });
    expect(s.start).toEqual(at('09:00'));
    expect(s.end).toEqual(at('22:00'));
  });

  it('moves the start to a hand-started run, leaving the end alone', () => {
    const s = span({
      windowStart: '09:00', windowEnd: '17:00',
      quotaStartedAt: at('10:30').toISOString(),
    });
    expect(s.start).toEqual(at('10:30'));
    expect(s.end).toEqual(at('17:00'));
  });

  it('ignores a start earlier than the window opens', () => {
    // Getting ahead of yourself doesn't redefine the work day.
    const s = span({
      windowStart: '09:00', windowEnd: '17:00',
      quotaStartedAt: at('08:00').toISOString(),
    });
    expect(s.start).toEqual(at('09:00'));
  });

  it('ignores a stamp from an earlier day', () => {
    const s = span({
      windowStart: '09:00', windowEnd: '17:00',
      quotaStartedAt: '2026-08-25T10:30:00',
    });
    expect(s.start).toEqual(at('09:00'));
  });

  it('ignores a start after the window has already shut', () => {
    const s = span({
      windowStart: '09:00', windowEnd: '17:00',
      quotaStartedAt: at('18:00').toISOString(),
    });
    expect(s.start).toEqual(at('09:00'));
  });

  it('ignores an unparseable stamp rather than producing an invalid span', () => {
    const s = span({ windowStart: '09:00', windowEnd: '17:00', quotaStartedAt: 'not a date' });
    expect(s.start).toEqual(at('09:00'));
  });

  it('resolves a window that closes at or before it opens into the next calendar day', () => {
    // Active hours for a night owl — "22:00–06:00" — read as the small hours
    // of *tomorrow*, not as a span that closed before it opened today.
    const s = span({ windowStart: '22:00', windowEnd: '06:00' });
    expect(s.start).toEqual(at('22:00'));
    expect(s.end).toEqual(new Date('2026-08-27T06:00:00'));
  });

  it('does the same for the active-hours fallback, not just a task window', () => {
    const s = span({ activeHoursStart: '20:00', activeHoursEnd: '08:00' });
    expect(s.start).toEqual(at('20:00'));
    expect(s.end).toEqual(new Date('2026-08-27T08:00:00'));
  });
});

describe('quotaTargetForInterval', () => {
  it('divides the span by the interval', () => {
    expect(quotaTargetForInterval(span({ windowStart: '09:00', windowEnd: '17:00' }), 20)).toBe(24);
  });

  it('keeps the interval and loses the count when the run starts late', () => {
    // The whole reason the interval is what's stored: 6.5 hours at 20 minutes
    // is 19 breaks, not 24 breaks squeezed closer together.
    const late = span({
      windowStart: '09:00', windowEnd: '17:00',
      quotaStartedAt: at('10:30').toISOString(),
    });
    expect(quotaTargetForInterval(late, 20)).toBe(19);
  });

  it('floors rather than rounds, so the last unit lands inside the run', () => {
    // 09:00–17:00 is 8h; at 50 minutes that's 9.6, and a 10th would fall past
    // the end of a day that can never reach it.
    expect(quotaTargetForInterval(span({ windowStart: '09:00', windowEnd: '17:00' }), 50)).toBe(9);
  });

  it('clamps to the floor rather than ceasing to be a target', () => {
    const stub = span({ windowStart: '16:45', windowEnd: '17:00' });
    expect(quotaTargetForInterval(stub, 20)).toBe(2);
  });

  it('clamps to the ceiling', () => {
    expect(quotaTargetForInterval(span({ windowStart: '09:00', windowEnd: '17:00' }), 1)).toBe(99);
  });

  it('survives a nonsense interval', () => {
    expect(quotaTargetForInterval(span({ windowStart: '09:00', windowEnd: '17:00' }), 0)).toBe(2);
  });

  it('divides an overnight window across its full span, not just the hours before midnight', () => {
    // 17:00–09:00 (next day) is 16h; at 20 minutes that's 48.
    expect(quotaTargetForInterval(span({ windowStart: '17:00', windowEnd: '09:00' }), 20)).toBe(48);
  });
});

describe('quotaDueTimes', () => {
  it('spaces the grid evenly from the start of the span', () => {
    const times = quotaDueTimes(span({ windowStart: '09:00', windowEnd: '17:00' }), 24);
    expect(times).toHaveLength(24);
    expect(times[0]).toEqual(at('09:00'));
    expect(times[1]).toEqual(at('09:20'));
    expect(times[23]).toEqual(at('16:40'));
  });

  it('matches the boundaries the pace ramp owes units at', () => {
    // quotaExpectedByNow owes the kth unit once k/target of the span has
    // passed, so the kth grid instant has to be start + k·span/target. If
    // these two ever disagree, the notification and the row it sends you to
    // disagree about when a unit was due.
    const s = span({ windowStart: '09:00', windowEnd: '17:00' });
    const target = 24;
    const times = quotaDueTimes(s, target);
    times.forEach((t, k) => {
      expect(+t).toBe(+s.start + ((+s.end - +s.start) * k) / target);
    });
  });

  it('spaces an overnight window grid across the full night, not just up to midnight', () => {
    const times = quotaDueTimes(span({ windowStart: '17:00', windowEnd: '09:00' }), 24);
    expect(times).toHaveLength(24);
    expect(times[0]).toEqual(at('17:00'));
    expect(times[1]).toEqual(at('17:40'));
    expect(times[23]).toEqual(new Date('2026-08-27T08:20:00'));
  });

  it('is empty for a span that genuinely does not resolve', () => {
    // quotaRunSpan itself never produces one of these any more (it rolls an
    // overnight close into the next day), but the guard here still has to
    // hold for a span built by hand.
    expect(quotaDueTimes({ start: at('17:00'), end: at('09:00') }, 24)).toEqual([]);
  });
});

describe('quotaDueTimesAfter', () => {
  const s = span({ windowStart: '09:00', windowEnd: '17:00' });

  it('takes the next few strictly after now', () => {
    expect(quotaDueTimesAfter(s, 24, at('09:25'), 3)).toEqual([at('09:40'), at('10:00'), at('10:20')]);
  });

  it('does not re-offer an instant exactly now', () => {
    expect(quotaDueTimesAfter(s, 24, at('09:20'), 1)).toEqual([at('09:40')]);
  });

  it('runs dry rather than wrapping once the run is over', () => {
    expect(quotaDueTimesAfter(s, 24, at('17:30'), 6)).toEqual([]);
  });

  it('is unaffected by how many have been logged', () => {
    // Deliberately not quotaNextDueAt: logging three at once must not buy an
    // hour of quiet on a cadence.
    expect(quotaDueTimesAfter(s, 24, at('09:25'), 1)).toEqual([at('09:40')]);
  });
});

describe('isQuotaRunOver', () => {
  const s = span({ windowStart: '09:00', windowEnd: '17:00' });

  it('is false inside the run', () => {
    expect(isQuotaRunOver(s, at('16:59'))).toBe(false);
  });

  it('is true from the closing instant on', () => {
    expect(isQuotaRunOver(s, at('17:00'))).toBe(true);
    expect(isQuotaRunOver(s, at('23:00'))).toBe(true);
  });
});

// A weekly target's span — see Task.quotaPeriod. Aug 26 2026 is a Wednesday,
// and every case below is stated against that so the day arithmetic is
// checkable by eye rather than by rerunning the function.
describe('quotaWeekStart', () => {
  // 02:00 rather than midnight throughout: the whole reason this subtracts days
  // instead of calling startOfWeek is that the reset time has to survive.
  const wed = new Date('2026-08-26T02:00:00');

  it('walks back to Sunday when the week starts on Sunday', () => {
    expect(quotaWeekStart(wed, 0)).toEqual(new Date('2026-08-23T02:00:00'));
  });

  it('walks back to Monday when the week starts on Monday', () => {
    expect(quotaWeekStart(wed, 1)).toEqual(new Date('2026-08-24T02:00:00'));
  });

  // The bug this exists to avoid: startOfWeek would zero the clock and hand a
  // 2 AM user a week beginning two hours before all of their days do.
  it('keeps the day-reset time rather than snapping to midnight', () => {
    expect(quotaWeekStart(wed, 0).getHours()).toBe(2);
  });

  it('is a no-op on a day that already is the week start', () => {
    const sun = new Date('2026-08-23T02:00:00');
    expect(quotaWeekStart(sun, 0)).toEqual(sun);
  });

  // Sunday under a Monday-start week is day *seven*, not day zero — the case a
  // plain subtraction without the +7 modulo gets wrong by a whole week.
  it('reads Sunday as the last day of a Monday-start week', () => {
    const sun = new Date('2026-08-23T02:00:00');
    expect(quotaWeekStart(sun, 1)).toEqual(new Date('2026-08-17T02:00:00'));
  });
});

describe('quotaWeekSpan', () => {
  const wed = new Date('2026-08-26T02:00:00');

  it('runs the seven days from the week start', () => {
    expect(quotaWeekSpan({ quotaStartedAt: null, dayStart: wed, weekStartsOn: 0 })).toEqual({
      start: new Date('2026-08-23T02:00:00'),
      end: new Date('2026-08-30T02:00:00'),
    });
  });

  // The invariant the feature rests on: every day of one week agrees on the
  // span, so the pace ramp a task reads on Thursday is the same one it read on
  // Sunday and the count doesn't reset underneath it mid-week. (The input is
  // always a logical day start, never an arbitrary moment — getQuotaSpan hands
  // it getCurrentDayStart().)
  it('gives every day of the same week one span', () => {
    const spans = [23, 24, 25, 26, 27, 28, 29].map(d =>
      quotaWeekSpan({
        quotaStartedAt: null,
        dayStart: new Date(`2026-08-${d}T02:00:00`),
        weekStartsOn: 0,
      }),
    );
    expect(new Set(spans.map(s => +s.start)).size).toBe(1);
    expect(spans[0]).toEqual({
      start: new Date('2026-08-23T02:00:00'),
      end: new Date('2026-08-30T02:00:00'),
    });
  });

  // ...and the next day starts a new one, which is what makes the rollover
  // sweep's period comparison fire exactly once a week.
  it('starts a new span on the following week', () => {
    const sun = new Date('2026-08-30T02:00:00');
    expect(quotaWeekSpan({ quotaStartedAt: null, dayStart: sun, weekStartsOn: 0 }).start)
      .toEqual(sun);
  });

  it('lets a run started this week move the start', () => {
    const started = '2026-08-25T09:00:00';
    expect(quotaWeekSpan({ quotaStartedAt: started, dayStart: wed, weekStartsOn: 0 }).start)
      .toEqual(new Date(started));
  });

  // Same guard quotaRunSpan keeps for a stale daily stamp, one period up: an
  // app left closed must not resume last week's run.
  it('ignores a stamp from an earlier week', () => {
    expect(quotaWeekSpan({ quotaStartedAt: '2026-08-19T09:00:00', dayStart: wed, weekStartsOn: 0 }).start)
      .toEqual(new Date('2026-08-23T02:00:00'));
  });

  it('ignores an unparseable stamp rather than producing an invalid span', () => {
    expect(quotaWeekSpan({ quotaStartedAt: 'not a date', dayStart: wed, weekStartsOn: 0 }).start)
      .toEqual(new Date('2026-08-23T02:00:00'));
  });
});

// A weekly target set up partway through a week, and the smaller count its
// first week asks for.
describe('weekly target proration', () => {
  // Thu Aug 27 2026, with a 2am day reset kept on the instant.
  const thu = new Date('2026-08-27T02:00:00');
  const row = (o: Partial<Parameters<typeof quotaProrationPatch>[0]> = {}) => ({
    quotaPeriod: 'week' as const,
    targetCount: 3,
    seriesDefaults: null,
    quotaStartedAt: null,
    ...o,
  });

  it('counts the days left in the week, its own included', () => {
    expect(weekDaysLeft(thu, 1)).toBe(4); // Thu..Sun
    expect(weekDaysLeft(thu, 0)).toBe(3); // Thu..Sat
    expect(weekDaysLeft(new Date('2026-08-24T02:00:00'), 1)).toBe(7); // Monday
    expect(weekDaysLeft(new Date('2026-08-30T02:00:00'), 1)).toBe(1); // Sunday
  });

  it('scales to the days left, rounding, and never below one', () => {
    expect(proratedWeeklyTarget(3, 4)).toBe(2);
    expect(proratedWeeklyTarget(5, 4)).toBe(3);
    expect(proratedWeeklyTarget(3, 1)).toBe(1);
    expect(proratedWeeklyTarget(7, 3)).toBe(3);
  });

  it('has nothing to offer on a full week, or when the count rounds back up', () => {
    expect(proratedWeeklyTarget(3, 7)).toBeNull();
    expect(proratedWeeklyTarget(3, 6)).toBeNull(); // 2.57 rounds to 3
    expect(proratedWeeklyTarget(2, 6)).toBeNull(); // 1.71 rounds to 2
  });

  it('writes this week\'s count, the full one to come back to, and the ramp start', () => {
    const patch = quotaProrationPatch(row(), 3, 2, thu);
    expect(patch).toEqual({
      targetCount: 2,
      seriesDefaults: { targetCount: 3 },
      quotaStartedAt: thu.toISOString(),
    });
    expect(proratedFrom({ ...row(), ...patch })).toBe(3);
  });

  it('keeps whatever else is waiting in seriesDefaults', () => {
    const patch = quotaProrationPatch(row({ seriesDefaults: { title: 'Run' } }), 3, 2, thu);
    expect(patch!.seriesDefaults).toEqual({ title: 'Run', targetCount: 3 });
  });

  it('does nothing to a row already in that state', () => {
    const scaled = { ...row(), ...quotaProrationPatch(row(), 3, 2, thu)! };
    expect(quotaProrationPatch(scaled, 3, 2, thu)).toBeNull();
  });

  it('puts the full count back when turned off, and clears the ramp start', () => {
    const scaled = { ...row({ seriesDefaults: { title: 'Run' } }), ...quotaProrationPatch(row({ seriesDefaults: { title: 'Run' } }), 3, 2, thu)! };
    expect(quotaProrationPatch(scaled, 3, null, thu)).toEqual({
      targetCount: 3,
      seriesDefaults: { title: 'Run' },
      quotaStartedAt: null,
    });
  });

  // An edit that raises the target writes the new full count first; the old
  // one left waiting would hand next week 3 instead of 4.
  it('replaces a stale full count rather than reverting to it', () => {
    const edited = row({ targetCount: 4, seriesDefaults: { targetCount: 3 }, quotaStartedAt: thu.toISOString() });
    expect(quotaProrationPatch(edited, 4, null, thu)).toEqual({ targetCount: 4, seriesDefaults: null, quotaStartedAt: null });
    expect(quotaProrationPatch(edited, 4, 2, thu)!.seriesDefaults).toEqual({ targetCount: 4 });
  });

  it('leaves an ordinary weekly target alone', () => {
    expect(quotaProrationPatch(row(), 3, null, thu)).toBeNull();
    expect(proratedFrom(row())).toBeNull();
  });

  it('is only a weekly thing', () => {
    expect(quotaProrationPatch(row({ quotaPeriod: 'day' }), 3, 2, thu)).toBeNull();
    expect(proratedFrom(row({ quotaPeriod: 'day', targetCount: 2, seriesDefaults: { targetCount: 3 } }))).toBeNull();
  });
});

describe('firstWeekPatch', () => {
  const thu = new Date('2026-08-27T00:00:00');
  const fresh = (o: Partial<Parameters<typeof firstWeekPatch>[0]> = {}) => ({
    quotaPeriod: 'week' as const, targetCount: 3, seriesDefaults: null, quotaStartedAt: null,
    rotationEnabled: false, quotaIntervalMinutes: null, ...o,
  });

  it('scales a plain weekly target set up midweek', () => {
    expect(firstWeekPatch(fresh(), thu, 1)).toMatchObject({ targetCount: 2, seriesDefaults: { targetCount: 3 } });
  });

  it('leaves a full week, a daily target and a rotation alone', () => {
    expect(firstWeekPatch(fresh(), new Date('2026-08-24T00:00:00'), 1)).toBeNull();
    expect(firstWeekPatch(fresh({ quotaPeriod: 'day' }), thu, 1)).toBeNull();
    expect(firstWeekPatch(fresh({ rotationEnabled: true }), thu, 1)).toBeNull();
  });

  it('counts from the first due day, never from before today', () => {
    const today = new Date('2026-08-25T00:00:00');
    expect(firstWeekAnchor(thu, today)).toEqual(thu);
    expect(firstWeekAnchor(new Date('2026-08-20T00:00:00'), today)).toEqual(today);
    expect(firstWeekAnchor(null, today)).toEqual(today);
  });
});

// A clock time earlier than the day's start belongs to the small hours at the
// end of that logical day, the same roll getWindowThreshold applies. Placed on
// the day start's own date instead, a "01:00–03:00" window under a 4 AM reset
// sat entirely before the day began: the whole target was owed the instant it
// opened and every due instant was a day old.
describe('quotaRunSpan under a day start after midnight', () => {
  const DAY_4AM = new Date('2026-08-26T04:00:00');
  const spanAt4 = (input: Partial<Parameters<typeof quotaRunSpan>[0]> = {}) =>
    quotaRunSpan({
      windowStart: null, windowEnd: null, quotaStartedAt: null,
      activeHoursStart: '08:00', activeHoursEnd: '22:00', dayStart: DAY_4AM, ...input,
    });

  it('rolls a small-hours window onto the end of the logical day', () => {
    const s = spanAt4({ windowStart: '01:00', windowEnd: '03:00' });
    expect(s.start).toEqual(new Date('2026-08-27T01:00:00'));
    expect(s.end).toEqual(new Date('2026-08-27T03:00:00'));
  });

  it('keeps a daytime window on the day start\'s own date', () => {
    const s = spanAt4({ windowStart: '09:00', windowEnd: '17:00' });
    expect(s.start).toEqual(new Date('2026-08-26T09:00:00'));
    expect(s.end).toEqual(new Date('2026-08-26T17:00:00'));
  });

  it('still resolves an overnight window into the next calendar day', () => {
    const s = spanAt4({ windowStart: '22:00', windowEnd: '02:00' });
    expect(s.start).toEqual(new Date('2026-08-26T22:00:00'));
    expect(s.end).toEqual(new Date('2026-08-27T02:00:00'));
  });
});
