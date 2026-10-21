// The one offer the keyboard bar is showing. A set cell publishes it while it
// has focus and takes it back on blur; `ApplyToAllAccessory` reads it. It lives
// outside any component because several tables can be mounted at once (one per
// exercise in the routine editor) while the keyboard has one bar, and the bar
// has to reflect whichever cell is focused, not whichever table mounted last
// (the accessory stack picks the mounted copy by window, see accessoryStack.ts).

export interface ApplyOffer {
  /** Identifies the focused cell, so a late blur from the cell just left can't clear the next one's offer. */
  key: string;
  label: string;
  apply: () => void;
}

let current: ApplyOffer | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(fn => fn());

export function setApplyOffer(offer: ApplyOffer | null): void {
  current = offer;
  notify();
}

/** Withdraws the offer, but only if it is still `key`'s. */
export function clearApplyOffer(key: string): void {
  if (current?.key !== key) return;
  current = null;
  notify();
}

export function getApplyOffer(): ApplyOffer | null {
  return current;
}

export function subscribeApplyOffer(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test hook: back to nothing on offer. */
export function resetApplyOffer(): void {
  current = null;
  listeners.clear();
}
