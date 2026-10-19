import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { ScreenTimeAuthorization, ScreenTimeSelectionCount } from 'todo-screentime-bridge';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { plainGroups } from '../utils/appGroups';
import { screenTimeBridge } from '../utils/screenTimeBridge';

/**
 * Screen Time's authorization and how many apps each plain group holds, read
 * while a rules sheet is open and again on every foreground. Authorization can
 * be revoked, and apps picked, in the system Settings app or on the Screen
 * Time screen while the sheet sits open, so a read taken at open goes stale.
 *
 * `setCounts` is for a sheet that has just run the app picker and knows the
 * new figure before the native read-back does. Shared by `ScreenTimeRulesSheet`
 * and `BlockOfferRulesSheet`, which had each written this out.
 */
export function useGroupSelectionCounts(visible: boolean) {
  const customGroups = useAppGroupStore(s => s.groups);
  const groupsMeta = useAppGroupStore(s => s.meta);
  const [authorization, setAuthorization] = useState<ScreenTimeAuthorization | null>(null);
  const [counts, setCounts] = useState<Record<string, ScreenTimeSelectionCount>>({});

  const refresh = useCallback(() => {
    const bridge = screenTimeBridge();
    if (!bridge) {
      setAuthorization('unavailable');
      return;
    }
    setAuthorization(bridge.screenTimeAuthorizationStatus());
    const next: Record<string, ScreenTimeSelectionCount> = {};
    for (const group of plainGroups(customGroups, groupsMeta)) {
      next[group.id] = bridge.screenTimeSelectionCount(group.id);
    }
    setCounts(next);
  }, [customGroups, groupsMeta]);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [visible, refresh]);

  return { authorization, counts, setCounts, refresh };
}
