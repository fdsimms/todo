import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';
import { twoPaneFor } from '../utils/twoPane';

function subscribe(onChange: () => void): () => void {
  const subscription = Dimensions.addEventListener('change', onChange);
  return () => subscription.remove();
}

/** Read per call, never at load: the window is resized after launch. */
function snapshot(): boolean {
  return twoPaneFor(Dimensions.get('window').width);
}

/**
 * Whether the window has room for a list and a page side by side.
 *
 * Subscribes to the window and answers with a boolean, so a screen re-renders
 * when a resize crosses the breakpoint and not on each of the hundred widths a
 * window drag passes through on the way. It was `useWindowDimensions()`, which
 * re-rendered Today's 6,000 lines, and its rows, at every one of them.
 */
export function useTwoPane(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
