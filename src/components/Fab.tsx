import React, { useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { fabHomeState, type FabHomeState } from '../utils/fabDrop';

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
const WELL_PADDING = 8;

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
  const styles = useMemo(() => makeStyles(colors), [colors]);

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

  const panResponder = useMemo(() => {
    /** Where the gesture stands relative to home, latching `leftHomeRef` on the way. */
    const readHome = (g: { dx: number; dy: number }): FabHomeState => {
      const state = fabHomeState(g.dx, g.dy, leftHomeRef.current);
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
      // Never claim the touch down — that's the tap's, and the menu's.
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      // Capture rather than bubble, for the same reason ReorderableList does:
      // once the finger has committed to a drag the press underneath has to be
      // taken from it cleanly, not negotiated with.
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        !!dragRef.current && Math.hypot(g.dx, g.dy) > interaction.tapMoveThreshold,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        leftHomeRef.current = false;
        setCancelArmed(false);
        Animated.timing(wellOpacity, {
          toValue: 1, duration: animation.duration.fast, useNativeDriver: true,
        }).start();
        haptics.impactLight();
        dragRef.current?.onStart();
      },
      onPanResponderMove: (e, g) => {
        dragX.setValue(g.dx);
        dragY.setValue(g.dy);
        dragRef.current?.onMove(e.nativeEvent.pageY, readHome(g));
      },
      onPanResponderRelease: (e, g) => {
        dragRef.current?.onEnd(e.nativeEvent.pageY, readHome(g));
        settle();
      },
      onPanResponderTerminate: () => {
        dragRef.current?.onCancel();
        settle();
      },
    });
  }, [dragX, dragY, wellOpacity]);

  const iconSize = size >= FAB_SIZE ? 28 : 24;

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
              right: -WELL_PADDING,
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
            styles.fab,
            { width: size, height: size, borderRadius: size / 2 },
            shadows.fab,
            // Over the well the button becomes the cancel button, so what's
            // under the finger says what the release does — the well itself is
            // hidden beneath it at exactly that moment.
            cancelArmed && styles.fabCancel,
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
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [menuVisible, setMenuVisible] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const circle = [styles.fab, { width: size, height: size, borderRadius: size / 2 }, shadows.fab];

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

      <Modal visible={menuVisible} transparent animationType="none" onRequestClose={() => close()}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => close()}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]} />
        </TouchableOpacity>
        <View style={[styles.menuContainer, { bottom }]} pointerEvents="box-none">
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
                  marginBottom: spacing.md,
                }}
              >
                <PressableScale
                  style={[styles.menuItem, shadows.fab]}
                  pressScale={0.95}
                  onPress={() => handleSelect(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <Ionicons name={item.icon} size={20} color={colors.onAccent} />
                  <Text style={styles.menuItemText}>{item.label}</Text>
                </PressableScale>
              </Animated.View>
            );
          })}
          <PressableScale style={circle} pressScale={0.9} onPress={() => close()} accessibilityLabel="Close">
            <Ionicons name="close" size={size >= FAB_SIZE ? 28 : 24} color={colors.onAccent} />
          </PressableScale>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
  },
  fabDisabled: {
    backgroundColor: colors.bgQuaternary,
    shadowColor: 'transparent',
  },
  backdrop: {
    backgroundColor: colors.backdrop,
  },
  menuContainer: {
    position: 'absolute',
    right: spacing.lg,
    alignItems: 'flex-end',
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
  },
  menuItemText: {
    color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold,
  },
  dragRow: {
    flexDirection: 'row',
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
  // Recolours the glow with the circle — shadowColor is the reason this is a
  // style swap and not an animated overlay, since a red face over an accent
  // halo reads as the wrong button lit from behind by the right one.
  fabCancel: {
    backgroundColor: colors.red,
    shadowColor: colors.red,
  },
});
