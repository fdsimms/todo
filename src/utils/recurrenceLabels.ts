import type { RecurrenceType } from '../types';

const RECURRENCE_UNIT_SINGULAR: Record<Exclude<RecurrenceType, 'none'>, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

/** "day"/"days", "week"/"weeks", … — pluralized for the given interval. */
export function recurrenceUnitLabel(type: RecurrenceType, interval: number): string {
  if (type === 'none') return '';
  const unit = RECURRENCE_UNIT_SINGULAR[type];
  return interval === 1 ? unit : `${unit}s`;
}
