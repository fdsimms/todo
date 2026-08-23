import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { SegmentedControl } from '../components/SegmentedControl';
import { CategoryPickerList } from '../components/CategoryPicker';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor } from '../utils/visibilityUtils';
import { formatDuration, EFFORT_MINUTES } from '../utils/effort';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import {
  BACKFILL_FIELDS, backfillCandidates, backfillFieldCounts, estimatePatchFor,
  type BackfillFieldId,
} from '../utils/fieldBackfill';
import { EFFORT_LABELS, type Effort, type Task } from '../types';

const FIELD_ICONS: Record<BackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  estimate: 'time-outline',
  priority: 'flag-outline',
  category: 'folder-outline',
};

// Bucket 0 ("—") is left off — see estimatePatchFor's doc comment for why.
const ESTIMATE_OPTIONS = [1, 2, 3, 4, 5, 6] as Effort[];
// None is the field's own "missing" value here, so offering it would be a
// tap that visibly does nothing — see the note on SegmentedControl's
// no-op-on-reselect behavior.
const PRIORITY_OPTIONS = PRIORITY_SEGMENTS.filter(s => s.value !== 0);

/**
 * Walk the tasks missing one field — time estimate, priority, category — and
 * fill it in one at a time: pick a value, the next task with the same gap
 * takes its place immediately. No swiping; a tap commits the value (writing
 * straight through `updateTask`, same as the task editor) and advances,
 * which is the fast, low-friction loop the field-by-field flow is for.
 *
 * The queue is *live*, not a snapshot: it's `backfillCandidates` recomputed
 * off the current task list every render, filtered against `skippedIds` for
 * tasks left for later this session. That's what lets a plain "current task
 * is the front of the queue" model work with no index to keep in sync — once
 * a task's field is set it drops out on its own.
 */
export function BackfillScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const tasks = useTaskStore(useShallow(s => s.tasks));
  const updateTask = useTaskStore(s => s.updateTask);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);

  const [activeField, setActiveField] = useState<BackfillFieldId | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [sessionTotal, setSessionTotal] = useState(0);

  const counts = useMemo(() => backfillFieldCounts(tasks), [tasks]);

  const queue = useMemo(
    () => activeField ? backfillCandidates(tasks, activeField).filter(t => !skippedIds.has(t.id)) : [],
    [tasks, activeField, skippedIds]
  );
  const current = queue[0] ?? null;

  const chooseField = (id: BackfillFieldId) => {
    haptics.tap();
    setActiveField(id);
    setSkippedIds(new Set());
    setSessionTotal(backfillCandidates(tasks, id).length);
  };

  const backToFields = () => {
    haptics.tap();
    setActiveField(null);
  };

  const apply = (patch: Partial<Task>) => {
    if (!current) return;
    haptics.tap();
    animateLayout();
    updateTask(current.id, patch);
  };

  const skip = () => {
    if (!current) return;
    haptics.tap();
    animateLayout();
    setSkippedIds(prev => new Set(prev).add(current.id));
  };

  if (!activeField) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Backfill" subtitle="Choose a field to fill in, one task at a time" />
        <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
          {BACKFILL_FIELDS.map(field => {
            const count = counts[field.id];
            return (
              <TouchableOpacity
                key={field.id}
                style={[styles.fieldRow, shadows.card]}
                onPress={() => chooseField(field.id)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${field.label}, ${count === 0 ? 'every task already has one' : `${count} ${count === 1 ? 'task needs' : 'tasks need'} one`}`}
              >
                <View style={styles.fieldIcon}>
                  <Ionicons name={FIELD_ICONS[field.id]} size={iconSize.md} color={colors.accent} />
                </View>
                <View style={styles.fieldBody}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <Text style={styles.fieldHint}>{field.hint}</Text>
                  <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>
                    {count === 0 ? 'Every task already has one' : `${count} ${count === 1 ? 'task needs' : 'tasks need'} one`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  const field = BACKFILL_FIELDS.find(f => f.id === activeField)!;
  const doneCount = Math.max(0, sessionTotal - queue.length);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title={field.label}
        subtitle={sessionTotal > 0 ? `${doneCount} of ${sessionTotal} done` : undefined}
        actions={[
          { icon: 'list-outline', onPress: backToFields, accessibilityLabel: 'Choose a different field' },
        ]}
      />

      {current ? (
        <ScrollView
          contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.taskCard, shadows.card]}>
            <Text style={styles.taskTitle} numberOfLines={3}>{displayTitleFor(current)}</Text>
            {!!current.notes.trim() && (
              <Text style={styles.taskNotes} numberOfLines={2}>{current.notes.trim()}</Text>
            )}
            {current.category && (
              <View style={styles.categoryChip}>
                <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textSecondary} />
                <Text style={styles.categoryChipText} numberOfLines={1}>
                  {categoryLabel(current.category, getCategoryByName)}
                </Text>
              </View>
            )}
          </View>

          <FieldControl
            field={activeField}
            colors={colors}
            styles={styles}
            onEstimate={e => apply(estimatePatchFor(e))}
            onPriority={p => apply({ priority: p })}
            onCategory={name => apply({ category: name })}
          />

          <PressableScale style={styles.skipButton} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip this task for now">
            <Text style={styles.skipText}>Skip for now</Text>
          </PressableScale>
        </ScrollView>
      ) : (
        <EmptyState
          icon="checkmark-circle-outline"
          title="All caught up"
          subtitle={`Every task has a ${field.label.toLowerCase()} now. Pick another field to keep going.`}
          actionLabel="Choose another field"
          onAction={backToFields}
          bottomOffset={tabBarHeight}
        />
      )}
    </View>
  );
}

function categoryLabel(
  category: string,
  getCategoryByName: (name: string) => { emoji?: string | null } | undefined | null,
): string {
  const emoji = getCategoryByName(category)?.emoji;
  return emoji ? `${emoji} ${category}` : category;
}

interface FieldControlProps {
  field: BackfillFieldId;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onEstimate: (effort: Effort) => void;
  onPriority: (priority: (typeof PRIORITY_SEGMENTS)[number]['value']) => void;
  onCategory: (name: string | null) => void;
}

function FieldControl({ field, colors, styles, onEstimate, onPriority, onCategory }: FieldControlProps) {
  if (field === 'estimate') {
    return (
      <View style={styles.pillRow}>
        {ESTIMATE_OPTIONS.map(e => {
          const mins = EFFORT_MINUTES[e];
          return (
            <PressableScale
              key={e}
              style={styles.pill}
              onPress={() => onEstimate(e)}
              accessibilityRole="button"
              accessibilityLabel={`${EFFORT_LABELS[e]}${mins != null ? `, about ${formatDuration(mins)}` : ''}`}
            >
              <Text style={styles.pillText}>{EFFORT_LABELS[e]}</Text>
              {mins != null && <Text style={styles.pillHint}>{formatDuration(mins)}</Text>}
            </PressableScale>
          );
        })}
      </View>
    );
  }

  if (field === 'priority') {
    return (
      <SegmentedControl
        label="Priority"
        value={0}
        onChange={onPriority}
        columns={2}
        options={PRIORITY_OPTIONS}
      />
    );
  }

  return (
    <View style={[styles.categoryCard, { backgroundColor: colors.bgSecondary }]}>
      <CategoryPickerList value={null} onSelect={onCategory} showNone={false} maxHeight={360} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  fieldList: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  fieldIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fieldBody: { flex: 1, minWidth: 0, gap: 2 },
  fieldLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  fieldHint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: lineHeight.xs },
  fieldCount: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
  fieldCountDone: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },

  reviewContent: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.lg },
  taskCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    gap: spacing.xs,
  },
  taskTitle: { color: colors.text, fontSize: font.lg, lineHeight: lineHeight.lg, fontWeight: fontWeight.semibold },
  taskNotes: { color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  categoryChipText: { color: colors.textSecondary, fontSize: font.xs },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    minWidth: 68,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  pillText: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  pillHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },

  categoryCard: { borderRadius: radius.md, padding: spacing.sm },

  skipButton: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  skipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.regular },
});
