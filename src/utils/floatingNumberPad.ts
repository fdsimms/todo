/**
 * The number pad's bar as a floating view instead of a native `InputAccessoryView`.
 *
 * An `InputAccessoryView` claims its whole rectangle for touches, including the
 * transparent stretches between the glass capsules, so a row sitting under that
 * gap can't be tapped (the "blueberry" under the empty part of the bar in the
 * food log's search results). A plain view with `pointerEvents="box-none"` only
 * takes touches where a capsule is drawn.
 *
 * It is only worth it where the bar has no fill of its own: with glass the
 * capsules float over the keyboard and the gaps look empty, while the solid bar
 * is a strip people expect to be a surface. It is for phones only: an iPad or a
 * Mac window can have a docked, floating or hidden keyboard, where a bar placed
 * from the keyboard's height has nowhere reliable to sit, and there the native
 * view stays.
 *
 * Three small pieces of state make it work, because the bar is drawn by the
 * window-level host (`KeyboardDoneAccessory`, mounted in the app root and in
 * every `SheetModal`) rather than by the screen that asked for it:
 *
 * - which number-pad fields are focused (`TextField` reports it, since it no
 *   longer hands the native keyboard an accessory id to attach on its own);
 * - what the newest `NumberPadAccessory` wants on its bar (`onNext`,
 *   `onOperator`), published here because the host can't see the screen's props;
 * - the shared `accessoryStack`, which already says which copy is topmost.
 */
import { isTopAccessory, subscribeAccessories, topAccessory } from './accessoryStack';
import type { AmountOperator } from './amountMath';

/** The `nativeID` every number-pad field names as its `inputAccessoryViewID`. */
export const NUMBER_PAD_ACCESSORY_ID = 'numberPadAccessory';

/** Whether the number pad's bar floats on this device (see above). */
export function numberPadBarFloats(glass: boolean, os: string, isPad: boolean): boolean {
  return glass && os === 'ios' && !isPad;
}

/** What a `NumberPadAccessory` asks of its bar. */
export interface NumberPadBarProps {
  onNext?: () => void;
  onOperator?: (op: AmountOperator) => void;
}

const focused = new Set<string>();
const bars = new Map<string, NumberPadBarProps>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(fn => fn());
}

/** A number-pad field that floats its bar gained or lost focus. */
export function setNumberPadFocus(fieldId: string, isFocused: boolean): void {
  const had = focused.has(fieldId);
  if (isFocused === had) return;
  if (isFocused) focused.add(fieldId);
  else focused.delete(fieldId);
  notify();
}

/** Whether a number-pad field is focused right now. */
export function numberPadFocused(): boolean {
  return focused.size > 0;
}

/**
 * Record what `instanceId`'s bar should carry. Called after every render of the
 * accessory, so the entry is replaced (a new object) and subscribers re-read.
 */
export function publishNumberPadBar(instanceId: string, props: NumberPadBarProps): void {
  bars.set(instanceId, { ...props });
  notify();
}

/** Drop `instanceId`'s entry when its accessory unmounts. */
export function withdrawNumberPadBar(instanceId: string): void {
  if (bars.delete(instanceId)) notify();
}

/** What the topmost number-pad accessory wants on its bar, or null when none is mounted. */
export function topNumberPadBar(): NumberPadBarProps | null {
  const top = topAccessory(NUMBER_PAD_ACCESSORY_ID);
  return top === null ? null : bars.get(top) ?? null;
}

/** Whether `instanceId` is the accessory that should draw the number-pad bar. */
export function isTopNumberPadBar(instanceId: string): boolean {
  return isTopAccessory(NUMBER_PAD_ACCESSORY_ID, instanceId);
}

/** Subscribe to focus, publication and stacking changes. Returns the unsubscribe. */
export function subscribeNumberPadBar(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeStack = subscribeAccessories(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeStack();
  };
}

/** Test-only. */
export function resetFloatingNumberPad(): void {
  focused.clear();
  bars.clear();
  notify();
}
