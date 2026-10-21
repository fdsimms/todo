import { defaultReminderAt } from '../utils/reminderDefault';

const STARTS = { morning: '06:00', afternoon: '12:00', evening: '18:00', night: '01:00' } as const;
const DAY = new Date(2026, 9, 20);

describe('defaultReminderAt', () => {
  it('starts at 9:00 on the day with no time of day', () => {
    expect(defaultReminderAt(DAY, [], STARTS, '00:00')).toEqual(new Date(2026, 9, 20, 9, 0));
  });

  it('starts when the earliest of the task’s times of day begins', () => {
    expect(defaultReminderAt(DAY, ['evening', 'afternoon'], STARTS, '00:00')).toEqual(new Date(2026, 9, 20, 12, 0));
    expect(defaultReminderAt(DAY, ['morning'], STARTS, '04:00')).toEqual(new Date(2026, 9, 20, 6, 0));
  });

  it('puts a night that starts after midnight at the end of the day, under a later reset', () => {
    expect(defaultReminderAt(DAY, ['night'], STARTS, '04:00')).toEqual(new Date(2026, 9, 21, 1, 0));
  });
});
