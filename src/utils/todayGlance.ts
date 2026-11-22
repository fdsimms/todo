/**
 * What the pane beside Today as a list shows while no task is open in it
 * (`TodayDayPane`): the rest of the day, an hour a row.
 */

/** Something on the rest of the day: an event that starts, or a task that surfaces, at `at`. */
export interface DayEntry {
  key: string;
  title: string;
  kind: 'event' | 'task';
  at: Date;
}

/** One hour of `dayTimeline`, and what starts in it. */
export interface DayHour {
  /** The hour's first instant. */
  start: Date;
  entries: DayEntry[];
}

/** The fewest hours the timeline shows, so a quiet afternoon still reads as an afternoon. */
export const DAY_TIMELINE_MIN_HOURS = 6;

/**
 * The rest of the day as hours, for the pane beside Today as a list
 * (`TodayDayPane`): from the hour `now` is in to the last hour anything starts
 * in, at least `DAY_TIMELINE_MIN_HOURS`, and never past `dayEnd` (the next
 * logical day's start, so a day that runs past midnight keeps its small hours).
 * An entry that started before this hour (an event under way) is shown in it;
 * one at or after `dayEnd` is left out, since it belongs to another day.
 */
export function dayTimeline(entries: readonly DayEntry[], now: Date, dayEnd: Date): DayHour[] {
  const HOUR = 3_600_000;
  const first = new Date(now);
  first.setMinutes(0, 0, 0);
  const firstMs = first.getTime();
  const endMs = dayEnd.getTime();
  const kept = entries.filter(e => e.at.getTime() < endMs).slice().sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = kept.length > 0 ? kept[kept.length - 1].at.getTime() : firstMs;
  const count = Math.max(
    1,
    Math.min(Math.ceil((endMs - firstMs) / HOUR), Math.max(DAY_TIMELINE_MIN_HOURS, Math.floor((last - firstMs) / HOUR) + 1)),
  );
  const hours: DayHour[] = Array.from({ length: count }, (_, i) => ({ start: new Date(firstMs + i * HOUR), entries: [] }));
  for (const entry of kept) {
    const index = Math.max(0, Math.floor((entry.at.getTime() - firstMs) / HOUR));
    if (index < hours.length) hours[index].entries.push(entry);
  }
  return hours;
}
