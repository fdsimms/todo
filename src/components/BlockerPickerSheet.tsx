import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { fuzzySearch } from '../utils/fuzzySearch';
import { wouldCycle, resolverFor } from '../utils/blocking';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The task being edited — excluded from the list, along with anything that would loop back to it. */
  taskId: string | null;
  onSelect: (blockerId: string) => void;
}

/** Enough to scan, few enough to render without virtualizing. Search reaches the rest. */
const MAX_ROWS = 40;

/**
 * Picks the task that another task is waiting on (see Task.blockedById).
 *
 * The list is filtered by wouldCycle, not just by id: a loop makes every task
 * in it permanently invisible, since each is waiting on something that can
 * never complete. Filtering here is what stops one being made in the first
 * place — and it's why "waiting on" can't be offered as a free-text field.
 */
export function BlockerPickerSheet({ visible, onClose, taskId, onSelect }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const tasks = useTaskStore(useShallow(s => s.tasks));
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => {
    const resolve = resolverFor(tasks);
    const eligible = tasks.filter(t =>
      !t.parentId &&
      !t.completed &&
      !t.archived &&
      t.id !== taskId &&
      // A completed blocker wouldn't hold anything back, and a loop would hide
      // both ends of it forever.
      !(taskId && wouldCycle(taskId, t.id, resolve))
    );
    if (!query.trim()) {
      return eligible.slice(0, MAX_ROWS);
    }
    const ids = new Set(eligible.map(t => t.id));
    return fuzzySearch(eligible, query)
      .filter(r => ids.has(r.task.id))
      .slice(0, MAX_ROWS)
      .map(r => r.task);
  }, [tasks, taskId, query]);

  const translateY = useRef(new Animated.Value(600)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setQuery('');
      translateY.setValue(600);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          ...animation.spring.smooth,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 700,
        damping: 28,
        stiffness: 320,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      translateY.setValue(600);
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            damping: 22,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleSelect = (task: Task) => {
    haptics.tap();
    dismiss(() => onSelect(task.id));
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>Waiting on</Text>
          <Text style={styles.sheetHint}>
            This task stays out of your lists until the one you pick is done.
          </Text>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search tasks"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>

          {candidates.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="hourglass-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{query.trim() ? 'No matches' : 'Nothing to wait on'}</Text>
              <Text style={styles.emptySub}>
                {query.trim()
                  ? 'No open task matches that.'
                  : 'Tasks that would end up waiting on each other are left out.'}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.list} bounces={false} keyboardShouldPersistTaps="handled">
              {candidates.map((task, idx) => (
                <React.Fragment key={task.id}>
                  {idx > 0 && <View style={styles.inlineSep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => handleSelect(task)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Wait on ${task.title}`}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.accent + '22' }]}>
                      <Ionicons name="checkbox-outline" size={16} color={colors.accent} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName} numberOfLines={1}>{task.title}</Text>
                      {!!task.category && <Text style={styles.rowHint}>{task.category}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </ScrollView>
          )}
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: {
    backgroundColor: colors.backdrop,
  },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sheetHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingTop: 2,
    paddingBottom: spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 8,
  },
  list: {
    maxHeight: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: '500' },
  rowHint: { color: colors.textTertiary, fontSize: font.xs },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  emptySub: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
