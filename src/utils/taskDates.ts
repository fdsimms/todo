import type { Task } from '../types';
import { buildSeriesRow, NO_RECURRENCE } from './taskDraft';

/**
 * Giving a task a set of dates (`Task.seriesId`): the rules `applyTaskDates`
 * writes, lifted out of the store so the MCP server's `set_task_dates` reaches
 * the same rows. Two steps, because the second reads the set after the first
 * has been written: the anchor row is patched through the writer's own
 * `updateTask` (which can stamp more than the patch), and the reconcile clones
 * the row as that write left it.
 */

// Identity of a date as the user picked it off a calendar — deliberately the
// literal Y/M/D rather than getDayStart, since reconciling a series matches
// rows against dates chosen in a date picker, where dayResetTime plays no part.
export function calendarDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export interface SeriesRepeat {
  monthDays: number[];
  repeatMonths: number;
}

/** The rows of one set, top-level only, as `seriesRowsOf` reads them. */
export function seriesRows(tasks: readonly Task[], seriesId: string): Task[] {
  return tasks.filter(t => t.seriesId === seriesId && !t.parentId);
}

export type DatesAnchorStep =
  /** A plain task given one date (or none): only its own date changes. */
  | { kind: 'plain'; patch: Partial<Task> }
  /**
   * A set shrunk to one date. The rest of it goes away and the row becomes an
   * ordinary dated task again — except for its completed and archived dates,
   * which are history and stay put, just unfiled from a set that no longer
   * exists.
   */
  | { kind: 'dissolve'; patch: Partial<Task>; dropped: Task[]; unfiled: Task[] }
  /** Two or more dates: patch the anchor, then `datesReconcile` the set. */
  | { kind: 'series'; seriesId: string; patch: Partial<Task>; anchorKept: boolean; sorted: Date[] };

export function datesAnchorStep(
  anchor: Task,
  tasks: readonly Task[],
  dates: readonly Date[],
  repeat: SeriesRepeat | undefined,
  newId: () => string,
): DatesAnchorStep {
  const sorted = [...dates].sort((a, b) => +a - +b);
  const monthDays = repeat?.monthDays ?? [];
  const repeatMonths = repeat?.repeatMonths ?? 1;

  if (sorted.length <= 1) {
    const dueDate = sorted[0]?.toISOString() ?? anchor.dueDate;
    if (!anchor.seriesId) return { kind: 'plain', patch: { dueDate } };
    const others = seriesRows(tasks, anchor.seriesId).filter(t => t.id !== anchor.id);
    return {
      kind: 'dissolve',
      patch: { dueDate, seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1 },
      dropped: others.filter(t => !t.completed && !t.archived),
      unfiled: others
        .filter(t => t.completed || t.archived)
        .map(t => ({ ...t, seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1 })),
    };
  }

  // Two or more dates: the anchor takes the series id, whether it's already
  // in a series or is a plain task being given extra dates for the first
  // time. It keeps its own date whenever that date survived the edit — the
  // row the user has open shouldn't silently become a different date, and
  // moving it would also make the reconcile below read it as dropped and
  // delete it. Only a row whose date was edited away gets repointed.
  const seriesId = anchor.seriesId ?? newId();
  const anchorDay = anchor.dueDate ? calendarDayKey(new Date(anchor.dueDate)) : null;
  const anchorKept = anchorDay !== null && sorted.some(d => calendarDayKey(d) === anchorDay);
  // Repointed onto a wanted date no other open row of the set already holds.
  // Always taking the earliest could land it on a sibling's date, and the
  // reconcile below then kept one and deleted the other: editing the 10th's
  // dates to {15th, 20th} deleted the 15th that was already there, with its
  // notes and subtasks.
  const heldByOthers = new Set(
    (anchor.seriesId ? seriesRows(tasks, anchor.seriesId) : [])
      .filter(t => t.id !== anchor.id && !t.completed && !t.archived && t.dueDate)
      .map(t => calendarDayKey(new Date(t.dueDate!)))
  );
  const repointTo = sorted.find(d => !heldByOthers.has(calendarDayKey(d))) ?? sorted[0];
  return {
    kind: 'series',
    seriesId,
    anchorKept,
    sorted,
    patch: {
      dueDate: anchorKept ? anchor.dueDate : repointTo.toISOString(),
      seriesId,
      seriesMonthDays: monthDays,
      seriesRepeatMonths: repeatMonths,
      // The anchor gives up its recurrence rule along with the rows cloned
      // from it — the dates are the schedule now (see NO_RECURRENCE).
      ...NO_RECURRENCE,
    },
  };
}

export interface DatesReconcile {
  /** Open rows whose date left the set. Deleted with their subtasks. */
  removed: Task[];
  /** New rows for dates the set gained, each with its own sortOrder. */
  added: Task[];
  /** Rows that stay, carrying the set's repeat rule. */
  rewritten: Task[];
}

/**
 * The second step, over the set as the anchor's write left it. `maxSortOrder`
 * is the highest `sortOrder` in the task table, so new rows land after it.
 */
export function datesReconcile(
  rows: readonly Task[],
  anchorId: string,
  step: Extract<DatesAnchorStep, { kind: 'series' }>,
  repeat: SeriesRepeat | undefined,
  maxSortOrder: number,
): DatesReconcile {
  if (rows.length === 0) return { removed: [], added: [], rewritten: [] };
  const monthDays = repeat?.monthDays ?? [];
  const repeatMonths = repeat?.repeatMonths ?? 1;
  // New rows clone the row the user was actually editing, so a title or
  // category changed in the same save reaches the dates added by it.
  const template = rows.find(t => t.id === anchorId) ?? rows.find(t => !t.completed) ?? rows[0];

  // Completed rows hold their date permanently — they're a record of a day
  // that happened, so they neither get rewritten nor count as a date the
  // set still owes. Everything below reconciles the incomplete rows only.
  //
  // Archived rows are held the same way, and for a sharper reason: they used
  // to count as live, so editing the dates deleted one outright when its date
  // was dropped from the set — filed-away data destroyed by an unrelated
  // edit. And when its date was *kept*, the archived row satisfied it, so the
  // set ended up with nothing actionable on a day the user had just asked
  // for. Excluded from `live` here, they're neither deleted nor counted, and
  // a kept date gets a real row of its own alongside them.
  const wanted = new Map(step.sorted.map(d => [calendarDayKey(d), d]));
  // A row whose own date was dropped goes last, so if every wanted date was
  // already held (see repointTo above) it's the one left over, not a sibling
  // that still had its date.
  const live = rows
    .filter(t => !t.completed && !t.archived)
    .sort((a, b) => (step.anchorKept ? 0 : Number(a.id === anchorId) - Number(b.id === anchorId)));

  const kept: Task[] = [];
  const removed: Task[] = [];
  for (const row of live) {
    const key = row.dueDate ? calendarDayKey(new Date(row.dueDate)) : null;
    if (key !== null && wanted.has(key)) {
      wanted.delete(key);
      kept.push(row);
    } else {
      removed.push(row);
    }
  }

  let order = maxSortOrder;
  const added = Array.from(wanted.values())
    .sort((a, b) => +a - +b)
    .map(date => {
      order += 1;
      return { ...buildSeriesRow(template, date, step.seriesId, repeat), sortOrder: order };
    });

  // The repeat rule lives on every row of the set (they share one schedule),
  // so a change to it has to reach the rows that already existed too.
  const rewritten = [...kept, ...rows.filter(t => t.completed || t.archived)].map(t => ({
    ...t,
    seriesMonthDays: monthDays,
    seriesRepeatMonths: repeatMonths,
  }));

  return { removed, added, rewritten };
}
