import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SwipeDismiss } from './SwipeDismiss';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, type Colors } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

/** How far a banner rises as it arrives, and drops as it goes. */
const ENTER_RISE = 16;
const EXIT_DROP = 12;
/** The bottom sheets' exit curve, which this leaves on too (see useSheetMotion). */
const EXIT_EASING = Easing.bezier(0.4, 0, 1, 1);

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
  /**
   * Plays the way out: the banner drops and fades, then `onLeft` runs. A
   * caller that wants it keeps rendering the banner until then. Without it a
   * banner just goes when its caller stops rendering it, as before.
   */
  leaving?: boolean;
  onLeft?: () => void;
  /**
   * Draws a hairline along the bottom that drains over `ms`, so a banner on a
   * timer shows how long it has left. Restarts whenever `key` changes, for a
   * banner whose content is replaced while it's up.
   */
  lifetime?: { ms: number; key: unknown };
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
  leaving = false,
  onLeft,
  lifetime,
}: Props) {
  const { colors, shadows } = useTheme();
  const styles = makeStyles(colors);
  const stacked = layout === 'stacked';
  const reduceMotion = useReduceMotion();

  // Arrives by rising and fading in on the smooth spring, where it used to
  // appear in one frame. Reduce Motion keeps the fade.
  const rise = useRef(new Animated.Value(reduceMotion ? 0 : ENTER_RISE)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(rise, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start();
    // Mount only: the way back in after a cancelled exit is the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;
  const wasLeaving = useRef(false);
  useEffect(() => {
    if (leaving === wasLeaving.current) return;
    wasLeaving.current = leaving;
    rise.stopAnimation();
    fade.stopAnimation();
    if (leaving) {
      Animated.parallel([
        Animated.timing(rise, { toValue: reduceMotion ? 0 : EXIT_DROP, duration: animation.duration.sheetBackdropOut, easing: EXIT_EASING, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: animation.duration.sheetBackdropOut, easing: EXIT_EASING, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onLeftRef.current?.();
      });
      return;
    }
    // New content arrived while it was on its way out: come back up.
    Animated.parallel([
      Animated.spring(rise, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const drain = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!lifetime) return;
    drain.setValue(1);
    const run = Animated.timing(drain, { toValue: 0, duration: lifetime.ms, easing: Easing.linear, useNativeDriver: true });
    run.start();
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifetime?.key, lifetime?.ms]);

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
      {lifetime ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.drain, { transform: [{ scaleX: drain }] }]}
        />
      ) : null}
    </View>
  );

  return (
    // box-none so whatever is behind stays tappable either side of the bar.
    // Nothing on a banner on its way out can be pressed.
    <Animated.View
      style={[styles.wrap, { bottom, opacity: fade, transform: [{ translateY: rise }] }]}
      pointerEvents={leaving ? 'none' : 'box-none'}
    >
      {onDismiss ? <SwipeDismiss onDismiss={onDismiss}>{bar}</SwipeDismiss> : bar}
    </Animated.View>
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
  // Inset by the corner radius rather than clipped by it: the bar carries a
  // shadow, and clipping it would cut the shadow off too. Drains toward the
  // left edge, so what's left reads from where the eye starts.
  drain: {
    position: 'absolute',
    left: radius.lg,
    right: radius.lg,
    bottom: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
    opacity: 0.55,
    transformOrigin: 'left',
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
