import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The OS "Reduce Motion" setting, kept current at module level so code that
 * isn't a component (animateLayout, a store-triggered animation) can read it
 * synchronously. Starts false and settles once the first read returns, which
 * happens at launch: the hook below starts the subscription on first mount.
 */
let current = false;
let subscribed = false;
const listeners = new Set<(on: boolean) => void>();

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  // Guarded rather than assumed: this module is imported from logic that runs
  // under Jest, where AccessibilityInfo is a partial mock or absent.
  AccessibilityInfo?.isReduceMotionEnabled?.()
    .then(enabled => publish(enabled))
    .catch(() => {});
  AccessibilityInfo?.addEventListener?.('reduceMotionChanged', publish);
}

function publish(enabled: boolean): void {
  if (enabled === current) return;
  current = enabled;
  listeners.forEach(l => l(enabled));
}

/** Whether Reduce Motion is on, for callers outside React. */
export function reduceMotionEnabled(): boolean {
  ensureSubscribed();
  return current;
}

/**
 * Tracks the OS "Reduce Motion" accessibility setting. Components that run
 * decorative entrance/spring animations should read this and skip straight to
 * the settled state when it's on — motion-sensitive users get functionality
 * without the movement, everyone else keeps the animations.
 *
 * Seeded from the module-level value, so a component mounting after launch
 * knows the answer on its first frame rather than animating once before the
 * read comes back. Stays subscribed, so toggling the setting takes effect
 * without an app restart.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(reduceMotionEnabled);

  useEffect(() => {
    listeners.add(setReduceMotion);
    // A change between the first render and this effect would otherwise be missed.
    setReduceMotion(current);
    return () => { listeners.delete(setReduceMotion); };
  }, []);

  return reduceMotion;
}
