import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SwipeDismiss } from './SwipeDismiss';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, type Colors } from '../theme';

interface Props {
  /** Distance from the bottom of the screen or sheet, safe-area inset included. */
  bottom: number;
  /** What happened, in the user's words. */
  label: string;
  /** Lines the label may take before it truncates. Defaults to 2. */
  labelLines?: number;
  /** The buttons, normally `InlineAction`s. Omit for a plain confirmation. */
  actions?: React.ReactNode;
  /**
   * 'inline' puts the actions beside the label (one or two short buttons);
   * 'stacked' gives the label its own line with the actions underneath, for
   * a label that must stay readable beside buttons that can grow.
   */
  layout?: 'inline' | 'stacked';
  /**
   * Called when the banner is swiped away. It is the banner's own way of going
   * (the one its timer calls), so a swipe clears the same timer and state.
   */
  onDismiss?: () => void;
  /**
   * 'card' is the bordered card every banner uses over a screen. 'sunken' is
   * for a bar inside a sheet, whose own background it has to stand out from.
   */
  surface?: 'card' | 'sunken';
  liveRegion?: boolean;
}

/**
 * The one floating banner: UndoBar, the created / template / event toasts, the
 * ready offer and the in-sheet undo bars all draw through this, so their look,
 * their placement and their swipe-away stay the same. Each keeps its own timer
 * and its own source of truth and only hands this the words and the buttons.
 */
export function BannerBar({
  bottom,
  label,
  labelLines = 2,
  actions,
  layout = 'inline',
  onDismiss,
  surface = 'card',
  liveRegion,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = makeStyles(colors);
  const stacked = layout === 'stacked';

  const bar = (
    <View
      style={[styles.bar, surface === 'card' ? styles.card : styles.sunken, stacked && styles.barStacked, shadows.fab]}
      accessibilityLiveRegion={liveRegion ? 'polite' : undefined}
    >
      {/* The label takes the row and the buttons are the fixed-width siblings,
          never the other way round: what just happened has to be readable. */}
      <Text style={[styles.label, !stacked && styles.labelInline]} numberOfLines={labelLines}>
        {label}
      </Text>
      {actions ? <View style={[styles.actions, stacked && styles.actionsStacked]}>{actions}</View> : null}
    </View>
  );

  return (
    // box-none so whatever is behind stays tappable either side of the bar.
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      {onDismiss ? <SwipeDismiss onDismiss={onDismiss}>{bar}</SwipeDismiss> : bar}
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
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  barStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: spacing.smd,
    paddingRight: spacing.md,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderWidth: border.md,
    borderColor: colors.separator,
  },
  sunken: {
    backgroundColor: colors.bgSunken,
  },
  label: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  labelInline: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionsStacked: {
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
