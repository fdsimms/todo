import {
  quotaRunSpan,
  quotaTargetForInterval,
  quotaDueTimes,
  quotaDueTimesAfter,
  isQuotaRunOver,
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

  it('survives a span that does not resolve, and a nonsense interval', () => {
    expect(quotaTargetForInterval(span({ windowStart: '17:00', windowEnd: '09:00' }), 20)).toBe(2);
    expect(quotaTargetForInterval(span({ windowStart: '09:00', windowEnd: '17:00' }), 0)).toBe(2);
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

  it('is empty for a span that does not resolve', () => {
    expect(quotaDueTimes(span({ windowStart: '17:00', windowEnd: '09:00' }), 24)).toEqual([]);
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
