import { format } from 'date-fns/format';
import type { DeliverableKind, Task } from '../types';

/**
 * "Ask on completion" — tasks that finish by recording a decision.
 *
 * "Pick a date for the trip" isn't done when you tick it, it's done when you
 * know the date; the tick is where that answer wants capturing, and until now
 * it went into the notes by hand or nowhere at all. See `Task.deliverableKind`
 * for why the answer is its own field rather than appended text, and
 * `taskKinds.ts` for why this is an additive field rather than a fifth kind.
 *
 * Everything here is pure and shared: the row, the prompt sheet, the Logbook
 * and the editor all read the same formatter, so none of them can invent a
 * second spelling of the same answer.
 *
 * **There is deliberately nowhere for the value to go yet.** No target field,
 * no "write this into the project's dates" mechanism — the value is stored
 * typed so a later feature (an itinerary) can read it, and a general
 * write-anywhere mechanism would be a lot of surface area for one reader. See
 * #1253.
 */

/** Longest answer a 'text' deliverable will keep — "The Anchor, 7pm", not an essay. */
export const DELIVERABLE_TEXT_MAX_LENGTH = 200;

/** Label, glyph, and what the answer is, in picker order. */
export const DELIVERABLE_META: {
  key: DeliverableKind;
  label: string;
  icon: string;
  /** The one line under the picker — this is the only in-app documentation the field has. */
  hint: string;
}[] = [
  { key: 'text', label: 'Text', icon: 'text-outline', hint: 'Asks you to type an answer when you complete it.' },
  { key: 'date', label: 'Date', icon: 'calendar-outline', hint: 'Asks you to pick a date when you complete it.' },
  { key: 'number', label: 'Number', icon: 'calculator-outline', hint: 'Asks you for a number when you complete it.' },
];

export function deliverableMeta(kind: DeliverableKind) {
  return DELIVERABLE_META.find(m => m.key === kind)!;
}

/** Whether completing this task should stop and ask for an answer. */
export function asksOnCompletion(task: Pick<Task, 'deliverableKind'>): boolean {
  return task.deliverableKind !== null;
}

/**
 * The stored form of a typed answer, or null if there isn't one.
 *
 * Null is a real answer everywhere in this feature — a completion may never be
 * blocked on giving one — so an empty or unparseable input clears the value
 * rather than failing.
 */
export function normalizeDeliverableValue(kind: DeliverableKind, raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  switch (kind) {
    case 'text':
      return trimmed.slice(0, DELIVERABLE_TEXT_MAX_LENGTH);
    case 'number': {
      // Separators the user typed are theirs to type; the stored value is the
      // bare number so anything reading it later can parse it without knowing
      // which locale wrote it.
      const bare = trimmed.replace(/[\s,]/g, '');
      return /^-?\d+(\.\d+)?$/.test(bare) ? bare : null;
    }
    case 'date': {
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
  }
}

/**
 * The answer as it's shown — on the Logbook row, in the prompt, in the editor.
 *
 * A date reads absolutely ("Sat 12 Sep"), never through `formatScheduledDate`:
 * that one says "Today", which is a recorded decision's *worst* rendering,
 * true only on the day it was written and quietly wrong every day after.
 */
export function formatDeliverableValue(kind: DeliverableKind, value: string | null): string | null {
  if (value === null) return null;
  switch (kind) {
    case 'text':
      return value;
    case 'number':
      return groupDigits(value);
    case 'date': {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      return format(d, d.getFullYear() === new Date().getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy');
    }
  }
}

/** A task's answer, ready to render, or null if it has no deliverable or wasn't answered. */
export function formatTaskDeliverable(task: Pick<Task, 'deliverableKind' | 'deliverableValue'>): string | null {
  if (task.deliverableKind === null) return null;
  return formatDeliverableValue(task.deliverableKind, task.deliverableValue);
}

/** Thousands separators for display only — the stored value stays bare. */
function groupDigits(value: string): string {
  const [whole, fraction] = value.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}
