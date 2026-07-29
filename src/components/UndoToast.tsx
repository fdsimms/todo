import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { useTheme } from '../theme/ThemeContext';
import { animation, font, fontWeight, radius, spacing } from '../theme';
import { haptics } from '../utils/haptics';

const VISIBLE_MS = 4000;

export function UndoToast() {
  const lastAction = useTaskStore(s => s.lastAction);
  const undoLastAction = useTaskStore(s => s.undoLastAction);
  const setLastAction = useTaskStore(s => s.setLastAction);
  const { colors, shadows } = useTheme();

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 16,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setLastAction(null));
  };

  useEffect(() => {
    if (!lastAction) return;

    if (timer.current) clearTimeout(timer.current);

    translateY.setValue(16);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }),
    ]).start();

    timer.current = setTimeout(dismiss, VISIBLE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAction]);

  if (!lastAction) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        shadows.sheet,
        { opacity, transform: [{ translateY }], backgroundColor: colors.bgSecondary },
      ]}
      pointerEvents="box-none"
    >
      <Ionicons name="checkmark-circle" size={16} color={colors.green} />
      <Text style={[styles.label, { color: colors.text }]}>{lastAction.label}</Text>
      <TouchableOpacity
        onPress={() => {
          haptics.tap();
          undoLastAction();
          dismiss();
        }}
        hitSlop={8}
        style={[styles.undoBtn, { borderColor: colors.accent }]}
      >
        <Text style={[styles.undoBtnText, { color: colors.accent }]}>Undo</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  label: {
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  undoBtn: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  undoBtnText: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
});
