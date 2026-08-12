import { describeRecurrence, recurrenceUnitLabel } from '../utils/recurrenceLabels';

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
