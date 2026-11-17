import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { currentShieldReasons, liveSpeedBumpNow } from '../utils/appShieldReconcile';
import type { LiveSpeedBump } from '../utils/speedBump';
import { outstandingGates } from '../utils/appGate';
import type { ShieldReasonEntry } from '../utils/appShield';
import { isTaskVisible } from '../utils/visibilityUtils';
import { nextScheduleBoundary, withVacationPause } from '../utils/blockSchedule';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useFocusStore } from '../store/useFocusStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useManualBlockStore } from '../store/useManualBlockStore';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';
import { isFocusReleased, isGateReleased } from '../utils/shieldRelease';
import { useTaskStore } from '../store/useTaskStore';
import { useRewardStore } from '../store/useRewardStore';
import { useUnlockStore } from '../store/useUnlockStore';
import { lockedUnlockBlocksNow } from '../utils/unlockWorld';

/** Just under 24.8 days, the largest delay setTimeout stores without overflowing. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Why the apps are blocked right now, for the Screen Time page.
 *
 * The answer is `currentShieldReasons`, built by the same `buildShieldState`
 * the system shield reads, so the page cannot say something the shield is not
 * doing. Never build the state here: a copy of it is how the page once said
 * "Nothing is blocking your apps" during a speed bump. The subscriptions below
 * only decide when to ask again. It reads only: nothing here writes the
 * shield, which stays `syncAppShield`'s alone.
 *
 * A penalty ends at an instant nothing writes anything at, so a timer
 * re-renders at it, the way `useAppShieldSync` waits at it to lift the block.
 * Without that, an expired penalty would stay listed until something else
 * happened to change.
 */
export function useShieldReasons(): ShieldReasonEntry[] {
  const focusSession = useFocusStore(s => s.session);
  const releases = useShieldReleaseStore(s => s.releases);
  const manualBlock = useManualBlockStore(s => s.block);
  const session = isFocusReleased(focusSession?.id, releases) ? null : focusSession;
  const focusEnabled = useSettingsStore(s => s.focusShieldEnabled);
  const penaltyEnabled = useSettingsStore(s => s.penaltyShieldEnabled);
  const penaltyUntil = useSettingsStore(s => s.penaltyShieldUntil);
  const penaltyReason = useSettingsStore(s => s.penaltyShieldReason);
  const gateEnabled = useSettingsStore(s => s.gateShieldEnabled);
  const keys = useNfcKeyStore(s => s.keys);
  const locked = useNfcKeyStore(s => s.locked);
  // Held as one string so a task write that changes no gate costs no render.
  const gateKey = useTaskStore(s => (
    gateEnabled
      ? JSON.stringify(outstandingGates(s.tasks, isTaskVisible).filter(t => !isGateReleased(t.id, releases)).map(t => ({ title: t.title, own: t.gateGroupId ?? null })))
      : '[]'
  ));
  // The same inputs `lockedUnlockBlocksNow` reads, so the page re-renders when
  // an unlock opens or re-locks. Held as a string so a write that changes no
  // lock costs no render; the stores below are read only to wake the selector.
  useUnlockStore(s => s.unlocks);
  useRewardStore(s => s.entries);
  useSettingsStore(s => s.rewardsEnabled && s.vacationMode);
  const unlockKey = useTaskStore(() => JSON.stringify(lockedUnlockBlocksNow()));
  const groups = useAppGroupStore(s => s.groups);
  const assignments = useAppGroupStore(s => s.assignments);
  const storedSchedules = useAppGroupStore(s => s.schedules);
  const vacationOn = useSettingsStore(s => s.vacationMode);
  const vacationStart = useSettingsStore(s => s.vacationStart);
  const vacationEnd = useSettingsStore(s => s.vacationEnd);
  const [now, setNow] = useState(() => new Date());
  // The same pause `buildShieldState` applies, so the page agrees with the shield.
  const schedules = useMemo(
    () => withVacationPause(storedSchedules, { on: vacationOn, start: vacationStart, end: vacationEnd }, now),
    [storedSchedules, vacationOn, vacationStart, vacationEnd, now],
  );
  // Bumped by the timer below so the effect re-arms for the following boundary.
  const [tick, setTick] = useState(0);
  // A speed bump is raised by the monitor extension, often with the app closed,
  // so it lives in the App Group rather than a store. Read again whenever the
  // effect below runs, and when the app returns to the foreground.
  const [speedBump, setSpeedBump] = useState<LiveSpeedBump | null>(() => liveSpeedBumpNow(new Date()));
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') setTick(t => t + 1);
    });
    return () => sub.remove();
  }, []);

  // Waits at whichever comes first: the penalty's end, a speed bump's end, or a
  // schedule opening or closing. None of them writes anything at that instant.
  useEffect(() => {
    const current = new Date();
    setNow(current);
    const bump = liveSpeedBumpNow(current);
    setSpeedBump(prev => (JSON.stringify(prev) === JSON.stringify(bump) ? prev : bump));
    const bumpAt = bump ? new Date(bump.untilIso) : null;
    const penaltyAt = penaltyUntil ? new Date(penaltyUntil) : null;
    const manualAt = manualBlock?.untilIso ? new Date(manualBlock.untilIso) : null;
    const boundary = nextScheduleBoundary(schedules, current);
    const next = [penaltyAt, manualAt, bumpAt, boundary].filter((d): d is Date => d !== null && d > current)
      .reduce<Date | null>((a, d) => (a === null || d < a ? d : a), null);
    if (!next) return;
    const remaining = next.getTime() - Date.now();
    if (remaining <= 0 || remaining > MAX_TIMER_MS) return;
    const timer = setTimeout(() => setTick(t => t + 1), remaining + 50);
    return () => clearTimeout(timer);
  }, [penaltyUntil, manualBlock, schedules, tick]);

  // Every input buildShieldState reads, so the list is asked for again when one
  // changes. None is read here: the answer comes from the stores themselves.
  return useMemo(
    () => currentShieldReasons(now),
    [session, focusEnabled, penaltyUntil, penaltyEnabled, penaltyReason, gateEnabled, locked, keys, gateKey, unlockKey, manualBlock, speedBump, now, groups, assignments, schedules],
  );
}
