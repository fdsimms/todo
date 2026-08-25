import {
  CALENDAR_REVIEW_TITLE,
  calendarReviewDayKey,
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
