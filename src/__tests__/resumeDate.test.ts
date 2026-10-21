import { hasStaleDate, resumeDueDateFor } from '../utils/resumeDate';
import { getCurrentDayStart, getLogicalToday } from '../utils/dateUtils';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0, holidaySet: 'none', customHolidays: [] }) },
}));

const past = () => new Date(getCurrentDayStart().getTime() - 49 * 86400000).toISOString();
const future = () => new Date(getCurrentDayStart().getTime() + 5 * 86400000).toISOString();

describe('hasStaleDate', () => {
  it('is true only for a day already gone by', () => {
    expect(hasStaleDate({ dueDate: past() })).toBe(true);
    expect(hasStaleDate({ dueDate: future() })).toBe(false);
    expect(hasStaleDate({ dueDate: null })).toBe(false);
  });
});

describe('resumeDueDateFor', () => {
  it('keeps the day on "keep" and for a day that has not passed', () => {
    expect(resumeDueDateFor({ dueDate: past() }, 'keep')).toBeUndefined();
    expect(resumeDueDateFor({ dueDate: future() }, 'today')).toBeUndefined();
    expect(resumeDueDateFor({ dueDate: null }, 'none')).toBeUndefined();
  });

  it('moves a stale day to the logical today or clears it', () => {
    expect(resumeDueDateFor({ dueDate: past() }, 'today')).toBe(getLogicalToday().toISOString());
    expect(resumeDueDateFor({ dueDate: past() }, 'none')).toBeNull();
  });
});
