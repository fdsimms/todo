import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import type { ScreenTimeCrossing } from 'todo-screentime-bridge';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import { armableRules } from '../utils/screenTimeRules';
import { armableSpeedBumps } from '../utils/speedBump';
import { getCurrentDayStart, dayKeyOf } from '../utils/dateUtils';
import { useSettingsStore } from './useSettingsStore';
import { expandGroupNow, resolveGroupNow, useAppGroupStore } from './useAppGroupStore';
import { DEFAULT_GROUP_ID, groupName } from '../utils/appGroups';
import { createRefreshGuard } from '../utils/refreshGuard';
import {
  isUsageRuleId,
  raisedUsageDays,
  usageArmSignature,
  usageRungs,
  USAGE_GROUP_ID,
  type ScreenTimeDay,
} from '../utils/screenTimeUsage';
import { dbClearScreenTimeDays, dbGetScreenTimeDays, dbRaiseScreenTimeDay } from '../db/database';

/**
 * What iOS has reported about app usage, held in memory — the screen-time
 * generator's equivalent of `useWeatherStore`'s snapshot, and for the identical
 * reason: it is the OS's answer about something outside this app, not the
 * app's own data, so there is no table and no migration.
 * `checkScreenTimeTasks` (`useTaskStore.ts`) only ever reads whatever is here;
 * this store owns getting it there and owns arming the monitor that produces it.
 *
 * **Crossings are drained destructively from the native side**, so one held
 * here and never turned into a task is lost if the app is killed first. That
 * is the same exposure `useWeatherStore` has with a snapshot it hasn't acted
 * on yet, and the same shrug applies: a rule that fires daily loses one day,
 * and the alternative is an acknowledgement protocol across a process boundary
 * for a reminder to go for a walk.
 */

interface ScreenTimeState {
  /** Thresholds reported crossed and not yet turned into tasks. */
  crossings: ScreenTimeCrossing[];
  refreshing: boolean;
  /**
   * Daily phone use as this phone's monitor saw it, oldest first
   * (`screen_time_days`; `screenTimeUsage.ts` says what a reading means).
   */
  usageDays: ScreenTimeDay[];
  /**
   * Whether the last attempt to arm the usage ladder took: null before one,
   * false when iOS refused it (it can throw when too many events are monitored).
   */
  usageArmed: boolean | null;
  /** Read the stored readings into `usageDays`. */
  loadUsage: () => void;
  /**
   * Forget every reading. Called only from the switch the person turns off, never
   * from a settings change: entering or leaving demo mode swaps the settings
   * under this store, and a clear fired by that would run against whichever
   * database is open at that moment.
   */
  clearUsage: () => void;
  /** Drain whatever the monitor extension has recorded. */
  refresh: () => Promise<void>;
  /**
   * Arm (or disarm) the OS monitor against the current rules. `force` re-arms
   * a usage ladder that is already armed, for when the chosen apps changed.
   */
  armMonitor: (force?: boolean) => Promise<void>;
  /** Drop crossings that have been acted on. */
  consume: (ruleIds: readonly string[]) => void;
  clear: () => void;
}

// See refreshGuard.ts. One read here, and a stale drain is discarded rather
// than appended.
const crossingsGuard = createRefreshGuard();

// What the monitor was last armed with, so a foreground that changes nothing
// doesn't re-arm a usage ladder. Whether re-arming resets what iOS has counted
// is not documented, and a ladder is only a floor if it doesn't, so it is left
// alone unless the day, the rungs or the chosen apps changed. Not set on a
// failed arm, which has to be tried again.
let armedSignature: string | null = null;

export const useScreenTimeStore = create<ScreenTimeState>((set, get) => ({
  crossings: [],
  refreshing: false,
  usageDays: [],
  usageArmed: null,

  loadUsage() {
    set({ usageDays: dbGetScreenTimeDays() });
  },

  clearUsage() {
    dbClearScreenTimeDays();
    armedSignature = null;
    set({ usageDays: [], usageArmed: null });
  },

  async refresh() {
    const bridge = screenTimeBridge();
    if (!bridge) return;
    if (get().refreshing) return;
    set({ refreshing: true });
    const token = crossingsGuard.begin();
    try {
      const drained = await bridge.drainCrossings();
      if (drained.length === 0) return;
      // A drain that lands after the feature was switched off is dropped
      // rather than appended: `clear` ran because the user turned Screen Time
      // tasks off, and crossings from a rule that is no longer armed would sit
      // in state waiting to raise a task nobody asked for.
      if (!crossingsGuard.isCurrent(token)) return;
      // The usage ladder's rungs are split off first: they are readings, not
      // rules, and `checkScreenTimeTasks` would otherwise spend them as
      // crossings of a rule that doesn't exist.
      const rungs = drained.filter(c => isUsageRuleId(c.ruleId));
      const ruleCrossings = drained.filter(c => !isUsageRuleId(c.ruleId));
      if (rungs.length > 0) {
        const settings = useSettingsStore.getState();
        // Dropped when the recording has been turned off since the monitor
        // produced them, rather than writing a reading nobody asked for.
        if (settings.screenTimeUsage) {
          const current = new Map(get().usageDays.map(d => [d.dayKey, d.minutes]));
          const changed = raisedUsageDays(current, rungs, settings.dayResetTime);
          for (const day of changed) dbRaiseScreenTimeDay(day.dayKey, day.minutes);
          if (changed.length > 0) get().loadUsage();
        }
      }
      // Appended rather than replacing: a drain that happens between one sweep
      // and the next must not discard what the previous drain is still holding.
      if (ruleCrossings.length > 0) set({ crossings: [...get().crossings, ...ruleCrossings] });
    } finally {
      set({ refreshing: false });
    }
  },

  async armMonitor(force = false) {
    const bridge = screenTimeBridge();
    if (!bridge) return;
    const settings = useSettingsStore.getState();
    // Speed bumps are their own monitor and answer to their own rules, so they
    // are armed (or disarmed) before the task rules' early return below, and
    // whether Screen Time tasks are on has no say in them.
    const dayStart = getCurrentDayStart();
    const dayKey = dayKeyOf(dayStart);
    const bumps = armableSpeedBumps(
      settings.speedBumpRules,
      id => resolveGroupNow(id ?? DEFAULT_GROUP_ID),
      id => expandGroupNow(id ?? DEFAULT_GROUP_ID),
      {
        leadMinutes: settings.speedBumpWarnMinutes,
        blockedName: rule => {
          const groups = useAppGroupStore.getState();
          return groupName(groups.groups, rule.blockGroupId ?? rule.groupId, groups.meta);
        },
      },
      // Which rules run today: the logical day's weekday, so a rule for
      // weekends re-arms with the day key at the day rollover.
      dayStart.getDay(),
    );
    if (bumps.length === 0) bridge.stopSpeedBumps();
    else await bridge.armSpeedBumps(bumps, dayKey, settings.speedBumpResetHours);
    const taskRules = settings.screenTimeTasks
      ? armableRules(settings.screenTimeRules, id => resolveGroupNow(id ?? DEFAULT_GROUP_ID))
      : [];
    // The usage ladder shares the monitor: one activity holds the task rules and
    // the rungs, and arming replaces it whole, so both are armed together.
    // Nothing chosen under the usage group arms nothing natively, so it must not
    // count as armed either: a day marked watched with no apps behind it would
    // read as a day of no use.
    const chosen = bridge.screenTimeSelectionCount(USAGE_GROUP_ID);
    const rungs = settings.screenTimeUsage && chosen.applications + chosen.categories + (chosen.websites ?? 0) > 0
      ? usageRungs()
      : [];
    const rules = [...taskRules, ...rungs];
    if (rules.length === 0) {
      bridge.stopMonitoring();
      armedSignature = null;
      return;
    }
    // A ladder already armed for this day with these rungs is left running
    // (see `armedSignature`). Task rules alone keep their re-arm on every
    // foreground, which is cheap and keeps their day key current.
    const signature = `${usageArmSignature(dayKey, rungs)}|${taskRules.map(r => r.id).join(',')}`;
    if (rungs.length > 0 && !force && signature === armedSignature) return;
    // The day key is stamped here rather than in the extension, which has no
    // way to read the user's dayResetTime — a crossing filed under the wrong
    // day is a task on the wrong day.
    const armed = await bridge.startMonitoring(rules, dayKey);
    if (rungs.length === 0) return;
    armedSignature = armed ? signature : null;
    set({ usageArmed: armed });
    if (armed) {
      // The day is marked watched at 0 before any rung fires, so a quiet day
      // reads as a quiet day and not as a day nobody was watching.
      dbRaiseScreenTimeDay(dayKey, 0);
      get().loadUsage();
    }
  },

  consume(ruleIds) {
    const spent = new Set(ruleIds);
    set({ crossings: get().crossings.filter(c => !spent.has(c.ruleId)) });
  },

  clear() {
    crossingsGuard.invalidate();
    set({ crossings: [] });
  },
}));

/**
 * Keeps the monitor armed and the crossings current, on the same three
 * triggers `useWeatherSync` uses.
 *
 * Re-arming on every foreground is deliberate and cheap: `startMonitoring`
 * replaces the schedule rather than stacking one, and the day key it carries
 * goes stale every midnight, so a phone left open across a day boundary would
 * otherwise file tomorrow's crossings under yesterday.
 */
export function useScreenTimeSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => {
      const settings = useSettingsStore.getState();
      if (!settings.initialized) return;
      useScreenTimeStore.getState().loadUsage();
      void useScreenTimeStore.getState().armMonitor();
      if (settings.screenTimeTasks || settings.screenTimeUsage) void useScreenTimeStore.getState().refresh();
    };

    sync();

    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.screenTimeTasks !== prev.screenTimeTasks ||
        state.screenTimeUsage !== prev.screenTimeUsage ||
        state.screenTimeRules !== prev.screenTimeRules ||
        state.speedBumpRules !== prev.speedBumpRules ||
        state.speedBumpWarnMinutes !== prev.speedBumpWarnMinutes ||
        // Moving the reset moves which day "today" is, and the day key is
        // baked into the armed monitor — same reason useWeatherSync watches it.
        state.dayResetTime !== prev.dayResetTime
      ) {
        if (!state.screenTimeTasks) useScreenTimeStore.getState().clear();
        sync();
      }
    });

    // A group removed or made the default changes which apps a rule resolves to.
    const unsubscribeGroups = useAppGroupStore.subscribe((state, prev) => {
      if (state.groups !== prev.groups || state.meta !== prev.meta) sync();
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });

    return () => {
      unsubscribe();
      unsubscribeGroups();
      subscription.remove();
    };
  }, []);
}
