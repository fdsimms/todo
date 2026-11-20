import { useEffect, useState } from 'react';
import { subscribeToNowTick } from '../utils/nowTick';
import { getLogicalDayKey } from '../utils/dateUtils';

/**
 * A task row's share of the heartbeat (`nowTick.ts`): rendered again on every
 * tick when `followsClock` (see `rowFollowsClock`), and otherwise only when
 * the logical day changes.
 *
 * `useNowTick` for a row that may have nothing timed on it. Both listen to
 * the same tick; this one keeps its state at the day's key when the row isn't
 * following the clock, so a tick inside the same day sets the value it
 * already holds and renders nothing.
 */
export function useRowClock(followsClock: boolean, dayResetTime: string): void {
  const [, setStamp] = useState<number | string>(0);
  useEffect(
    () => subscribeToNowTick(now => setStamp(followsClock ? now : getLogicalDayKey(new Date(now), dayResetTime))),
    [followsClock, dayResetTime],
  );
}
