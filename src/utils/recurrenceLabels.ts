import type { RecurrenceType } from '../types';
import { ordinal } from './ordinal';

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

/**
 * Nth-weekday-of-month picker options ("every 2nd Tuesday", "every last Friday").
 *
 * Here rather than in `RecurrencePicker` because `describeRecurrence` below
 * needs the same five words, and a component is the wrong home for a pure
 * string table — same argument `ordinal.ts` makes about itself.
 */
export const ORDINAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface RecurrenceRule {
  type: RecurrenceType;
  interval: number;
  /** Weekdays, 0 = Sunday. Only meaningful for weekly, and for the monthly week-ordinal mode. */
  days?: number[];
  /** Day of month, or -1 for "last day". Null = same day as the due date. */
  monthDay?: number | null;
  /** Nth-weekday-of-month ("2nd Tuesday"); -1 = last. Null = not in that mode. */
  weekOrdinal?: number | null;
}

/** "Mon, Wed", "weekdays", "3 days" — how a set of weekdays reads in a summary. */
function describeDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'every day';
  if (sorted.length === 5 && sorted.every(d => d >= 1 && d <= 5)) return 'weekdays';
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return 'weekends';
  // Past three, the names stop fitting the row this ends up in — and a count
  // is what someone reading a collapsed summary actually wants to know.
  if (sorted.length > 3) return `${sorted.length} days`;
  return sorted.map(d => DAY_NAMES[d]).join(', ');
}

/**
 * The whole recurrence rule as one line: "Every 2 weeks on Mon, Wed",
 * "Every month on the last day".
 *
 * This is the read-back for the picker — it's what the Repeat row shows, sitting
 * directly above the controls, so the six things you can set add up to a
 * sentence rather than to six independent pill rows. It deliberately stops
 * short of the end condition and the on-schedule/after-completion anchor: both
 * have their own labelled group in the picker, and both push the line past what
 * an `EditorRow` value can show without truncating.
 */
export function describeRecurrence(rule: RecurrenceRule): string {
  const { type, interval, days = [], monthDay = null, weekOrdinal = null } = rule;
  if (type === 'none') return '';

  const unit = recurrenceUnitLabel(type, interval);
  // "Every 1 day" is how a form talks; "Every day" is how a person does.
  const base = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}`;

  if (type === 'weekly' && days.length > 0) return `${base} on ${describeDays(days)}`;

  if (type === 'monthly') {
    if (weekOrdinal !== null && days.length > 0) {
      const word = ORDINAL_OPTIONS.find(o => o.value === weekOrdinal)?.label.toLowerCase();
      if (word) return `${base} on the ${word} ${DAY_NAMES[days[0]]}`;
    }
    if (monthDay === -1) return `${base} on the last day`;
    if (monthDay !== null && monthDay > 0) return `${base} on the ${ordinal(monthDay)}`;
  }

  return base;
}
