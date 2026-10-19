/** The lengths the event date picker offers as one-tap chips. Any other length is "Other…". */
export const EVENT_LENGTH_PRESETS = [30, 60, 90, 120] as const;

/** "30m", "1h", "1h 20m": a length read aloud, not a decimal ("1.3h"). */
export function describeEventLength(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Minutes from a start to an end given only as a clock time. An end at or
 * before the start's clock time falls on the next day ("10pm to 1am"), so a
 * time wheel alone can say an overnight event. Always 1 to 1440.
 */
export function lengthToClock(start: Date, endClock: Date): number {
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = endClock.getHours() * 60 + endClock.getMinutes();
  const diff = endMin - startMin;
  return diff > 0 ? diff : diff + 1440;
}
