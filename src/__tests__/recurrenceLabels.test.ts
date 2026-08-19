import { describeRecurrence, describeTaskRecurrence, recurrenceUnitLabel } from '../utils/recurrenceLabels';
import type { Task } from '../types';

describe('recurrenceUnitLabel', () => {
  it('pluralizes off the interval', () => {
    expect(recurrenceUnitLabel('daily', 1)).toBe('day');
    expect(recurrenceUnitLabel('daily', 2)).toBe('days');
    expect(recurrenceUnitLabel('weekly', 1)).toBe('week');
    expect(recurrenceUnitLabel('monthly', 3)).toBe('months');
    expect(recurrenceUnitLabel('yearly', 1)).toBe('year');
  });

  it('has nothing to say about a task that does not repeat', () => {
    expect(recurrenceUnitLabel('none', 1)).toBe('');
  });
});

describe('describeRecurrence', () => {
  it('drops the "1" rather than saying "Every 1 day"', () => {
    expect(describeRecurrence({ type: 'daily', interval: 1 })).toBe('Every day');
    expect(describeRecurrence({ type: 'weekly', interval: 1 })).toBe('Every week');
    expect(describeRecurrence({ type: 'yearly', interval: 1 })).toBe('Every year');
  });

  it('keeps the count past one', () => {
    expect(describeRecurrence({ type: 'daily', interval: 3 })).toBe('Every 3 days');
    expect(describeRecurrence({ type: 'weekly', interval: 2 })).toBe('Every 2 weeks');
  });

  it('is empty for a task that does not repeat', () => {
    expect(describeRecurrence({ type: 'none', interval: 1 })).toBe('');
  });

  describe('weekly days', () => {
    it('names up to three', () => {
      expect(describeRecurrence({ type: 'weekly', interval: 2, days: [1, 3] }))
        .toBe('Every 2 weeks on Mon, Wed');
      expect(describeRecurrence({ type: 'weekly', interval: 1, days: [1, 3, 5] }))
        .toBe('Every week on Mon, Wed, Fri');
    });

    it('sorts them however they were tapped', () => {
      expect(describeRecurrence({ type: 'weekly', interval: 1, days: [3, 1] }))
        .toBe('Every week on Mon, Wed');
    });

    it('counts past three, where the names would not fit the row', () => {
      expect(describeRecurrence({ type: 'weekly', interval: 1, days: [0, 1, 3, 5] }))
        .toBe('Every week on 4 days');
    });

    it('recognizes the sets that have their own word', () => {
      expect(describeRecurrence({ type: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] }))
        .toBe('Every week on weekdays');
      expect(describeRecurrence({ type: 'weekly', interval: 1, days: [0, 6] }))
        .toBe('Every week on weekends');
      expect(describeRecurrence({ type: 'weekly', interval: 1, days: [0, 1, 2, 3, 4, 5, 6] }))
        .toBe('Every week on every day');
    });

    it('falls back to the bare interval with no day chosen', () => {
      expect(describeRecurrence({ type: 'weekly', interval: 1, days: [] })).toBe('Every week');
    });
  });

  describe('monthly anchors', () => {
    it('says the day of the month', () => {
      expect(describeRecurrence({ type: 'monthly', interval: 1, monthDay: 3 }))
        .toBe('Every month on the 3rd');
      expect(describeRecurrence({ type: 'monthly', interval: 2, monthDay: 22 }))
        .toBe('Every 2 months on the 22nd');
    });

    it('spells out the last-day sentinel rather than showing "-1st"', () => {
      expect(describeRecurrence({ type: 'monthly', interval: 1, monthDay: -1 }))
        .toBe('Every month on the last day');
    });

    it('says the nth weekday', () => {
      expect(describeRecurrence({ type: 'monthly', interval: 1, weekOrdinal: 2, days: [2] }))
        .toBe('Every month on the 2nd Tue');
      expect(describeRecurrence({ type: 'monthly', interval: 1, weekOrdinal: -1, days: [5] }))
        .toBe('Every month on the last Fri');
    });

    it('leaves the anchor out when it is the due date', () => {
      expect(describeRecurrence({ type: 'monthly', interval: 1, monthDay: null }))
        .toBe('Every month');
    });

    // The picker seeds a weekday when the mode is picked, but a rule arriving
    // from anywhere else may not have one — better a short summary than
    // "on the 2nd undefined".
    it('falls back when the week-ordinal mode has no weekday yet', () => {
      expect(describeRecurrence({ type: 'monthly', interval: 1, weekOrdinal: 2, days: [] }))
        .toBe('Every month');
    });
  });

  it('ignores weekdays on a type that has no use for them', () => {
    expect(describeRecurrence({ type: 'daily', interval: 1, days: [1, 3] })).toBe('Every day');
    expect(describeRecurrence({ type: 'yearly', interval: 1, monthDay: 4 })).toBe('Every year');
  });
});

describe('describeTaskRecurrence', () => {
  // Only the fields the label reads — the row register takes a stored task
  // rather than a rule, since the anchor lives on the row too.
  const rule = (over: Partial<Task> = {}) => ({
    recurrenceType: 'none' as Task['recurrenceType'],
    recurrenceInterval: 1,
    recurrenceDays: [] as number[],
    recurrenceMonthDay: null,
    recurrenceWeekOrdinal: null,
    recurrenceFromCompletion: false,
    ...over,
  });

  it('says nothing for a task that does not repeat', () => {
    expect(describeTaskRecurrence(rule())).toBe('');
  });

  // The register's whole point, and the reason it isn't describeRecurrence:
  // the row draws a repeat glyph beside this, so the word is already said.
  it('is the short form, where the read-back is a sentence', () => {
    expect(describeTaskRecurrence(rule({ recurrenceType: 'daily' }))).toBe('Daily');
    expect(describeRecurrence({ type: 'daily', interval: 1 })).toBe('Every day');

    expect(describeTaskRecurrence(rule({ recurrenceType: 'weekly', recurrenceDays: [4] })))
      .toBe('Weekly on Thu');
    expect(describeRecurrence({ type: 'weekly', interval: 1, days: [4] })).toBe('Every week on Thu');
  });

  it('names every weekday, where the one-line read-back counts them', () => {
    // It has the width the editor row hasn't, and the days are the schedule.
    expect(describeTaskRecurrence(rule({ recurrenceType: 'weekly', recurrenceDays: [1, 2, 3, 4, 5] })))
      .toBe('Weekly on Mon, Tue, Wed, Thu, Fri');
    expect(describeRecurrence({ type: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] }))
      .toBe('Every week on weekdays');
  });

  it('keeps the interval', () => {
    expect(describeTaskRecurrence(rule({ recurrenceType: 'daily', recurrenceInterval: 3 })))
      .toBe('Every 3 days');
    expect(describeTaskRecurrence(rule({ recurrenceType: 'weekly', recurrenceInterval: 2, recurrenceDays: [1] })))
      .toBe('Every 2 weeks on Mon');
    expect(describeTaskRecurrence(rule({ recurrenceType: 'yearly' }))).toBe('Yearly');
    expect(describeTaskRecurrence(rule({ recurrenceType: 'yearly', recurrenceInterval: 2 })))
      .toBe('Every 2 years');
  });

  it('reads a monthly anchor', () => {
    expect(describeTaskRecurrence(rule({ recurrenceType: 'monthly' }))).toBe('Monthly');
    expect(describeTaskRecurrence(rule({ recurrenceType: 'monthly', recurrenceMonthDay: 3 })))
      .toBe('Monthly on the 3rd');
    expect(describeTaskRecurrence(rule({ recurrenceType: 'monthly', recurrenceMonthDay: -1 })))
      .toBe('Monthly on the last day');
  });

  // The row used to drop this on the floor: an "every 2nd Tuesday" task read
  // as a bare "Monthly", which is a different schedule.
  it('reads the nth-weekday-of-month mode', () => {
    expect(describeTaskRecurrence(rule({ recurrenceType: 'monthly', recurrenceWeekOrdinal: 2, recurrenceDays: [2] })))
      .toBe('Monthly on the 2nd Tue');
    expect(describeTaskRecurrence(rule({ recurrenceType: 'monthly', recurrenceWeekOrdinal: -1, recurrenceDays: [5] })))
      .toBe('Monthly on the last Fri');
  });

  it('falls back when the week-ordinal mode has no weekday yet', () => {
    expect(describeTaskRecurrence(rule({ recurrenceType: 'monthly', recurrenceWeekOrdinal: 2, recurrenceDays: [] })))
      .toBe('Monthly');
  });

  // It carried the interval only in the branch with no anchor, so a
  // two-monthly rule on the 3rd claimed to be monthly.
  it('keeps the interval alongside a monthly anchor', () => {
    expect(describeTaskRecurrence(rule({ recurrenceType: 'monthly', recurrenceInterval: 2, recurrenceMonthDay: 3 })))
      .toBe('Every 2 months on the 3rd');
  });

  // Named here and not in the read-back, which has the picker's own labelled
  // group for it directly underneath.
  it('names the after-completion anchor', () => {
    expect(describeTaskRecurrence(rule({ recurrenceType: 'daily', recurrenceFromCompletion: true })))
      .toBe('Daily · from completion');
    expect(describeRecurrence({ type: 'daily', interval: 1 })).toBe('Every day');
  });
});
