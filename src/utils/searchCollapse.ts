import type { Task } from '../types';
import { getCurrentDayStart, getEffectiveTaskDate, getTaskDayStart } from './dateUtils';
import { normalizeTitle } from './taskInstances';

/**
 * One search result per *thing*, rather than one per row standing for it.
 *
 * A task that happens on many days is many rows — that's the materialised
 * design the Series and Recurrence notes both argue for — and search was the
 * one surface reading those rows back at face value. A daily meal slot put five
 * identically-titled "Breakfast" rows in the quick-search card (which only
 * shows five) and thirty-two on the Search screen, so a card that exists to get
 * you to one task showed one task, five times, with nothing on any row to say
 * which was which.
 *
 * Three shapes of the same problem, and they need three keys:
 *
 * | Rows | What links them |
 * |---|---|
 * | a dated series (the 10th and the 15th) | a shared `seriesId` |
 * | a recurring task and its tombstones | the `previousOccurrenceId` chain |
 * | one generated task per day (meal slots, pantry checks, use-ups) | nothing at all |
 *
 * The third is why `projectProgress`'s `memberKey` isn't reused here. Its two
 * keys are the first two rows of that table, and a generator writes a *fresh*
 * task per (day, source) with no pointer back to yesterday's — see
 * `mealSlotSourceId`, whose source id names a square on the calendar. So a
 * generated task keys on its kind plus its normalised title, which is the only
 * thing its occurrences actually share. That key is deliberately not applied to
 * hand-made tasks: two tasks called "Call the vet" that someone typed twice are
 * two tasks, and hiding one behind the other would lose it. `getRepeatedInstances`
 * is the Stats screen's separate, opt-in take on *that* question.
 *
 * Deliberately **not** applied to the Logbook (`LogbookScreen` calls
 * `fuzzySearch` directly and is left alone): history is exactly where every
 * occurrence should be its own line. Nor to `TaskRelationPickerSheet`, where the
 * point is to pick one specific occurrence to block on.
 */

/** The shape this needs off a search result: everything else rides along. */
export interface SearchOccurrence {
  task: Task;
  score: number;
}

/** A result that now stands for `occurrenceCount` matched rows (1 = it's just itself). */
export type CollapsedOccurrence<T> = T & { occurrenceCount: number };

/**
 * The key rows of one recurring/repeated/generated thing share.
 *
 * `byId` should hold every task in the list being searched, not just the
 * matched ones — the chain walk climbs through rows the query never matched
 * (a mid-chain title edit, a match that landed on notes) and would otherwise
 * stop early and split one family into several.
 */
export function occurrenceFamilyKey(task: Task, byId: Map<string, Task>): string {
  if (task.seriesId) return `series:${task.seriesId}`;

  // Checked before the chain walk, not after: a generated task's occurrences
  // have no pointers between them, so the walk would return each row's own id
  // and every one of them would read as unique.
  if (task.generatedKind) {
    const titleKey = normalizeTitle(task.title);
    if (titleKey) return `generated:${task.generatedKind}:${titleKey}`;
  }

  let root = task;
  const seen = new Set<string>([root.id]);
  while (root.previousOccurrenceId) {
    const prev = byId.get(root.previousOccurrenceId);
    // Same defensiveness memberKey keeps, and for the same reason: this runs
    // on every keystroke of a search, so a loop that arrived some other way
    // must not hang the field.
    if (!prev || seen.has(prev.id)) break;
    seen.add(prev.id);
    root = prev;
  }
  return `occurrence:${root.id}`;
}

// Which of a family's rows is the one worth showing, as a comparable tuple:
// lower sorts first. Held rows lead, then live ones, then — within the live
// ones — what's next, what just happened, and what has no date at all.
//
// "Soonest upcoming, else most recent" rather than "highest scoring": every
// row in a family scores about the same (they share a title), so the score
// can't answer this, and the row someone is looking for when they search a
// habit is the one they're about to do.
function representativeOrder(
  row: SearchOccurrence,
  heldIds: ReadonlySet<string>,
  todayStart: Date
): number[] {
  const task = row.task;
  const held = heldIds.has(task.id);
  // A row ticked from these very results stays the one on screen. Without
  // this, ticking the visible occurrence swaps a *different* date into its
  // place, which reads as the tick having hit the wrong row — the same
  // misfire heldIds exists to prevent upstream in fuzzySearch.
  if (held) return [0];
  if (task.completed) {
    const at = task.completedAt ? new Date(task.completedAt).getTime() : null;
    // Most recently completed first; one with no stamp sorts last.
    return [2, 0, at === null ? Infinity : -at, -row.score];
  }

  const iso = getEffectiveTaskDate(task);
  if (!iso) return [1, 2, 0, -row.score];
  const at = getTaskDayStart(new Date(iso)).getTime();
  return at >= todayStart.getTime()
    ? [1, 0, at, -row.score]      // upcoming: soonest first
    : [1, 1, -at, -row.score];    // past: most recent first
}

function compareOrder(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

/**
 * Collapses each family of results down to one row, counting what it stands for.
 *
 * Order is preserved by *family*: a family keeps the slot its best-scoring row
 * held, so nothing is re-ranked by this — the representative is which row the
 * slot shows, not where the slot sits. That matters most in the quick-search
 * card, where collapsing has to happen before the five-row cap or the cap is
 * spent on one task's occurrences (which is the bug this fixes).
 */
export function collapseOccurrences<T extends SearchOccurrence>(
  results: T[],
  tasks: readonly Task[],
  heldIds: ReadonlySet<string> = new Set()
): CollapsedOccurrence<T>[] {
  if (results.length === 0) return [];

  const byId = new Map(tasks.map(t => [t.id, t]));
  const families = new Map<string, T[]>();
  const order: string[] = [];

  for (const result of results) {
    const key = occurrenceFamilyKey(result.task, byId);
    const bucket = families.get(key);
    if (bucket) bucket.push(result);
    else {
      families.set(key, [result]);
      order.push(key);
    }
  }

  const todayStart = getCurrentDayStart();

  return order.map(key => {
    const rows = families.get(key)!;
    if (rows.length === 1) return { ...rows[0], occurrenceCount: 1 };
    const representative = rows
      .slice()
      .sort((a, b) => compareOrder(
        representativeOrder(a, heldIds, todayStart),
        representativeOrder(b, heldIds, todayStart)
      ))[0];
    return { ...representative, occurrenceCount: rows.length };
  });
}

/**
 * What a collapsed row says it stands for, phrased the same way on both search
 * surfaces. Null when the row is only itself.
 *
 * "Dates" rather than "results" or "copies": every row a family folds up is the
 * same task on a different day, which is the fact the reader needs to know
 * before deciding whether the one on screen is the one they meant.
 */
export function formatOccurrenceCount(occurrenceCount: number): string | null {
  const others = occurrenceCount - 1;
  if (others < 1) return null;
  return others === 1 ? '1 more date' : `${others} more dates`;
}
