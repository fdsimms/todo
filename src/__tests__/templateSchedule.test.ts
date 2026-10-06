import type { TaskTemplate, TemplateSchedule } from '../types';
import {
  defaultTemplateSchedule,
  describeTemplateSchedule,
  dueTemplateRun,
  periodKeyFor,
  scheduledRunName,
  schedulesEqual,
  triggerDayFor,
} from '../utils/templateSchedule';

// templateSchedule reaches dateUtils for getDayStart/dayKeyOf, which reaches
// the settings store — which nothing here needs, since every call below passes
// its own dayResetTime explicitly. Same defensive mock as mealPlanNudge.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

function schedule(overrides: Partial<TemplateSchedule> = {}): TemplateSchedule {
  return { ...defaultTemplateSchedule(), ...overrides };
}

function template(
  overrides: Partial<Pick<TaskTemplate, 'name' | 'schedule' | 'scheduleLastFiredKey'>> = {}
): Pick<TaskTemplate, 'name' | 'schedule' | 'scheduleLastFiredKey'> {
  return {
    name: 'Sunday reset',
    schedule: schedule(),
    scheduleLastFiredKey: null,
    ...overrides,
  };
}

/** Sunday 23 Aug 2026, 10am — after a 09:00 trigger. */
const SUNDAY_10AM = new Date(2026, 7, 23, 10, 0, 0);

describe('periodKeyFor', () => {
  it('keys a week by its own first day, following weekStartsOn', () => {
    const wednesday = new Date(2026, 7, 26);
    expect(periodKeyFor('weekly', wednesday, 0)).toBe('2026-08-23'); // Sunday
    expect(periodKeyFor('weekly', wednesday, 1)).toBe('2026-08-24'); // Monday
  });

  it('keys a month and a year by the calendar name', () => {
    const day = new Date(2026, 7, 26);
    expect(periodKeyFor('monthly', day, 0)).toBe('2026-08');
    expect(periodKeyFor('yearly', day, 0)).toBe('2026');
  });
});

describe('triggerDayFor', () => {
  it('finds the schedule weekday inside the day’s own week', () => {
    const wednesday = new Date(2026, 7, 26);
    const trigger = triggerDayFor(schedule({ weekday: 0 }), wednesday, 0);
    expect(trigger.getDate()).toBe(23);
  });

  it('clamps a month day to the length of a short month rather than skipping it', () => {
    const february = new Date(2026, 1, 10);
    const trigger = triggerDayFor(
      schedule({ frequency: 'monthly', monthDay: 31 }),
      february,
      0
    );
    expect(trigger.getMonth()).toBe(1);
    expect(trigger.getDate()).toBe(28);
  });

  it('puts a yearly trigger in its own month', () => {
    const january = new Date(2026, 0, 5);
    const trigger = triggerDayFor(
      schedule({ frequency: 'yearly', month: 10, monthDay: 1 }),
      january,
      0
    );
    expect(trigger.getMonth()).toBe(9);
    expect(trigger.getDate()).toBe(1);
  });
});

describe('dueTemplateRun', () => {
  it('is never due for a template with no schedule', () => {
    expect(dueTemplateRun(template({ schedule: null }), SUNDAY_10AM, 0, '00:00')).toBeNull();
  });

  it('fires once the trigger instant has passed', () => {
    const due = dueTemplateRun(template(), SUNDAY_10AM, 0, '00:00');
    expect(due?.periodKey).toBe('2026-08-23');
  });

  it('does not fire before the trigger time on the trigger day', () => {
    const sundayEarly = new Date(2026, 7, 23, 8, 0, 0);
    expect(dueTemplateRun(template(), sundayEarly, 0, '00:00')).toBeNull();
  });

  // An HH:MM earlier than the reset belongs to the small hours after the
  // trigger day, not the night before it (still the previous logical day).
  it('places a time earlier than the day reset after its day, not before it', () => {
    const early = template({ schedule: schedule({ weekday: 0, time: '01:00' }), scheduleLastFiredKey: '2026-08-16' });
    // Sunday's logical day runs 04:00 Sunday to 04:00 Monday, so its 01:00 is
    // Monday 01:00. At Sunday 10am that hasn't come yet (a bare setHours on
    // the calendar day read it as Sunday 01:00, already past).
    expect(dueTemplateRun(early, new Date(2026, 7, 23, 10, 0, 0), 0, '04:00')).toBeNull();
    // Monday 01:30 is still Sunday's logical day, and past its 01:00.
    const due = dueTemplateRun(early, new Date(2026, 7, 24, 1, 30, 0), 0, '04:00');
    expect(due?.periodKey).toBe('2026-08-23');
  });

  it('reads a time that is not HH:MM as the default rather than rolling it over', () => {
    const bad = template({ schedule: schedule({ time: '25:00' }) });
    expect(dueTemplateRun(bad, SUNDAY_10AM, 0, '00:00')?.periodKey).toBe('2026-08-23');
  });

  // The week's key is its first day, so switching week start mid-week makes
  // a new key for the same week.
  it('does not fire again this week after the week start changes', () => {
    const fired = template({ schedule: schedule({ weekday: 3 }), scheduleLastFiredKey: '2026-08-23' });
    expect(dueTemplateRun(fired, new Date(2026, 7, 27, 10, 0, 0), 1, '00:00')).toBeNull();
    // The next week still fires.
    expect(dueTemplateRun(fired, new Date(2026, 8, 3, 10, 0, 0), 1, '00:00')?.periodKey).toBe('2026-08-31');
  });

  it('does not fire twice for the same period', () => {
    const fired = template({ scheduleLastFiredKey: '2026-08-23' });
    expect(dueTemplateRun(fired, SUNDAY_10AM, 0, '00:00')).toBeNull();
  });

  it('still fires later in the week when the trigger day went unopened', () => {
    const wednesday = new Date(2026, 7, 26, 9, 0, 0);
    const due = dueTemplateRun(template(), wednesday, 0, '00:00');
    expect(due?.periodKey).toBe('2026-08-23');
  });

  // The no-backfill rule: three weeks away is one run, not three.
  it('fires once for the current period after several missed ones', () => {
    const threeWeeksLater = new Date(2026, 8, 13, 10, 0, 0);
    const stale = template({ scheduleLastFiredKey: '2026-08-23' });
    const due = dueTemplateRun(stale, threeWeeksLater, 0, '00:00');
    expect(due?.periodKey).toBe('2026-09-13');
  });

  it('dates the run to the day it actually fires, not the trigger day it was owed on', () => {
    const wednesday = new Date(2026, 7, 26, 9, 0, 0);
    const due = dueTemplateRun(template(), wednesday, 0, '00:00');
    expect(due?.anchors.start?.getDate()).toBe(26);
  });

  it('spans the anchor range when the schedule asks for one, and leaves it open otherwise', () => {
    const open = dueTemplateRun(template(), SUNDAY_10AM, 0, '00:00');
    expect(open?.anchors.end).toBeNull();

    const spanned = dueTemplateRun(
      template({ schedule: schedule({ anchorSpanDays: 7 }) }),
      SUNDAY_10AM,
      0,
      '00:00'
    );
    expect(spanned?.anchors.end?.getDate()).toBe(30);
  });

  // The grace-window rule from CLAUDE.md: a decision made at 1:30am with a
  // 02:00 reset belongs to the previous logical day.
  it('anchors to the logical day, not the calendar one, inside the grace window', () => {
    const mondayHalfOne = new Date(2026, 7, 24, 1, 30, 0);
    const due = dueTemplateRun(template(), mondayHalfOne, 0, '02:00');
    expect(due?.anchors.start?.getDate()).toBe(23);
    expect(due?.periodKey).toBe('2026-08-23');
  });

  it('reads the same instant as the next period once the reset time has passed', () => {
    const mondayThree = new Date(2026, 7, 24, 3, 0, 0);
    const due = dueTemplateRun(template(), mondayThree, 0, '02:00');
    expect(due?.anchors.start?.getDate()).toBe(24);
  });

  it('waits for a yearly schedule’s own month', () => {
    const yearly = template({ schedule: schedule({ frequency: 'yearly', month: 10, monthDay: 1 }) });
    expect(dueTemplateRun(yearly, new Date(2026, 0, 5, 12, 0, 0), 0, '00:00')).toBeNull();

    const october = dueTemplateRun(yearly, new Date(2026, 9, 2, 12, 0, 0), 0, '00:00');
    expect(october?.periodKey).toBe('2026');
  });
});

describe('scheduledRunName', () => {
  it('dates the run so two firings are told apart', () => {
    expect(scheduledRunName('Sunday reset', new Date(2026, 7, 23))).toBe('Sunday reset · Aug 23');
  });

  it('falls back to the date alone for an unnamed template', () => {
    expect(scheduledRunName('  ', new Date(2026, 7, 23))).toBe('Aug 23');
  });
});

describe('describeTemplateSchedule', () => {
  // disclosureValue is numberOfLines={1}. The label takes ~105pt of the card's
  // 358pt at 390pt, leaving the value roughly 27 characters before it truncates
  // mid-word — which is what the long-form sentence ("Every Sunday from 9:00
  // AM") did. Checked against a mock at real widths, not derived.
  const FITS = 27;

  it('says never when nothing is scheduled', () => {
    expect(describeTemplateSchedule(null)).toBe('Never');
  });

  it('names the weekday, the month day and the yearly date', () => {
    expect(describeTemplateSchedule(schedule())).toBe('Sundays · 9:00 AM');
    expect(describeTemplateSchedule(schedule({ frequency: 'monthly', monthDay: 1 })))
      .toBe('1st each month · 9:00 AM');
    expect(describeTemplateSchedule(schedule({ frequency: 'yearly', month: 10, monthDay: 1 })))
      .toBe('Oct 1 each year · 9:00 AM');
  });

  it('honours 24-hour time', () => {
    expect(describeTemplateSchedule(schedule({ time: '17:30' }), true)).toBe('Sundays · 17:30');
  });

  it('fits the one line it is given, in every frequency’s longest form', () => {
    const longest = [
      schedule({ weekday: 3, time: '11:30' }),
      schedule({ frequency: 'monthly', monthDay: 31, time: '11:30' }),
      schedule({ frequency: 'yearly', month: 9, monthDay: 30, time: '11:30' }),
    ];
    longest.forEach(s => {
      expect(describeTemplateSchedule(s).length).toBeLessThanOrEqual(FITS);
    });
  });
});

describe('schedulesEqual', () => {
  it('compares field by field, so key order is not a change', () => {
    const a = schedule({ weekday: 3 });
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as TemplateSchedule;
    expect(schedulesEqual(a, reordered)).toBe(true);
  });

  it('sees a changed field, and tells null apart from a schedule', () => {
    expect(schedulesEqual(schedule({ weekday: 3 }), schedule({ weekday: 4 }))).toBe(false);
    expect(schedulesEqual(null, null)).toBe(true);
    expect(schedulesEqual(schedule(), null)).toBe(false);
  });
});

// The trigger time is a time of day on the trigger's *logical* day, so a time
// earlier than the day reset belongs to the small hours at that day's end. Set
// on the trigger day's calendar date it was already past when the day began,
// and the run fired at the day's start, a logical day early by the clock.
describe('dueTemplateRun under a day start after midnight', () => {
  it('waits for a trigger time before the reset until the end of the trigger day', () => {
    const early = template({ schedule: schedule({ time: '02:00' }) });
    // Sunday 05:00 is logical Sunday; a 02:00 trigger is Monday 02:00 by the clock.
    expect(dueTemplateRun(early, new Date(2026, 7, 23, 5, 0, 0), 0, '04:00')).toBeNull();
    const due = dueTemplateRun(early, new Date(2026, 7, 24, 2, 30, 0), 0, '04:00');
    expect(due?.periodKey).toBe('2026-08-23');
  });

  it('keeps a daytime trigger on the trigger day itself', () => {
    expect(dueTemplateRun(template(), new Date(2026, 7, 23, 8, 0, 0), 0, '04:00')).toBeNull();
    expect(dueTemplateRun(template(), SUNDAY_10AM, 0, '04:00')?.periodKey).toBe('2026-08-23');
  });
});
