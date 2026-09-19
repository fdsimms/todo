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
import { createContext } from 'react';

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

/**
 * Which sheets are presented from one view controller, so a second one asking
 * the same controller can be caught in development.
 *
 * iOS presents a Modal from `[self reactViewController]` — the nearest view
 * controller up the responder chain — and a view controller can present only
 * one thing at a time. Two Modals that are *siblings* therefore share a
 * presenting controller, and the second is refused outright: nothing appears,
 * nothing is logged, and RN has already set its own `_isPresented`, so the
 * flow wedges and the screen reads as frozen. A Modal rendered *inside*
 * another one presents from that sheet's controller instead and is fine.
 *
 * That difference is invisible in the JSX, which is why it needs a check
 * rather than a rule: the food log's Scan and Describe buttons shipped doing
 * nothing at all because a sheet was moved from nested to sibling in the name
 * of keeping the one underneath open.
 *
 * A level stands for one presenting view controller. `SheetModal` makes a
 * fresh one for its own children and registers itself with the enclosing one.
 */
export interface PresentationLevel {
  /** Presented sheet id to the label it registered under. */
  readonly presented: Map<string, string>;
  /** Ids that outrank everything else here. See `claimPresentation`. */
  readonly claims: Set<string>;
  /** Notified whenever either of those changes. See `subscribePresentation`. */
  readonly listeners: Set<() => void>;
}

export function createPresentationLevel(): PresentationLevel {
  return { presented: new Map(), claims: new Set(), listeners: new Set() };
}

/**
 * One presenting view controller's worth of sheets. The default stands for the
 * root view controller, which is what a Modal rendered in the ordinary screen
 * tree presents from; each `SheetModal` supplies a fresh one to its own
 * children, since a Modal nested inside it presents from *its* controller.
 *
 * Defined here rather than in `SheetModal.tsx` so `useKeyboardInsetScroll` can
 * read the same level a screen's sheets register against, without importing a
 * component module.
 */
export const PresentationLevelContext = createContext<PresentationLevel>(createPresentationLevel());

/**
 * Watches a level, so the sheet that owns it can tell when the sheet presented
 * from it has gone. Returns the unsubscribe.
 *
 * This is what lets a sheet wait its turn (`canHideSheet` below) rather than
 * dismissing while something is still presented on top of it.
 */
export function subscribePresentation(level: PresentationLevel, fn: () => void): () => void {
  level.listeners.add(fn);
  return () => { level.listeners.delete(fn); };
}

/**
 * Whether a sheet may hand `visible: false` to its own `Modal` yet.
 *
 * **A sheet must not dismiss while something it is presenting is still up.**
 * UIKit tears a presented view controller down along with its presenter, so
 * dismissing both in one commit destroys the inner one's view controller
 * behind RN's back: the inner `SheetModal` still believes it is presented,
 * and `prepareForRecycle` then clears `_viewController` and `_isPresented`
 * *without dismissing*, orphaning a view controller iOS is still showing.
 * What is left on screen is an empty sheet that nothing can dismiss, because
 * the React tree that owned it no longer holds a reference to it.
 *
 * That shipped: logging from the nested Scan or Describe sheet called
 * `onLogged` (closing the picker underneath) and `onClose` (closing itself)
 * in the same commit, and the food log came back as a blank frozen sheet.
 *
 * Holding the outer one back a commit is enough. The two dismissals are then
 * issued in separate commits, innermost first, which is the order UIKit
 * expects and the order RN's own bookkeeping stays consistent under.
 */
export function canHideSheet(level: PresentationLevel): boolean {
  return level.presented.size === 0;
}

/**
 * Whether a sheet may hand `visible: true` to its own `Modal` yet.
 *
 * The same predicate as `canHideSheet` over a different level — the two names
 * are two rules, not one function written twice. `canHideSheet` asks about the
 * level a sheet presents *to* (may I go while I am holding something up?);
 * this asks about the level it presents *from* (is the place I would appear
 * already taken?).
 *
 * **A level holds one sheet at a time on the way in as much as on the way
 * out**, because one view controller presents one thing. Without this the
 * invariant was enforced nowhere: `SheetModal` defers every close by a commit
 * to sequence the keyboard's dismissal, and defers no open at all, so a caller
 * that closed one sheet and opened another in a single commit left a commit
 * where both `Modal`s were `visible: true`. iOS refuses the second present,
 * RN has already set `_isPresented`, and the sheet never appears — the flow
 * wedges and users report the screen behind it as frozen.
 *
 * That idiom used to be safe and is written all over the app (~25 call sites):
 * before the sweep to `SheetModal` a close reached the native `Modal` in the
 * same commit as the other's open, so the dismissal was always issued first.
 * The hold is what broke it, three times in three days — the Add button's menu
 * doing nothing, the log-a-meal prompt freezing Today, the focus session
 * freezing Today — each fixed at its own call site, which is the shape of rule
 * this file exists to stop relying on.
 *
 * Holding the open rather than asking the call sites to sequence it restores
 * the old ordering and improves on it: the dismissal goes out a commit *before*
 * the present instead of alongside it. A sheet with no one above it opens in
 * the commit it was asked to, exactly as before, which is the case
 * `AppLockGate` needs and very nearly every case there is.
 */
export function canShowSheet(level: PresentationLevel, id?: string): boolean {
  if (id !== undefined && mustYieldSheet(level, id)) return false;
  return level.presented.size === 0;
}

/**
 * Says a sheet outranks its level: whatever is presented there stands down so
 * this one can present, and nothing else opens there until it lets go.
 *
 * **The app lock is the only thing that claims one, and it has to.** Every
 * screen-level sheet in this app presents from the root view controller —
 * `RCTModalHostViewComponentView` presents from `[self reactViewController]`,
 * the nearest one *above* the Modal, and `enableScreens(false)` means no screen
 * is one. A view controller presents one thing at a time, so a lock screen
 * asking to present over an open task editor was refused outright: leaving the
 * app with any sheet up meant the shield never covered the app-switcher
 * snapshot, and a resume past the grace period did not lock the app at all.
 * `AppLockGate` chose a Modal over an overlay `View` precisely so it would
 * cover an open editor, on the understanding that a later modal stacks above
 * one already up. It doesn't; only a modal presented *by* that one does.
 *
 * Yielding is the only lever available from here. What it cannot fix is the
 * timing: a sheet has to be told to go, and go, before the lock can present,
 * which is a commit or two rather than the same one. For the snapshot that is
 * a real cost, and the honest fix is a window-level native overlay, which sits
 * above every presented view controller and needs no one's permission. This is
 * the half that can be done in JS, and it turns "never" into "a moment later".
 *
 * A claim cascades: see `mustYieldSheet`.
 */
export function claimPresentation(level: PresentationLevel, id: string): void {
  if (level.claims.has(id)) return;
  level.claims.add(id);
  notify(level);
}

export function releasePresentationClaim(level: PresentationLevel, id: string): void {
  if (level.claims.delete(id)) notify(level);
}

/**
 * Whether `id` has to give up its place at `level` to a claim it doesn't own.
 *
 * A yielding sheet claims *its own* level as it goes, which is what carries the
 * order down a nest: its children yield first, so it is never dismissed while
 * still presenting one of them (`canHideSheet`) — the orphaned view controller
 * that leaves an empty sheet nothing can dismiss. Releasing its claim on the
 * way back up lets them reopen in the same order they left.
 */
export function mustYieldSheet(level: PresentationLevel, id: string): boolean {
  return level.claims.size > 0 && !level.claims.has(id);
}

function notify(level: PresentationLevel): void {
  for (const fn of [...level.listeners]) fn();
}

/**
 * Records `id` as presented at `level`, returning the message to report when
 * that collides with one already there, or `null` when it is the only one.
 *
 * Re-registering an id already present is not a collision — it is the same
 * sheet re-reporting — so it replaces its own entry rather than tripping.
 */
export function registerPresentation(
  level: PresentationLevel,
  id: string,
  label: string,
): string | null {
  const others = [...level.presented.entries()].filter(([key]) => key !== id);
  const had = level.presented.has(id);
  level.presented.set(id, label);
  if (!had) notify(level);
  if (others.length === 0) return null;
  const already = others.map(([, name]) => name).join(', ');
  return (
    `Two sheets opened from the same place in one commit (${already}, and now ${label}). ` +
    'iOS presents each Modal from the nearest view controller above it, and one view ' +
    'controller can present only one thing, so they cannot both be up. This one stands ' +
    'down and opens once the other has gone, which is what a hand-off wants and is not ' +
    'what a pair meant to be up together wants: that one waits for a sheet that is never ' +
    'going to close. Either hide the sheet underneath while this one is up, or render this ' +
    "one inside it (React Native's Modal nests fine). See the sibling-Modal rule in CLAUDE.md."
  );
}

export function releasePresentation(level: PresentationLevel, id: string): void {
  if (level.presented.delete(id)) notify(level);
}
