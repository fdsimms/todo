import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { addDays } from 'date-fns/addDays';
import { dayKeyOf, getCurrentDayStart, getLogicalDayKey } from '../utils/dateUtils';
import type { HealthDayInput } from '../utils/moodInsights';
import type { WeightPoint } from '../utils/weightLog';
import { healthBridge } from '../utils/healthBridge';
import { useSettingsStore } from './useSettingsStore';
import { createRefreshGuard } from '../utils/refreshGuard';
import { anyExerciseRule } from '../utils/healthRules';

/**
 * What Apple Health says about today, held in memory.
 *
 * The `useWeatherStore` / `useCalendarStore` shape, and for the identical
 * reason: it is another app's answer about something outside this one, not this
 * app's own data, so there is **no table, no migration and no sync**. That last
 * one is worth stating rather than leaving to be inferred — Health already
 * syncs across a person's own devices through iCloud, so there is nothing for a
 * second device to disagree about and nothing a merge would resolve, which is
 * exactly the argument `SYNC_EXCLUDED_TABLES` makes for the barcode cache. A
 * copy in this app's SQLite would be half a health record in a backup file, put
 * there to answer a question the phone can already answer.
 *
 * Readers only ever take whatever snapshot is here; this store owns getting it
 * there, and nothing else calls the bridge.
 *
 * ## Why this refreshes more often than the weather does
 *
 * `useWeatherStore.refresh()` returns early once the day already has a
 * snapshot, because a forecast is one answer for a day. A step count is a
 * running total that is wrong the moment after it is read, so this re-reads on
 * every foreground and keeps the day key only to know which day the number is
 * *about*. It is a local read with no network and no location, so re-reading
 * costs approximately nothing — which is also what will make it the first
 * reading in this app that a background refresh can legitimately take (see
 * `backgroundRefresh.ts`, which refuses a weather read because the location
 * permission sheet promises otherwise).
 */

/** One logical day's readings. A field is null when there is no number for it. */
export interface HealthDay {
  /** The logical day these numbers are about, under the user's own reset time. */
  dayKey: string;
  /**
   * Steps so far today, or null.
   *
   * **Null is not zero and must never be rendered as one.** It covers a read
   * that was refused, a day with no samples and a device that has never
   * recorded any, and HealthKit does not distinguish them — a refusal is
   * deliberately made to look like an empty store. Same rule `moodInsights`
   * already holds ("a day you didn't log is not a zero"), except that here the
   * API forces it rather than the design choosing it.
   */
  steps: number | null;
  /**
   * Hours asleep recorded for today, or null. Same rules as `steps`.
   *
   * Filed under the day the sleeping *ended* in, so this is last night's for
   * most of the day — but nothing calls it that, because a nap counts toward
   * its own day too. The honest name for the number is time asleep recorded
   * against a day.
   */
  sleepHours: number | null;
  /**
   * Milligrams of sodium logged for today so far, or null. Same null rule as
   * `steps`/`sleepHours` — and doubly so here, since this app never records a
   * sodium sample itself: the number only exists at all once another app (a
   * food/diet logger) has written one to Health, so "nothing recorded" and
   * "nobody logs sodium" read identically, same as everywhere else in this
   * file.
   */
  sodiumMg: number | null;
  /** Grams of protein logged for today so far, or null. Same rules as `sodiumMg`. */
  proteinG: number | null;
  /** Grams of saturated fat logged for today so far, or null. Same rules as `sodiumMg`. */
  satFatG: number | null;
  /** Grams of fiber logged for today so far, or null. Same rules as `sodiumMg`. */
  fiberG: number | null;
  /** Grams of sugar logged for today so far, or null. Same rules as `sodiumMg`. */
  sugarG: number | null;
  /** Milligrams of caffeine logged for today so far, or null. Same rules as `sodiumMg`. */
  caffeineMg: number | null;
  /** Millilitres of water logged for today so far, or null. Same rules as `sodiumMg`. */
  waterMl: number | null;
  /** Kilocalories logged for today so far, or null. Same rules as `sodiumMg`. */
  calorieKcal: number | null;
  /**
   * Kilocalories of active energy burned so far today, or null — what a body
   * spent moving, over and above what it spends existing.
   *
   * **A running total, and the one on this record that is read as a number to
   * act on rather than only to report.** `activeEnergyBoost.ts` raises today's
   * calorie target by whatever of this clears a baseline the person set, so
   * the null rule bites harder here than anywhere else in this file: read an
   * absent figure as a zero and the target never moves for somebody whose
   * devices do record this, which is a feature silently doing nothing.
   * Reading it as a refusal costs the same nothing and claims less, so that is
   * what every reader does.
   *
   * It only ever grows through the day, which is what makes it safe to add to
   * a target: a partial day understates the boost rather than overstating it,
   * so the number on screen is never one somebody has to take back.
   */
  activeEnergyKcal: number | null;
  /**
   * Minutes of Apple Exercise Time so far today, or null. Same rules as
   * `steps`, and the metric where that null does the most damage.
   */
  exerciseMinutes: number | null;
  /**
   * Whether exercise minutes were recorded on any day of the trailing window
   * — **not a reading about today**, and the one field on this record that
   * isn't.
   *
   * It exists because `exerciseMinutes` is the metric where "absent" and
   * "zero" come apart in a way steps never forced. A carried phone always
   * records some steps, so a null step count really does mean a refusal or no
   * device. Exercise minutes are different: most people have days with
   * genuinely none, and HealthKit writes no sample for a day that earned none,
   * so the honest reading of a null is ambiguous in a way that matters. Read
   * as a refusal, a floor rule can never fire on the day it is most about;
   * read as a zero, it fires every evening at everybody who has no device
   * recording exercise and never will, which is exactly the failure
   * `docs/arch/health-data.md` exists to prevent.
   *
   * This is what separates the two. Somebody whose devices have recorded
   * exercise at some point in the window demonstrably has a device that
   * records it, so today's silence is a real zero. Somebody with nothing in
   * the whole window is told nothing at all.
   *
   * False whenever the window wasn't read — the safe direction, since the
   * failure it buys is a rule that stays quiet.
   */
  exerciseMinutesSeenRecently: boolean;
  /** When this was read, for a caller that wants to say how fresh it is. */
  readAt: string;
}

/**
 * How far back `refresh` looks to decide whether exercise minutes are a thing
 * this person's devices record at all — see `exerciseMinutesSeenRecently`.
 *
 * Two weeks is round rather than measured, the same admission
 * `HEALTH_METRIC_EARLIEST_HOUR` makes about its own 18:00. Long enough that
 * somebody who exercises once a week still counts, short enough that a rule
 * goes quiet after a fortnight of nothing rather than nagging indefinitely —
 * and coming back on its own the first day anything is recorded again.
 *
 * The window is only read when a rule actually needs it (see `refresh`), so
 * nobody pays for a wider query to serve a feature they aren't using.
 */
export const EXERCISE_LIVE_WINDOW_DAYS = 14;

/**
 * How far back the history read goes.
 *
 * Long enough to clear `MIN_PAIRED_DAYS` for somebody who logs their mood a
 * couple of times a week, which is the point of reading it at all, and short
 * enough to stay one quick query. It is a window on somebody else's data rather
 * than a retention setting: nothing here is stored, so making it longer costs a
 * slower read and nothing else, and making it a preference would be a knob over
 * a number nobody has an opinion about.
 */
export const HEALTH_HISTORY_DAYS = 90;

/**
 * How far back the weight read goes — longer than the readings window above,
 * and longer than the Weight screen's default display range, on purpose.
 *
 * `HEALTH_HISTORY_DAYS` is sized to gather enough *paired* days for the mood
 * correlations, which need both a mood entry and a reading on the same day.
 * Weight is drawn rather than correlated, and a body moves slowly: three months
 * of it is a chart with barely any shape, where a year shows the thing
 * somebody weighing themselves is actually watching for. Both are one query and
 * neither is stored, so the wider window costs nothing but a slightly longer
 * read.
 *
 * **This is the fetch ceiling, not the chart's default zoom.** The Weight
 * screen reads this many days once and lets somebody pick a shorter range to
 * look at (`WEIGHT_CHART_RANGES` in `WeightScreen.tsx`) without a second
 * Health query — the native side's own ceiling is 400 days
 * (`readWeightSeries`'s `days <= 400` guard), so 365 leaves margin and still
 * reads as an honest "a year".
 */
export const WEIGHT_HISTORY_DAYS = 365;

interface HealthState {
  today: HealthDay | null;
  refreshing: boolean;
  /**
   * The last `HEALTH_HISTORY_DAYS` of readings, oldest first, or null for
   * "not looked yet" — which is a third answer and must not render as an empty
   * window. Only days HealthKit answered for are present.
   */
  history: HealthDayInput[] | null;
  loadingHistory: boolean;
  /**
   * The last `WEIGHT_HISTORY_DAYS` of body-mass readings, oldest first, or null
   * for "not looked yet" — the same third answer `history` carries, and it
   * matters more here: most people do not weigh themselves daily, so an empty
   * window is a completely ordinary thing to have read and must not look like a
   * failure to read.
   */
  weightSeries: WeightPoint[] | null;
  loadingWeight: boolean;
  /** Re-read today's numbers. A no-op when the gate is closed or a read is already running. */
  refresh: () => Promise<void>;
  /** Re-read the trailing window. Only the screens that show a trend call this. */
  refreshHistory: () => Promise<void>;
  /** Re-read the body-mass window. Only the Weight screen calls this. */
  refreshWeight: () => Promise<void>;
  /**
   * A short body-mass window, answered without storing it. Null when there was
   * no way to ask at all.
   */
  readRecentWeights: (days: number) => Promise<WeightPoint[] | null>;
  /**
   * A short window of daily active-energy figures, answered without storing
   * one. Null when there was no way to ask; a day with no figure is null
   * within the array rather than being dropped.
   */
  readRecentActiveEnergy: (days: number) => Promise<(number | null)[] | null>;
  clear: () => void;
}

// Three reads that run independently, so a guard each rather than one for the
// store: today's reading and the history window are fetched separately and
// neither should cancel the other. See refreshGuard.ts — what they are really
// protecting is the rule this feature is built on, that access revoked shows as
// no data rather than as the last data.
const todayGuard = createRefreshGuard();
const historyGuard = createRefreshGuard();
const weightGuard = createRefreshGuard();

export const useHealthStore = create<HealthState>((set, get) => ({
  today: null,
  refreshing: false,
  history: null,
  loadingHistory: false,
  weightSeries: null,
  loadingWeight: false,

  async refresh() {
    // One gate, which is also the demo-mode refusal — see healthBridge.ts.
    const bridge = healthBridge();
    if (!bridge) return;
    if (get().refreshing) return;

    // The window is the user's *logical* day, computed here rather than
    // natively: at 1am with a 02:00 reset the day that is running is still
    // yesterday's, and a native `startOfDay` would file the reading against a
    // day the user hasn't reached yet. Same reason the Screen Time extension is
    // handed a day key rather than working one out.
    const dayStart = getCurrentDayStart();
    const dayKey = dayKeyOf(dayStart);
    const now = new Date();

    set({ refreshing: true });
    const token = todayGuard.begin();
    try {
      // Today's bucket, plus the trailing window when — and only when — a live
      // exercise rule needs it (see `exerciseMinutesSeenRecently`). The same
      // call the history read uses rather than a second "just today" one:
      // HealthKit has no future samples, so a bucket running to the end of
      // today is today-so-far, and one query shape means the source
      // de-duplication rule cannot drift between the two reads.
      const wantsWindow = anyExerciseRule(useSettingsStore.getState().healthRules);
      const days = wantsWindow ? EXERCISE_LIVE_WINDOW_DAYS : 1;
      const windowStart = wantsWindow ? addDays(dayStart, -(days - 1)) : dayStart;
      const window = await bridge.readDailyHealth(windowStart.toISOString(), days);
      if (!todayGuard.isCurrent(token)) return;
      // Today is the window's last bucket — the native side emits one entry per
      // requested day from its own anchor, so the count is fixed and the final
      // one is always today, widened or not (unwidened, it is also the first).
      //
      // The day-key match is tried first because it is better evidence, but it
      // *falls back* rather than standing alone, and that is deliberate: the
      // native read's own note warns that if its buckets ever stop lining up,
      // "every day silently reads null ... and a feature whose absent value is
      // indistinguishable from a refusal cannot afford a failure that looks
      // like no data". A bare find would be exactly that failure.
      const reading =
        window.find(r => getLogicalDayKey(new Date(r.start)) === dayKey)
        ?? window[window.length - 1]
        ?? null;
      // Today's own figure counts: a rule only consults this when today is
      // null, so including it costs nothing and leaving it out would be an
      // odd exception to explain.
      const exerciseMinutesSeenRecently =
        wantsWindow && window.some(r => r.exerciseMinutes !== null);
      // Written even when the numbers are null, and written as a whole day
      // rather than merged into the last one. A null answer is the current
      // truth rather than a failed read to paper over, and holding the last
      // good number would keep reporting a figure after access was revoked —
      // the one state this feature must not misreport.
      set({
        today: {
          dayKey,
          steps: reading?.steps ?? null,
          sleepHours: reading?.sleepMinutes == null ? null : reading.sleepMinutes / 60,
          sodiumMg: reading?.sodiumMg ?? null,
          proteinG: reading?.proteinG ?? null,
          satFatG: reading?.satFatG ?? null,
          fiberG: reading?.fiberG ?? null,
          sugarG: reading?.sugarG ?? null,
          caffeineMg: reading?.caffeineMg ?? null,
          waterMl: reading?.waterMl ?? null,
          calorieKcal: reading?.calorieKcal ?? null,
          activeEnergyKcal: reading?.activeEnergyKcal ?? null,
          exerciseMinutes: reading?.exerciseMinutes ?? null,
          exerciseMinutesSeenRecently,
          readAt: now.toISOString(),
        },
      });
    } finally {
      set({ refreshing: false });
    }
  },

  /**
   * Read the trailing window, on demand.
   *
   * Deliberately not part of `refresh` and not on the foreground triggers: it
   * is a wider read that only the Mood screen's insights want, and running it
   * on every foreground would be paying for a chart nobody has open. Same split
   * `useMealPlanStore` draws by letting the screen own which week is loaded.
   *
   * Nothing is persisted, here or anywhere: `docs/arch/health-data.md` explains
   * why this app never keeps a copy of somebody's health record, and a
   * historical query is cheap enough that the copy would buy only a backup file
   * with their sleep in it.
   */
  async refreshHistory() {
    const bridge = healthBridge();
    if (!bridge) return;
    if (get().loadingHistory) return;

    // The window ends with today and runs back HEALTH_HISTORY_DAYS - 1 days, so
    // today is the last bucket rather than a partial one hanging off the end.
    const anchor = addDays(getCurrentDayStart(), -(HEALTH_HISTORY_DAYS - 1));

    set({ loadingHistory: true });
    const token = historyGuard.begin();
    try {
      const readings = await bridge.readDailyHealth(anchor.toISOString(), HEALTH_HISTORY_DAYS);
      if (!historyGuard.isCurrent(token)) return;
      const history: HealthDayInput[] = [];
      for (const reading of readings) {
        const at = new Date(reading.start);
        if (Number.isNaN(at.getTime())) continue;
        history.push({
          // The day key is derived here rather than natively, so there is one
          // implementation of "which day is this" and it is the one holding
          // `dayResetTime`. The native side hands back the instant it bucketed
          // from and says nothing about which day that is.
          dayKey: getLogicalDayKey(at),
          steps: reading.steps,
          // Hours, because that is the unit the insight speaks in; minutes are
          // what HealthKit's samples measure. Kept unrounded — the screen
          // decides how many decimals a person should read, and rounding at
          // the source would quietly change a correlation.
          sleepHours: reading.sleepMinutes === null ? null : reading.sleepMinutes / 60,
        });
      }
      set({ history });
    } finally {
      set({ loadingHistory: false });
    }
  },

  /**
   * Read the body-mass window, on demand.
   *
   * Its own call rather than a column on `refreshHistory`, matching the split
   * the native side draws and for the same reasons — a different statistic
   * (an average, not a sum), a different window, and a reader that is one
   * screen rather than every foreground.
   *
   * Nothing is persisted, here as everywhere else in this store. A weight is
   * the most personal number the app has ever handled, which makes the
   * no-copy rule in `docs/arch/health-data.md` more load-bearing rather than
   * less: Health already holds it, already syncs it, and already lets somebody
   * delete it in one place and have that mean something.
   */
  async refreshWeight() {
    const bridge = healthBridge();
    if (!bridge) return;
    if (get().loadingWeight) return;

    const anchor = addDays(getCurrentDayStart(), -(WEIGHT_HISTORY_DAYS - 1));

    set({ loadingWeight: true });
    const token = weightGuard.begin();
    try {
      const readings = await bridge.readWeightSeries(anchor.toISOString(), WEIGHT_HISTORY_DAYS);
      if (!weightGuard.isCurrent(token)) return;
      const weightSeries: WeightPoint[] = [];
      for (const reading of readings) {
        const at = new Date(reading.start);
        if (Number.isNaN(at.getTime())) continue;
        weightSeries.push({
          // Keyed here, not natively, for the reason `refreshHistory` gives:
          // one implementation of "which day is this", and it is the one that
          // knows about `dayResetTime`.
          dayKey: getLogicalDayKey(at),
          kilograms: reading.kilograms,
        });
      }
      // Written whole, including when every day came back null. Holding the
      // last good series would keep drawing a chart of somebody's weight after
      // they revoked access to it, which is the one thing this must not do.
      set({ weightSeries });
    } finally {
      set({ loadingWeight: false });
    }
  },

  /**
   * A short body-mass window, for the `weighIn` generator to ask "has anything
   * been recorded lately".
   *
   * **Deliberately answers without storing anything.** `weightSeries` is the
   * Weight screen's 180 days, and this is a handful of days a background pass
   * wants once per foreground: writing the short window into that state would
   * hand the screen a truncated chart, and widening the pass to the long window
   * would put a six-month query on every foreground, which is the exact cost
   * `readWeightSeries` exists as its own native call to avoid.
   *
   * **Null and `[]` are different answers and the caller must treat them so.**
   * Null is "there was no way to ask" (not iOS, no Health, demo mode); `[]` is
   * "asked, and nothing came back". Only the second is evidence of not having
   * weighed in. Collapsing them is how a generator ends up writing a task on an
   * Android build or, worse, during a demo.
   */
  async readRecentWeights(days) {
    const bridge = healthBridge();
    if (!bridge) return null;
    const window = Math.max(1, Math.round(days));
    const anchor = addDays(getCurrentDayStart(), -(window - 1));
    const readings = await bridge.readWeightSeries(anchor.toISOString(), window);
    const points: WeightPoint[] = [];
    for (const reading of readings) {
      const at = new Date(reading.start);
      if (Number.isNaN(at.getTime())) continue;
      points.push({ dayKey: getLogicalDayKey(at), kilograms: reading.kilograms });
    }
    return points;
  },

  /**
   * A short window of active-energy figures, for the one caller that needs to
   * say what a typical day of somebody's looks like — the baseline stepper in
   * `NutritionTargetsSheet`, which is unanswerable without it for anybody who
   * has never looked the number up.
   *
   * **Nothing is stored and nothing is decided here.** It hands back the days
   * and `typicalActiveEnergyKcal` reduces them to one figure, which the sheet
   * *offers* behind a button — the `WeightGoalSheet` shape, where the app may
   * do the arithmetic as long as a person is the one who accepts it.
   *
   * Same null-versus-empty rule `readRecentWeights` states at length: null is
   * "there was no way to ask", an array of nulls is "asked, and this person's
   * devices record none of this". Only the second is worth telling somebody
   * about, and the sheet says so rather than showing a zero.
   */
  async readRecentActiveEnergy(days) {
    const bridge = healthBridge();
    if (!bridge) return null;
    const window = Math.max(1, Math.round(days));
    // Runs back from *yesterday*, not today: today is a day in progress, and
    // averaging a part-day in would drag the "typical day" figure below every
    // full day it is built from — worst in the morning, which is exactly when
    // somebody opening this sheet would be told their usual day is 80 calories.
    const anchor = addDays(getCurrentDayStart(), -window);
    const readings = await bridge.readDailyHealth(anchor.toISOString(), window);
    // `?? null` for the same reason `refresh` above uses it: a day is only
    // ever a number or an absence here, never a missing property.
    return readings.map(r => r.activeEnergyKcal ?? null);
  },

  clear() {
    // All three, because all three are being dropped: a read still in flight
    // when access is revoked must not write its answer back afterwards.
    todayGuard.invalidate();
    historyGuard.invalidate();
    weightGuard.invalidate();
    set({ today: null, history: null, weightSeries: null });
  },
}));

/**
 * Keeps today's reading current. Call once from the root component — the same
 * three triggers `useWeatherSync` and `useScreenTimeSync` settled on, for the
 * same reason: there is no OS-side "your step count changed" notification to
 * subscribe to either.
 *
 * Nothing here asks for authorization. A sweep never raises a permission sheet;
 * a person does, from the row in Settings — the line `weatherLocation.ts` draws
 * for the location prompt, and the reason `refresh` simply finds no number when
 * access was never granted rather than trying to work out why.
 */
export function useHealthSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const settings = useSettingsStore.getState();
    if (settings.initialized && settings.healthReadEnabled) {
      void useHealthStore.getState().refresh();
    }

    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.healthReadEnabled !== prev.healthReadEnabled ||
        // The reading is anchored to the logical day, so moving the reset moves
        // which day "today" is — same reason useWeatherSync watches it.
        state.dayResetTime !== prev.dayResetTime
      ) {
        if (state.healthReadEnabled) void useHealthStore.getState().refresh();
        else useHealthStore.getState().clear();
      }
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && useSettingsStore.getState().healthReadEnabled) {
        void useHealthStore.getState().refresh();
      }
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
