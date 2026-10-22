import { useCallback, useState } from 'react';
import { runOnJS } from 'react-native-reanimated';

/**
 * A React key for an animated view whose resting value differs between
 * states (a highlight on one pill or another, a fold open or shut, a bar's
 * length), bumped each time its animation comes to rest.
 *
 * Reanimated 4 hands a settled animation's values back to React by polling
 * (FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS): about a second after the last
 * frame it sets them as state on the animated component, and that state goes
 * after every style React passes, on every later commit. The native side
 * forgets a value two seconds after its last frame whether or not JS took it,
 * so a handover missed (the JS thread busy for that second, or the tab frozen
 * and its views unregistered) leaves that state holding the previous rest. The
 * next re-render then commits the view back to where it was before, with
 * nothing in the React style able to outrank it. A view remounted under a new
 * key has no such state: its first render reads the shared values as they
 * now stand.
 *
 * Only for a leaf, or a view whose children are cheap to rebuild: the key
 * remounts everything under it. A view whose resting value is the same in
 * every state (an entrance that always ends at 1) has nothing to go stale and
 * needs none of this.
 *
 * Pass `onRest` as the callback of every `withTiming`/`withSpring` that ends
 * at a new rest, and call `rested()` after assigning a plain value.
 */
export function useRestKey(): {
  restKey: number;
  rested: () => void;
  onRest: (finished?: boolean) => void;
} {
  const [restKey, setRestKey] = useState(0);
  const rested = useCallback(() => setRestKey(n => n + 1), []);
  // `finished` is false when a new animation cut this one short; the new one's
  // own callback takes over.
  const onRest = (finished?: boolean) => {
    'worklet';
    if (finished) runOnJS(rested)();
  };
  return { restKey, rested, onRest };
}
