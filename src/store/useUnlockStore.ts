import { create } from 'zustand';
import type { RewardUnlock, Task } from '../types';
import { dbDeleteRewardUnlock, dbGetAllRewardUnlocks, dbUpsertRewardUnlock } from '../db/database';
import { generateId } from '../utils/id';
import {
  addPlayTime,
  cleanUnlockDraft,
  playState,
  repointRequired,
  startPlay,
  stopPlay,
  type UnlockDraft,
} from '../utils/rewardUnlocks';
import { cancelPlayTimeUp, schedulePlayTimeUp } from '../utils/notifications';
import { getLogicalDayKey } from '../utils/dateUtils';
import { useSettingsStore } from './useSettingsStore';

/**
 * Unlocks: treats opened by the day's work rather than bought with coins.
 * Every rule is in `src/utils/rewardUnlocks.ts`; this keeps the rows and the
 * one notification per unlock that says the day's play time is up, which
 * every play write re-schedules or cancels so it can't outlive the timer.
 *
 * Its own store beside `useRewardStore` because an unlock never touches the
 * ledger: nothing here reads or writes a coin.
 */
interface UnlockStore {
  /** Oldest first, the order they were made in. */
  unlocks: RewardUnlock[];
  initialized: boolean;
  initialize: () => void;
  addUnlock: (draft: UnlockDraft) => RewardUnlock | null;
  updateUnlock: (id: string, patch: Partial<UnlockDraft>) => void;
  deleteUnlock: (id: string) => void;
  /** Start (or carry on) today's play, and schedule the time-up notice. */
  startPlay: (id: string, now?: Date) => void;
  /** Stop the running stretch, keeping what was used. */
  stopPlay: (id: string, now?: Date) => void;
  /** Add `minutes` to today's play time. */
  addPlayTime: (id: string, minutes: number, now?: Date) => void;
  /**
   * Move each required task to its family's newest row, so a requirement
   * outlives the retention window purging the row it was set on. Run from the
   * Rewards screen, the way dollar repricing is.
   */
  repointRequirements: (tasks: readonly Task[]) => void;
  /** The unlock whose linked habit is `taskId`, if one is. */
  unlockLinkedTo: (taskId: string) => RewardUnlock | null;
}

export type { UnlockDraft } from '../utils/rewardUnlocks';

function todayKey(now: Date): string {
  return getLogicalDayKey(now, useSettingsStore.getState().dayResetTime);
}


export const useUnlockStore = create<UnlockStore>((set, get) => {
  const write = (next: RewardUnlock) => {
    dbUpsertRewardUnlock(next);
    set(s => ({ unlocks: s.unlocks.map(u => (u.id === next.id ? next : u)) }));
  };
  // The notice follows the timer: scheduled for when the running stretch runs
  // out, cancelled when nothing is running.
  const syncNotice = (unlock: RewardUnlock, now: Date) => {
    const state = playState(unlock, now, todayKey(now));
    if (state.running && state.endsAt) void schedulePlayTimeUp(unlock.id, unlock.title, state.endsAt);
    else void cancelPlayTimeUp(unlock.id);
  };
  const play = (id: string, now: Date, change: (u: RewardUnlock, key: string) => Partial<RewardUnlock>) => {
    const current = get().unlocks.find(u => u.id === id);
    if (!current) return;
    const next = { ...current, ...change(current, todayKey(now)) };
    write(next);
    syncNotice(next, now);
  };

  return {
    unlocks: [],
    initialized: false,

    initialize() {
      const unlocks = dbGetAllRewardUnlocks();
      set({ unlocks, initialized: true });
      // A timer started on another device, or by the MCP server, arrives here
      // with no notice scheduled on this one; one stopped elsewhere leaves a
      // notice to cancel. Both are settled from the rows as loaded.
      const now = new Date();
      unlocks.forEach(u => syncNotice(u, now));
    },

    addUnlock(draft) {
      const clean = cleanUnlockDraft(draft);
      if (!clean.title) return null;
      const unlock: RewardUnlock = {
        id: generateId(),
        createdAt: new Date().toISOString(),
        ...clean,
        playDay: null,
        playUsedMs: 0,
        playExtraMs: 0,
        playStartedAt: null,
      };
      dbUpsertRewardUnlock(unlock);
      set(s => ({ unlocks: [...s.unlocks, unlock] }));
      return unlock;
    },

    updateUnlock(id, patch) {
      const current = get().unlocks.find(u => u.id === id);
      if (!current) return;
      const clean = cleanUnlockDraft({ ...current, ...patch });
      if (!clean.title) return;
      const next = { ...current, ...clean };
      write(next);
      // A new play time moves when the running stretch ends.
      if (patch.playMinutes !== undefined || patch.title !== undefined) syncNotice(next, new Date());
    },

    deleteUnlock(id) {
      dbDeleteRewardUnlock(id);
      void cancelPlayTimeUp(id);
      set(s => ({ unlocks: s.unlocks.filter(u => u.id !== id) }));
    },

    startPlay(id, now = new Date()) {
      play(id, now, (u, key) => startPlay(u, now, key));
    },

    stopPlay(id, now = new Date()) {
      play(id, now, (u, key) => stopPlay(u, now, key));
    },

    addPlayTime(id, minutes, now = new Date()) {
      if (!(minutes > 0)) return;
      play(id, now, (u, key) => addPlayTime(u, minutes, now, key));
    },

    repointRequirements(tasks) {
      for (const unlock of get().unlocks) {
        const next = repointRequired(unlock.requiredTaskIds, tasks);
        if (next) write({ ...unlock, requiredTaskIds: next });
      }
    },

    unlockLinkedTo(taskId) {
      return get().unlocks.find(u => u.guardsTaskId === taskId) ?? null;
    },
  };
});
