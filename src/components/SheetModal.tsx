import React, { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal } from 'react-native';
import {
  canHideSheet,
  canShowSheet,
  claimPresentation,
  createPresentationLevel,
  mustYieldSheet,
  nextSheetVisibility,
  registerPresentation,
  releasePresentation,
  releasePresentationClaim,
  subscribePresentation,
  type PresentationLevel,
} from '../utils/sheetModal';

type Props = React.ComponentProps<typeof Modal> & {
  /**
   * What to call this sheet when the sibling-Modal check below reports it.
   * Development only, and optional: without one the check still fires, it
   * just has a less helpful name to print. Worth setting on a sheet that
   * raises another.
   */
  name?: string;
  /**
   * Outranks every other sheet presented from the same place: they stand down
   * so this one can present, and stay down until it goes.
   *
   * **The app lock, and nothing else.** See `claimPresentation` for why it has
   * to exist — a lock screen that cannot present over an open editor is a lock
   * screen that does not lock — and for what it cannot fix, which is the commit
   * or two the standing down costs.
   */
  preempts?: boolean;
};

/**
 * One presenting view controller's worth of sheets. The default stands for the
 * root view controller, which is what a Modal rendered in the ordinary screen
 * tree presents from; each `SheetModal` supplies a fresh one to its own
 * children, since a Modal nested inside it presents from *its* controller.
 */
const PresentationLevelContext = React.createContext<PresentationLevel>(createPresentationLevel());

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
 *
 * ## It also holds a sheet back until its place is free
 *
 * The second bug this component is positioned to catch: iOS presents a Modal
 * from `[self reactViewController]`, and a view controller can present only
 * one thing at a time. Two Modals that are *siblings* share a presenting
 * controller, so the second is refused with nothing shown and no error, while
 * RN has already set `_isPresented` — the flow wedges and users report a
 * frozen screen. A Modal rendered *inside* another presents from that sheet's
 * own controller and is fine.
 *
 * Nothing in the JSX distinguishes the two, which is exactly how the food
 * log's Scan and Describe buttons shipped doing nothing at all: a sheet was
 * moved from nested to sibling in the name of keeping the one underneath
 * open. So each `SheetModal` registers with the level it presents from and
 * supplies a fresh level to its own children.
 *
 * **A sheet whose level is taken holds its open until that sheet goes**
 * (`canShowSheet`, the mirror of the `canHideSheet` hold below). This started
 * as a `__DEV__` report that intervened in nothing, on the grounds that which
 * fix applied differed per call site — and that was right for a pair meant to
 * be up *together*, which is a real mistake with two possible fixes. It was
 * wrong for the case that turned out to be everywhere: closing one sheet and
 * opening another in a single commit, which the whole app does (~25 call
 * sites) and which was *safe until this component existed*. A raw `Modal`
 * took `visible: false` in the same commit as the other took `visible: true`,
 * so the dismissal was always issued first; the one-commit keyboard hold
 * below made the close late and left both `visible: true` for a commit.
 * That shipped three freezes in three days — the Add button's menu, the
 * log-a-meal prompt, the focus session — each fixed at its own call site.
 * Holding the open is the same move this file's header makes about the
 * keyboard: a rule with one call site per chance to forget is a rule that
 * keeps losing, so the component keeps it instead.
 *
 * Two things follow. A sheet with nothing in its place still opens in the
 * commit it was asked to, which is what `AppLockGate` needs. And a clash is
 * still reported in `__DEV__`, because two sheets asked to be up *at once*
 * (rather than handed off) is still a mistake — one of them now waits for a
 * sheet that is never going to close.
 *
 * ## And it sequences a nested pair's dismissal
 *
 * Nesting fixed the first bug and bought a second one. A sheet and the sheet
 * it is presenting must not dismiss in the same commit: UIKit takes a
 * presented view controller down along with its presenter, so the inner
 * `SheetModal` is destroyed behind RN's back while it still believes it is
 * presented, and `prepareForRecycle` then clears `_viewController` and
 * `_isPresented` *without dismissing*. What is left is a view controller iOS
 * is still showing that nothing holds a reference to: an empty sheet the user
 * cannot dismiss, and the app reads as frozen.
 *
 * That is what logging from the nested Scan or Describe sheet did, since
 * `handleLog` fires `onLogged` (closing the picker underneath) and `onClose`
 * (closing itself) together. So the registry above is not only a development
 * check: a sheet holds its own closing edge for as long as something is
 * presented from it (`canHideSheet`), and `subscribePresentation` wakes it the
 * moment that sheet leaves. The two dismissals then land in separate commits,
 * innermost first, which is the order UIKit expects.
 *
 * This is why registration runs in production too, and why call sites are free
 * to close both at once rather than having to sequence it themselves.
 *
 * What a call site owes in return: **closing a sheet has to close anything
 * nested inside it too.** The hold waits for the inner sheet rather than
 * overriding it, so clearing only the outer one leaves it held open. Every
 * path today pairs them.
 */
export function SheetModal({ visible = true, children, name, preempts = false, ...rest }: Props) {
  // The view controller this sheet presents *from*, and the fresh one its own
  // children present from. See `PresentationLevelContext`.
  const parentLevel = useContext(PresentationLevelContext);
  const ownLevel = useMemo(() => createPresentationLevel(), []);
  const id = useId();

  // A sheet mounted already-open still waits its turn, which is what makes the
  // gate cover the sheets that are mounted only while they are up rather than
  // toggling `visible`.
  const [shown, setShown] = useState(() => visible === true && canShowSheet(parentLevel));

  // Whether something that outranks this sheet wants its place. Read during
  // render rather than from an effect so it is fresh on the commit `beside`
  // below wakes.
  const yielding = mustYieldSheet(parentLevel, id);

  // Bumped whenever a sheet is presented from or dismissed at this sheet's own
  // level, purely to re-run the closing effect below when the sheet above
  // finally goes. The count itself is read from `ownLevel`, not from here.
  const [above, setAbove] = useState(0);
  useEffect(
    () => subscribePresentation(ownLevel, () => setAbove(n => n + 1)),
    [ownLevel],
  );

  // The same, for the level this sheet presents *from*: it wakes the opening
  // effect below when whatever is standing in this sheet's place goes.
  const [beside, setBeside] = useState(0);
  useEffect(
    () => subscribePresentation(parentLevel, () => setBeside(n => n + 1)),
    [parentLevel],
  );

  // The opening edge, taken during render so it lands in this same commit
  // (see above). Legal as a render-phase state adjustment because it is
  // guarded and touches nothing outside this component — the keyboard is
  // deliberately not involved on this edge, so there is no side effect here.
  //
  // Held while another sheet is presented from the same place, since a view
  // controller presents one thing and iOS refuses the second silently. See
  // `canShowSheet`: this is what lets a call site close one sheet and open
  // another in a single commit, the way the whole app already does.
  const opening = nextSheetVisibility(visible === true, shown);
  if (opening && !opening.dismissKeyboard && canShowSheet(parentLevel, id)) setShown(opening.shown);

  // The rest of that edge: an open held above lands here instead, once the
  // sheet in the way has gone (`beside`).
  useEffect(() => {
    const step = nextSheetVisibility(visible === true, shown);
    if (!step || step.dismissKeyboard) return;
    if (!canShowSheet(parentLevel, id)) return;
    setShown(step.shown);
  }, [visible, shown, beside, parentLevel, id]);

  // Claiming the level this sheet presents from is how `preempts` clears a
  // path: everything else there yields below, and nothing else opens until
  // this lets go. Held while the sheet *wants* to be up rather than while it
  // is, since the whole point is to be let in.
  useEffect(() => {
    if (!preempts || visible !== true) return;
    claimPresentation(parentLevel, id);
    return () => releasePresentationClaim(parentLevel, id);
  }, [preempts, visible, parentLevel, id]);

  // The other side of that. A sheet told to stand down passes the order to its
  // own children first (they present from its controller, and UIKit takes a
  // presented controller down with its presenter — see `canHideSheet`), then
  // goes once they have. The keyboard leads, exactly as on any other close.
  // `visible` is left alone throughout, so the opening edge above puts the
  // sheet back when the claim is released.
  useEffect(() => {
    if (!yielding) return;
    claimPresentation(ownLevel, id);
    return () => releasePresentationClaim(ownLevel, id);
  }, [yielding, ownLevel, id]);

  useEffect(() => {
    if (!shown || !yielding || !canHideSheet(ownLevel)) return;
    Keyboard.dismiss();
    setShown(false);
  }, [shown, yielding, above, ownLevel]);

  // The closing edge, held one commit so the dismissal is queued behind the
  // keyboard's. Recomputed rather than closing over `opening`, which is a new
  // object every render and would re-run this constantly as a dependency.
  //
  // Held again, for as long as it takes, while a sheet this one is presenting
  // is still up: dismissing a presenting view controller takes the presented
  // one down with it behind RN's back, which is what left an empty sheet
  // nothing could dismiss. `above` re-runs this the moment that sheet goes,
  // so the two dismissals land in separate commits, innermost first. See
  // `canHideSheet`.
  useEffect(() => {
    const step = nextSheetVisibility(visible === true, shown);
    if (!step || !step.dismissKeyboard) return;
    if (!canHideSheet(ownLevel)) return;
    Keyboard.dismiss();
    setShown(step.shown);
  }, [visible, shown, above, ownLevel]);

  // A sheet torn down while still on screen closes the same way one that is
  // merely hidden does, so it needs the same dismissal — a parent dropping it
  // from the tree is one more close path, and the one no prop change reports.
  // Guarded on having actually been up: an unmount while hidden must not take
  // the keyboard off a field somewhere else on the screen.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => () => { if (shownRef.current) Keyboard.dismiss(); }, []);

  // Registering is not a development-only courtesy: it is what tells the sheet
  // *below* this one that it may not dismiss yet (see the closing effect). The
  // warning on a clash is the part that only fires in `__DEV__`, and it reports
  // rather than intervenes — hiding one automatically would paper over a real
  // mistake, and which fix applies differs per call site.
  useEffect(() => {
    if (!shown) return;
    const clash = registerPresentation(parentLevel, id, name ?? rest.testID ?? 'an unnamed sheet');
    if (clash) {
      // The gate above reads the level during render and registration happens
      // here, after the commit — so two sheets opened in the *same* commit
      // both saw it free. Whichever registered first keeps the place; this one
      // stands back down and reopens from the effect above once that one goes.
      // Standing down rather than staying up is what keeps the invariant true
      // in the one case the render-phase gate cannot see.
      if (__DEV__) console.error(`SheetModal: ${clash}`);
      releasePresentation(parentLevel, id);
      setShown(false);
      return;
    }
    return () => releasePresentation(parentLevel, id);
  }, [shown, parentLevel, id, name, rest.testID]);

  return (
    <Modal visible={shown} {...rest}>
      <PresentationLevelContext.Provider value={ownLevel}>
        {children}
      </PresentationLevelContext.Provider>
    </Modal>
  );
}
