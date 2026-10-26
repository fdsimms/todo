import type { BusyEvent } from './calendarBusy';

/**
 * The all-day strip of a multi-day view, with an event that runs several days
 * drawn once across them rather than as a clipped copy in every column.
 *
 * Two copies are one event when they share an id and a start (`eventsIn` hands
 * the same event to each day it touches). A run of neighbouring days is one bar;
 * a gap in the days makes two. Only `maxRows` rows are drawn, longest bars
 * first, and whatever doesn't fit is counted per day in `hidden`, which is
 * what each day's "+N more" reads.
 */

export interface AllDayBar {
  /** The first day's copy of the event. */
  event: BusyEvent;
  startColumn: number;
  /** How many days it covers. */
  span: number;
}

export interface AllDayLayout {
  rows: AllDayBar[][];
  /** Per day, how many events didn't fit in `rows`. */
  hidden: number[];
}

export function layoutAllDay(days: readonly (readonly BusyEvent[])[], maxRows: number): AllDayLayout {
  const firstSeen = new Map<string, { event: BusyEvent; columns: number[]; order: number }>();
  days.forEach((events, column) => {
    for (const event of events) {
      const key = `${event.id}:${event.start}`;
      const seen = firstSeen.get(key);
      if (seen) seen.columns.push(column);
      else firstSeen.set(key, { event, columns: [column], order: firstSeen.size });
    }
  });

  const bars: (AllDayBar & { order: number })[] = [];
  for (const { event, columns, order } of firstSeen.values()) {
    let runStart = columns[0];
    columns.forEach((column, i) => {
      if (i + 1 < columns.length && columns[i + 1] === column + 1) return;
      bars.push({ event, startColumn: runStart, span: column - runStart + 1, order });
      runStart = columns[i + 1];
    });
  }
  bars.sort((a, b) => b.span - a.span || a.startColumn - b.startColumn || a.order - b.order);

  const rows: AllDayBar[][] = [];
  const taken: boolean[][] = [];
  const hidden = days.map(() => 0);
  for (const bar of bars) {
    const end = bar.startColumn + bar.span;
    let placed = false;
    for (let r = 0; r < maxRows && !placed; r += 1) {
      taken[r] ??= days.map(() => false);
      let free = true;
      for (let c = bar.startColumn; c < end; c += 1) if (taken[r][c]) free = false;
      if (!free) continue;
      for (let c = bar.startColumn; c < end; c += 1) taken[r][c] = true;
      (rows[r] ??= []).push({ event: bar.event, startColumn: bar.startColumn, span: bar.span });
      placed = true;
    }
    if (!placed) for (let c = bar.startColumn; c < end; c += 1) hidden[c] += 1;
  }
  rows.forEach(row => row.sort((a, b) => a.startColumn - b.startColumn));
  return { rows, hidden };
}
