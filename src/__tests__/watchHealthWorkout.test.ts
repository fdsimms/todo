import {
  NO_WATCH_HEALTH_REQUESTS,
  RECENTLY_FINISHED_LIMIT,
  WATCH_RETRACT_LIMIT,
  WATCH_SPAN_TOLERANCE_MS,
  currentWatchHealthRequests,
  parseWatchHealthRequests,
  recentlyFinished,
  watchSpanDiffers,
  watchWorkoutTapTiming,
  withDrop,
  withRetractions,
  withoutRetraction,
} from '../utils/watchHealthWorkout';

const NOW = new Date(2026, 9, 18, 12);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('the workouts the watch is asked to retract', () => {
  it('adds each once, in order, and takes one off when the watch says it is done', () => {
    let r = withRetractions(NO_WATCH_HEALTH_REQUESTS, ['HK-1', 'HK-2', 'HK-1', ''], NOW);
    r = withRetractions(r, ['HK-2', 'HK-3'], NOW);
    expect(r.retract.map(x => x.id)).toEqual(['HK-1', 'HK-2', 'HK-3']);
    expect(withoutRetraction(r, 'HK-2').retract.map(x => x.id)).toEqual(['HK-1', 'HK-3']);
  });

  it('returns the same lists when nothing changes, so nothing is written for nothing', () => {
    const r = withRetractions(NO_WATCH_HEALTH_REQUESTS, ['HK-1'], NOW);
    expect(withRetractions(r, ['HK-1'], NOW)).toBe(r);
    expect(withoutRetraction(r, 'HK-9')).toBe(r);
  });

  it('keeps the newest past the cap, so a watch never seen again can’t grow it for ever', () => {
    const ids = Array.from({ length: WATCH_RETRACT_LIMIT + 5 }, (_, i) => `HK-${i}`);
    const r = withRetractions(NO_WATCH_HEALTH_REQUESTS, ids, NOW);
    expect(r.retract).toHaveLength(WATCH_RETRACT_LIMIT);
    expect(r.retract[0].id).toBe('HK-5');
  });

  it('is kept however old, since the watch may be away for days', () => {
    const r = { retract: [{ id: 'HK-1', at: hoursAgo(24 * 30) }], drop: [] };
    expect(currentWatchHealthRequests(r, NOW).retract).toHaveLength(1);
  });
});

describe('the measurements the watch is asked to throw away', () => {
  it('adds a session once, and forgets one over a day old', () => {
    let r = withDrop({ retract: [], drop: [{ id: 'old', at: hoursAgo(25) }] }, 'w1', NOW);
    r = withDrop(r, 'w1', NOW);
    expect(r.drop.map(d => d.id)).toEqual(['w1']);
    expect(currentWatchHealthRequests({ retract: [], drop: [{ id: 'w1', at: hoursAgo(2) }] }, NOW).drop).toHaveLength(1);
  });
});

describe('reading the stored lists', () => {
  it('reads what it can and leaves out the rest', () => {
    expect(parseWatchHealthRequests(JSON.stringify({
      retract: [{ id: 'HK-1', at: hoursAgo(1) }, { id: 'HK-1', at: hoursAgo(1) }, { id: '', at: hoursAgo(1) }, { id: 'HK-2', at: 'soon' }],
      drop: 'nope',
    }))).toEqual({ retract: [{ id: 'HK-1', at: hoursAgo(1) }], drop: [] });
  });

  it('is empty for nothing stored, or something unreadable', () => {
    expect(parseWatchHealthRequests(null)).toEqual(NO_WATCH_HEALTH_REQUESTS);
    expect(parseWatchHealthRequests('')).toEqual(NO_WATCH_HEALTH_REQUESTS);
    expect(parseWatchHealthRequests('[1,2]')).toEqual(NO_WATCH_HEALTH_REQUESTS);
    expect(parseWatchHealthRequests('{bad')).toEqual(NO_WATCH_HEALTH_REQUESTS);
  });
});

describe('the phone’s workouts finished lately', () => {
  it('lists the finished ones of the last day, newest first, and nothing live', () => {
    expect(recentlyFinished([
      { id: 'a', endedAt: hoursAgo(3) },
      { id: 'live', endedAt: null },
      { id: 'b', endedAt: hoursAgo(1) },
      { id: 'old', endedAt: hoursAgo(30) },
    ], NOW)).toEqual([
      { sessionId: 'b', endedAt: hoursAgo(1) },
      { sessionId: 'a', endedAt: hoursAgo(3) },
    ]);
  });

  it('keeps it short', () => {
    const many = Array.from({ length: RECENTLY_FINISHED_LIMIT + 3 }, (_, i) => ({ id: `s${i}`, endedAt: hoursAgo(i + 1) }));
    expect(recentlyFinished(many, NOW)).toHaveLength(RECENTLY_FINISHED_LIMIT);
  });
});

describe('the times the watch saved a workout at', () => {
  const row = { startedAt: hoursAgo(2), endedAt: hoursAgo(1) };
  const shifted = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

  it('match the row within the clocks’ rounding, and not past it', () => {
    expect(watchSpanDiffers(row, { start: row.startedAt, end: row.endedAt })).toBe(false);
    expect(watchSpanDiffers(row, { start: shifted(row.startedAt, 900), end: shifted(row.endedAt, -WATCH_SPAN_TOLERANCE_MS) })).toBe(false);
    expect(watchSpanDiffers(row, { start: row.startedAt, end: shifted(row.endedAt, 5 * 60_000) })).toBe(true);
    expect(watchSpanDiffers(row, { start: shifted(row.startedAt, -60_000), end: row.endedAt })).toBe(true);
  });

  it('can’t differ with nothing to compare: no span, a workout still going, a time that doesn’t read', () => {
    expect(watchSpanDiffers(row, null)).toBe(false);
    expect(watchSpanDiffers({ ...row, endedAt: null }, { start: row.startedAt, end: hoursAgo(0) })).toBe(false);
    expect(watchSpanDiffers(row, { start: 'soon', end: 'later' })).toBe(false);
  });
});

describe('when a drain in the background applies the watch’s saved workout', () => {
  const finished = { startedAt: hoursAgo(2), endedAt: hoursAgo(1) };
  const same = { start: finished.startedAt, end: finished.endedAt };
  const old = { start: finished.startedAt, end: hoursAgo(1.5) };
  const waiting = { ...finished, healthWorkoutId: null, measuredOnWatch: true };
  const phoneCopy = { ...finished, healthWorkoutId: 'HK-PHONE', measuredOnWatch: false };
  const watchCopy = { ...finished, healthWorkoutId: 'HK-WATCH', measuredOnWatch: true };

  it('applies at once when it needs nothing of the phone’s HealthKit', () => {
    expect(watchWorkoutTapTiming(undefined, 'HK-W', same)).toBe('now');
    expect(watchWorkoutTapTiming(waiting, 'HK-W', same)).toBe('now');
    expect(watchWorkoutTapTiming(waiting, null, old)).toBe('now');
    expect(watchWorkoutTapTiming(watchCopy, 'HK-W2', old)).toBe('now');
    // The phone's copy is at the row's times: the watch retracts its own.
    expect(watchWorkoutTapTiming(phoneCopy, 'HK-W', old)).toBe('now');
  });

  it('waits for the app in front to retract the phone’s copy, or to write one at times the watch’s no longer has', () => {
    expect(watchWorkoutTapTiming(phoneCopy, 'HK-W', same)).toBe('front');
    expect(watchWorkoutTapTiming(phoneCopy, null, null)).toBe('front');
    expect(watchWorkoutTapTiming(waiting, 'HK-W', old)).toBe('front');
  });
});
