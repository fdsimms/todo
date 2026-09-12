import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InlineAction } from './InlineAction';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';

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
  bottom,
}: {
  /** What was just done, in the user's words. Truncated to one line. */
  label: string;
  onUndo: () => void;
  /** Distance from the bottom of the sheet, safe-area inset included. */
  bottom: number;
}) {
  const { colors, shadows } = useTheme();
  const styles = makeStyles(colors);

  return (
    // box-none so the sheet behind the bar stays tappable either side of it.
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={[styles.bar, shadows.fab]}>
        {/* The label takes the row and the button is the fixed-width sibling,
            never the other way round: an action the user just performed has to
            be readable to be worth undoing. */}
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <InlineAction label="Undo" onPress={onUndo} accessibilityLabel={`Undo: ${label}`} />
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  label: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
});
