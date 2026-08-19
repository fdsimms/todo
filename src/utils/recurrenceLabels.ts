import type { RecurrenceType, Task } from '../types';
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

/**
 * The same rule, as a **row** says it: "Weekly on Thu", not "Every week on Thu".
 *
 * There are deliberately two registers here, and the difference is the control
 * each one sits next to — not drift to be tidied away:
 *
 * - `describeRecurrence` is a **read-back**, rendered in the editor's Repeat
 *   row directly above the picker that sets it. It reads as a sentence stating
 *   the rule, because that's the sentence the six controls beneath it add up
 *   to, and it collapses more than three weekdays to a count because
 *   `disclosureValue` renders on one line.
 * - This one is a **caption** on a row, next to the repeat glyph. It was
 *   shortened on purpose (patch note `recurrence-label-remove-repeats`, from
 *   "Repeats weekly on Thu") precisely because that glyph already says the
 *   task repeats, so the word doesn't have to. It has room to name the days
 *   individually, and it carries the after-completion anchor, which the
 *   read-back leaves out because the picker gives that its own labelled group.
 *
 * `parseTaskInput`'s `describeSchedule` is *not* a third copy of this: it
 * describes a whole parsed schedule, including one with no recurrence at all
 * ("Tue, Jun 17"), off a `ParsedSchedule` rather than a stored row.
 */
export function describeTaskRecurrence(
  task: Pick<Task, 'recurrenceType' | 'recurrenceInterval' | 'recurrenceDays' | 'recurrenceMonthDay' | 'recurrenceWeekOrdinal' | 'recurrenceFromCompletion'>,
): string {
  const { recurrenceType: type, recurrenceInterval: interval, recurrenceDays: days } = task;
  if (type === 'none') return '';

  let text: string;
  if (type === 'daily') {
    text = interval === 1 ? 'Daily' : `Every ${interval} days`;
  } else if (type === 'weekly') {
    const base = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
    const named = days.map(d => DAY_NAMES[d]).join(', ');
    text = named ? `${base} on ${named}` : base;
  } else if (type === 'monthly') {
    const base = interval === 1 ? 'Monthly' : `Every ${interval} months`;
    const ordWord = ORDINAL_OPTIONS.find(o => o.value === task.recurrenceWeekOrdinal)?.label.toLowerCase();
    if (task.recurrenceWeekOrdinal !== null && days.length > 0 && ordWord) {
      // The one thing the row used to drop on the floor: an "every 2nd Tuesday"
      // task read as a bare "Monthly", which is a different schedule.
      text = `${base} on the ${ordWord} ${DAY_NAMES[days[0]]}`;
    } else if (task.recurrenceMonthDay === -1) {
      text = `${base} on the last day`;
    } else if (task.recurrenceMonthDay) {
      text = `${base} on the ${ordinal(task.recurrenceMonthDay)}`;
    } else {
      text = base;
    }
  } else {
    text = interval === 1 ? 'Yearly' : `Every ${interval} years`;
  }

  // Named here and nowhere else: on a row there is nothing else on screen
  // saying which end of the cycle the next date is measured from.
  return task.recurrenceFromCompletion ? `${text} · from completion` : text;
}

/**
 * A stored task's recurrence fields as the rule `describeRecurrence` takes.
 *
 * The editor builds the same object out of its own draft state rather than
 * from a row, which is why this takes a task and that stays inline — there is
 * no `Task` there to hand it.
 */
export function recurrenceRuleOf(
  task: Pick<Task, 'recurrenceType' | 'recurrenceInterval' | 'recurrenceDays' | 'recurrenceMonthDay' | 'recurrenceWeekOrdinal'>,
): RecurrenceRule {
  return {
    type: task.recurrenceType,
    interval: task.recurrenceInterval,
    days: task.recurrenceDays,
    monthDay: task.recurrenceMonthDay,
    weekOrdinal: task.recurrenceWeekOrdinal,
  };
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
