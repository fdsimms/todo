import type { ContextRow } from '../types';
import type { TodayListItem } from '../utils/taskGrouping';
import {
  contextCardPositions,
  contextSectionSummaries,
  isCardRow,
} from '../utils/contextCards';

// Same two mocks dayContextRows.test.ts installs, for the same reason: the
// module imports reach the settings and category stores.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ use24HourTime: false, dayResetTime: '00:00' }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ categories: [], getCategoryByName: () => null }),
  },
}));

function row(id: string, kind: ContextRow['kind'], extra: Partial<ContextRow> = {}): ContextRow {
  return { id, sourceId: id, kind, title: id, caption: '', category: 'X', now: false, calendarTag: null, ...extra };
}
const ctx = (r: ContextRow): TodayListItem => ({ type: 'context', row: r }) as TodayListItem;
const header = (label: string): TodayListItem => ({ type: 'header', label }) as TodayListItem;
const task = (id: string): TodayListItem => ({ type: 'task', task: { id } }) as unknown as TodayListItem;

describe('isCardRow', () => {
  it('draws readouts as cards and leaves anything with an action out', () => {
    expect(isCardRow(row('event-1', 'event'))).toBe(true);
    expect(isCardRow(row('health-steps', 'health'))).toBe(true);
    expect(isCardRow(row('meal-1', 'meal'))).toBe(false);
    expect(isCardRow(row('moved-1', 'event'))).toBe(false);
  });
});

describe('contextCardPositions', () => {
  it('marks a run first, middle and last, and a lone row single', () => {
    const items = [ctx(row('event-a', 'event')), ctx(row('event-b', 'event')), ctx(row('event-c', 'event')), task('t')];
    const pos = contextCardPositions(items);
    expect([...pos.entries()]).toEqual([['event-a', 'first'], ['event-b', 'middle'], ['event-c', 'last']]);
    expect(contextCardPositions([ctx(row('event-a', 'event'))]).get('event-a')).toBe('single');
  });

  it('ends a run at a meal or a moved event, and gives those no position', () => {
    const items = [
      ctx(row('event-a', 'event')),
      ctx(row('moved-x', 'event')),
      ctx(row('event-b', 'event')),
      ctx(row('meal-1', 'meal')),
    ];
    const pos = contextCardPositions(items);
    expect(pos.get('event-a')).toBe('single');
    expect(pos.get('event-b')).toBe('single');
    expect(pos.has('moved-x')).toBe(false);
    expect(pos.has('meal-1')).toBe(false);
  });

  it('keeps a health card and an event card apart when they touch', () => {
    const pos = contextCardPositions([ctx(row('health-steps', 'health')), ctx(row('event-a', 'event'))]);
    expect(pos.get('health-steps')).toBe('single');
    expect(pos.get('event-a')).toBe('single');
  });
});

describe('contextSectionSummaries', () => {
  it('reads a health section out as its own figures', () => {
    const items = [
      header('Health'),
      ctx(row('health-steps', 'health', { title: '5,348 steps' })),
      ctx(row('health-activeEnergy', 'health', { title: '510 active cal' })),
    ];
    expect(contextSectionSummaries(items).get('Health')).toBe('5,348 steps · 510 active cal');
  });

  it('counts events and names the next timed one, skipping all-day', () => {
    const items = [
      header('Calendar'),
      ctx(row('event-a', 'event', { title: 'Birthday', caption: 'All day' })),
      ctx(row('event-b', 'event', { title: 'Dentist', caption: '2:30 PM' })),
    ];
    expect(contextSectionSummaries(items).get('Calendar')).toBe('2 events · next Dentist 2:30 PM');
  });

  it('names the running event instead of the next one', () => {
    const items = [
      header('Calendar'),
      ctx(row('event-a', 'event', { title: 'Standup', caption: 'Now', now: true })),
      ctx(row('event-b', 'event', { title: 'Dentist', caption: '2:30 PM' })),
    ];
    expect(contextSectionSummaries(items).get('Calendar')).toBe('2 events · Standup now');
  });

  it('says nothing for a section that also holds a task, a meal or a moved event', () => {
    const withTask = [header('Home'), ctx(row('event-a', 'event')), task('t')];
    const withMeal = [header('Home'), ctx(row('event-a', 'event')), ctx(row('meal-1', 'meal'))];
    const withMoved = [header('Home'), ctx(row('event-a', 'event')), ctx(row('moved-1', 'event'))];
    for (const items of [withTask, withMeal, withMoved]) {
      expect(contextSectionSummaries(items).size).toBe(0);
    }
  });
});
