import {
  formatCategorySchedule,
  formatScheduleDays,
  formatScheduleTime,
} from '../utils/categorySchedule';
import type { Category } from '../types';

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'c1',
    name: 'Work',
    scheduleDays: null,
    scheduleStart: null,
    scheduleEnd: null,
    hideOnVacation: false,
    defaultTimeSegments: [],
    excludeFromPinSuggestions: false,
    sortOrder: 1,
    emoji: null,
    ...overrides,
  };
}

describe('formatScheduleTime', () => {
  it('drops :00 minutes and uses 12-hour clock', () => {
    expect(formatScheduleTime('09:00')).toBe('9 AM');
    expect(formatScheduleTime('18:00')).toBe('6 PM');
    expect(formatScheduleTime('00:00')).toBe('12 AM');
    expect(formatScheduleTime('12:00')).toBe('12 PM');
  });

  it('keeps non-zero minutes', () => {
    expect(formatScheduleTime('13:30')).toBe('1:30 PM');
    expect(formatScheduleTime('07:05')).toBe('7:05 AM');
  });
});

describe('formatScheduleDays', () => {
  it('names the common day sets', () => {
    expect(formatScheduleDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(formatScheduleDays([0, 6])).toBe('Weekends');
    expect(formatScheduleDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
  });

  it('lists anything else, in week order regardless of input order', () => {
    expect(formatScheduleDays([3, 1])).toBe('Mo We');
    expect(formatScheduleDays([5, 4, 3, 2, 1])).toBe('Weekdays');
  });
});

describe('formatCategorySchedule', () => {
  it('returns null when the category has no schedule', () => {
    expect(formatCategorySchedule(null)).toBeNull();
    expect(formatCategorySchedule(makeCategory())).toBeNull();
  });

  it('returns null when only part of the schedule is set', () => {
    expect(formatCategorySchedule(makeCategory({ scheduleDays: [1], scheduleStart: '09:00' }))).toBeNull();
  });

  it('returns null for an empty day list', () => {
    expect(
      formatCategorySchedule(makeCategory({ scheduleDays: [], scheduleStart: '09:00', scheduleEnd: '18:00' }))
    ).toBeNull();
  });

  it('summarises days and hours on one line', () => {
    expect(
      formatCategorySchedule(
        makeCategory({ scheduleDays: [1, 2, 3, 4, 5], scheduleStart: '09:00', scheduleEnd: '18:00' })
      )
    ).toBe('Weekdays, 9 AM–6 PM');
  });
});
