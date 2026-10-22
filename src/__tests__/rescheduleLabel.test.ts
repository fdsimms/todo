import { describeReschedule, movedDayLabel } from '../utils/rescheduleLabel';
import type { TimeOfDay } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 as 0 | 1 }),
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({ categories: [], getCategoryByName: jest.fn().mockReturnValue(null) })),
  },
}));

const NOW = new Date(2026, 9, 22, 12);
beforeAll(() => { jest.useFakeTimers().setSystemTime(NOW); });
afterAll(() => { jest.useRealTimers(); });

const task = (title: string, day: number, timeSegments: TimeOfDay[] = []) => ({
  title,
  dueDate: new Date(2026, 9, day, 9).toISOString(),
  deferUntil: null,
  timeSegments,
});
const day = (d: number) => new Date(2026, 9, d, 9);

describe('describeReschedule', () => {
  it('names the segment when a task stays on its day and only the time of day changes', () => {
    expect(describeReschedule([task('Play violin', 22)], day(22), ['evening'], '00:00'))
      .toBe('Moved “Play violin” to evening');
  });
  it('names the day when the day changes', () => {
    expect(describeReschedule([task('Play violin', 22)], day(23), ['evening'], '00:00'))
      .toBe('Moved “Play violin” to tomorrow');
  });
  it('names the day when nothing about the segments changed', () => {
    expect(describeReschedule([task('Play violin', 22, ['evening'])], day(22), ['evening'], '00:00'))
      .toBe('Moved “Play violin” to today');
  });
  it('names the day when the pick has no segments', () => {
    expect(describeReschedule([task('A', 22, ['evening'])], day(22), [], '00:00')).toBe('Moved “A” to today');
  });
  it('counts tasks when several move', () => {
    expect(describeReschedule([task('A', 22), task('B', 23), task('C', 24)], day(28), [], '00:00'))
      .toBe('Moved 3 tasks to Oct 28');
  });
  it('names the segment for several tasks all staying on the day', () => {
    expect(describeReschedule([task('A', 22), task('B', 22)], day(22), ['morning', 'afternoon'], '00:00'))
      .toBe('Moved 2 tasks to morning, afternoon');
  });
  it('names the day when only some tasks stay on it', () => {
    expect(describeReschedule([task('A', 22), task('B', 23)], day(22), ['evening'], '00:00'))
      .toBe('Moved 2 tasks to today');
  });
  it('says the date came off when cleared', () => {
    expect(describeReschedule([task('A', 22)], null, [], '00:00')).toBe('Took the date off “A”');
    expect(describeReschedule([task('A', 22), task('B', 22)], null, [], '00:00')).toBe('Took the date off 2 tasks');
  });
  it('lowercases today and tomorrow only', () => {
    expect(movedDayLabel(day(22), '00:00')).toBe('today');
    expect(movedDayLabel(day(23), '00:00')).toBe('tomorrow');
  });
});
