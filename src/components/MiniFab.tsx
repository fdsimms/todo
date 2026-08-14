import React, { useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  FabMenuOverlay,
  fabCancelCircle,
  fabCircle,
  fabGlyphSize,
  FAB_SIZE,
  type FabDragHandlers,
  type FabMenuItem,
} from './Fab';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, animation, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { fabHomeState, MINI_CANCEL_RADIUS, type FabHomeState } from '../utils/fabDrop';
import { useSettingsStore } from '../store/useSettingsStore';
import { useReduceMotion } from '../utils/useReduceMotion';

/** Diameter of the in-card add button. The screen one is FAB_SIZE (56). */
export const MINI_FAB_SIZE = 36;

/**
 * The well's ring, narrower than Fab's WELL_PADDING of 8 — that's 8 around 56,
 * and this is the same proportion around 36. It also has to be: the button is
 * pulled outward to sit on the row's icon column (see MINI_FAB_ROW_INSET), and
 * a ring the screen button's width would end up a point from the card's edge.
 */
const MINI_WELL_PADDING = spacing.xs;

/** The button plus its well — the footprint the caller has to place. */
export const MINI_FAB_BOX = MINI_FAB_SIZE + MINI_WELL_PADDING * 2;

/**
 * Room a card has to leave below its last row for the button — its footprint
 * and a little air. The button floats over this strip, so it never covers a
 * row's reorder handle or delete ✕.
 */
export const MINI_FAB_GUTTER = MINI_FAB_BOX + spacing.xs;

/**
 * How far in from a row's edge that row's edge-most control is centred — what
 * the button lines its own centre up with, so the ✕ column and the + read as
 * one column rather than two things near the same corner.
 *
 * Both cards put their trailing ✕ at `padding: 4` around a 14pt glyph, so on
 * the right (the default hand) this is exact. On the left the two cards differ
 * slightly — the subtasks checkbox centres at 10, the stack's drag handle at
 * 13 — and 11 sits between them, close enough that the residual isn't visible.
 */
export const MINI_FAB_ROW_INSET = 11;

interface MiniFabProps {
  onPress: () => void;
  /** Required — the button is icon-only. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  disabled?: boolean;
  /** Omit to leave the button tap-only. */
  drag?: FabDragHandlers;
}

/**
 * The add button that lives *inside* a card — the subtasks list, a stack's
 * tasks — rather than in the screen's corner. Same circle, same accent glow,
 * same drag-somewhere-to-place-it gesture as `Fab`, one size down, and it
 * follows the same `fabHand` corner so both buttons fall under the same thumb.
 *
 * It is a separate component rather than a mode of `FabButton` because almost
 * everything below the paint differs: it arms on touch-down instead of on
 * travel, it therefore can't use `PressableScale`, its coordinates are the
 * card's rather than the screen's, and its well has to sit inside the card's
 * bounds. What must *not* differ is the look, so the circle, the cancel
 * recolour and the glyph size all come from Fab.tsx.
 *
 * ## Why it claims the touch on touch-down, and tells the caller there and then
 *
 * The card sits inside the editor sheet's ScrollView, and a native scroll view
 * only stands down for a JS responder that is one of its *ancestors*
 * (`_shouldDisableScrollInteraction` walks `superview`, not the subtree). By
 * the time a responder claimed on travel would fire, UIScrollView's pan has
 * already engaged and the JS touch is cancelled — so the drag simply never
 * happens. Claiming in the capture phase on touch-down is the same move
 * PaintSelection makes for its checkbox gutter, and it carries the same
 * deliberate cost: **you cannot scroll the sheet by starting a drag on this
 * button.** It's 36pt, and every other pixel of the card scrolls as before.
 *
 * Claiming the touch is not on its own enough, though, and this used to stop
 * there. Read that `superview` walk again: it starts at the *scroll view* and
 * goes up, so a JS responder anywhere inside it — this button included — is
 * never found, and the scroll view goes on cancelling content touches exactly
 * as if nobody had claimed anything. The only thing that actually stands it
 * down is `scrollEnabled`, which is why `SortableList` demands it. So `onStart`
 * fires on **grant**, not on the first travelled point: reporting it from
 * `beginDrag` left the flag to land at `tapMoveThreshold` (10pt), which is also
 * roughly where UIScrollView's pan begins — a race the drag lost about as often
 * as it won. A touch that turns out to be a tap takes it back through
 * `onCancel` on release.
 *
 * The consequence is that `PressableScale` never becomes the responder, so the
 * two things it would have provided are hand-rolled here: the press scale, and
 * the tap itself — a release that never travelled further than
 * `interaction.tapMoveThreshold` is a tap, which is exactly what that constant
 * is documented for.
 */
export function MiniFab({
  onPress, accessibilityLabel, accessibilityHint, icon = 'add',
  size = MINI_FAB_SIZE, disabled, drag,
}: MiniFabProps) {
  const colors = useColors();
  const { shadows } = useTheme();
  const reduceMotion = useReduceMotion();
  const styles = useMemo(() => makeStyles(colors, size), [colors, size]);

  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;
  const wellOpacity = useRef(new Animated.Value(0)).current;

  // The one piece of drag state React needs, because it recolours the button.
  const [cancelArmed, setCancelArmed] = useState(false);

  const leftHomeRef = useRef(false);
  // Whether this touch has become a drag. Until it has, the gesture is still a
  // candidate tap and nothing has been reported to the caller.
  const draggingRef = useRef(false);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const panResponder = useMemo(() => {
    const setPressed = (pressed: boolean) => {
      Animated.spring(pressScale, {
        toValue: pressed && !reduceMotionRef.current ? interaction.pressScale : 1,
        ...(pressed ? animation.spring.snappy : animation.spring.smooth),
        useNativeDriver: true,
      }).start();
      Animated.timing(pressOpacity, {
        toValue: pressed ? 0.85 : 1,
        duration: animation.duration.fast,
        useNativeDriver: true,
      }).start();
    };

    const settle = () => {
      draggingRef.current = false;
      setCancelArmed(false);
      Animated.spring(dragX, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      Animated.spring(dragY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      Animated.timing(wellOpacity, {
        toValue: 0, duration: animation.duration.fast, useNativeDriver: true,
      }).start();
    };

    const readHome = (g: { dx: number; dy: number }): FabHomeState => {
      const state = fabHomeState(g.dx, g.dy, leftHomeRef.current, MINI_CANCEL_RADIUS);
      if (state === 'outside') leftHomeRef.current = true;
      setCancelArmed(state === 'returned');
      return state;
    };

    // Promotes a candidate tap into a drag, once the finger has travelled far
    // enough that it can't be one. The caller was already told at grant (see
    // the docblock) — what's left here is everything the *user* should only see
    // once the gesture is unambiguously a drag.
    const beginDrag = () => {
      draggingRef.current = true;
      leftHomeRef.current = false;
      setCancelArmed(false);
      haptics.impactLight();
      Animated.timing(wellOpacity, {
        toValue: 1, duration: animation.duration.fast, useNativeDriver: true,
      }).start();
    };

    return PanResponder.create({
      // See the docblock: the touch has to be taken before the scroll view can
      // start dragging, which means taking it on touch-down.
      onStartShouldSetPanResponderCapture: () => !disabledRef.current,
      onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        draggingRef.current = false;
        leftHomeRef.current = false;
        setPressed(true);
        // Before the finger has moved a point: this is what switches the
        // enclosing ScrollView off, and it has to be off before that scroll
        // view's own pan can begin. Nothing the user can see happens yet.
        dragRef.current?.onStart();
      },
      onPanResponderMove: (e, g) => {
        if (!dragRef.current) return;
        if (!draggingRef.current) {
          if (Math.hypot(g.dx, g.dy) <= interaction.tapMoveThreshold) return;
          setPressed(false);
          beginDrag();
        }
        dragX.setValue(g.dx);
        dragY.setValue(g.dy);
        dragRef.current.onMove(e.nativeEvent.pageY, readHome(g));
      },
      onPanResponderRelease: (e, g) => {
        setPressed(false);
        if (draggingRef.current) {
          dragRef.current?.onEnd(e.nativeEvent.pageY, readHome(g));
          settle();
          return;
        }
        // Never travelled far enough to be a drag, so take back the `onStart`
        // that grant fired — the caller is holding a scroll view switched off
        // for a gesture that turned out to be a tap (or a wander that stayed
        // under the threshold, which never became a drag either).
        dragRef.current?.onCancel();
        if (Math.hypot(g.dx, g.dy) <= interaction.tapMoveThreshold) {
          haptics.impactLight();
          onPressRef.current();
        }
      },
      onPanResponderTerminate: () => {
        setPressed(false);
        dragRef.current?.onCancel();
        if (draggingRef.current) settle();
      },
    });
  }, [dragX, dragY, pressScale, pressOpacity, wellOpacity]);

  return (
    <View style={styles.container} pointerEvents={disabled ? 'none' : 'box-none'}>
      {/*
        The spot the button left, offered back as the way out of the drag.
        Sized to the container rather than hung off the button's edges with
        negative offsets the way Fab's is — the card clips (`overflow: hidden`),
        so anything outside these bounds would be sliced.
      */}
      {drag ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.well, cancelArmed && styles.wellArmed, { opacity: wellOpacity }]}
        >
          <Ionicons
            name="close"
            size={fabGlyphSize(size)}
            color={cancelArmed ? colors.red : colors.textTertiary}
          />
        </Animated.View>
      ) : null}
      <Animated.View
        {...panResponder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={drag ? accessibilityHint : undefined}
        accessibilityState={{ disabled: !!disabled }}
        style={[
          fabCircle(colors, size),
          shadows.fab,
          cancelArmed && fabCancelCircle(colors),
          disabled && styles.disabled,
          {
            opacity: pressOpacity,
            transform: [
              { translateX: dragX },
              { translateY: dragY },
              { scale: pressScale },
            ],
          },
        ]}
      >
        <Ionicons
          name={cancelArmed ? 'close' : icon}
          size={fabGlyphSize(size)}
          color={colors.onAccent}
        />
      </Animated.View>
    </View>
  );
}

interface MiniFabMenuProps extends Omit<MiniFabProps, 'onPress'> {
  /** Rendered bottom-up: the last one ends up nearest the button. */
  items: FabMenuItem[];
  onSelect: (key: string) => void;
}

/**
 * A `MiniFab` that accordions open, for the card with more than one thing to
 * add (a stack takes a brand-new task or an existing one).
 *
 * The menu is a `Modal` anchored to where the button measured itself to be,
 * not a view inside the card: the card clips, and two pills need more headroom
 * than a stack with two members has. Measuring once on tap is enough because
 * the Modal covers the sheet, so nothing can scroll the button out from under
 * its own menu while it's open.
 *
 * **The open menu is the standard size, not this button's size.** Only the
 * resting button is 36pt, and only because it shares a card with the rows; once
 * the menu is up it's the same full-screen Modal Today opens, so it's drawn at
 * `FAB_SIZE` with the same pills. The close button grows over the resting one
 * rather than beside it — both are pinned to the same bottom corner of the
 * button's box, and a 56pt circle in that corner covers the 36pt one whole.
 */
export function MiniFabMenu({ items, onSelect, size = MINI_FAB_SIZE, ...rest }: MiniFabMenuProps) {
  const hand = useSettingsStore(s => s.fabHand);
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState({ bottom: 0, left: undefined as number | undefined, right: undefined as number | undefined });
  const anim = useRef(new Animated.Value(0)).current;
  const buttonRef = useRef<View | null>(null);

  const open = () => {
    const view = buttonRef.current;
    if (!view || typeof view.measureInWindow !== 'function') return;
    view.measureInWindow((x, y, width, height) => {
      const { width: winW, height: winH } = Dimensions.get('window');
      setAnchor({
        bottom: winH - (y + height),
        left: hand === 'left' ? x : undefined,
        right: hand === 'left' ? undefined : winW - (x + width),
      });
      setVisible(true);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
    });
  };

  const close = (onDismissed?: () => void) => {
    Animated.timing(anim, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true })
      .start(() => {
        setVisible(false);
        onDismissed?.();
      });
  };

  return (
    <>
      {/* collapsable={false} keeps the view around to be measured — without it
          a plain wrapper is flattened away on the native side. */}
      <View ref={buttonRef} collapsable={false}>
        <MiniFab {...rest} size={size} onPress={open} />
      </View>

      <FabMenuOverlay
        items={items}
        visible={visible}
        anim={anim}
        onSelect={key => { haptics.tap(); close(() => onSelect(key)); }}
        onDismiss={() => close()}
        size={FAB_SIZE}
        anchor={{
          bottom: anchor.bottom,
          left: anchor.left,
          right: anchor.right,
          alignItems: hand === 'left' ? 'flex-start' : 'flex-end',
        }}
      />
    </>
  );
}

const makeStyles = (colors: Colors, size: number) => {
  const box = size + MINI_WELL_PADDING * 2;
  return StyleSheet.create({
    // The button plus the room its well needs. Sized rather than absolutely
    // placed: the caller decides which corner it sits in (MiniFabMenu has to
    // wrap this in a measurable view, and an absolute child would anchor
    // itself to that wrapper instead of to the card).
    container: {
      width: box,
      height: box,
      alignItems: 'center',
      justifyContent: 'center',
    },
    well: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: box / 2,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: border.md,
      borderColor: colors.separator,
      backgroundColor: colors.bgSecondary,
    },
    wellArmed: {
      borderColor: colors.red,
      // Tinted rather than filled: the button lands on top of this, and a solid
      // red disc under a solid red button reads as one shape twice the size.
      backgroundColor: colors.red + '26',
    },
    disabled: {
      backgroundColor: colors.bgQuaternary,
      shadowColor: 'transparent',
    },
  });
};
