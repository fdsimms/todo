import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing } from '../theme';

const VISIBLE_MS = 4000;

export function UndoToast() {
  const lastEditSnapshot = useTaskStore(s => s.lastEditSnapshot);
  const undoTaskEdit = useTaskStore(s => s.undoTaskEdit);
  const setLastEditSnapshot = useTaskStore(s => s.setLastEditSnapshot);
  const colors = useColors();

  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setLastEditSnapshot(null));
  };

  useEffect(() => {
    if (!lastEditSnapshot) return;

    if (timer.current) clearTimeout(timer.current);

    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    timer.current = setTimeout(dismiss, VISIBLE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEditSnapshot]);

  if (!lastEditSnapshot) return null;

  return (
    <Animated.View
      style={[styles.container, { opacity, backgroundColor: colors.bgSecondary }]}
      pointerEvents="box-none"
    >
      <Ionicons name="checkmark-circle" size={16} color={colors.green} />
      <Text style={[styles.label, { color: colors.text }]}>Edit saved</Text>
      <TouchableOpacity
        onPress={() => {
          undoTaskEdit();
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  label: {
    fontSize: font.sm,
    fontWeight: '500',
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
    fontWeight: '600',
  },
});
