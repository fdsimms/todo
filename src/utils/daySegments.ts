/**
 * The four time-of-day boundaries, kept in order.
 *
 * Morning, afternoon, evening and night are four independent "HH:MM" settings
 * (`morningStart` and the three beside it), and nothing used to stop them being
 * set out of order — Morning at 14:00 over an Afternoon still sitting at 12:00
 * was two taps away, with no complaint from anywhere.
 *
 * That is not merely untidy. `streakWindowEnd` in `visibilityUtils.ts` reads a
 * segment's window as "this segment, until the next one starts", so a
 * morning-only task's window closes at `afternoonStart`. Out of order, the task
 * is *hidden* until 14:00 by a window that closed at 12:00 — it becomes visible
 * two hours after it was already late, and with `streakRequiresWindow` on,
 * `isCompletionOnTime` is false for every completion the task can ever have. A
 * streak that cannot be continued, from a setting the app let you make.
 *
 * The rest of the model assumes the order too: `getTimeOfDayThreshold` anchors
 * every boundary to the same logical day with `setHours`, so there is no
 * wrap-past-midnight to represent, and "later segment" means "later clock time"
 * throughout.
 *
 * **The rule is a forward push, deliberately, rather than a clamp both ways.**
 * The boundary the user just set is the one they mean, so it is never moved,
 * and only the boundaries *after* it give way — moving Morning to 14:00 carries
 * Afternoon, Evening and Night along with it if they would otherwise be left
 * behind. A symmetric clamp would instead drag three earlier boundaries back to
 * meet one late edit, spending three settings to honour one. Moving a later
 * boundary earlier than the one before it is the one case with nothing after it
 * to give way, so that value is held at its predecessor: the edit still lands
 * as far back as it can go, which is what a picker with a floor would have
 * offered in the first place.
 */

export const DAY_SEGMENT_KEYS = ['morning', 'afternoon', 'evening', 'night'] as const;

export type DaySegmentKey = (typeof DAY_SEGMENT_KEYS)[number];

/** The four boundaries as they are stored, earliest first. */
export type DaySegmentTimes = Record<DaySegmentKey, string>;

/** "HH:MM" as minutes past midnight, for comparison only. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * The four boundaries after setting one of them, with the order restored.
 *
 * Returns a whole set rather than the one value, so a caller writes what it is
 * given and never has to work out which of the others moved.
 */
export function applyDaySegmentTime(
  current: DaySegmentTimes,
  key: DaySegmentKey,
  hhmm: string,
): DaySegmentTimes {
  const index = DAY_SEGMENT_KEYS.indexOf(key);
  const next = { ...current };

  // Held at its predecessor when it would otherwise start before it — the one
  // direction with nothing later to give way.
  const floor = index > 0 ? current[DAY_SEGMENT_KEYS[index - 1]] : null;
  next[key] = floor !== null && minutesOf(hhmm) < minutesOf(floor) ? floor : hhmm;

  // Everything after it comes along rather than being left behind.
  for (let i = index + 1; i < DAY_SEGMENT_KEYS.length; i++) {
    const prev = next[DAY_SEGMENT_KEYS[i - 1]];
    if (minutesOf(next[DAY_SEGMENT_KEYS[i]]) < minutesOf(prev)) next[DAY_SEGMENT_KEYS[i]] = prev;
  }
  return next;
}

/** Whether these four are in order — what `applyDaySegmentTime` guarantees. */
export function daySegmentsInOrder(times: DaySegmentTimes): boolean {
  return DAY_SEGMENT_KEYS.every((key, i) =>
    i === 0 || minutesOf(times[key]) >= minutesOf(times[DAY_SEGMENT_KEYS[i - 1]]));
}
