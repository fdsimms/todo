/**
 * Pure geometry for dropping the add button into a list — which row it landed
 * on, and what creating something there should mean. Today uses every kind
 * below; Projects, whose list is the same category-sectioned shape minus stacks
 * and pinning, uses `header` and `task`.
 *
 * Kept out of the component (like reorder.ts and paintSelect.ts) so the
 * hit-testing can be tested without a running gesture. Coordinates are
 * window-space, because that's the one space a PanResponder's pageY and a
 * view's measureInWindow already agree on — the dragged button lives in an
 * absolutely-positioned sibling of the list, so there is no shared content
 * space to reconcile against (see dragTranslation in reorder.ts for what
 * reconciling one costs).
 *
 * The one adjustment on top is the list's own scroll offset, added to both the
 * measured bands and the queried point so a drag that autoscrolls compares two
 * numbers from the same moment (FabDropZones). It cancels out of everything
 * below, which only ever compares a point against bands — so the functions
 * here are "one consistent space", and the provider picks which.
 */

/**
 * A row of the Today list, as a thing the add button can be dropped on.
 *
 * `category` is the section the row sits in — the nearest header at or above
 * it, which is the same rule resolveDrop uses when a dragged task settles
 * (taskGrouping.ts). Carried here only so the drag can name its target
 * out loud; the actual category assignment on commit still comes from
 * resolveDrop reading the new row's spliced-in position, so the two can't drift.
 */
export type DropZone =
  /** An ordinary row that splits into above/below — a task on Today, a project on Projects. */
  | { kind: 'task'; key: string; category: string | null }
  /** A category header. Its own label is its category. */
  | { kind: 'header'; key: string; category: string | null }
  | { kind: 'group'; key: string; groupId: string; groupTitle: string; category: string | null }
  /** A row of the pinned run at the top of Today, when anything is pinned. */
  | { kind: 'pinned'; key: string }
  /**
   * A row that can be landed on but has nothing to say about placement — the
   * "Everything else" divider, the Later Today time section. Registered rather
   * than left out so the drag resolves to "no target" over them, instead of
   * reaching past them to whatever is nearest.
   */
  | { kind: 'rest'; key: string };

/** A zone's measured vertical band on screen. */
export interface ZoneRect {
  zone: DropZone;
  /** Window-space Y of the row's top edge. */
  top: number;
  /** Window-space Y of the row's bottom edge (exclusive). */
  bottom: number;
}

/**
 * What a release resolves to.
 *
 * `insert` names its position by the key of the row it landed on rather than by
 * index: the quick-add sheet sits between the drop and the commit, and an
 * anchor survives the list changing underneath in a way an index doesn't.
 */
export type FabDropIntent =
  | { kind: 'insert'; anchorKey: string; before: boolean; category: string | null }
  | { kind: 'joinGroup'; groupId: string; groupTitle: string; category: string | null }
  | { kind: 'pin' }
  /**
   * Released back on the corner the button came from — create nothing at all.
   * Distinct from `plain`: that one still opens the sheet, this one is the way
   * out of a drag you've thought better of.
   */
  | { kind: 'cancel' }
  /** Released on nothing in particular — create exactly as tapping the button does. */
  | { kind: 'plain' };

/** Registry key for a zone — the list key of the row it was measured from. */
export function zoneKey(zone: DropZone): string {
  return zone.key;
}

/**
 * Vertical slack when resolving the drop point to a row. Matches
 * ROW_HIT_SLOP in paintSelect.ts and for the same reason: cards are separated
 * by a 4px gutter, and without slack a release into that gap reports "no row"
 * and silently downgrades a deliberate drop to a plain add.
 */
export const ZONE_HIT_SLOP = 6;

/**
 * Slack below the *last* row, where ZONE_HIT_SLOP's few pixels aren't enough.
 *
 * Every other seam in the list has a row on both sides of it, so a gutter-sized
 * slop is all a finger needs to find it. The seam after the last row has empty
 * page under it instead, and aiming at it meant landing inside the final card —
 * a drop a few pixels lower silently downgraded to a plain add, which is the one
 * spot where "past the end of the list" and "at the end of the list" look
 * identical to the person doing it. Roughly a row's height of empty page keeps
 * reading as the end of the list; further down is clear of the list and stays a
 * plain add, so releasing into the blank page still means what it did.
 *
 * Only applied downward off the bottom, not upward off the top: above the first
 * row is the header and the Today/Later pills, not blank page.
 */
export const TAIL_HIT_SLOP = 64;

/**
 * The zone `y` falls in, or the nearest one within `slop` when it lands in the
 * gap between two cards — `tailSlop` instead of `slop` when it lands below the
 * last row, per TAIL_HIT_SLOP. Null past that, so releasing well clear of every
 * row stays a plain add rather than snapping to the last one.
 */
export function zoneAtY(
  rects: ZoneRect[],
  y: number,
  slop: number = ZONE_HIT_SLOP,
  tailSlop: number = TAIL_HIT_SLOP,
): ZoneRect | null {
  let best: ZoneRect | null = null;
  let bestDist = Infinity;
  let last: ZoneRect | null = null;
  for (const r of rects) {
    const dist = Math.max(r.top - y, y - r.bottom, 0);
    if (dist === 0) return r;
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
    if (!last || r.bottom > last.bottom) last = r;
  }
  // Below every row, the nearest zone is the bottom one by definition — so this
  // is the tail, and nothing above the list can reach the larger slop.
  const belowList = best !== null && best === last && y > best.bottom;
  return bestDist <= (belowList ? Math.max(slop, tailSlop) : slop) ? best : null;
}

/**
 * What dropping at `y` on `hit` means.
 *
 * The task/group split is the same distinction reorder.ts draws between
 * dropIndexFromTranslation and rowIndexAtContentY: a stack is a whole-row
 * target (anywhere in its band means "into this stack"), while a plain task is
 * a gap target, splitting at its midpoint into above/below. A header is a whole
 * row too, meaning "first thing under this heading" — dropping onto the top
 * half of a header to mean "above it" would be a two-pixel distinction between
 * two different categories.
 */
export function resolveFabDrop(
  hit: ZoneRect | null,
  y: number,
  overHome: boolean = false,
): FabDropIntent {
  // Checked before the rows: the button's resting corner sits over the tail of
  // the list, so the bottom row is a real hit at the same moment the button is
  // home. Whichever wins has to win everywhere — during the drag (what the
  // label says) and at the release (what gets created) — so it's decided here
  // rather than at either call site.
  if (overHome) return { kind: 'cancel' };
  if (!hit) return { kind: 'plain' };
  const { zone } = hit;
  switch (zone.kind) {
    case 'pinned':
      return { kind: 'pin' };
    case 'rest':
      return { kind: 'plain' };
    case 'group':
      return {
        kind: 'joinGroup',
        groupId: zone.groupId,
        groupTitle: zone.groupTitle,
        category: zone.category,
      };
    case 'header':
      return { kind: 'insert', anchorKey: zone.key, before: false, category: zone.category };
    case 'task':
      return {
        kind: 'insert',
        anchorKey: zone.key,
        before: y < (hit.top + hit.bottom) / 2,
        category: zone.category,
      };
  }
}

/**
 * Identity of the *place* an intent points at. The drag ticks its haptic and
 * moves its line only when this string changes, so a finger resting between two
 * samples doesn't buzz on every pointer event.
 *
 * Insert intents collapse to the gap they name rather than the row they name it
 * from: "below this row" and "above the next one" are one seam, and "first under
 * this header" is that same seam again. Comparing the wording instead — which is
 * what an anchorKey/before pair does — fired two ticks for every row the finger
 * crossed and bounced the line across the 4px gutter between the two cards,
 * because both spellings of one position look like two different targets.
 */
export function targetKey(rects: ZoneRect[], intent: FabDropIntent): string {
  switch (intent.kind) {
    case 'plain':
      return 'plain';
    case 'cancel':
      return 'cancel';
    case 'pin':
      return 'pin';
    case 'joinGroup':
      return `group:${intent.groupId}`;
    case 'insert': {
      const i = rects.findIndex(r => zoneKey(r.zone) === intent.anchorKey);
      // An anchor that isn't in this snapshot can't be placed on the seam
      // scale; fall back to its own wording rather than colliding with slot 0.
      if (i < 0) return `anchor:${intent.anchorKey}:${intent.before}`;
      return `seam:${i + (intent.before ? 0 : 1)}`;
    }
  }
}

/**
 * The category each row belongs to, given each row's header label (null for
 * rows that aren't headers) in list order.
 *
 * "Nearest header at or above", matching resolveDrop — so a row above every
 * header is uncategorized, which is the deliberate rule that lets a task be
 * dragged out of every category by dropping it at the very top.
 */
export function categoriesByIndex(headerLabels: Array<string | null>): Array<string | null> {
  let current: string | null = null;
  return headerLabels.map(label => {
    if (label !== null) current = label;
    return current;
  });
}

/** Window-space Y the insertion line should be drawn at for an `insert` intent. */
export function indicatorY(hit: ZoneRect, before: boolean): number {
  return before ? hit.top : hit.bottom;
}

/**
 * How near its resting corner the button has to come back for a release to
 * cancel. A bit more than the button's own radius (FAB_SIZE is 56), so the
 * catch is forgiving without swallowing the whole bottom-right of the list —
 * everything outside it, including the rest of the bottom edge, still
 * autoscrolls and still drops.
 */
export const CANCEL_RADIUS = 44;

/**
 * Whether the button has been dragged back onto the spot it started from,
 * given the gesture's cumulative translation.
 *
 * Measured from the gesture rather than from a measured rect: the drag can
 * only ever start on the button, and the button is translated by exactly this
 * delta, so `dx`/`dy` of zero *is* the resting corner however the finger
 * happened to grab it. Nothing has to be measured, and — the reason it matters
 * here — the answer doesn't move when the list scrolls underneath.
 */
export function isOverFabHome(dx: number, dy: number, radius: number = CANCEL_RADIUS): boolean {
  return Math.hypot(dx, dy) <= radius;
}

/**
 * Where a drag stands relative to the corner it started in.
 *
 * Three states rather than a boolean because the drag *begins* on that corner,
 * and the first moments of it must not be read as a return to it: `inside` is
 * the lift, and it neither arms the cancel well nor scrolls the list — which
 * would otherwise start the moment the button came off its spot, since the
 * corner sits inside the list's bottom autoscroll band.
 */
export type FabHomeState =
  /** Still on the resting spot, never having left it — the lift. */
  | 'inside'
  /** Out over the list. The only state that autoscrolls. */
  | 'outside'
  /** Brought back to the resting spot. A release here cancels. */
  | 'returned';

/** The state a gesture translated by `dx`/`dy` is in, given whether it has ever left home. */
export function fabHomeState(dx: number, dy: number, hasLeftHome: boolean): FabHomeState {
  if (!isOverFabHome(dx, dy)) return 'outside';
  return hasLeftHome ? 'returned' : 'inside';
}

/** Height of the band at each end of the list that scrolls it while dragged into. */
export const AUTOSCROLL_EDGE = 88;
/** Pixels per tick at the very edge; the band ramps up to this. */
export const AUTOSCROLL_MAX_STEP = 14;
export const AUTOSCROLL_INTERVAL_MS = 16;

/**
 * Pixels to scroll this tick, given where the finger is and where the list's
 * viewport starts and ends (all window-space). Negative scrolls back toward
 * the top; zero anywhere in the middle.
 *
 * Ramped rather than a flat step (which is what a row drag uses, see
 * ReorderableList's AUTOSCROLL_STEP) because this drag enters the bottom band
 * on its way out of the corner it started in: a flat step means the list
 * lurches the instant the button lifts, before the user has aimed at anything.
 * Easing in from zero at the band's inner edge makes the near-edge crawl
 * controllable and keeps the lift itself still.
 *
 * The band is halved rather than dropped on a viewport too short to hold two
 * of them, so a small list still scrolls; a viewport with no height at all
 * (measured before layout) scrolls not at all.
 */
export function autoscrollStep(
  pageY: number,
  top: number,
  bottom: number,
  edge: number = AUTOSCROLL_EDGE,
  maxStep: number = AUTOSCROLL_MAX_STEP,
): number {
  const height = bottom - top;
  if (!(height > 0)) return 0;
  const band = Math.min(edge, height / 2);
  if (band <= 0) return 0;
  if (pageY < top + band) {
    return -maxStep * Math.min(1, (top + band - pageY) / band);
  }
  if (pageY > bottom - band) {
    return maxStep * Math.min(1, (pageY - (bottom - band)) / band);
  }
  return 0;
}

/**
 * A list the add-button drag can scroll while it's in flight.
 *
 * Deliberately three plain functions rather than a list ref: the two lists
 * Today renders (a FlatList whenever anything is pinned, a ReorderableList
 * otherwise) don't share a scroll API, and the reorderable one owns its scroll
 * view privately. Both can satisfy this.
 *
 * `scrollToOffset` is expected to record the offset it was given synchronously,
 * because the tick reads `getOffset()` back a frame before the real scroll
 * event lands and would otherwise re-issue the same offset forever.
 */
export interface DragScroller {
  getOffset: () => number;
  /** Largest scrollable offset — content height less viewport height, floored at 0. */
  getMaxOffset: () => number;
  scrollToOffset: (y: number) => void;
}
