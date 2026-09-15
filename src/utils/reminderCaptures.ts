import type { MealSlot, ReminderCapture, ReminderCaptureFiling, TaskDraft } from '../types';
import { MEAL_SLOTS, MEAL_SLOT_LABELS } from '../types';
import { generateId } from './id';
import { slotForHour } from './mealLog';

/**
 * The extra Reminders lists the app drains, beyond the Inbox and grocery legs
 * that have their own settings rows.
 *
 * Pure, like `healthRules.ts` and `weatherRules.ts` beside it: what a capture
 * is, how it reads back off a settings row, which of them a drain may touch,
 * and what each one stamps on the task it creates. The drain itself is
 * `drainTargets`/`drainOnce` in `remindersImportSync.ts`, the UI is
 * `ReminderCapturesSheet`.
 *
 * **Nothing here writes to any store, and nothing here is a new destination in
 * the app.** Every filing produces `Partial<TaskDraft>`, so a capture is the
 * existing task leg with fields stamped on it. The reason that is worth stating
 * is that the obvious reading of "let a list feed any feature" is a matrix of
 * areas, and this app can only honour the two corners of it where a dictated
 * title is already a complete record. See `ReminderCaptureFiling`'s own note
 * and `docs/arch/reminders-import.md`.
 */

/** Cap on a capture's own name, the same length a health rule's title takes. */
export const CAPTURE_TITLE_MAX_LENGTH = 60;

/** How many captures may be configured. */
export const MAX_REMINDER_CAPTURES = 8;

export function makeReminderCapture(): ReminderCapture {
  return {
    id: generateId(),
    title: '',
    enabled: true,
    listId: null,
    confirmedListId: null,
    // On, matching `remindersImportDelete`'s default: the delete is what stops
    // a capture being imported twice, and it is the mode the whole import path
    // was built around.
    deleteAfterImport: true,
    filing: { kind: 'meal', slot: null },
  };
}

const KNOWN_SLOTS: ReadonlySet<string> = new Set<MealSlot>(MEAL_SLOTS);

function parseFiling(raw: unknown): ReminderCaptureFiling | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const filing = raw as { kind?: unknown; slot?: unknown; projectId?: unknown; category?: unknown; tag?: unknown };
  switch (filing.kind) {
    case 'meal':
      return {
        kind: 'meal',
        // An unrecognised slot derives rather than dropping the capture, the
        // same call parseHealthRules makes about an unknown metric: the list
        // and the filing are the parts somebody chose.
        slot: typeof filing.slot === 'string' && KNOWN_SLOTS.has(filing.slot)
          ? (filing.slot as MealSlot)
          : null,
      };
    case 'project':
      return typeof filing.projectId === 'string' && filing.projectId !== ''
        ? { kind: 'project', projectId: filing.projectId }
        : null;
    case 'category':
      return typeof filing.category === 'string' && filing.category !== ''
        ? { kind: 'category', category: filing.category }
        : null;
    case 'tag':
      return typeof filing.tag === 'string' && filing.tag !== ''
        ? { kind: 'tag', tag: filing.tag }
        : null;
    default:
      return null;
  }
}

/**
 * Read the stored list back, tolerantly.
 *
 * A malformed value reads as "nothing saved" and a bad entry is dropped rather
 * than discarding the list — `parseHealthRules`' rules exactly. A capture whose
 * filing no longer parses *is* dropped, unlike a health rule with an unknown
 * metric: a filing that can't be read has no destination to fall back to, and
 * guessing one would drain somebody's list into the wrong place.
 */
export function parseReminderCaptures(raw: string | null | undefined): ReminderCapture[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): ReminderCapture[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const capture = entry as Partial<ReminderCapture>;
    if (typeof capture.id !== 'string' || capture.id === '') return [];
    const filing = parseFiling(capture.filing);
    if (!filing) return [];
    return [{
      id: capture.id,
      title: typeof capture.title === 'string'
        ? capture.title.slice(0, CAPTURE_TITLE_MAX_LENGTH)
        : '',
      enabled: capture.enabled !== false,
      listId: typeof capture.listId === 'string' && capture.listId !== '' ? capture.listId : null,
      confirmedListId: typeof capture.confirmedListId === 'string' && capture.confirmedListId !== ''
        ? capture.confirmedListId
        : null,
      deleteAfterImport: capture.deleteAfterImport !== false,
      filing,
    }];
  }).slice(0, MAX_REMINDER_CAPTURES);
}

export function serializeReminderCaptures(captures: readonly ReminderCapture[]): string {
  return JSON.stringify(captures);
}

/**
 * The captures a drain may actually run against: switched on, pointed at a
 * list, and pointed at the list whose confirmation alert was answered.
 *
 * All three are the gate the two fixed legs already apply
 * (`remindersImportEnabled && listId && confirmedListId === listId`), applied
 * per row rather than per feature. The third is the load-bearing one — see
 * `ReminderCapture.confirmedListId`.
 */
export function activeReminderCaptures(
  captures: readonly ReminderCapture[]
): ReminderCapture[] {
  return captures.filter(c => c.enabled && c.listId !== null && c.confirmedListId === c.listId);
}

/**
 * The captures a drain will actually build a target for: active, and not
 * standing down because the app area they feed has been switched off.
 *
 * **One predicate rather than the same gate written in two places.** The drain
 * asks twice — once to decide whether the import is on at all, once to build
 * the targets — and those two answers disagreeing is a bug this file has
 * already seen: the grocery leg reported `'no-list'` ("the list you chose has
 * gone") for a list that was sitting right there, because the early-out counted
 * a leg the target builder had dropped. A meal capture is the same shape, so it
 * gets the same answer from the same function instead of a second copy of the
 * rule.
 *
 * Standing down drops the *target*, never the configuration: the list and its
 * confirmation stay, so turning the area back on resumes rather than re-asking.
 */
export function drainableReminderCaptures(
  captures: readonly ReminderCapture[],
  gates: { kitchenEnabled: boolean }
): ReminderCapture[] {
  return activeReminderCaptures(captures).filter(capture =>
    // A meal capture feeds the food log, which lives in the kitchen area.
    // Every other filing lands an ordinary task and is unaffected.
    capture.filing.kind !== 'meal' || gates.kitchenEnabled
  );
}

/**
 * Every list id some capture is pointed at, other than `exceptId`'s own.
 *
 * Feeds the list picker's exclusions. Two destinations reading one list is not
 * cosmetic: the handled record is read as one flat set across every list
 * (`handledReminderIds`), so a list wired to two of them would send each
 * reminder to whichever drain reached it first. The two fixed legs kept each
 * other disjoint with a single `excludeId`; with an open set of captures that
 * has to become "every other list in use", which is what this is for.
 */
export function captureListIds(
  captures: readonly ReminderCapture[],
  exceptId: string | null = null
): string[] {
  const ids: string[] = [];
  for (const capture of captures) {
    if (capture.id === exceptId) continue;
    if (capture.listId) ids.push(capture.listId);
  }
  return ids;
}

/**
 * What a capture stamps on the task the drain is about to create, over and
 * above what the reminder itself said.
 *
 * `createdAt` is when the *reminder* was made, not when the drain ran, and only
 * the meal filing reads it: a dinner dictated at 19:00 on Tuesday and drained
 * on Wednesday morning is still dinner. Null when EventKit gave no creation
 * date (it is an optional field — see `creationTime` in `remindersImport.ts`),
 * in which case the drain's own clock stands in, which is the best available
 * answer rather than a good one.
 *
 * Note what the other three arms do *not* stamp: a date. A capture files a task
 * somewhere, and filing is not scheduling — a project-list capture is exactly
 * the undated running list `ProjectKind` `'list'` exists for, and giving it a
 * due date would put it on Today on the strength of a sentence nobody has read.
 * The schedule a reminder *does* imply still rides `pendingImport` as it always
 * did.
 */
export function captureDraftFields(
  filing: ReminderCaptureFiling,
  createdAt: Date
): Partial<TaskDraft> {
  switch (filing.kind) {
    case 'meal':
      return { logMealSlot: filing.slot ?? slotForHour(createdAt.getHours()) };
    case 'project':
      return { projectId: filing.projectId };
    case 'category':
      return { category: filing.category };
    case 'tag':
      return { tags: [filing.tag] };
  }
}

/**
 * The secondary line under a capture in settings — what it does, in the same
 * words the pickers offered.
 *
 * Names are resolved by the caller rather than looked up here, so this stays
 * pure and testable like the rest of the module. A project or category the user
 * has since deleted reads as its own absence rather than as a blank: the
 * capture still exists and still needs explaining before it can be fixed.
 */
export function describeReminderCaptureFiling(
  filing: ReminderCaptureFiling,
  names: { projectName?: string | null; categoryName?: string | null } = {}
): string {
  switch (filing.kind) {
    case 'meal':
      return filing.slot
        ? `Food log, as ${MEAL_SLOT_LABELS[filing.slot].toLowerCase()}`
        : 'Food log, meal from the time of day';
    case 'project':
      return names.projectName
        ? `Project: ${names.projectName}`
        : 'Project (deleted)';
    case 'category':
      return names.categoryName
        ? `Category: ${names.categoryName}`
        : 'Category (deleted)';
    case 'tag':
      return `Tagged #${filing.tag}`;
  }
}
