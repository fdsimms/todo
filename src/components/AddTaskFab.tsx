import React, { useMemo, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { PressableScale } from './PressableScale';

export type AddTaskType = 'chain' | 'stack' | 'recurring' | 'task';

const ITEMS: { type: AddTaskType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { type: 'chain', label: 'Chain', icon: 'link' },
  { type: 'stack', label: 'Stack', icon: 'layers' },
  { type: 'recurring', label: 'Recurring', icon: 'repeat' },
  { type: 'task', label: 'Task', icon: 'checkmark-circle' },
];

interface Props {
  /** Distance from the bottom of the screen — matches the resting FAB's position. */
  bottom: number;
  onSelect: (type: AddTaskType) => void;
  disabled?: boolean;
  /** Fades the resting FAB (e.g. while a task is spotlighted). Ignored while the menu is open. */
  opacity?: Animated.AnimatedInterpolation<number> | Animated.Value;
}

/** FAB that accordions out into Chain/Stack/Recurring/Task shortcuts, each of which opens the editor with that type preselected. */
export function AddTaskFab({ bottom, onSelect, disabled, opacity }: Props) {
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

  const handleSelect = (type: AddTaskType) => {
    haptics.tap();
    close(() => onSelect(type));
  };

  return (
    <>
      <Animated.View
        style={[styles.fabContainer, { bottom, opacity }]}
        pointerEvents={disabled ? 'none' : 'box-none'}
      >
        <PressableScale
          style={[styles.fab, shadows.fab]}
          pressScale={0.9}
          onPress={open}
          accessibilityLabel="Add"
        >
          <Ionicons name="add" size={28} color={colors.onAccent} />
        </PressableScale>
      </Animated.View>

      <Modal visible={menuVisible} transparent animationType="none" onRequestClose={() => close()}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => close()}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]} />
        </TouchableOpacity>
        <View style={[styles.menuContainer, { bottom }]} pointerEvents="box-none">
          {ITEMS.map((item, i) => {
            const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [16 + (ITEMS.length - i) * 4, 0] });
            return (
              <Animated.View
                key={item.type}
                style={{
                  opacity: anim,
                  transform: [{ translateY }, { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
                  marginBottom: spacing.md,
                }}
              >
                <PressableScale
                  style={[styles.menuItem, shadows.fab]}
                  pressScale={0.95}
                  onPress={() => handleSelect(item.type)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.label}`}
                >
                  <Ionicons name={item.icon} size={20} color={colors.onAccent} />
                  <Text style={styles.menuItemText}>{item.label}</Text>
                </PressableScale>
              </Animated.View>
            );
          })}
          <PressableScale
            style={[styles.fab, shadows.fab]}
            pressScale={0.9}
            onPress={() => close()}
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={28} color={colors.onAccent} />
          </PressableScale>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  fabContainer: {
    position: 'absolute', right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent,
  },
  backdrop: {
    backgroundColor: colors.backdrop,
  },
  menuContainer: {
    position: 'absolute', right: spacing.lg,
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
