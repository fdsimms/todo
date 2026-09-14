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
}

export function createPresentationLevel(): PresentationLevel {
  return { presented: new Map() };
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
  level.presented.set(id, label);
  if (others.length === 0) return null;
  const already = others.map(([, name]) => name).join(', ');
  return (
    `Two sheets are presented from the same place at once (${already}, and now ${label}). ` +
    'iOS presents each Modal from the nearest view controller above it, and one view ' +
    'controller can present only one thing, so the second is refused: nothing appears and ' +
    'the flow wedges with no error. Either hide the sheet underneath while this one is up, ' +
    "or render this one inside it (React Native's Modal nests fine). See the sibling-Modal " +
    'rule in CLAUDE.md.'
  );
}

export function releasePresentation(level: PresentationLevel, id: string): void {
  level.presented.delete(id);
}
