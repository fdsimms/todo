/**
 * The Apple Fitness rings, as a reading.
 *
 * The same rules every other Health reading here lives under
 * (`docs/arch/health-data.md`), restated for the three numbers this one adds:
 *
 * - **Absent is never zero.** A refused read, a day with no summary and a device
 *   with no rings all come back as no summary at all, and HealthKit does not say
 *   which. So every figure is `number | null`, and a ring with no figure draws
 *   nothing rather than an empty ring (an empty ring is a claim: "you have done
 *   none of this").
 * - **A ring nobody set a goal for has no fill.** Fitness always has goals, but
 *   the bridge sends a goal of zero or less as null, because a fraction of
 *   nothing is not a number.
 * - **This only reports.** It never derives a state about the person ("behind",
 *   "on track"). A closed ring is the one derived fact, and it is the ring's own
 *   definition: the total reached the goal the person set.
 *
 * Nothing here is stored. The reading rides on `HealthDay.rings` and goes away
 * with the rest of the snapshot.
 */

/** One ring: how much so far today, and the goal the person set for it. */
export interface ActivityRing {
  value: number | null;
  goal: number | null;
}

export type RingId = 'move' | 'exercise' | 'stand';

export interface ActivityRings {
  /**
   * Kilocalories of active energy against the Move goal. **Both null when the
   * person's Move ring counts Move Time instead** (`moveByTime`), which Fitness
   * offers people under 18: that ring's number is minutes, and reporting it
   * under a calories label would be a wrong figure rather than a missing one.
   */
  move: ActivityRing;
  /** Minutes of Apple Exercise Time against the Exercise goal. */
  exercise: ActivityRing;
  /** Hours stood in against the Stand goal. */
  stand: ActivityRing;
  /** True when the Move ring is measured in Move Time rather than calories. */
  moveByTime: boolean;
}

/** What each ring is called, measured in, and drawn as. */
export const RING_META: Record<RingId, { label: string; unit: string }> = {
  move: { label: 'Move', unit: 'cal' },
  exercise: { label: 'Exercise', unit: 'min' },
  stand: { label: 'Stand', unit: 'hr' },
};

/** Drawing order, outermost ring first, as Fitness draws them. */
export const RING_ORDER: readonly RingId[] = ['move', 'exercise', 'stand'];

/** A real 0 survives; a negative, a non-number or NaN is "no figure". */
function figure(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** A goal of zero is no goal. */
function goalFigure(value: unknown): number | null {
  const n = figure(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Read the native summary's JSON into rings, or null when there is no summary
 * to report: the string `"null"`, anything unparseable, or a summary in which
 * no ring has a figure at all.
 *
 * That last case is deliberate. A summary of three nulls is a reading that
 * carries nothing, and handing it on would give every reader a non-null object
 * to render an empty ring from.
 */
export function parseActivitySummary(json: string): ActivityRings | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const moveByTime = raw.moveMode === 'moveTime';
  const rings: ActivityRings = {
    // Time-based Move is dropped here as well as natively, so a build that sent
    // calories under it would still not be believed.
    move: moveByTime
      ? { value: null, goal: null }
      : { value: figure(raw.moveKcal), goal: goalFigure(raw.moveGoalKcal) },
    exercise: { value: figure(raw.exerciseMinutes), goal: goalFigure(raw.exerciseGoalMinutes) },
    stand: { value: figure(raw.standHours), goal: goalFigure(raw.standGoalHours) },
    moveByTime,
  };
  if (RING_ORDER.every(id => rings[id].value === null)) return null;
  return rings;
}

/**
 * How far round the ring is, as a fraction that may pass 1 (Fitness keeps
 * counting past a closed ring and draws a second lap), or null when either half
 * is missing. Null rather than 0 for the same reason a figure is: an empty ring
 * is a statement.
 */
export function ringFraction(ring: ActivityRing): number | null {
  if (ring.value === null || ring.goal === null) return null;
  return ring.value / ring.goal;
}

/** Did the total reach the goal? False when either half is missing. */
export function isRingClosed(ring: ActivityRing): boolean {
  const fraction = ringFraction(ring);
  return fraction !== null && fraction >= 1;
}

/**
 * The ring's readout: "312 / 500 cal", "18 / 30 min", "7 / 12 hr", or just the
 * figure when no goal came with it. Null when there is no figure.
 */
export function describeRing(id: RingId, ring: ActivityRing): string | null {
  if (ring.value === null) return null;
  const { unit } = RING_META[id];
  const value = Math.round(ring.value).toLocaleString();
  if (ring.goal === null) return `${value} ${unit}`;
  return `${value} / ${Math.round(ring.goal).toLocaleString()} ${unit}`;
}

/**
 * One sentence for a screen reader, since the drawn rings are one accessibility
 * element rather than three: "Move 312 of 500 calories, Exercise 30 of 30
 * minutes (closed), Stand 7 of 12 hours". Rings with no figure are left out
 * rather than read as zero. Null when none has one.
 */
export function ringsAccessibilityLabel(rings: ActivityRings): string | null {
  const nouns: Record<RingId, [string, string]> = {
    move: ['calorie', 'calories'],
    exercise: ['minute', 'minutes'],
    stand: ['hour', 'hours'],
  };
  const parts: string[] = [];
  for (const id of RING_ORDER) {
    const ring = rings[id];
    if (ring.value === null) continue;
    const value = Math.round(ring.value);
    const noun = nouns[id][value === 1 ? 0 : 1];
    const against = ring.goal === null
      ? `${value.toLocaleString()} ${noun}`
      : `${value.toLocaleString()} of ${Math.round(ring.goal).toLocaleString()} ${nouns[id][1]}`;
    parts.push(`${RING_META[id].label} ${against}${isRingClosed(ring) ? ' (closed)' : ''}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Fitness's own one-line summary of the rings, "312/500 cal · 18/30 min ·
 * 7/12 hr", for a row with room for one line of text.
 *
 * **A ring at zero is left out**, the rule `healthContextRows` already holds
 * for steps: every day starts there and stays until the first sample lands, so
 * the line would scold each morning and read the same as not-synced-yet.
 * Null when no ring has anything to say, which is most mornings.
 */
export function ringsSummaryLine(rings: ActivityRings): string | null {
  const parts: string[] = [];
  for (const id of RING_ORDER) {
    const ring = rings[id];
    if (ring.value === null || ring.value <= 0) continue;
    const text = describeRing(id, ring);
    if (text !== null) parts.push(text.replace(' / ', '/'));
  }
  return parts.length > 0 ? parts.join(' \u00B7 ') : null;
}
