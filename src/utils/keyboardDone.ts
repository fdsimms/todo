/**
 * The "Done" that every text keyboard carries, and the rule for which fields
 * get which of its two forms.
 *
 * A single-line field names `DONE_ACCESSORY_ID` as its `inputAccessoryViewID`
 * and iOS draws the bar above the keyboard itself (`KeyboardDoneAccessory`).
 * A multiline field can't: an `InputAccessoryView` is never attached to one, with
 * no warning, so it reports its focus here and a floating Done follows the
 * keyboard instead. `TextField` does both, which is why a bare `TextInput` is
 * banned (`noBareTextInput.test.ts`): the field is where the bar is decided.
 *
 * A field with a bar of its own (number pad, title tokens, set tables) names
 * that bar and neither form applies. One whose own bar is floating opts out with
 * `dismissBar={false}`.
 */

/** The `nativeID` of the shared Done bar. */
export const DONE_ACCESSORY_ID = 'keyboardDoneAccessory';

/** What `TextField` does about a field's Done bar. */
export type DoneBarKind = 'accessory' | 'floating' | 'none';

/**
 * `ownAccessoryId` is the field's own `inputAccessoryViewID`; `dismissBar` is the
 * opt-out. A multiline field never attaches an accessory, so one that names an id
 * (a number-pad leftover, say) still has nothing above its keyboard and gets the
 * floating bar unless it opts out.
 */
export function doneBarKind(opts: {
  multiline?: boolean;
  ownAccessoryId?: string;
  dismissBar?: boolean;
}): DoneBarKind {
  if (opts.dismissBar === false) return 'none';
  if (opts.multiline) return 'floating';
  return opts.ownAccessoryId ? 'none' : 'accessory';
}

const focused = new Set<string>();
const listeners = new Set<() => void>();

/** A multiline field with no bar of its own gained or lost focus. */
export function setFloatingDoneFocus(fieldId: string, isFocused: boolean): void {
  const had = focused.has(fieldId);
  if (isFocused === had) return;
  if (isFocused) focused.add(fieldId);
  else focused.delete(fieldId);
  listeners.forEach(fn => fn());
}

/** Whether a field that needs the floating Done is focused right now. */
export function floatingDoneWanted(): boolean {
  return focused.size > 0;
}

export function subscribeFloatingDone(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only. */
export function resetFloatingDone(): void {
  focused.clear();
  listeners.forEach(fn => fn());
}
