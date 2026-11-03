/**
 * Today's held-back footer: the tasks the day is not showing for a reason that
 * will pass, collected under one footer instead of one footer each.
 *
 * Three groups used to be three footers stacked under "later today" ("Show 2
 * expired", "Show 3 waiting for a lighter day", "Show 2 waiting on another
 * task"), each its own tap, each only there while it had something in it. A
 * day with all three read as a column of near-identical lines. Together they
 * are one: "Show 7 held back", and opening it names each reason with its own
 * count above its rows.
 *
 * **One reason alone keeps its own wording.** "Show 2 expired" says more than
 * "Show 2 held back", and most days have at most one group, so merging only
 * changes the days that had several. "Later today" is not in here: those tasks
 * are not held, only not due yet, and vacation-hidden tasks have a footer of
 * their own that says why they are away.
 */

export type HeldBackKind = 'expired' | 'slot' | 'waitingOn';

export interface HeldBackGroup<T> {
  kind: HeldBackKind;
  tasks: T[];
}

export interface HeldBackCopy {
  /** The sub-heading above this reason's rows, once there is more than one. */
  heading: string;
  /** The footer's words for it alone: "Show 2 expired". */
  noun: string;
  icon: 'time-outline' | 'hourglass-outline' | 'pause-circle-outline';
}

export const HELD_BACK_COPY: Record<HeldBackKind, HeldBackCopy> = {
  expired: { heading: 'Expired', noun: 'expired', icon: 'time-outline' },
  slot: { heading: 'Waiting for a lighter day', noun: 'waiting for a lighter day', icon: 'hourglass-outline' },
  waitingOn: { heading: 'Waiting on another task', noun: 'waiting on another task', icon: 'pause-circle-outline' },
};

/** The groups that have something in them, in the order they have always appeared. */
export function heldBackGroups<T>(input: { expired: T[]; slot: T[]; waitingOn: T[] }): HeldBackGroup<T>[] {
  const all: HeldBackGroup<T>[] = [
    { kind: 'expired', tasks: input.expired },
    { kind: 'slot', tasks: input.slot },
    { kind: 'waitingOn', tasks: input.waitingOn },
  ];
  return all.filter(g => g.tasks.length > 0);
}

export function heldBackTotal(groups: readonly HeldBackGroup<unknown>[]): number {
  return groups.reduce((sum, g) => sum + g.tasks.length, 0);
}

/** Whether each reason gets its own sub-heading, which only matters with more than one. */
export function heldBackHasHeadings(groups: readonly HeldBackGroup<unknown>[]): boolean {
  return groups.length > 1;
}

/** The footer line, or null when nothing is held back. */
export function heldBackToggleText(groups: readonly HeldBackGroup<unknown>[], expanded: boolean): string | null {
  if (groups.length === 0) return null;
  const noun = groups.length === 1 ? HELD_BACK_COPY[groups[0].kind].noun : 'held back';
  return `${expanded ? 'Hide' : 'Show'} ${heldBackTotal(groups)} ${noun}`;
}

/** The footer's icon: the reason's own when there is one, else the one for waiting. */
export function heldBackIcon(groups: readonly HeldBackGroup<unknown>[]): HeldBackCopy['icon'] {
  return groups.length === 1 ? HELD_BACK_COPY[groups[0].kind].icon : 'hourglass-outline';
}
