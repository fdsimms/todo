/**
 * Which day of the calendar's week list the reader has scrolled to, so the
 * strip above it can mark that day.
 *
 * A day is "the one you're on" once its section's top has reached the top of
 * the list. The last sections of a week usually can't scroll that far (there
 * is nothing below them to scroll into), so once the list is at its end the
 * last day counts, or Sunday could never be marked by scrolling.
 *
 * `sections` are in list order, each with the `y` its section was laid out at.
 * Returns null while nothing has been laid out yet.
 */
export interface WeekSection {
  key: string;
  y: number;
}

/** How far into a section the top edge may sit and still name the one above. */
export const WEEK_SPY_SLOP = 8;

export function activeWeekDay(
  sections: readonly WeekSection[],
  scrollY: number,
  viewportHeight: number,
  contentHeight: number,
): string | null {
  if (sections.length === 0) return null;
  const atEnd = viewportHeight > 0 && contentHeight > viewportHeight
    && scrollY + viewportHeight >= contentHeight - 1;
  if (atEnd) return sections[sections.length - 1].key;
  let active = sections[0].key;
  for (const section of sections) {
    if (section.y <= scrollY + WEEK_SPY_SLOP) active = section.key;
    else break;
  }
  return active;
}
