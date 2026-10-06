import type { ContextRow } from '../types';
import type { TodayListItem } from './taskGrouping';
import { ALL_DAY_CAPTION } from './dayContextRows';

/**
 * Which of Today's non-task rows are drawn as one joined card, and what a
 * collapsed section says about the card it is holding.
 *
 * A card row is a pure readout: a health reading, or a calendar event. A meal
 * row (it has a tick) and a moved-off-today event (it carries the "move tasks"
 * offer) are not, and stay ordinary rows. That split is the rule this module
 * exists to hold: **nothing with an action is ever folded into a card**, so
 * collapsing a section can't hide something that needed answering.
 *
 * Pure, because the grouping is the part with edge cases (a meal splitting a
 * run, two kinds meeting at a boundary); the drawing stays in `DayContextRow`.
 */

export type CardPosition = 'single' | 'first' | 'middle' | 'last';

/** The id prefix `movedEventContextRows` gives its rows. */
const MOVED_PREFIX = 'moved-';

export function isCardRow(row: ContextRow): boolean {
  if (row.kind === 'health') return true;
  return row.kind === 'event' && !row.id.startsWith(MOVED_PREFIX);
}

/**
 * Each card row's place in its run, keyed by row id. A run is consecutive card
 * rows of the same kind: a health card and an event card that happen to touch
 * stay two cards, and a meal or moved-event row between two events ends the run.
 */
export function contextCardPositions(items: readonly TodayListItem[]): Map<string, CardPosition> {
  const keyAt = (i: number): string | null => {
    const item = items[i];
    return item && item.type === 'context' && isCardRow(item.row) ? item.row.kind : null;
  };
  const out = new Map<string, CardPosition>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'context' || !isCardRow(item.row)) continue;
    const kind = item.row.kind;
    const joinsPrev = keyAt(i - 1) === kind;
    const joinsNext = keyAt(i + 1) === kind;
    out.set(
      item.row.id,
      joinsPrev ? (joinsNext ? 'middle' : 'last') : (joinsNext ? 'first' : 'single'),
    );
  }
  return out;
}

/**
 * One line for a collapsed section, keyed by its header label. Only a section
 * holding nothing but card rows of one kind gets one: a category that also has
 * tasks in it would be summarised by a line that left them out.
 *
 * Health reads out its own figures. Events read as a count plus the one that
 * matters now: the running event, else the next timed one.
 */
export function contextSectionSummaries(items: readonly TodayListItem[]): Map<string, string> {
  const out = new Map<string, string>();
  let label: string | null = null;
  let rows: ContextRow[] = [];
  let pure = true;

  const flush = () => {
    if (label === null || !pure || rows.length === 0) return;
    const kind = rows[0].kind;
    if (!rows.every(r => r.kind === kind)) return;
    out.set(label, kind === 'health' ? rows.map(r => r.title).join(' · ') : eventSummary(rows));
  };

  for (const item of items) {
    if (item.type === 'header') {
      flush();
      label = item.label;
      rows = [];
      pure = true;
    } else if (item.type === 'context' && isCardRow(item.row)) {
      rows.push(item.row);
    } else {
      pure = false;
    }
  }
  flush();
  return out;
}

function eventSummary(rows: readonly ContextRow[]): string {
  const count = `${rows.length} ${rows.length === 1 ? 'event' : 'events'}`;
  const running = rows.find(r => r.now);
  if (running) return `${count} · ${running.title} now`;
  const next = rows.find(r => r.caption !== ALL_DAY_CAPTION);
  return next ? `${count} · next ${next.title} ${next.caption}` : count;
}
