import { useMemo } from 'react';
import { useRewardStore } from '../store/useRewardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUnlockStore } from '../store/useUnlockStore';
import { lockedUnlockProgressNow, type LockedUnlockProgress } from '../utils/unlockWorld';

/**
 * The locked unlocks that are holding apps shut, with their progress, for the
 * Screen Time page (see `lockedUnlockProgressNow`).
 *
 * The same inputs `useShieldReasons` wakes on, held as one string so a task or
 * coin write that moves no progress costs no render; the stores read below only
 * wake the selector. It reads only.
 */
export function useLockedUnlockProgress(): LockedUnlockProgress[] {
  const unlocks = useUnlockStore(s => s.unlocks);
  useRewardStore(s => s.entries);
  useSettingsStore(s => s.rewardsEnabled && s.vacationMode);
  const key = useTaskStore(() => JSON.stringify(
    lockedUnlockProgressNow().map(p => [p.unlock.id, p.share, p.coinsShort, p.pendingTitles]),
  ));
  // `unlocks` is a dependency because an edit to a card's name or share changes
  // what is drawn without changing the key.
  return useMemo(() => lockedUnlockProgressNow(), [key, unlocks]);
}
