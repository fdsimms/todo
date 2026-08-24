import { format } from 'date-fns/format';
import type { DeliverableKind, Task } from '../types';
import { activeChainStep, nextChainStep, type ChainCarrier } from './chain';

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
 * **There is exactly one place the value goes, and it is opt-in per step.** A
 * date step inside a chain can send its answer to the next step's due date
 * (`ChainItem.deliverableDatesNextStep`) — "Book haircut" answers with the
 * appointment and "Get haircut" lands on it. That is still deliberately not a
 * general write-anywhere mechanism: it is one reader, in one place
 * (`completeTask`), reusing the date the chain was already going to give that
 * successor. Everywhere else the value is stored typed and read back by the
 * Logbook, Search and a project's decisions. See #1253.
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

/** What the deliverable reads need: the task's own question, plus its chain position. */
export type DeliverableSource = ChainCarrier & Pick<Task, 'deliverableKind'>;

/**
 * What a task asks for on completion, or null when it asks for nothing — the
 * single read for the question, the way `displayTitleFor` is the single read
 * for a name and `estimatedMinutesFor` for a duration.
 *
 * Mid-chain it's the active step's own question when that step has one. The
 * task-level kind covers the whole chain and rides `...effective` onto every
 * successor, so with only that to read, a two-step chain that asks a question
 * at step one asks it again at step two — "Book haircut" wants the date and
 * "Get haircut" doesn't want anything.
 *
 * Falls back to the task's kind exactly as `estimatedMinutesFor` falls back to
 * the task's estimate, and for the same reason: a chain that predates per-step
 * questions behaves precisely as it did. The way to make one step silent is to
 * leave the task's own "Ask on completion" at Nothing, which is what every
 * task starts as.
 */
export function deliverableKindFor(task: DeliverableSource): DeliverableKind | null {
  const step = activeChainStep(task);
  return step?.deliverableKind ?? task.deliverableKind ?? null;
}

/** Whether completing this task should stop and ask for an answer. */
export function asksOnCompletion(task: DeliverableSource): boolean {
  return deliverableKindFor(task) !== null;
}

/**
 * The chain step this task's answer is about to date, or null when the answer
 * is just being recorded.
 *
 * Both halves have to hold: the question in force at this step must be a date
 * *and* the step opted into moving the next one, and there has to be a next
 * step to move (the last step of a chain has nowhere to send it, and a
 * repeating chain's wrap is dated by the recurrence — see nextChainStep).
 *
 * The kind comes through `deliverableKindFor` rather than off the step, so a
 * date question declared once at the task level and passed on by one step
 * works like any other; the flag itself is only ever the step's, since only a
 * step has a next step.
 */
export function chainStepDatedByAnswer(task: DeliverableSource) {
  const step = activeChainStep(task);
  if (!step?.deliverableDatesNextStep || deliverableKindFor(task) !== 'date') return null;
  return nextChainStep(task);
}

/**
 * A stored date answer as a Date, or null if there isn't a usable one.
 *
 * The prompt sheet commits noon on the chosen day (see `noonOf` there), which
 * is the same instant `completeTask` gives a mid-chain successor — so an answer
 * flows into a due date with no re-anchoring. This still re-parses rather than
 * trusting the string: `normalizeDeliverableValue` runs in the sheet, and the
 * store is reachable without it.
 */
export function deliverableDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
export function formatTaskDeliverable(
  task: DeliverableSource & Pick<Task, 'deliverableValue'>,
): string | null {
  const kind = deliverableKindFor(task);
  if (kind === null) return null;
  return formatDeliverableValue(kind, task.deliverableValue);
}

/** Thousands separators for display only — the stored value stays bare. */
function groupDigits(value: string): string {
  const [whole, fraction] = value.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}
