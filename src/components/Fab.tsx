import React, { useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { fabHomeState, type FabHomeState } from '../utils/fabDrop';
import { useSettingsStore, type FabHand } from '../store/useSettingsStore';

/** Diameter of the standard list-screen FAB — also the room a list must leave below its last row. */
export const FAB_SIZE = 56;

/**
 * Turns the button into a thing you can also pull into the list behind it,
 * rather than only tap. The button reports where it is and where it was let
 * go; what a given position *means* is entirely the screen's business.
 */
export interface FabDragHandlers {
  onStart: () => void;
  /**
   * `home` — where the button is relative to the corner it started in, so a
   * release back on that corner can mean "forget it". Reported alongside the
   * position rather than instead of it so the caller keeps one code path: it
   * still resolves a drop, it just resolves that one to a cancel.
   */
  onMove: (pageY: number, home: FabHomeState) => void;
  onEnd: (pageY: number, home: FabHomeState) => void;
  /** Touch lost, app switched — the drag never happened. */
  onCancel: () => void;
}

/** How far the well behind the dragged button extends past the button itself. */
export const WELL_PADDING = 8;

/**
 * The circle itself — fill, glow and geometry — as one definition, because
 * MiniFab draws the same button inside an editor card and these are exactly the
 * declarations that drift when they're copied (the accent `shadowColor` most of
 * all: it's what makes the button glow its own colour rather than cast a grey
 * drop shadow, and it's the easiest one to leave out).
 */
export function fabCircle(colors: Colors, size: number) {
  return {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: colors.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: colors.accent,
  };
}

/**
 * Recolours the circle for the moment a release would cancel. A style swap and
 * not an animated overlay because `shadowColor` goes with it — a red face over
 * an accent halo reads as the wrong button lit from behind by the right one.
 */
export function fabCancelCircle(colors: Colors) {
  return { backgroundColor: colors.red, shadowColor: colors.red };
}

/** Glyph size for a given button size — 56 and 48 are the screen tiers, 36 the in-card one. */
export function fabGlyphSize(size: number): number {
  if (size >= FAB_SIZE) return 28;
  return size >= 48 ? 24 : 20;
}

/**
 * The corner the button rests in, read from settings here so no caller has to
 * know about it — by the resting button, by the menu that opens off it, and by
 * FabMenu to place that menu's anchor. Everything handed lives in
 * `makeStyles` — mirroring the button is four declarations, because the drag it
 * supports is measured vertically and radially and so is already hand-blind:
 * `zoneAtY` compares a pageY against bands, `resolveFabDrop` splits a row at
 * its vertical midpoint, and `isOverFabHome` is a radius around wherever the
 * gesture began. None of fabDrop.ts knows which side it started from.
 */
function useFabHand(): FabHand {
  return useSettingsStore(s => s.fabHand);
}

interface FabButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  bottom: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  size: number;
  disabled?: boolean;
  /** Greys the circle out while disabled; the menu variant fades via `opacity` instead. */
  dimWhenDisabled?: boolean;
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
  drag?: FabDragHandlers;
  dragHint?: string;
  dragLabel?: string | null;
}

/**
 * The button itself: the circle, the corner it sits in, and — when `drag` is
 * supplied — the responder that lets it be pulled off that corner.
 *
 * Shared by both exports below so the resting look, the press feedback and the
 * drag gesture can't drift between the single-action and the menu variants.
 */
function FabButton({
  onPress, accessibilityLabel, bottom, icon, size, disabled, dimWhenDisabled, opacity,
  drag, dragHint, dragLabel,
}: FabButtonProps) {
  const colors = useColors();
  const { shadows } = useTheme();
  const hand = useFabHand();
  const styles = useMemo(() => makeStyles(colors, hand), [colors, hand]);

  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  // The well behind the button, faded in for the length of the drag.
  const wellOpacity = useRef(new Animated.Value(0)).current;
  // Whether a release right now would cancel. Unlike the position (Animated,
  // untouched by React) and unlike the drop target (a channel, see
  // FabDropZones), this is state: it flips at most a couple of times in a drag
  // — you have to leave a 44pt circle and come back — and it recolours a
  // shadow, which no animated driver can do. Nothing outside this leaf
  // re-renders for it.
  const [cancelArmed, setCancelArmed] = useState(false);
  // The button starts *on* its resting spot, so "back home" can't be armed
  // until the finger has taken it somewhere else first — otherwise every drag
  // opens armed for cancel, flashing the button red as it's picked up.
  const leftHomeRef = useRef(false);
  // Read from inside the responder, which is created once.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // When the finger went down, so a drag can require a hold before it claims
  // the gesture — set from `onStartShouldSetPanResponderCapture`, which fires
  // on every touch-down regardless of what it returns (it always returns
  // false here; the tap and the menu own touch-down). There's no
  // `onPanResponderGrant`-equivalent for touch-down alone, since grant only
  // fires once something has already claimed the responder.
  const touchStartRef = useRef(0);
  // Where the finger already was, in dx/dy, the moment the capture handler
  // decided to claim the gesture. RN's PanResponder zeroes `gestureState.dx/dy`
  // at grant (`onResponderGrant` re-centres `x0`/`y0` on the grant point), so
  // without this the button starts tracking from its own position rather than
  // the finger's: the delay-plus-threshold gate below means the finger is
  // already off the button by the time grant fires on a fast drag, and the
  // button trails behind it for the rest of the gesture instead of catching
  // up. Stashed here — the last place the pre-grant accumulated distance is
  // still visible — and added back on top of every post-grant dx/dy so the
  // button starts exactly under the finger.
  const grantOffsetRef = useRef({ x: 0, y: 0 });

  const panResponder = useMemo(() => {
    /**
     * Where the gesture stands relative to home, latching `leftHomeRef` on the
     * way. Takes the already offset-adjusted dx/dy (see `grantOffsetRef`) so
     * this agrees with where the button is actually drawn, not just the
     * post-grant delta.
     */
    const readHome = (dx: number, dy: number): FabHomeState => {
      const state = fabHomeState(dx, dy, leftHomeRef.current);
      if (state === 'outside') leftHomeRef.current = true;
      setCancelArmed(state === 'returned');
      return state;
    };
    const settle = () => {
      setCancelArmed(false);
      Animated.parallel([
        Animated.spring(dragX, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }),
        Animated.spring(dragY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }),
        Animated.timing(wellOpacity, {
          toValue: 0, duration: animation.duration.fast, useNativeDriver: true,
        }),
      ]).start();
    };
    return PanResponder.create({
      // Never claim the touch down — that's the tap's, and the menu's. Still
      // record when it happened, so a move shortly after can be told apart
      // from one after a genuine hold.
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => {
        touchStartRef.current = Date.now();
        return false;
      },
      // Capture rather than bubble, for the same reason ReorderableList does:
      // once the finger has committed to a drag the press underneath has to be
      // taken from it cleanly, not negotiated with. Gated on both distance
      // *and* hold time — mirroring `interaction.delayLongPress`, the same
      // token drag handles use elsewhere — so a fast flick-tap that happens to
      // wobble past the distance threshold still doesn't start a drag; only a
      // press held past the delay and then moved does.
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        const claim =
          !!dragRef.current &&
          Math.hypot(g.dx, g.dy) > interaction.tapMoveThreshold &&
          Date.now() - touchStartRef.current >= interaction.delayLongPress;
        // Last chance to read the pre-grant dx/dy before RN zeroes it.
        if (claim) grantOffsetRef.current = { x: g.dx, y: g.dy };
        return claim;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        leftHomeRef.current = false;
        setCancelArmed(false);
        // Jump the button under the finger immediately, rather than at 0 and
        // catching up over the next move events.
        dragX.setValue(grantOffsetRef.current.x);
        dragY.setValue(grantOffsetRef.current.y);
        Animated.timing(wellOpacity, {
          toValue: 1, duration: animation.duration.fast, useNativeDriver: true,
        }).start();
        haptics.impactLight();
        dragRef.current?.onStart();
      },
      onPanResponderMove: (e, g) => {
        const x = grantOffsetRef.current.x + g.dx;
        const y = grantOffsetRef.current.y + g.dy;
        dragX.setValue(x);
        dragY.setValue(y);
        dragRef.current?.onMove(e.nativeEvent.pageY, readHome(x, y));
      },
      onPanResponderRelease: (e, g) => {
        const x = grantOffsetRef.current.x + g.dx;
        const y = grantOffsetRef.current.y + g.dy;
        const home = readHome(x, y);
        // Settle — and so start the well's fade-out — before handing off to the
        // caller's onEnd, whose side effects (closing a menu, opening a sheet,
        // disabling the button) can re-render this component. Once the fade is
        // already running on the native driver a JS re-render can't interrupt
        // it; starting it *after* onEnd risked the re-render landing between
        // the animation being requested and it actually kicking off, which
        // left the well's ring stuck at whatever opacity it had.
        settle();
        dragRef.current?.onEnd(e.nativeEvent.pageY, home);
      },
      onPanResponderTerminate: () => {
        settle();
        dragRef.current?.onCancel();
      },
    });
  }, [dragX, dragY, wellOpacity]);

  const iconSize = fabGlyphSize(size);

  return (
    <Animated.View
      style={[styles.container, { bottom, opacity }]}
      pointerEvents={disabled ? 'none' : 'box-none'}
    >
      {/*
        The spot the button left, offered back as the way out of the drag.
        Rendered before the button so it sits under it — which is what makes
        bringing the button home cover it again, and why the button rather than
        the well is what turns red at that moment.
      */}
      {drag ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.well,
            cancelArmed && styles.wellArmed,
            {
              width: size + WELL_PADDING * 2,
              height: size + WELL_PADDING * 2,
              borderRadius: size / 2 + WELL_PADDING,
              bottom: -WELL_PADDING,
              opacity: wellOpacity,
            },
          ]}
        >
          <Ionicons
            name="close"
            size={iconSize}
            color={cancelArmed ? colors.red : colors.textTertiary}
          />
        </Animated.View>
      ) : null}
      <Animated.View
        style={[styles.dragRow, { transform: [{ translateX: dragX }, { translateY: dragY }] }]}
        {...(drag ? panResponder.panHandlers : {})}
      >
        {dragLabel ? (
          <View style={[styles.dragLabel, cancelArmed && styles.dragLabelCancel, shadows.fab]}>
            <Text style={styles.dragLabelText} numberOfLines={1}>{dragLabel}</Text>
          </View>
        ) : null}
        <PressableScale
          style={[
            fabCircle(colors, size),
            shadows.fab,
            // Over the well the button becomes the cancel button, so what's
            // under the finger says what the release does — the well itself is
            // hidden beneath it at exactly that moment.
            cancelArmed && fabCancelCircle(colors),
            disabled && dimWhenDisabled && styles.fabDisabled,
          ]}
          pressScale={0.9}
          disabled={disabled}
          onPress={onPress}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={drag ? dragHint : undefined}
        >
          <Ionicons
            name={cancelArmed ? 'close' : icon}
            size={iconSize}
            color={colors.onAccent}
          />
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

interface FabProps {
  onPress: () => void;
  /** Spoken label — these buttons are icon-only. */
  accessibilityLabel: string;
  /** Distance from the bottom of the screen; callers add their own tab bar / inset math. */
  bottom: number;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 48 for FABs inside detail screens, which sit closer to the content. */
  size?: number;
  disabled?: boolean;
  /** Lets the button be dragged into the list behind it. Omit for tap-only. */
  drag?: FabDragHandlers;
  /** Spoken explanation of what dragging does, e.g. "Drag onto the list to add a project there". */
  dragHint?: string;
  /** Names the drop target beside the button while dragging. */
  dragLabel?: string | null;
}

/**
 * The single-action floating button every list screen adds from.
 *
 * Adding lives in the same corner app-wide — Today, Projects, Templates,
 * Categories, Tags — rather than being a header "+" on some screens and a FAB
 * on others. The position, shadow, press scale and impact haptic all live here
 * so the copies can't drift. Screens with more than one thing to add use
 * FabMenu below, which accordions the same button open.
 */
export function Fab({
  onPress, accessibilityLabel, bottom, icon = 'add', size = FAB_SIZE, disabled,
  drag, dragHint, dragLabel,
}: FabProps) {
  return (
    <FabButton
      onPress={() => { haptics.impactLight(); onPress(); }}
      accessibilityLabel={accessibilityLabel}
      bottom={bottom}
      icon={icon}
      size={size}
      disabled={disabled}
      dimWhenDisabled
      drag={drag}
      dragHint={dragHint}
      dragLabel={dragLabel}
    />
  );
}

export interface FabMenuItem {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

/** Where an open menu hangs from, in screen coordinates. */
export interface FabMenuAnchor {
  bottom: number;
  left?: number;
  right?: number;
  /** Which way the pills grow — they're wider than the button. */
  alignItems: 'flex-start' | 'flex-end';
}

interface FabMenuOverlayProps {
  items: FabMenuItem[];
  visible: boolean;
  /** 0 closed, 1 open. Owned by the caller so it can drive the resting button too. */
  anim: Animated.Value;
  onSelect: (key: string) => void;
  onDismiss: () => void;
  anchor: FabMenuAnchor;
  size: number;
  /** Tighter pills for the in-card button, whose menu opens mid-sheet. */
  compact?: boolean;
}

/**
 * The opened menu — backdrop, staggered pills, and the close button the resting
 * FAB turns into.
 *
 * Split out so `MiniFab` can open the same menu from inside an editor card
 * without a second copy of the stagger, the spring or the dismiss-then-select
 * ordering (that ordering matters: `onSelect` runs in the close animation's
 * completion callback, so a sheet the selection opens isn't racing this Modal's
 * dismissal). Only the anchor differs — the screen version hangs off a corner,
 * the in-card one off wherever the button measured itself to be.
 */
export function FabMenuOverlay({
  items, visible, anim, onSelect, onDismiss, anchor, size, compact,
}: FabMenuOverlayProps) {
  const colors = useColors();
  const { shadows } = useTheme();
  const hand = useFabHand();
  const styles = useMemo(() => makeStyles(colors, hand), [colors, hand]);

  const gap = compact ? spacing.sm : spacing.md;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]} />
      </TouchableOpacity>
      <View
        style={[
          styles.menuContainer,
          { bottom: anchor.bottom, left: anchor.left, right: anchor.right, alignItems: anchor.alignItems },
        ]}
        pointerEvents="box-none"
      >
        {items.map((item, i) => {
          const translateY = anim.interpolate({
            inputRange: [0, 1],
            outputRange: [16 + (items.length - i) * 4, 0],
          });
          return (
            <Animated.View
              key={item.key}
              style={{
                opacity: anim,
                transform: [{ translateY }, { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
                marginBottom: gap,
              }}
            >
              <PressableScale
                style={[styles.menuItem, compact && styles.menuItemCompact, shadows.fab]}
                pressScale={0.95}
                onPress={() => onSelect(item.key)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Ionicons name={item.icon} size={compact ? 18 : 20} color={colors.onAccent} />
                <Text style={[styles.menuItemText, compact && styles.menuItemTextCompact]}>
                  {item.label}
                </Text>
              </PressableScale>
            </Animated.View>
          );
        })}
        <PressableScale
          style={[fabCircle(colors, size), shadows.fab]}
          pressScale={0.9}
          onPress={onDismiss}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={fabGlyphSize(size)} color={colors.onAccent} />
        </PressableScale>
      </View>
    </Modal>
  );
}

interface FabMenuProps {
  /** Rendered bottom-up: the last item ends up closest to the button, so put the most-used one there. */
  items: FabMenuItem[];
  onSelect: (key: string) => void;
  bottom: number;
  accessibilityLabel?: string;
  size?: number;
  disabled?: boolean;
  /** Fades the resting button (e.g. while a task is spotlighted). Ignored while the menu is open. */
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
  /** Omit to leave the button tap-only. */
  drag?: FabDragHandlers;
  /** Spoken explanation of what dragging does. */
  dragHint?: string;
  /** Names the current drop target beside the button while dragging, e.g. "New task in Work". */
  dragLabel?: string | null;
}

/**
 * A FAB that accordions out into labelled shortcuts — for screens with more
 * than one thing to add, where a single "+" would have to guess which one you
 * meant. Same resting button as `Fab`, so the corner behaves identically until
 * you tap it.
 *
 * With `drag` supplied it can also be pulled off its corner and dropped
 * somewhere. Tapping is unaffected: the responder is never claimed on
 * touch-down, only once the finger has travelled far enough to rule a tap out,
 * so a press still opens the menu exactly as before.
 */
export function FabMenu({
  items, onSelect, bottom, accessibilityLabel = 'Add', size = FAB_SIZE, disabled, opacity,
  drag, dragHint = 'Drag onto the list to add a task there, or back to the button to cancel',
  dragLabel,
}: FabMenuProps) {
  const hand = useFabHand();
  const [menuVisible, setMenuVisible] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const open = () => {
    haptics.impactLight();
    setMenuVisible(true);
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
  };

  const close = (onDismissed?: () => void) => {
    Animated.timing(anim, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true })
      .start(() => {
        setMenuVisible(false);
        onDismissed?.();
      });
  };

  const handleSelect = (key: string) => {
    haptics.tap();
    close(() => onSelect(key));
  };

  return (
    <>
      <FabButton
        onPress={open}
        accessibilityLabel={accessibilityLabel}
        bottom={bottom}
        icon="add"
        size={size}
        disabled={disabled}
        opacity={opacity}
        drag={drag}
        dragHint={dragHint}
        dragLabel={dragLabel}
      />

      <FabMenuOverlay
        items={items}
        visible={menuVisible}
        anim={anim}
        onSelect={handleSelect}
        onDismiss={() => close()}
        size={size}
        anchor={{
          bottom,
          left: hand === 'left' ? spacing.lg : undefined,
          right: hand === 'left' ? undefined : spacing.lg,
          alignItems: hand === 'left' ? 'flex-start' : 'flex-end',
        }}
      />
    </>
  );
}

const makeStyles = (colors: Colors, hand: FabHand) => StyleSheet.create({
  container: {
    position: 'absolute',
    // spacing.lg (24) rather than the spacing.md the cards use, and on the left
    // that inset is load-bearing: AppNavigator's drawer edge-swipe strip is a
    // 20pt-wide view at left: 0, rendered as a later sibling of the whole
    // NavigationContainer — so it wins any touch it receives regardless of this
    // container's zIndex. 24 clears it by 4pt. At spacing.md the button's left
    // sliver would open the side menu instead of starting a drag.
    left: hand === 'left' ? spacing.lg : undefined,
    right: hand === 'left' ? undefined : spacing.lg,
    zIndex: 20,
  },
  fabDisabled: {
    backgroundColor: colors.bgQuaternary,
    shadowColor: 'transparent',
  },
  backdrop: {
    backgroundColor: colors.backdrop,
  },
  // left/right/alignItems come from the caller's anchor — the pills are wider
  // than the button and grow away from whichever corner it sits in, and the
  // in-card button's corner is measured rather than known.
  menuContainer: {
    position: 'absolute',
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
  },
  // Scaled to the 36pt button the way the 52pt pill is scaled to the 56pt one.
  menuItemCompact: {
    paddingHorizontal: spacing.md, height: 40,
  },
  menuItemText: {
    color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold,
  },
  menuItemTextCompact: {
    fontSize: font.sm,
  },
  dragRow: {
    // Reversed on the left so the drop label still trails *into* the screen
    // rather than off the edge it's parked against — the label is up to 220pt
    // wide and the button is only 24pt from the frame.
    flexDirection: hand === 'left' ? 'row-reverse' : 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dragLabel: {
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    height: 32,
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
  },
  dragLabelText: {
    color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold,
  },
  dragLabelCancel: {
    backgroundColor: colors.red,
    shadowColor: colors.red,
  },
  well: {
    position: 'absolute',
    // Pinned to the same edge as the button, so the spot it left behind stays
    // under it — which is what makes bringing it home cover the well again.
    left: hand === 'left' ? -WELL_PADDING : undefined,
    right: hand === 'left' ? undefined : -WELL_PADDING,
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
});
