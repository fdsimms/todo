import React from 'react';
import { Keyboard, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors, useTheme } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { BUTTON_LABEL } from '../copy/shared';
import { PressableScale } from './PressableScale';
import { OVERLAY_CARD_MAX_WIDTH } from '../utils/frameWidth';
import { GlassLayer, glassSupported } from './GlassLayer';

/** A glass capsule's height: the 40pt row the journal bar's buttons already use. */
export const ACCESSORY_CAPSULE_HEIGHT = 40;

/**
 * The fill an `InputAccessoryView` (or a floating stand-in) takes behind its
 * bar. Transparent where the bar is glass capsules, since a solid fill behind
 * them is the strip they replace.
 */
export function accessoryFill(colors: Colors): string {
  return glassSupported() ? 'transparent' : colors.bgSecondary;
}

/**
 * The strip an `InputAccessoryView` carries above the keyboard (title tokens, a
 * number pad's Done, "apply to all"). The system gives the view the whole width
 * of the window, and on a Mac window that is 1,500pt with its buttons at one
 * end and its confirm at the other, nowhere near the field they act on. The
 * strip keeps its full-width fill and hairline, so it still reads as one bar,
 * and its content sits in a column the width of the card above it (a quick add
 * card is capped at the same `OVERLAY_CARD_MAX_WIDTH`).
 *
 * Where Liquid Glass is available the fill and hairline are dropped and the
 * bar is only a row: each control sits in its own `AccessoryCapsule`, floating
 * over the keyboard's rounded top the way iOS 26's own toolbars do.
 *
 * `style` is the content row's own layout (direction, spacing, padding).
 *
 * `passThrough` is for a bar drawn as a floating view rather than an
 * `InputAccessoryView`: its two full-width wrappers then let touches fall
 * through to what is behind them, so only the capsules take a tap
 * (`src/utils/floatingNumberPad.ts`).
 */
export function AccessoryBar({ children, style, passThrough }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  passThrough?: boolean;
}) {
  const colors = useColors();
  const glass = glassSupported();
  const pointerEvents = passThrough ? 'box-none' : undefined;
  return (
    <View
      pointerEvents={pointerEvents}
      style={glass ? undefined : [styles.strip, { backgroundColor: colors.bgSecondary, borderTopColor: colors.separator }]}
    >
      <View pointerEvents={pointerEvents} style={[styles.column, style]}>{children}</View>
    </View>
  );
}

/**
 * One control, or one group of related controls, in a bar. Where glass is
 * available it draws a capsule of Liquid Glass behind its children; elsewhere it
 * is only a wrapper that gives them `style` (or nothing at all without one), so
 * the solid bar looks as it always has. Buttons inside a capsule drop their own
 * fill when `glassSupported()`: a second surface on the glass reads as a
 * button stuck to it.
 *
 * `style` is the capsule's own layout (direction, gap), applied either way.
 * `tintColor` colors the glass, for the one confirming control (a fill token,
 * never a raw color).
 */
export function AccessoryCapsule({ children, style, tintColor }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
}) {
  if (!glassSupported()) return style ? <View style={style}>{children}</View> : <>{children}</>;
  return (
    <View style={[styles.capsule, style]}>
      <GlassLayer interactive tintColor={tintColor} style={styles.capsuleRadius} />
      {children}
    </View>
  );
}

/**
 * The Done that dismisses the keyboard, in every accessory bar and in the
 * floating one a multiline field gets: one capsule, one label, so the three
 * can't drift apart. `floating` only matters without glass, where the button
 * has no bar to sit in and so draws its own chip.
 *
 * It is not a `SheetHeaderButton`: that registers itself as the form's commit
 * (⌘Return), and a Done that is mounted in every sheet would take the shortcut
 * from the sheet's own Save.
 */
export function AccessoryDoneButton({ floating }: { floating?: boolean }) {
  const { colors, shadows } = useTheme();
  const glass = glassSupported();
  const chip: StyleProp<ViewStyle> = floating && !glass
    ? [styles.chip, { backgroundColor: colors.bgSecondary, borderColor: colors.separator }, shadows.card]
    : undefined;
  return (
    <AccessoryCapsule style={chip}>
      <PressableScale
        onPress={() => Keyboard.dismiss()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={BUTTON_LABEL.done}
        style={glass ? styles.doneOnGlass : styles.done}
      >
        <Text style={{ color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold }}>
          {BUTTON_LABEL.done}
        </Text>
      </PressableScale>
    </AccessoryCapsule>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  done: { paddingHorizontal: spacing.smd, paddingVertical: spacing.xsm },
  doneOnGlass: { minHeight: ACCESSORY_CAPSULE_HEIGHT, justifyContent: 'center', paddingHorizontal: spacing.smd },
  strip: { borderTopWidth: StyleSheet.hairlineWidth },
  column: { width: '100%', maxWidth: OVERLAY_CARD_MAX_WIDTH, alignSelf: 'center' },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ACCESSORY_CAPSULE_HEIGHT,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
  },
  capsuleRadius: { borderRadius: radius.full },
});
