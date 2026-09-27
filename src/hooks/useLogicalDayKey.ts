import { useEffect, useState } from 'react';
import { subscribeToNowTick } from '../utils/nowTick';
import { getLogicalDayKey } from '../utils/dateUtils';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * The current logical day's key, re-rendering the caller only when it changes.
 *
 * For a screen whose words depend on which day it is ("Due tomorrow", "3d
 * overdue") and nothing finer. useNowTick re-renders on every heartbeat, which
 * a whole list screen doesn't need; this listens to the same heartbeat and
 * only sets state when the day rolls over, dayResetTime included, so the
 * captions stop saying "tomorrow" about today without anything else having to
 * change first.
 */
export function useLogicalDayKey(): string {
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const [key, setKey] = useState(() => getLogicalDayKey(new Date(), dayResetTime));
  useEffect(() => {
    // The functional form bails out of the re-render when the key is the same.
    const check = (now: number) => setKey(getLogicalDayKey(new Date(now), dayResetTime));
    check(Date.now());
    return subscribeToNowTick(check);
  }, [dayResetTime]);
  return key;
}
