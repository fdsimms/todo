/**
 * When a sheet's `Modal` may actually go away, and what has to happen first.
 *
 * Closing a `Modal` while a `TextInput` inside it still holds native keyboard
 * focus races the keyboard's own dismiss animation against the modal's, and
 * strands the touch handler on whatever renders underneath — the app stops
 * responding to taps entirely, with no crash and no error to point at it. The
 * fix has always been to dismiss the keyboard *before* the modal starts
 * closing, which is an ordering rule, not a "remember to call this" rule:
 * dismissing afterwards is the same race.
 *
 * `SheetModal` keeps that ordering by refusing to hand `visible: false` to the
 * real `Modal` in the same commit it was asked to. This is the state machine
 * behind that, split out here so the ordering is assertable rather than merely
 * intended — the same call `paintSelect.ts` and `scrollClamp.ts` make about
 * the pure half of a component that cannot otherwise be tested.
 *
 * `shown` is what the real `Modal` currently has. A step of `null` means the
 * two already agree and nothing happens, which is every render but the two
 * that matter.
 */
export interface SheetVisibilityStep {
  /** What to hand the real `Modal` next. */
  shown: boolean;
  /**
   * Whether the keyboard has to be dismissed before that. True only on the
   * closing edge: an opening modal has no focused field of its own yet, and
   * dismissing there would take the keyboard off whatever raised the sheet.
   */
  dismissKeyboard: boolean;
}

export function nextSheetVisibility(visible: boolean, shown: boolean): SheetVisibilityStep | null {
  if (visible === shown) return null;
  return visible
    ? { shown: true, dismissKeyboard: false }
    : { shown: false, dismissKeyboard: true };
}
