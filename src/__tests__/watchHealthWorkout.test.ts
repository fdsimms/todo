import {
  NO_WATCH_HEALTH_REQUESTS,
  RECENTLY_FINISHED_LIMIT,
  WATCH_RETRACT_LIMIT,
  currentWatchHealthRequests,
  parseWatchHealthRequests,
  recentlyFinished,
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
