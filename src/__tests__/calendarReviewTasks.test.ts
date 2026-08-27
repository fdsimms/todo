import {
  CALENDAR_REVIEW_TITLE,
  calendarReviewDayKey,
  calendarReviewEventsFor,
  wantsCalendarReview,
} from '../utils/calendarReviewTasks';
import type { BusyEvent } from '../utils/calendarBusy';
import type { Task } from '../types';

function makeEvent(overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'e-1',
    title: 'Dentist',
    start: '2026-08-26T14:00:00.000Z',
    end: '2026-08-26T15:00:00.000Z',
    allDay: false,
    calendarId: 'cal-1',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

describe('wantsCalendarReview', () => {
  it('wants a task when tomorrow has an event', () => {
    expect(wantsCalendarReview([makeEvent()])).toBe(true);
  });

  it('wants nothing for a day with no events', () => {
    expect(wantsCalendarReview([])).toBe(false);
  });
});

describe('calendarReviewDayKey', () => {
  it('reads the day key off a calendarReview task', () => {
    const task = { generatedKind: 'calendarReview', generatedSourceId: '2026-08-26' } as
      Pick<Task, 'generatedKind' | 'generatedSourceId'>;
    expect(calendarReviewDayKey(task)).toBe('2026-08-26');
  });

  it('is null for any other kind of task, even one carrying a source id', () => {
    const task = { generatedKind: 'projectReview', generatedSourceId: '2026-08-26' } as
      Pick<Task, 'generatedKind' | 'generatedSourceId'>;
    expect(calendarReviewDayKey(task)).toBeNull();
  });
});

describe('CALENDAR_REVIEW_TITLE', () => {
  it('never varies — there is exactly one question this asks', () => {
    expect(CALENDAR_REVIEW_TITLE).toBe('Review tomorrow\'s calendar');
  });
});

describe('calendarReviewEventsFor', () => {
  const task = { generatedKind: 'calendarReview', generatedSourceId: '2026-08-26' } as
    Pick<Task, 'generatedKind' | 'generatedSourceId'>;

  it('reads back the events on the day the task names', () => {
    const onDay = makeEvent({
      id: 'e-on-day',
      start: new Date(2026, 7, 26, 14).toISOString(),
      end: new Date(2026, 7, 26, 15).toISOString(),
    });
    const dayBefore = makeEvent({
      id: 'e-before',
      start: new Date(2026, 7, 25, 14).toISOString(),
      end: new Date(2026, 7, 25, 15).toISOString(),
    });
    const dayAfter = makeEvent({
      id: 'e-after',
      start: new Date(2026, 7, 27, 14).toISOString(),
      end: new Date(2026, 7, 27, 15).toISOString(),
    });
    expect(calendarReviewEventsFor(task, [onDay, dayBefore, dayAfter])).toEqual([onDay]);
  });

  it('is empty for any other kind of task, even one carrying a source id', () => {
    const other = { generatedKind: 'projectReview', generatedSourceId: '2026-08-26' } as
      Pick<Task, 'generatedKind' | 'generatedSourceId'>;
    expect(calendarReviewEventsFor(other, [makeEvent()])).toEqual([]);
  });

  it('is empty when there is nothing on the day', () => {
    expect(calendarReviewEventsFor(task, [])).toEqual([]);
  });
});
