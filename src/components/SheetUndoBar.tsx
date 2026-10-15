import React from 'react';
import { InlineAction } from './InlineAction';
import { BannerBar } from './BannerBar';

/**
 * The transient "X added. Undo" bar that floats at the bottom of a sheet.
 *
 * **Not `UndoBar`**, which is a different thing wearing a similar shape:
 * that one is mounted once at the navigator root, reads the four stores' undo
 * stacks itself and decides what to offer. This takes a label and a handler,
 * because a sheet's undo is about the one action the sheet just performed and
 * is gone when the sheet is. Neither can stand in for the other, which is why
 * this is its own component rather than a prop on that one.
 *
 * It exists because `AddMealsToListSheet` and `RecipeToListSheet` had written
 * out the same JSX and the same two style objects, character for character —
 * the drift `SheetHeaderButton` and `InlineAction` were created to undo, one
 * level up. A third sheet wanting one uses this rather than copying either.
 *
 * The caller positions it: `bottom` is the sheet's own safe-area inset plus
 * whatever sits above the bar, which differs per sheet and is the one thing
 * these two copies did not have in common.
 */
export function SheetUndoBar({
  label,
  onUndo,
  onDismiss,
  bottom,
  leaving,
  onLeft,
}: {
  /** What was just done, in the user's words. Truncated to one line. */
  label: string;
  onUndo: () => void;
  /** Swiped away by hand. */
  onDismiss?: () => void;
  /** Distance from the bottom of the sheet, safe-area inset included. */
  bottom: number;
  /** On its way out (see useLingering); BannerBar plays the exit, then `onLeft`. */
  leaving?: boolean;
  onLeft?: () => void;
}) {
  return (
    <BannerBar
      bottom={bottom}
      label={label}
      labelLines={1}
      surface="sunken"
      onDismiss={onDismiss}
      leaving={leaving}
      onLeft={onLeft}
      actions={<InlineAction label="Undo" onPress={onUndo} accessibilityLabel={`Undo: ${label}`} />}
    />
  );
}
