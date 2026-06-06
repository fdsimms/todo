import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SortOption, Priority, Effort } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, EFFORT_HINTS } from '../types';
import { colors, spacing, radius, font } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  sort: SortOption;
  onSortChange: (s: SortOption) => void;
  priorities: Priority[];
  onPrioritiesChange: (p: Priority[]) => void;
  efforts: Effort[];
  onEffortsChange: (e: Effort[]) => void;
}

const SORT_OPTIONS: { value: SortOption; label: string; icon: string }[] = [
  { value: 'default', label: 'My order', icon: 'list' },
  { value: 'priority', label: 'Urgency first', icon: 'alert-circle' },
  { value: 'effort-asc', label: 'Quick wins first', icon: 'flash' },
  { value: 'effort-desc', label: 'Big tasks first', icon: 'barbell' },
  { value: 'due-date', label: 'Due soonest', icon: 'calendar' },
  { value: 'streak', label: 'Hottest streak', icon: 'flame' },
];

function toggle<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

export function SortFilterSheet({
  visible, onClose, sort, onSortChange, priorities, onPrioritiesChange, efforts, onEffortsChange,
}: Props) {
  const activeCount =
    (sort !== 'default' ? 1 : 0) + priorities.length + efforts.length;

  const reset = () => {
    onSortChange('default');
    onPrioritiesChange([]);
    onEffortsChange([]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Sort & Filter</Text>
          <View style={styles.headerRight}>
            {activeCount > 0 && (
              <TouchableOpacity onPress={reset} style={styles.resetBtn}>
                <Text style={styles.resetText}>Clear all ({activeCount})</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Sort */}
          <Text style={styles.groupLabel}>Sort by</Text>
          {SORT_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.sortRow, sort === opt.value && styles.sortRowActive]}
              onPress={() => onSortChange(opt.value)}
              activeOpacity={0.7}
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
                  onPress={() => onPrioritiesChange(toggle(priorities, p))}
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
            {([1, 2, 3, 4, 5] as Effort[]).map(e => {
              const active = efforts.includes(e);
              return (
                <TouchableOpacity
                  key={e}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => onEffortsChange(toggle(efforts, e))}
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
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.bgQuaternary, alignSelf: 'center',
    marginTop: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resetBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
  },
  resetText: { color: colors.accent, fontSize: font.sm },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  groupLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  sortRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 11, paddingHorizontal: spacing.sm,
    borderRadius: radius.sm, marginBottom: 2,
  },
  sortRowActive: { backgroundColor: colors.bgTertiary },
  sortLabel: { flex: 1, color: colors.textSecondary, fontSize: font.md },
  sortLabelActive: { color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center', gap: 2,
  },
  chipActive: { backgroundColor: colors.accent },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  chipTextActive: { color: colors.text, fontWeight: '600' },
  chipHint: { color: colors.textTertiary, fontSize: 10 },
  chipHintActive: { color: colors.text + 'aa' },
});
