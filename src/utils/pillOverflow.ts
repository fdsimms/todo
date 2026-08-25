/**
 * How much of a pill grid is on show, and whether it gets a find-or-add field.
 *
 * A pill grid states every option at once, which is exactly right for a closed
 * set of four and exactly wrong for an open-ended one. The aisle picker ships
 * sixteen defaults before the user adds any, and the store picker is entirely
 * user-built with no ceiling at all — so the grocery item sheet rendered ~30
 * pills across two grids, burying the name/quantity/note fields it also holds.
 *
 * The rule: show what's set plus a handful, and put the rest behind one
 * "N more". Two things differ from a plain overflow cap, both because a pill
 * grid is a *picker* rather than a form:
 *
 *  - Past the cap the grid also earns a filter field, since a set big enough
 *    to hide from is a set big enough to be worth searching. That field
 *    doubles as the create-new input, the way `ListBulkBar`'s category field
 *    already does — finding one is the common case, adding one the rare case,
 *    and both start by typing.
 *  - Order is never re-ranked. `aisleOrder` is the user's own walk round the
 *    shop and the store list is hand-ordered too; hoisting the selected pill
 *    to the front would shuffle a deliberate arrangement under someone between
 *    two edits. Selected pills are *exempted* from the cap, not moved by it.
 *
 * Pure and separate from the component because it is the whole behaviour, and
 * there are no component tests in this repo to catch it otherwise.
 */

export interface OverflowPill {
  key: string;
  /** What the pill reads, and what the filter matches against. */
  label: string;
  /** A selected pill is never hidden — it's the field's current value. */
  selected?: boolean;
  /**
   * Never hidden by the cap either, but for the opposite reason: it's the
   * option that means *no choice* ("No store", "Usually Produce"). Burying the
   * default behind a disclosure makes it look unavailable.
   */
  pinned?: boolean;
}

export interface PillOverflowResult<T> {
  /** Pills to render, in their original order. */
  visible: T[];
  /** How many are behind the "N more" control. 0 means everything is shown. */
  hiddenCount: number;
  /** Render the find-or-add field? True once the full set outgrows the cap. */
  filterable: boolean;
  /** An option whose label *is* the query — so "add" would be a duplicate. */
  exact: T | null;
  /** A query that matched nothing. */
  noMatches: boolean;
}

export interface PillOverflowOptions {
  /** The find-or-add field's current text. Empty means no filtering. */
  query?: string;
  /** Cap on pills shown before the "N more". */
  limit?: number;
  /** Set once the user has tapped "N more". Lifts the cap for this session. */
  showAll?: boolean;
}

/**
 * Eight is two or three rows of pills at phone width — enough that the common
 * answer is usually on screen, few enough that the grid stays a glance rather
 * than a page.
 */
export const DEFAULT_PILL_LIMIT = 8;

const normalize = (s: string) => s.trim().toLowerCase();

export function resolvePillOverflow<T extends OverflowPill>(
  options: T[],
  { query = '', limit = DEFAULT_PILL_LIMIT, showAll = false }: PillOverflowOptions = {},
): PillOverflowResult<T> {
  // Measured against the whole set, not against what's left after filtering:
  // the field mustn't vanish from under the person typing into it the moment
  // their query narrows the grid below the cap.
  const filterable = options.length > limit;

  const q = normalize(query);
  if (q) {
    const matches = options.filter(o => normalize(o.label).includes(q));
    return {
      visible: matches,
      hiddenCount: 0,
      filterable,
      exact: matches.find(o => normalize(o.label) === q) ?? null,
      noMatches: matches.length === 0,
    };
  }

  if (showAll || !filterable) {
    return { visible: options, hiddenCount: 0, filterable, exact: null, noMatches: false };
  }

  const forced = options.filter(o => o.selected || o.pinned);
  // Selected and pinned pills are shown whatever the cap says, so they eat the
  // budget rather than adding to it — a set of eight already-linked stores
  // fills the grid on its own and nothing unselected joins it.
  const room = Math.max(0, limit - forced.length);
  const filler = new Set(options.filter(o => !o.selected && !o.pinned).slice(0, room));
  const visible = options.filter(o => o.selected || o.pinned || filler.has(o));
  const hiddenCount = options.length - visible.length;

  // A "1 more" stands about as tall as the pill it conceals, so it costs a
  // tap to save nothing — and you have to spend the tap to discover it was
  // one thing.
  if (hiddenCount === 1) {
    return { visible: options, hiddenCount: 0, filterable, exact: null, noMatches: false };
  }

  return { visible, hiddenCount, filterable, exact: null, noMatches: false };
}

export type PillSubmit<T> =
  | { action: 'pick'; option: T }
  | { action: 'create' }
  | { action: 'none' };

/**
 * What the keyboard's done key does to a find-or-add field.
 *
 * Picking always beats creating, so Enter can't mint a duplicate of something
 * already in the list. The part worth keeping honest is the middle case: with
 * several options still matching, Enter does **nothing**. A filter is typed a
 * letter at a time, so "ba" on the way to "Bakery" is a state the field is in
 * constantly, and creating from it leaves a junk aisle behind that only the
 * Aisles sheet can clear — while an aisle *is* just a name, so nothing about
 * the junk one looks wrong later. Ambiguity is what the `Create "…"` pill is
 * for; creating is a tap on the control that says "create".
 */
export function resolvePillSubmit<T extends OverflowPill>(
  result: PillOverflowResult<T>,
  { text, canCreate }: { text: string; canCreate: boolean },
): PillSubmit<T> {
  if (!text.trim()) return { action: 'none' };
  if (result.exact) return { action: 'pick', option: result.exact };
  if (result.filterable) {
    if (result.visible.length === 1) return { action: 'pick', option: result.visible[0] };
    if (result.visible.length > 1) return { action: 'none' };
  }
  return canCreate ? { action: 'create' } : { action: 'none' };
}
