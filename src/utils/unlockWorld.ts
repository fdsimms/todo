import type { RewardUnlock } from '../types';
import { useRewardStore } from '../store/useRewardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUnlockStore } from '../store/useUnlockStore';
import { getCurrentDayStart, getLogicalDayKey } from './dateUtils';
import { isUnlockOpen, statusOfUnlock, type UnlockWorld } from './rewardUnlocks';
import { displayTitleFor } from './visibilityUtils';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';
import { isUnlockReleased } from './shieldRelease';
import { lockedUnlockBlocks } from './unlockShield';
import type { UnlockBlock } from './unlockBlockText';

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

/** The unlocks holding apps shut right now, read from the stores (see `lockedUnlockBlocks`). */
export function lockedUnlockBlocksNow(now: Date = new Date()): UnlockBlock[] {
  const { unlocks } = useUnlockStore.getState();
  // Most installs have none, and the world read below walks every task.
  if (!unlocks.some(u => u.blockGroupId)) return [];
  return blocksIn(unlocks, unlockWorldNow(now));
}

function blocksIn(unlocks: readonly RewardUnlock[], world: UnlockWorld): UnlockBlock[] {
  const { releases } = useShieldReleaseStore.getState();
  return lockedUnlockBlocks(unlocks, world, useSettingsStore.getState().rewardsEnabled, id => isUnlockReleased(id, world.todayKey, releases));
}

/** A locked, app-blocking unlock and how far today's work has got toward opening it. */
export interface LockedUnlockProgress {
  unlock: RewardUnlock;
  share: number;
  coinsShort: number;
  pendingTitles: string[];
}

/**
 * The unlocks `lockedUnlockBlocksNow` lists, with their progress, for the
 * Screen Time page. The unlocks come from the shield's own rule, so the card
 * can't show one the status card isn't blocking for, and the progress from
 * `statusOfUnlock`, so it can't disagree with the Rewards screen.
 */
export function lockedUnlockProgressNow(now: Date = new Date()): LockedUnlockProgress[] {
  const { unlocks } = useUnlockStore.getState();
  if (!unlocks.some(u => u.blockGroupId)) return [];
  const world = unlockWorldNow(now);
  const out: LockedUnlockProgress[] = [];
  for (const block of blocksIn(unlocks, world)) {
    const unlock = unlocks.find(u => u.id === block.id);
    if (!unlock) continue;
    const { status } = statusOfUnlock(unlock, world);
    if (status.kind !== 'locked') continue;
    out.push({ unlock, share: status.share, coinsShort: status.coinsShort, pendingTitles: status.pending.map(displayTitleFor) });
  }
  return out;
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
