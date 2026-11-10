import { subDays } from 'date-fns/subDays';
import {
  BACKFILL_AREAS,
  BACKFILL_CADENCE_DAYS,
  backfillAreaOf,
  backfillCadenceElapsed,
  backfillLinkUrl,
  clampBackfillThreshold,
  parseBackfillLastDayKeys,
  staleBackfillTasks,
  wantsBackfillTask,
  BACKFILL_THRESHOLD_MAX,
  BACKFILL_THRESHOLD_MIN,
} from '../utils/backfillTasks';
import { dayKeyOf } from '../utils/dateUtils';

// dateUtils reaches the settings store, which opens SQLite.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const row = (area: string | null, extra: object = {}) => ({
  generatedKind: 'backfill' as const,
  generatedSourceId: area,
  completed: false,
  archived: false,
  ...extra,
});

const zero = Object.fromEntries(BACKFILL_AREAS.map(a => [a, 0])) as Record<(typeof BACKFILL_AREAS)[number], number>;

describe('backfill tasks', () => {
  it('offers only once a pool reaches the threshold, and never an empty one', () => {
    expect(wantsBackfillTask(9, 10)).toBe(false);
    expect(wantsBackfillTask(10, 10)).toBe(true);
    expect(wantsBackfillTask(0, 0)).toBe(false);
  });

  it('clamps the threshold into its range', () => {
    expect(clampBackfillThreshold(0)).toBe(BACKFILL_THRESHOLD_MIN);
    expect(clampBackfillThreshold(10_000)).toBe(BACKFILL_THRESHOLD_MAX);
    expect(clampBackfillThreshold(12.4)).toBe(12);
  });

  it('reads the pool off the source id and refuses anything else', () => {
    expect(backfillAreaOf(row('recipe'))).toBe('recipe');
    expect(backfillAreaOf(row('nonsense'))).toBeNull();
    expect(backfillAreaOf({ generatedKind: 'pantryReview', generatedSourceId: 'recipe' })).toBeNull();
  });

  it('waits a week per pool before another offer', () => {
    const today = new Date(2026, 10, 9);
    expect(backfillCadenceElapsed(null, today)).toBe(true);
    expect(backfillCadenceElapsed('garbage', today)).toBe(true);
    expect(backfillCadenceElapsed(dayKeyOf(subDays(today, BACKFILL_CADENCE_DAYS - 1)), today)).toBe(false);
    expect(backfillCadenceElapsed(dayKeyOf(subDays(today, BACKFILL_CADENCE_DAYS)), today)).toBe(true);
  });

  it('parses stored marks, dropping unknown pools and non-strings', () => {
    expect(parseBackfillLastDayKeys(JSON.stringify({ task: '2026-11-01', bogus: '2026-11-02', recipe: 5 })))
      .toEqual({ task: '2026-11-01' });
    expect(parseBackfillLastDayKeys('not json')).toEqual({});
    expect(parseBackfillLastDayKeys(null)).toEqual({});
    expect(parseBackfillLastDayKeys('[]')).toEqual({});
  });

  it('marks a row stale only when its own pool is empty, not when it falls under the threshold', () => {
    const tasks = [row('task'), row('recipe'), row('person', { completed: true })];
    const stale = staleBackfillTasks(tasks, { ...zero, task: 2, recipe: 0 });
    expect(stale).toEqual([tasks[1]]);
  });
});
