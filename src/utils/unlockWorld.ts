import type { RewardUnlock } from '../types';
import { useRewardStore } from '../store/useRewardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUnlockStore } from '../store/useUnlockStore';
import { getCurrentDayStart, getLogicalDayKey } from './dateUtils';
import { isUnlockOpen, statusOfUnlock, type UnlockWorld } from './rewardUnlocks';

/**
 * The stores' current state as `statusOfUnlock` reads it, for a reader outside
 * React (the slip prompt). The Rewards screen builds the same thing from its
 * own subscriptions so it re-renders as tasks are done.
 */
export function unlockWorldNow(now: Date = new Date()): UnlockWorld {
  const tasks = useTaskStore.getState();
  const settings = useSettingsStore.getState();
  return {
    entries: useRewardStore.getState().entries,
    tasks: tasks.tasks,
    onToday: [...tasks.visibleTasks(), ...tasks.upcomingTodayTasks()],
    todayStart: getCurrentDayStart(),
    todayKey: getLogicalDayKey(now, settings.dayResetTime),
    vacation: settings.vacationMode,
  };
}

/**
 * The unlock `taskId` is the linked habit of, when that unlock is open now
 * (worked for, a free day, or already playing). A slip logged on the habit
 * then asks first, since doing the thing while it's open isn't one.
 */
export function openUnlockLinkedTo(taskId: string): RewardUnlock | null {
  if (!useSettingsStore.getState().rewardsEnabled) return null;
  const unlock = useUnlockStore.getState().unlockLinkedTo(taskId);
  if (!unlock) return null;
  return isUnlockOpen(statusOfUnlock(unlock, unlockWorldNow()).status) ? unlock : null;
}
