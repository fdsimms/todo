import type { GroceryListEntry, Task } from '../types';
import { completionTapFor, offersMealLogOnCompletion } from './completionTap';

/**
 * Taps on a widget that apply without bringing the app forward.
 *
 * The widget's first checkbox (`CompleteTaskIntent`) opens the app on every
 * tap, so that the row's completion animation plays and anything the task asks
 * on completion gets asked. For a plain task there's nothing to ask, and ticking
 * three things off the home screen meant three trips into the app and back.
 * Those taps now go to `CompleteTaskQuietlyIntent` and `CheckGroceryItemIntent`
 * (`targets/todo-widget/WidgetQuietIntents.swift`), which run in the widget's
 * own process and only queue the tap. The app applies the queue the next time
 * it comes forward, with nothing on screen moving.
 *
 * **Which tasks still open the app is `widgetTapNeedsApp`, decided twice.**
 * Once when the snapshot is written, to pick the intent a row's checkbox runs,
 * and again here at drain time, because the task may have changed in between
 * (a question added in the editor on another device, a target's last unit
 * coming due). A tap that turns out to need the app is handed to
 * `useWidgetCompletionStore`, which is the path the opening intent already
 * takes, and Today runs it the next time a row for it mounts.
 *
 * What the quiet path costs is immediacy: the next occurrence of a repeating
 * task, its streak and any sync wait until the app next opens. The intent
 * cancels the task's own pending reminder as it queues the tap, so the one
 * thing that would otherwise visibly disagree with the widget (a reminder for
 * something already checked off) doesn't.
 */

/**
 * One queued tap. A JSON record in `widget_quiet_taps.json`, written by the
 * Swift intents and read here.
 */
export interface QuietTap {
  /**
   * `complete` checks a task off, `unit` logs one unit of a daily target (the
   * widget sends these for every target row, so a run of taps is a run of
   * units), `grocery` puts an item in the cart on one list.
   */
  kind: 'complete' | 'unit' | 'grocery';
  /** The task id, or the grocery item id. */
  id: string;
  /** The grocery list the row was on; null is the home list. Tasks carry null. */
  listId: string | null;
  /** When the tap happened, ISO. */
  at: string;
  /**
   * Set on a tap made on the Apple Watch: the watch's own id for it, which the
   * watch settles its drawing by (WatchSession.swift). Kept through a drain so
   * a tap put back on the queue (`tapsToRequeue`) is still the same tap there.
   */
  watchTapId?: string;
}

export type QuietTapAction =
  | { type: 'complete'; id: string; at: string }
  | { type: 'logUnit'; id: string }
  /** Needs a person after all: run it through the opening intent's path. */
  | { type: 'handToApp'; id: string; at: string }
  | { type: 'checkGrocery'; itemId: string; listId: string | null };

/**
 * Whether a widget tap on this task has to bring the app forward to be done
 * right: anything a tap in the app answers with a sheet, a picker, a refusal or
 * a follow-up question rather than a plain tick or one unit.
 */
export function widgetTapNeedsApp(task: Task, mealLogPrompt: boolean): boolean {
  const tap = completionTapFor(task);
  if (tap === 'log-unit') return false;
  if (tap !== 'complete') return true;
  // Both of these still complete the task, but follow it with a question the
  // app asks in its own UI: "Set a reminder?" and "what did you eat?".
  return Boolean(task.completionTimerMinutes) || offersMealLogOnCompletion(task, mealLogPrompt);
}

/**
 * Reads the queue file. Anything malformed is dropped rather than failing the
 * whole drain: the file is deleted once read, so a bad entry kept back would
 * only be lost later instead.
 */
export function parseQuietTaps(json: string): QuietTap[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const taps: QuietTap[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { kind, id, listId, at, watchTapId } = entry as Record<string, unknown>;
    if (kind !== 'complete' && kind !== 'unit' && kind !== 'grocery') continue;
    if (typeof id !== 'string' || id === '') continue;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
    const tap: QuietTap = { kind, id, listId: typeof listId === 'string' && listId !== '' ? listId : null, at };
    if (typeof watchTapId === 'string' && watchTapId !== '') tap.watchTapId = watchTapId;
    taps.push(tap);
  }
  return taps;
}

/**
 * What to do with each queued tap, judged against the stores as they are now.
 *
 * Taps are walked in order against a working copy of each task, so three
 * units on a target of eight log three, and the one that meets the target
 * completes it (through `logQuotaUnit`, which hands off to `completeTask`
 * itself). Once a task is done, later taps on it are dropped.
 *
 * `isCurrentDay` answers whether a tap's time falls in today's logical day. A
 * unit tapped on an earlier day is dropped rather than logged: the rollover has
 * already closed that day's count, and logging it now would credit today with
 * a glass drunk yesterday. A completion keeps its tap time instead
 * (`completeTask`'s `completedAt`), which is what the opening path does too.
 */
export function planQuietTaps(
  taps: readonly QuietTap[],
  tasks: readonly Task[],
  entries: readonly GroceryListEntry[],
  mealLogPrompt: boolean,
  isCurrentDay: (iso: string) => boolean,
): QuietTapAction[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const working = new Map<string, Task>();
  const settled = new Set<string>();
  const checked = new Set<string>();
  const actions: QuietTapAction[] = [];

  for (const tap of taps) {
    if (tap.kind === 'grocery') {
      const key = `${tap.listId ?? ''}\u0000${tap.id}`;
      if (checked.has(key)) continue;
      const entry = entries.find(e => e.itemId === tap.id && e.listId === tap.listId);
      // Off the list, already in the cart, or one side of an either/or. The
      // widget never offers a tick on that last kind (ticking one option is
      // how the choice gets made, which deletes the others, and that belongs
      // in front of the list), but a row can have become one since.
      if (!entry || entry.checked || entry.choiceGroup) continue;
      checked.add(key);
      actions.push({ type: 'checkGrocery', itemId: tap.id, listId: tap.listId });
      continue;
    }

    if (settled.has(tap.id)) continue;
    const task = working.get(tap.id) ?? byId.get(tap.id);
    if (!task || task.completed || task.archived) continue;

    const tapKind = completionTapFor(task);
    if (tapKind === 'log-unit') {
      if (!isCurrentDay(tap.at)) continue;
      actions.push({ type: 'logUnit', id: tap.id });
      working.set(tap.id, { ...task, progressCount: task.progressCount + 1 });
      continue;
    }
    settled.add(tap.id);
    if (widgetTapNeedsApp(task, mealLogPrompt)) {
      actions.push({ type: 'handToApp', id: tap.id, at: tap.at });
    } else if (tap.kind === 'unit') {
      // The unit that meets the target. logQuotaUnit completes the task itself.
      if (isCurrentDay(tap.at)) actions.push({ type: 'logUnit', id: tap.id });
    } else {
      actions.push({ type: 'complete', id: tap.id, at: tap.at });
    }
  }
  return actions;
}

/**
 * The taps to put back on the queue instead of handing them to the app, when
 * the drain ran with nobody looking (a watch tap that woke the app in the
 * background).
 *
 * A hand-off goes to `useWidgetCompletionStore`, which lives in memory and is
 * read by the Today screen. With the app in the background there may be no
 * screen at all, and iOS can end the process before anyone opens it, so a tap
 * handed off then would be gone with nothing left to retry from. Every tap on
 * a handed-off task goes back, in its original order, so the next foreground
 * drain plans it exactly as this one did and hands it over with a person there.
 */
export function tapsToRequeue(taps: readonly QuietTap[], handedOverIds: ReadonlySet<string>): QuietTap[] {
  return taps.filter(tap => tap.kind !== 'grocery' && handedOverIds.has(tap.id));
}
