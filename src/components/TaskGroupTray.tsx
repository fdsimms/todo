import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, animation, type Colors } from '../theme';
import { SpotlightScrim } from './SpotlightOverlay';
import { AnimatedCollapsible } from './AnimatedCollapsible';

/** Inner padding of the tray, and so the inset of everything inside it. */
export const TRAY_PAD = spacing.sm;

/** The tray's vertical margin, which is also how far a highlight around it sits from its row's edge. */
export const TRAY_MARGIN_Y = spacing.xxs;

/**
 * How far the card edges under a collapsed stack reach below its header (see
 * TaskGroupHeader). The tray grows by this much as it collapses, so the edges
 * have room of their own rather than drawing over the next row.
 */
export const STACK_EDGE_DEPTH = spacing.smd;

/**
 * 0 while the tray is open, 1 once it has folded down to a deck. Read by the
 * header, which draws the deck itself: the tray only fades out its own surface
 * and makes room for the edges.
 */
const TrayFoldContext = createContext<SharedValue<number> | null>(null);

/** The tray's fold progress, or null outside a tray. */
export function useTrayFold(): SharedValue<number> | null {
  return useContext(TrayFoldContext);
}

interface Props {
  /**
   * Whether the stack is folded to its header. Pass what the header's chevron
   * shows (its `expanded` prop, or `!group.collapsed`), not what the body is
   * doing: a drag folds the body for a moment without collapsing the stack.
   * Omitted (a tray with no stack header, like Stuck's), it never folds.
   */
  collapsed?: boolean;
  /**
   * Draw the tray one step lighter than the page instead of recessed. In the
   * dark themes `bgSunken` is darker than the page, which on a screen with no
   * stack header over it (Stuck's) reads as a black slab rather than a region.
   * The cards inside must then step up again (`bgTertiary`) to stay visible.
   */
  raised?: boolean;
  children: React.ReactNode;
}

/**
 * The recessed region a stack's header and its task cards share.
 *
 * This is the thing that says the cards belong to the header, and it replaced
 * two earlier answers to that question. The first was making the header a card
 * itself, one shade brighter than the rows and flush against them — which read
 * as a *selected* row, because a brighter version of the card surface is what
 * this app uses for pressed and dragged. The second dropped the card, made the
 * header a caption band on the page, and leaned on alignment plus a hairline
 * rail to do the grouping; the header stopped looking selected and started
 * looking unrelated to the tasks beneath it.
 *
 * Enclosure is the cue that actually holds, and it costs nothing that the
 * other two spent: a common region groups the header with the cards without
 * the header having to resemble them at all. So the header stays a caption —
 * transparent, no card, 17pt — and the tray does the work. It also gives the
 * stack a visible bottom edge, which is what the rail was for.
 *
 * Children sit at `TRAY_PAD` from its inner edges; `TaskItem`'s `indented`
 * rows drop their own horizontal margins so this padding is the only inset
 * they get (which incidentally hands them back the width the old 56pt
 * text-alignment indent was eating).
 *
 * **Collapsed, the tray gets out of the way and the header becomes a deck.**
 * A tray folded down to its header was a grey band sitting right on top of the
 * next card, which is exactly what a section header looks like, so a collapsed
 * stack read as the heading of the loose tasks below it. Folded, the surface
 * fades out, the header turns into a card with two card edges showing under it
 * (TaskGroupHeader draws them), and this view grows by `STACK_EDGE_DEPTH` to
 * hold them. Both run on AnimatedCollapsible's clock, so the deck forms as the
 * rows fold away under it.
 */
export function TaskGroupTray({ collapsed = false, raised = false, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fold = useSharedValue(collapsed ? 1 : 0);

  useEffect(() => {
    fold.value = withTiming(collapsed ? 1 : 0, {
      duration: animation.duration.normal,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [collapsed, fold]);

  const surfaceStyle = useAnimatedStyle(() => ({ opacity: 1 - fold.value }));

  return (
    <TrayFoldContext.Provider value={fold}>
    <View style={styles.tray}>
      {/* Drawn *under* the children, so it dims only the tray surface they
          don't cover — its padding and the gaps between the cards. The header
          and every row are opaque and paint their own scrim already (that's how
          they recede in step with the rest of the screen), so a layer on top of
          them here would dim those pixels a second time and the whole stack
          would read darker than the list around it.

          A separate clipped view rather than `overflow: hidden` on the tray
          itself — the tray can't clip its own children, since TaskGroupBody's
          drag-out lets a child's floating card cross the tray's edge on its
          way out of the stack (see the `dragging` prop there). This layer
          carries the tray's colour and rounds the scrim's corners to match,
          and fades out with both when the stack folds, since the page under
          a folded stack is dimmed already. */}
      <Reanimated.View style={[styles.surface, raised && styles.surfaceRaised, surfaceStyle]} pointerEvents="none">
        <SpotlightScrim />
      </Reanimated.View>
      {children}
      <AnimatedCollapsible expanded={collapsed}>
        <View style={styles.edgeRoom} />
      </AnimatedCollapsible>
    </View>
    </TrayFoldContext.Provider>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  tray: {
    marginHorizontal: spacing.md,
    marginTop: TRAY_MARGIN_Y,
    marginBottom: TRAY_MARGIN_Y,
    paddingHorizontal: TRAY_PAD,
    // No vertical padding: the gaps above and below the children live inside
    // TaskGroupBody, where AnimatedCollapsible takes them away with the rest
    // of the body. Put them here and a collapsed stack keeps a band of empty
    // tray under its header.
  },
  // The tray's own colour lives on this layer rather than on the tray, so it
  // can fade out as the stack folds into a deck.
  surface: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgSunken,
  },
  surfaceRaised: {
    backgroundColor: colors.bgSecondary,
  },
  edgeRoom: {
    height: STACK_EDGE_DEPTH,
  },
});
