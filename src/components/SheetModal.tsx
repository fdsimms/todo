import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal } from 'react-native';
import { nextSheetVisibility } from '../utils/sheetModal';

type Props = React.ComponentProps<typeof Modal>;

/**
 * `Modal`, with the keyboard guaranteed to be gone before it closes.
 *
 * **Use this instead of `react-native`'s `Modal` everywhere.** A test
 * (`noRawModal.test.ts`) fails the build on a raw one, and this component is
 * the only file exempt from it.
 *
 * ## What it is for
 *
 * Closing a `Modal` while a `TextInput` inside it still holds native keyboard
 * focus races the keyboard's dismiss animation against the modal's: the touch
 * handler on whatever renders underneath gets stranded mid-handoff and the app
 * stops responding to any tap at all, with no crash and no error to point at
 * it. Users report it as "the app froze", usually naming a screen that is
 * merely the one left on top.
 *
 * The fix has never been in doubt — dismiss the keyboard, *then* close — and
 * that is exactly why this component exists rather than another note in
 * CLAUDE.md. It shipped as a bug, got swept across 27 sheets, shipped again in
 * `CookModeSheet` (missed by that very sweep, despite matching the pattern
 * exactly), got swept again across 9 more, and then shipped a fifth time in
 * `EstimateMealSheet`'s recipe-match row — every time in a sheet whose *other*
 * close paths were already correct. A rule that has to be re-applied by hand
 * at every callback that can lead to a close is a rule with one call site per
 * chance to forget, and there are hundreds: `onRequestClose`, a scrim tap, a
 * header button, a Save action, an `Alert` confirm, and every parent-supplied
 * `onPick`/`onConfirm`/`onCreated` whose handler closes the sheet from outside.
 *
 * ## How it holds the ordering
 *
 * It does not pass `visible` straight through. On the closing edge it dismisses
 * the keyboard and keeps the real `Modal` open for one more commit, handing it
 * `false` on the next one — so the resign-first-responder command is always
 * queued ahead of the dismissal, whichever call site set the prop and whether
 * or not that call site dismissed anything itself.
 *
 * Dismissing from an effect *without* that hold would not work and is the
 * obvious thing to try: by the time an effect (layout or otherwise) runs, the
 * commit carrying `visible: false` has already reached the native modal, and
 * the race is on. The one-commit hold is the whole mechanism; `sheetModal.ts`
 * holds the rule and its tests.
 *
 * The hold is safe against a caller whose children read state that went away
 * with `visible` — iOS already renders a closing modal's children right
 * through its dismiss animation (`Modal._shouldShowModal` ORs `props.visible`
 * with its own `isRendered`), so every call site is already written for that.
 *
 * **Opening is never held, and that asymmetry is load-bearing.** It is applied
 * during render rather than from an effect, so a modal becomes visible in the
 * very commit it was asked to. `AppLockGate` is why: it drives both the lock
 * screen and the shield that covers the app while it isn't frontmost, and a
 * frame of delay there is a frame of the user's tasks in the app-switcher
 * snapshot. There is nothing to order on the way in anyway — an opening modal
 * has no focused field of its own yet — so the edge that needs the hold is the
 * only edge that gets it.
 *
 * Call sites may still dismiss the keyboard themselves; several do, from
 * before this existed. That is harmless (the keyboard starts moving a touch
 * sooner) and is no longer load-bearing, so new code does not need it.
 */
export function SheetModal({ visible = true, children, ...rest }: Props) {
  const [shown, setShown] = useState(visible === true);

  // The opening edge, taken during render so it lands in this same commit
  // (see above). Legal as a render-phase state adjustment because it is
  // guarded and touches nothing outside this component — the keyboard is
  // deliberately not involved on this edge, so there is no side effect here.
  const opening = nextSheetVisibility(visible === true, shown);
  if (opening && !opening.dismissKeyboard) setShown(opening.shown);

  // The closing edge, held one commit so the dismissal is queued behind the
  // keyboard's. Recomputed rather than closing over `opening`, which is a new
  // object every render and would re-run this constantly as a dependency.
  useEffect(() => {
    const step = nextSheetVisibility(visible === true, shown);
    if (!step || !step.dismissKeyboard) return;
    Keyboard.dismiss();
    setShown(step.shown);
  }, [visible, shown]);

  // A sheet torn down while still on screen closes the same way one that is
  // merely hidden does, so it needs the same dismissal — a parent dropping it
  // from the tree is one more close path, and the one no prop change reports.
  // Guarded on having actually been up: an unmount while hidden must not take
  // the keyboard off a field somewhere else on the screen.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => () => { if (shownRef.current) Keyboard.dismiss(); }, []);

  return <Modal visible={shown} {...rest}>{children}</Modal>;
}
