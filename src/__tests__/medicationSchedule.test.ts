import {
  describeSchedule,
  describeScheduleStatus,
  parseSchedule,
  scheduleStatus,
  type MedicationSchedule,
} from '../utils/medicationSchedule';

const everyOther: MedicationSchedule = { kind: 'interval', everyDays: 2 };
const mwf: MedicationSchedule = { kind: 'weekdays', days: [1, 3, 5] };

// 2026-10-21 is a Wednesday.
describe('parseSchedule', () => {
  it('reads both kinds back', () => {
    expect(parseSchedule(everyOther)).toEqual(everyOther);
    expect(parseSchedule({ kind: 'weekdays', days: [5, 1, 1, 3] })).toEqual(mwf);
  });

  it('drops anything malformed', () => {
    expect(parseSchedule(null)).toBeNull();
    expect(parseSchedule({ kind: 'interval', everyDays: 0 })).toBeNull();
    expect(parseSchedule({ kind: 'interval', everyDays: 1.5 })).toBeNull();
    expect(parseSchedule({ kind: 'interval', everyDays: 31 })).toBeNull();
    expect(parseSchedule({ kind: 'weekdays', days: [] })).toBeNull();
    expect(parseSchedule({ kind: 'weekdays', days: [7, -1] })).toBeNull();
    expect(parseSchedule({ kind: 'monthly' })).toBeNull();
  });
});

describe('describeSchedule', () => {
  it('says the interval in words', () => {
    expect(describeSchedule({ kind: 'interval', everyDays: 1 })).toBe('Every day');
    expect(describeSchedule(everyOther)).toBe('Every other day');
    expect(describeSchedule({ kind: 'interval', everyDays: 3 })).toBe('Every 3 days');
  });

  it('lists weekdays, and calls all seven every day', () => {
    expect(describeSchedule(mwf)).toBe('Mon, Wed, Fri');
    expect(describeSchedule({ kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day');
  });
});

describe('scheduleStatus, every N days', () => {
  it('is due now with no dose yet', () => {
    expect(scheduleStatus(everyOther, [], '2026-10-21')).toEqual({ state: 'dueToday', nextDueKey: '2026-10-21', daysLate: 0 });
  });

  it('counts from the last dose, not from the first', () => {
    expect(scheduleStatus(everyOther, ['2026-10-15', '2026-10-20'], '2026-10-21'))
      .toEqual({ state: 'upcoming', nextDueKey: '2026-10-22', daysLate: 0 });
    expect(scheduleStatus(everyOther, ['2026-10-19'], '2026-10-21').state).toBe('dueToday');
  });

  it('is taken today after a dose today, with the next one two days on', () => {
    expect(scheduleStatus(everyOther, ['2026-10-21'], '2026-10-21'))
      .toEqual({ state: 'takenToday', nextDueKey: '2026-10-23', daysLate: 0 });
  });

  it('says how late a missed dose is, and a late dose resets the count', () => {
    expect(scheduleStatus(everyOther, ['2026-10-16'], '2026-10-21')).toEqual({ state: 'overdue', nextDueKey: '2026-10-21', daysLate: 3 });
    expect(scheduleStatus(everyOther, ['2026-10-16', '2026-10-21'], '2026-10-21').nextDueKey).toBe('2026-10-23');
  });

  it('ignores a dose dated after today', () => {
    expect(scheduleStatus(everyOther, ['2026-10-30'], '2026-10-21').state).toBe('dueToday');
  });

  it('works across a month end', () => {
    expect(scheduleStatus(everyOther, ['2026-10-31'], '2026-10-31').nextDueKey).toBe('2026-11-02');
  });
});

describe('scheduleStatus, certain weekdays', () => {
  it('is due on a scheduled day with no dose', () => {
    expect(scheduleStatus(mwf, [], '2026-10-21')).toEqual({ state: 'dueToday', nextDueKey: '2026-10-21', daysLate: 0 });
  });

  it('is taken today once a dose is recorded, and points at the next scheduled day', () => {
    expect(scheduleStatus(mwf, ['2026-10-21'], '2026-10-21'))
      .toEqual({ state: 'takenToday', nextDueKey: '2026-10-23', daysLate: 0 });
  });

  it('is upcoming on an off day, and never carries a missed day forward', () => {
    expect(scheduleStatus(mwf, ['2026-10-16'], '2026-10-22')).toEqual({ state: 'upcoming', nextDueKey: '2026-10-23', daysLate: 0 });
    expect(scheduleStatus(mwf, [], '2026-10-24').nextDueKey).toBe('2026-10-26');
  });

  it('a dose on an off day does not make it taken today for a scheduled one', () => {
    expect(scheduleStatus({ kind: 'weekdays', days: [5] }, ['2026-10-22'], '2026-10-22').state).toBe('upcoming');
  });
});

describe('describeScheduleStatus', () => {
  it('reads each state', () => {
    expect(describeScheduleStatus({ state: 'dueToday', nextDueKey: '2026-10-21', daysLate: 0 }, '2026-10-21')).toBe('Due today');
    expect(describeScheduleStatus({ state: 'overdue', nextDueKey: '2026-10-21', daysLate: 3 }, '2026-10-21')).toBe('Due today, 3 days past its day');
    expect(describeScheduleStatus({ state: 'overdue', nextDueKey: '2026-10-21', daysLate: 1 }, '2026-10-21')).toBe('Due today, 1 day past its day');
    expect(describeScheduleStatus({ state: 'takenToday', nextDueKey: '2026-10-22', daysLate: 0 }, '2026-10-21')).toBe('Taken today. Next tomorrow');
    expect(describeScheduleStatus({ state: 'upcoming', nextDueKey: '2026-10-23', daysLate: 0 }, '2026-10-21')).toBe('Next on Fri, Oct 23');
  });
});
