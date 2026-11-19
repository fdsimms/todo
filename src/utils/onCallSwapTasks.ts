import type { BusyEvent } from './calendarBusy';
import type { Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import {
  eventOccurrenceKey,
  eventOccurrenceKeys,
  eventTaskSourceId,
  parseEventTaskSourceId,
  type HandledEventTasks,
} from './eventTasks';

/**
 * "Find someone to swap on call for <event>": a task for each event that runs into
 * an on-call stretch (`onCallConflicts` in `onCall.ts`). The rules module for the
 * `onCallSwap` generator, store-free like `eventTasks.ts` beside it; the sweep is
 * `src/store/onCallSwapSweep.ts`.
 *
 * **It shares the event-task machinery rather than copying it.** The source id is
 * an event task's (`${occurrenceKey}#onCallSwap`, the occurrence key being the
 * event id and its start, so one standing meeting is not one task for all of them),
 * and the record that keeps a deleted or ticked task from coming back is the same
 * `eventTaskHandled`, pruned on the same expiry (the event's end). A rule id that
 * can never be a real `generateId()` is what keeps the two from touching.
 *
 * **A conflict going away does not delete the task.** The user may already have
 * messaged someone, and the app never removes a row a person has likely acted on.
 * It says so on the row instead (`onCallSwapContext`), derived at render and never
 * stored, so a swap that was arranged reads as done and not as a task that vanished.
 */

/** The rule id in an on-call swap's source id. Never a `generateId()` value. */
export const ON_CALL_SWAP_RULE_ID = 'onCallSwap';

/** The longest an event's title may run in a task title before it is cut. */
const TITLE_EVENT_MAX = 60;

export function onCallSwapSourceId(event: Pick<BusyEvent, 'id' | 'start' | 'externalId'>): string {
  return eventTaskSourceId(eventOccurrenceKey(event), ON_CALL_SWAP_RULE_ID);
}

/** The task's own words. An untitled event is real, so it gets a name here. */
export function onCallSwapTitle(event: Pick<BusyEvent, 'title'>): string {
  const name = event.title.trim() || 'an event';
  const short = name.length > TITLE_EVENT_MAX ? `${name.slice(0, TITLE_EVENT_MAX - 1).trimEnd()}…` : name;
  return `Find someone to swap on call for ${short}`;
}

/** One conflict the sweep has decided to write a task for. */
export interface OnCallSwapMatch {
  sourceId: string;
  event: BusyEvent;
  /** ISO. When the occurrence ends, which is when its handled entry expires. */
  endsAt: string;
}

/**
 * The conflicts still worth a task: not over, and not already written for or
 * answered. A key written before the calendar server named the event is checked
 * too (`eventOccurrenceKeys`), or the same event is two tasks across the change.
 */
export function matchedOnCallSwaps(
  conflicts: readonly BusyEvent[],
  now: Date,
  handled: Readonly<HandledEventTasks>,
): OnCallSwapMatch[] {
  const out: OnCallSwapMatch[] = [];
  for (const event of conflicts) {
    const end = Date.parse(event.end);
    if (!Number.isFinite(end) || end <= now.getTime()) continue;
    const alreadyHandled = eventOccurrenceKeys(event).some(
      key => eventTaskSourceId(key, ON_CALL_SWAP_RULE_ID) in handled,
    );
    if (alreadyHandled) continue;
    out.push({ sourceId: onCallSwapSourceId(event), event, endsAt: event.end });
  }
  return out;
}

/** The occurrence key and its start (ISO) in an on-call swap task, or null. */
function occurrenceOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): { key: string; start: string } | null {
  const parsed = parseEventTaskSourceId(generatedSourceOf(task, 'onCallSwap'));
  if (!parsed || parsed.ruleId !== ON_CALL_SWAP_RULE_ID) return null;
  const start = parsed.occurrenceKey.slice(parsed.occurrenceKey.lastIndexOf('|') + 1);
  return Number.isFinite(Date.parse(start)) ? { key: parsed.occurrenceKey, start } : null;
}

export interface OnCallSwapContext {
  /** "Sat, Nov 21 7:00 PM", or "No longer conflicts" once it doesn't. */
  label: string;
  stale: boolean;
}

/**
 * What the row says about its event: when it is, or that it no longer clashes.
 * Null for any other task, and while the read hasn't landed (`loaded`): an unread
 * window must not be taken for "the conflict is gone".
 *
 * Stale means the event's occurrence is no longer among the conflicts and has not
 * started: it moved, was deleted or the shift was swapped. An event that has begun
 * is left alone, since it may have dropped out only by finishing.
 */
export function onCallSwapContext(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  conflicts: readonly BusyEvent[],
  loaded: boolean,
  now: Date,
  formatWhen: (event: Pick<BusyEvent, 'start' | 'allDay'> | { start: string; allDay: boolean }) => string,
): OnCallSwapContext | null {
  const occurrence = occurrenceOf(task);
  if (!occurrence || !loaded) return null;
  const event = conflicts.find(e => eventOccurrenceKeys(e).includes(occurrence.key));
  if (event) return { label: formatWhen(event), stale: false };
  if (Date.parse(occurrence.start) <= now.getTime()) return null;
  return { label: 'No longer conflicts', stale: true };
}
