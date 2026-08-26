import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  PanResponder,
  Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { SortOption, Priority, Effort } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, EFFORT_HINTS } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { SheetScrim } from './SheetScrim';

interface Props {
  visible: boolean;
  onClose: () => void;
  sort: SortOption;
  onSortChange: (s: SortOption) => void;
  priorities: Priority[];
  onPrioritiesChange: (p: Priority[]) => void;
  efforts: Effort[];
  onEffortsChange: (e: Effort[]) => void;
  hasReminder: boolean;
  onHasReminderChange: (on: boolean) => void;
  /**
   * Later, Unscheduled and Inbox share this sheet with Today (#1798), but only
   * the reminder filter reaches those three views — sort and priority/effort
   * stay Today-only (see TodayScreen's filteredDeferredTasks and friends).
   * Hides the sections that wouldn't do anything there, rather than showing
   * controls that silently have no effect.
   */
  remindersOnly?: boolean;
}

const SORT_OPTIONS: { value: SortOption; label: string; icon: string }[] = [
  { value: 'default', label: 'My order', icon: 'list' },
  { value: 'priority', label: 'Urgency first', icon: 'arrow-up-circle' },
  { value: 'effort-asc', label: 'Quick wins first', icon: 'barbell' },
  { value: 'effort-desc', label: 'Big tasks first', icon: 'barbell' },
  { value: 'due-date', label: 'Due soonest', icon: 'calendar' },
  { value: 'streak', label: 'Hottest streak', icon: 'flame' },
];

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

export function SortFilterSheet({
  visible, onClose, sort, onSortChange, priorities, onPrioritiesChange, efforts, onEffortsChange,
  hasReminder, onHasReminderChange, remindersOnly = false,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(hiddenY);
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

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: hiddenY,
        ...animation.spring.sheetDismiss,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 10,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 60 || vy > 1) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            ...animation.spring.snappy,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const activeCount = remindersOnly
    ? (hasReminder ? 1 : 0)
    : (sort !== 'default' ? 1 : 0) + priorities.length + efforts.length + (hasReminder ? 1 : 0);

  const reset = () => {
    if (!remindersOnly) {
      onSortChange('default');
      onPrioritiesChange([]);
      onEffortsChange([]);
    }
    onHasReminderChange(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: backdropOpacity }]}>
          <SheetScrim onPress={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{remindersOnly ? 'Filter' : 'Sort & Filter'}</Text>
            <View style={styles.headerRight}>
              {activeCount > 0 && (
                <TouchableOpacity onPress={reset} style={styles.resetBtn}>
                  <Text style={styles.resetText}>Clear all ({activeCount})</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {!remindersOnly && (
              <>
                {/* Sort */}
                <Text style={styles.groupLabel}>Sort by</Text>
                {SORT_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.sortRow, sort === opt.value && styles.sortRowActive]}
                    onPress={() => {
                      haptics.tap();
                      onSortChange(opt.value);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Ionicons
                      name={opt.icon as never}
                      size={18}
                      color={sort === opt.value ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.sortLabel, sort === opt.value && styles.sortLabelActive]}>
                      {opt.label}
                    </Text>
                    {sort === opt.value && (
                      <Ionicons name="checkmark" size={16} color={colors.accent} />
                    )}
                  </TouchableOpacity>
                ))}

                {/* Priority filter */}
                <Text style={[styles.groupLabel, { marginTop: spacing.lg }]}>Filter by priority</Text>
                <View style={styles.chips}>
                  {([1, 2, 3, 4] as Priority[]).map(p => {
                    const active = priorities.includes(p);
                    return (
                      <TouchableOpacity
                        key={p}
                        style={[
                          styles.chip,
                          active && { backgroundColor: PRIORITY_COLORS[p] },
                        ]}
                        onPress={() => {
                          haptics.tap();
                          onPrioritiesChange(toggle(priorities, p));
                        }}
                      >
                        {!active && (
                          <View style={[styles.chipDot, { backgroundColor: PRIORITY_COLORS[p] }]} />
                        )}
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {PRIORITY_LABELS[p]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Effort filter */}
                <Text style={[styles.groupLabel, { marginTop: spacing.lg }]}>Filter by effort</Text>
                <View style={styles.chips}>
                  {([1, 2, 3, 4, 5, 6] as Effort[]).map(e => {
                    const active = efforts.includes(e);
                    return (
                      <TouchableOpacity
                        key={e}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => {
                          haptics.tap();
                          onEffortsChange(toggle(efforts, e));
                        }}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {EFFORT_LABELS[e]}
                        </Text>
                        <Text style={[styles.chipHint, active && styles.chipHintActive]}>
                          {EFFORT_HINTS[e]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Reminder filter */}
            <Text style={[styles.groupLabel, { marginTop: spacing.lg }]}>Filter by reminder</Text>
            <View style={styles.chips}>
              <TouchableOpacity
                style={[styles.chip, hasReminder && styles.chipActive]}
                onPress={() => {
                  haptics.tap();
                  onHasReminderChange(!hasReminder);
                }}
                accessibilityRole="button"
                accessibilityLabel="Has reminder set"
                accessibilityState={{ selected: hasReminder }}
              >
                <Text style={[styles.chipText, hasReminder && styles.chipTextActive]}>
                  Has reminder set
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  handleArea: {
    paddingVertical: spacing.md, alignItems: 'center',
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resetBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
  },
  resetText: { color: colors.accent, fontSize: font.sm },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 12, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, marginBottom: 2,
  },
  sortRowActive: { backgroundColor: colors.bgTertiary },
  sortLabel: { flex: 1, color: colors.textSecondary, fontSize: font.md },
  sortLabelActive: { color: colors.text, fontWeight: fontWeight.medium },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center', gap: 2,
  },
  chipActive: { backgroundColor: colors.accent },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  chipHint: { color: colors.textTertiary, fontSize: 10 },
  chipHintActive: { color: colors.onAccent + 'aa' },
});
