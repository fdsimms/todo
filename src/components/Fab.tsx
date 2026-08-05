import React, { useMemo, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

/** Diameter of the standard list-screen FAB — also the room a list must leave below its last row. */
export const FAB_SIZE = 56;

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
export function Fab({ onPress, accessibilityLabel, bottom, icon = 'add', size = FAB_SIZE, disabled }: FabProps) {
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.container, { bottom }]} pointerEvents="box-none">
      <PressableScale
        style={[
          styles.fab,
          { width: size, height: size, borderRadius: size / 2 },
          shadows.fab,
          disabled && styles.fabDisabled,
        ]}
        pressScale={0.9}
        disabled={disabled}
        onPress={() => { haptics.impactLight(); onPress(); }}
        accessibilityLabel={accessibilityLabel}
      >
        <Ionicons name={icon} size={size >= FAB_SIZE ? 28 : 24} color={colors.onAccent} />
      </PressableScale>
    </View>
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
}

/**
 * A FAB that accordions out into labelled shortcuts — for screens with more
 * than one thing to add, where a single "+" would have to guess which one you
 * meant. Same resting button as `Fab`, so the corner behaves identically until
 * you tap it.
 */
export function FabMenu({
  items, onSelect, bottom, accessibilityLabel = 'Add', size = FAB_SIZE, disabled, opacity,
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
      <Animated.View
        style={[styles.container, { bottom, opacity }]}
        pointerEvents={disabled ? 'none' : 'box-none'}
      >
        <PressableScale style={circle} pressScale={0.9} onPress={open} accessibilityLabel={accessibilityLabel}>
          <Ionicons name="add" size={size >= FAB_SIZE ? 28 : 24} color={colors.onAccent} />
        </PressableScale>
      </Animated.View>

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
});
