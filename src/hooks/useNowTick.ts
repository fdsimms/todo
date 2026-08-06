import { useEffect, useState } from 'react';
import { subscribeToNowTick } from '../utils/nowTick';

/**
 * Subscribes this component to the shared clock heartbeat (see `nowTick.ts`)
 * and returns the current timestamp.
 *
 * The value is rarely worth reading — what matters is the re-render. That
 * re-render comes from this component's own state, so it happens even when the
 * component is wrapped in `React.memo` and none of its props changed, which is
 * exactly the point: a memoized row has no other reason to re-render as the
 * clock moves past a deadline or a time window.
 */
export function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeToNowTick(setNow), []);
  return now;
}
