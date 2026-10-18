/**
 * Workouts other apps recorded in Apple Health (a run, a ride, a class), read
 * for a window and never kept.
 *
 * The native side (`readWorkouts` in `todo-health-bridge`) hands back raw JSON
 * and leaves out this app's own workouts, so a session written from the
 * Workouts screen isn't listed twice. Every rule about what the rest *mean*
 * lives here, where it can be tested: the `sleepLog.ts` arrangement.
 *
 * **A workout from Health is a reading, not an entry.** It is shown with the
 * app that recorded it ("From Health", then the source's name) and never
 * asserted as fact, and nothing here stores one: there is no table, the
 * reason `docs/arch/health-data.md` gives for every Health read. The sets this
 * app logs are entries and have tables; another app's run is somebody else's
 * record.
 *
 * **Absent stays absent.** A workout recorded with no energy has
 * `energyKcal: null`, never 0, and a missing duration is null rather than
 * worked out from the two ends (a paused workout's duration is shorter than
 * its span, and guessing which is what the source meant is not this file's
 * call). A present zero survives as zero.
 *
 * **An empty answer can't say why.** Health serves a refused read as an empty
 * store, so `[]` covers a refusal, a person with no workouts, and an install
 * that allowed Health before workouts were added and hasn't asked again.
 * Nothing may read it as "no workouts this week".
 */
import { healthBridge } from './healthBridge';

/**
 * The activity names the bridge sends, one per `HKWorkoutActivityType` case
 * it maps (`workoutActivityTable` in the Swift module). Anything else arrives
 * as `other`, and so does a name this side doesn't know yet.
 */
export const HEALTH_WORKOUT_ACTIVITIES = [
  'traditionalStrengthTraining',
  'functionalStrengthTraining',
  'coreTraining',
  'highIntensityIntervalTraining',
  'crossTraining',
  'mixedCardio',
  'running',
  'walking',
  'hiking',
  'cycling',
  'swimming',
  'rowing',
  'elliptical',
  'stairClimbing',
  'stairs',
  'stepTraining',
  'jumpRope',
  'yoga',
  'pilates',
  'barre',
  'flexibility',
  'cooldown',
  'mindAndBody',
  'taiChi',
  'cardioDance',
  'socialDance',
  'boxing',
  'kickboxing',
  'martialArts',
  'climbing',
  'tennis',
  'pickleball',
  'soccer',
  'basketball',
  'golf',
  'downhillSkiing',
  'snowboarding',
  'crossCountrySkiing',
  'fitnessGaming',
  'other',
] as const;

export type HealthWorkoutActivity = (typeof HEALTH_WORKOUT_ACTIVITIES)[number];

/** What each activity is called on screen. `other` is a plain "Workout": it is one, of a kind this table doesn't name. */
export const HEALTH_WORKOUT_ACTIVITY_LABEL: Record<HealthWorkoutActivity, string> = {
  traditionalStrengthTraining: 'Strength training',
  functionalStrengthTraining: 'Functional strength training',
  coreTraining: 'Core training',
  highIntensityIntervalTraining: 'HIIT',
  crossTraining: 'Cross training',
  mixedCardio: 'Mixed cardio',
  running: 'Running',
  walking: 'Walking',
  hiking: 'Hiking',
  cycling: 'Cycling',
  swimming: 'Swimming',
  rowing: 'Rowing',
  elliptical: 'Elliptical',
  stairClimbing: 'Stair stepper',
  stairs: 'Stairs',
  stepTraining: 'Step training',
  jumpRope: 'Jump rope',
  yoga: 'Yoga',
  pilates: 'Pilates',
  barre: 'Barre',
  flexibility: 'Flexibility',
  cooldown: 'Cooldown',
  mindAndBody: 'Mind and body',
  taiChi: 'Tai chi',
  cardioDance: 'Cardio dance',
  socialDance: 'Social dance',
  boxing: 'Boxing',
  kickboxing: 'Kickboxing',
  martialArts: 'Martial arts',
  climbing: 'Climbing',
  tennis: 'Tennis',
  pickleball: 'Pickleball',
  soccer: 'Soccer',
  basketball: 'Basketball',
  golf: 'Golf',
  downhillSkiing: 'Downhill skiing',
  snowboarding: 'Snowboarding',
  crossCountrySkiing: 'Cross-country skiing',
  fitnessGaming: 'Fitness gaming',
  other: 'Workout',
};

/** One workout another app recorded. */
export interface HealthWorkout {
  start: Date;
  end: Date;
  activity: HealthWorkoutActivity;
  /** The source's own duration, which leaves out pauses; null when it sent none. */
  durationSeconds: number | null;
  /** The recording app's name, for the attribution. Empty when it gave none. */
  sourceName: string;
  /** Total active energy saved with the workout, or null when it carries none. */
  energyKcal: number | null;
}

const KNOWN_ACTIVITIES: ReadonlySet<string> = new Set(HEALTH_WORKOUT_ACTIVITIES);

function amountOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The bridge's wire JSON as workouts, sorted by start, dropping anything
 * malformed. `[]` for every reason there is nothing to read (see the file
 * note: that includes a refusal, which can't be told apart).
 */
export function parseHealthWorkouts(json: string): HealthWorkout[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: HealthWorkout[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { start, end, activity, durationSeconds, source, energyKcal } = entry as Record<string, unknown>;
      if (typeof start !== 'string' || typeof end !== 'string') continue;
      const startAt = new Date(start);
      const endAt = new Date(end);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) continue;
      if (endAt < startAt) continue;
      out.push({
        start: startAt,
        end: endAt,
        activity:
          typeof activity === 'string' && KNOWN_ACTIVITIES.has(activity)
            ? (activity as HealthWorkoutActivity)
            : 'other',
        durationSeconds: amountOrNull(durationSeconds),
        sourceName: typeof source === 'string' ? source.trim() : '',
        energyKcal: amountOrNull(energyKcal),
      });
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch {
    return [];
  }
}

/**
 * Workouts from other apps overlapping the `days` days starting at `anchor`.
 *
 * `anchor` is the caller's to compute (the start of a logical day, from
 * `dayResetTime`), for the reason every Health read gives: nothing native may
 * guess where a day begins. `[]` off iOS, in demo mode (the `healthBridge()`
 * gate: a demo never reads a real body), and for every empty answer. Nothing
 * is stored.
 */
export async function readHealthWorkouts(anchor: Date, days: number): Promise<HealthWorkout[]> {
  const bridge = healthBridge();
  if (!bridge) return [];
  return parseHealthWorkouts(await bridge.readWorkouts(anchor.toISOString(), days));
}
