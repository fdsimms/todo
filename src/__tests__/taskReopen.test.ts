import { reopenBlockedByLater } from '../utils/taskReopen';
import type { Task } from '../types';

// taskReopen reaches visibilityUtils, which reads these stores.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', vacationMode: false, newTaskDefaults: {}, activeHoursStart: '08:00', activeHoursEnd: '22:00', holidaySet: 'us', customHolidays: [] }),
  },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: jest.fn(() => ({ categories: [], getCategoryByName: jest.fn().mockReturnValue(null) })) },
}));
jest.mock('../store/useProjectStore', () => ({
  useProjectStore: { getState: jest.fn(() => ({ getProjectById: jest.fn().mockReturnValue(null) })) },
}));

const row = (over: Partial<Task>): Task => ({ id: 't', completed: false, previousOccurrenceId: null, ...over }) as Task;

describe('reopenBlockedByLater', () => {
  it('is null for a task that is not completed', () => {
    expect(reopenBlockedByLater(row({ id: 'a' }), [])).toBeNull();
  });

  it('is null for the newest completed occurrence, whose successor is still open', () => {
    const a = row({ id: 'a', completed: true });
    const b = row({ id: 'b', previousOccurrenceId: 'a' });
    expect(reopenBlockedByLater(a, [a, b])).toBeNull();
  });

  it('is null for a completed one-off with no successor', () => {
    const a = row({ id: 'a', completed: true });
    expect(reopenBlockedByLater(a, [a])).toBeNull();
  });

  it('says to reopen the most recent when the successor has been done', () => {
    const a = row({ id: 'a', completed: true });
    const b = row({ id: 'b', completed: true, previousOccurrenceId: 'a' });
    const c = row({ id: 'c', previousOccurrenceId: 'b' });
    expect(reopenBlockedByLater(a, [a, b, c])).toMatch(/most recent/);
    // The middle one is refused too, and the newest completed is not.
    expect(reopenBlockedByLater(b, [a, b, c])).toBeNull();
  });

  it('leaves a dated series alone, whose next set points back at the last date done', () => {
    const a = row({ id: 'a', completed: true, seriesId: 's' } as Partial<Task>);
    const next = row({ id: 'n', completed: true, seriesId: 's', previousOccurrenceId: 'a' } as Partial<Task>);
    expect(reopenBlockedByLater(a, [a, next])).toBeNull();
  });

  it('counts a successor that was marked missed as done', () => {
    const a = row({ id: 'a', completed: true });
    const b = row({ id: 'b', completed: true, missedAt: '2026-01-01T00:00:00.000Z', previousOccurrenceId: 'a' } as Partial<Task>);
    expect(reopenBlockedByLater(a, [a, b])).not.toBeNull();
  });
});
