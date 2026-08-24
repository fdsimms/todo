import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { format } from 'date-fns/format';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { SegmentedControl } from '../components/SegmentedControl';
import { CategoryPickerList } from '../components/CategoryPicker';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from '../components/NumberPadAccessory';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { displayTitleFor } from '../utils/visibilityUtils';
import { describeTaskRecurrence } from '../utils/recurrenceLabels';
import { formatDuration, EFFORT_MINUTES, minutesToEffort } from '../utils/effort';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import {
  BACKFILL_FIELDS, backfillCandidates, backfillFieldCounts, estimatePatchFor, dismissBackfillField,
  type BackfillFieldId,
} from '../utils/fieldBackfill';
import {
  CATEGORY_BACKFILL_FIELDS, categoryBackfillCandidates, categoryBackfillFieldCounts, dismissCategoryBackfillField,
  type CategoryBackfillFieldId,
} from '../utils/categoryBackfill';
import { EFFORT_LABELS, type Effort, type Task } from '../types';

const FIELD_ICONS: Record<BackfillFieldId, keyof typeof Ionicons.glyphMap> = {
  estimate: 'time-outline',
  priority: 'flag-outline',
  category: 'folder-outline',
  streak: 'flame-outline',
  vacation: 'airplane-outline',
};

// Filled counterparts of the row icons above, for the per-card CTA button —
// same outline/filled split the task fields use (flame-outline in the list,
// flame on the button).
const CATEGORY_FIELD_ICONS: Record<CategoryBackfillFieldId, { row: keyof typeof Ionicons.glyphMap; button: keyof typeof Ionicons.glyphMap }> = {
  vacation: { row: 'airplane-outline', button: 'airplane' },
  suggestions: { row: 'color-wand-outline', button: 'color-wand' },
  newBanner: { row: 'notifications-off-outline', button: 'notifications-off' },
};

type EntityKind = 'task' | 'category';
const ENTITY_KIND_SEGMENTS = [
  { value: 'task' as const, label: 'Tasks' },
  { value: 'category' as const, label: 'Categories' },
];

// Bucket 0 ("—") is left off — see estimatePatchFor's doc comment for why.
const ESTIMATE_OPTIONS = [1, 2, 3, 4, 5, 6] as Effort[];
// None is the field's own "missing" value here, so offering it would be a
// tap that visibly does nothing — see the note on SegmentedControl's
// no-op-on-reselect behavior.
const PRIORITY_OPTIONS = PRIORITY_SEGMENTS.filter(s => s.value !== 0);

/** The unit beside the custom-estimate number — same pair TaskEditor's own Effort field offers. */
const DURATION_UNIT_SEGMENTS = [
  { value: 'min' as const, label: 'min' },
  { value: 'hr' as const, label: 'hr' },
];

/**
 * Walk the tasks or categories missing one field — time estimate, priority,
 * category, streak chip, vacation pause on the task side; hide-on-vacation,
 * skip-in-suggestions, skip-in-new-banner on the category side — and fill it
 * in one at a time: pick a value, the next item with the same gap takes its
 * place immediately. No swiping; a tap commits the value (writing straight
 * through `updateTask`/the category store, same as their own editors) and
 * advances, which is the fast, low-friction loop the field-by-field flow is
 * for. The `Tasks`/`Categories` segmented control on the field-picker step
 * chooses which pool `active` (and everything downstream) reads from.
 *
 * The queue is *live*, not a snapshot: it's `backfillCandidates`/
 * `categoryBackfillCandidates` recomputed off the current list every render,
 * filtered against `skippedIds` for items left for later this session.
 * That's what lets a plain "current item is the front of the queue" model
 * work with no index to keep in sync — once an item's field is set it drops
 * out on its own. Tasks and categories both carry a plain `id`, so the same
 * `skippedIds` set works for either without knowing which kind is active.
 */
type ActiveField =
  | { kind: 'task'; id: BackfillFieldId }
  | { kind: 'category'; id: CategoryBackfillFieldId };

export function BackfillScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const tasks = useTaskStore(useShallow(s => s.tasks));
  const updateTask = useTaskStore(s => s.updateTask);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const setCategoryHideOnVacation = useCategoryStore(s => s.setCategoryHideOnVacation);
  const setCategoryExcludeFromSuggestions = useCategoryStore(s => s.setCategoryExcludeFromSuggestions);
  const setCategoryExcludeFromNewTasksBanner = useCategoryStore(s => s.setCategoryExcludeFromNewTasksBanner);
  const setCategoryBackfillDismissedFields = useCategoryStore(s => s.setCategoryBackfillDismissedFields);
  const projects = useProjectStore(useShallow(s => s.projects));
  const projectNamesById = useMemo(() => new Map(projects.map(p => [p.id, p.title])), [projects]);

  const [entityKind, setEntityKind] = useState<EntityKind>('task');
  const [active, setActive] = useState<ActiveField | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [sessionTotal, setSessionTotal] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customUnit, setCustomUnit] = useState<'min' | 'hr'>('min');

  const taskCounts = useMemo(() => backfillFieldCounts(tasks), [tasks]);
  const categoryCounts = useMemo(() => categoryBackfillFieldCounts(categories), [categories]);

  const taskQueue = useMemo(
    () => active?.kind === 'task' ? backfillCandidates(tasks, active.id).filter(t => !skippedIds.has(t.id)) : [],
    [tasks, active, skippedIds]
  );
  const categoryQueue = useMemo(
    () => active?.kind === 'category' ? categoryBackfillCandidates(categories, active.id).filter(c => !skippedIds.has(c.id)) : [],
    [categories, active, skippedIds]
  );
  const currentTask = active?.kind === 'task' ? (taskQueue[0] ?? null) : null;
  const currentCategory = active?.kind === 'category' ? (categoryQueue[0] ?? null) : null;
  const queueLength = active?.kind === 'task' ? taskQueue.length : categoryQueue.length;
  const currentId = currentTask?.id ?? currentCategory?.id ?? null;

  // The custom-estimate entry is per-card: once the card advances (a value
  // was applied, or the item was skipped), a half-typed number from the
  // previous card has no business surviving onto this one.
  useEffect(() => {
    setCustomOpen(false);
    setCustomText('');
    setCustomUnit('min');
  }, [currentId]);

  const chooseTaskField = (id: BackfillFieldId) => {
    haptics.tap();
    setActive({ kind: 'task', id });
    setSkippedIds(new Set());
    setSessionTotal(backfillCandidates(tasks, id).length);
  };

  const chooseCategoryField = (id: CategoryBackfillFieldId) => {
    haptics.tap();
    setActive({ kind: 'category', id });
    setSkippedIds(new Set());
    setSessionTotal(categoryBackfillCandidates(categories, id).length);
  };

  const backToFields = () => {
    haptics.tap();
    setActive(null);
  };

  const apply = (patch: Partial<Task>) => {
    if (!currentTask) return;
    haptics.tap();
    animateLayout();
    updateTask(currentTask.id, patch);
  };

  // The category store has no generic "patch a category" setter (see
  // useCategoryStore) — each field already owns a dedicated one, matching
  // how CategoryEditor itself writes them, so this just dispatches to it.
  const applyCategory = () => {
    if (!currentCategory || active?.kind !== 'category') return;
    haptics.tap();
    animateLayout();
    switch (active.id) {
      case 'vacation': setCategoryHideOnVacation(currentCategory.name, true); break;
      case 'suggestions': setCategoryExcludeFromSuggestions(currentCategory.name, true); break;
      case 'newBanner': setCategoryExcludeFromNewTasksBanner(currentCategory.name, true); break;
    }
  };

  const skip = () => {
    if (!currentId) return;
    haptics.tap();
    animateLayout();
    setSkippedIds(prev => new Set(prev).add(currentId));
  };

  // Unlike skip, this is a written, permanent decision about the item —
  // "this one genuinely doesn't need a time estimate" — so it goes through
  // updateTask/the category store rather than the session-only skippedIds,
  // and the item never comes back into this field's queue, in this session
  // or any other.
  const dismiss = () => {
    if (!active) return;
    haptics.tap();
    animateLayout();
    if (active.kind === 'task') {
      if (!currentTask) return;
      updateTask(currentTask.id, dismissBackfillField(currentTask, active.id));
    } else {
      if (!currentCategory) return;
      setCategoryBackfillDismissedFields(
        currentCategory.name,
        dismissCategoryBackfillField(currentCategory, active.id).backfillDismissedFields
      );
    }
  };

  // iOS's number-pad keyboard has no return key (see NumberPadAccessory), so
  // this is reached by an explicit "Set" tap rather than onSubmitEditing.
  // Invalid/empty text is silently ignored rather than applied as null —
  // there's no draft to fall back to here the way there is in the editor.
  const applyCustomEstimate = () => {
    const n = parseFloat(customText);
    if (!Number.isFinite(n) || n <= 0) return;
    const minutes = Math.round(customUnit === 'hr' ? n * 60 : n);
    apply({ effort: minutesToEffort(minutes), estimatedMinutes: minutes });
  };

  if (!active) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Backfill" subtitle="Choose a field to fill in, one item at a time" />
        <View style={styles.entitySwitch}>
          <SegmentedControl label="Backfill scope" surface="page" value={entityKind} onChange={setEntityKind} options={ENTITY_KIND_SEGMENTS} />
        </View>
        {entityKind === 'task' ? (
          <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
            {BACKFILL_FIELDS.map(field => {
              const count = taskCounts[field.id];
              return (
                <TouchableOpacity
                  key={field.id}
                  style={[styles.fieldRow, shadows.card]}
                  onPress={() => chooseTaskField(field.id)}
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
        ) : (
          <ScrollView contentContainerStyle={[styles.fieldList, { paddingBottom: tabBarHeight + spacing.lg }]}>
            {CATEGORY_BACKFILL_FIELDS.map(field => {
              const count = categoryCounts[field.id];
              return (
                <TouchableOpacity
                  key={field.id}
                  style={[styles.fieldRow, shadows.card]}
                  onPress={() => chooseCategoryField(field.id)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`${field.label}, ${count === 0 ? 'every category already has this on' : `${count} ${count === 1 ? "category hasn't" : "categories haven't"} turned this on`}`}
                >
                  <View style={styles.fieldIcon}>
                    <Ionicons name={CATEGORY_FIELD_ICONS[field.id].row} size={iconSize.md} color={colors.accent} />
                  </View>
                  <View style={styles.fieldBody}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldHint}>{field.hint}</Text>
                    <Text style={count === 0 ? styles.fieldCountDone : styles.fieldCount}>
                      {count === 0 ? 'Every category already has this on' : `${count} ${count === 1 ? "category hasn't" : "categories haven't"} turned this on`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }

  const doneCount = Math.max(0, sessionTotal - queueLength);

  if (active.kind === 'task') {
    const field = BACKFILL_FIELDS.find(f => f.id === active.id)!;
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title={field.label} onBack={backToFields} backAccessibilityLabel="Back to fields" />
        {sessionTotal > 0 && (
          <Text style={styles.progress}>{doneCount} of {sessionTotal} done</Text>
        )}

        {currentTask ? (
          <ScrollView
            contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.itemCard, shadows.card]}>
              <Text style={styles.itemTitle} numberOfLines={3}>{displayTitleFor(currentTask)}</Text>
              {!!currentTask.notes.trim() && (
                <Text style={styles.itemNotes} numberOfLines={2}>{currentTask.notes.trim()}</Text>
              )}
              <TaskContextRow
                task={currentTask}
                categoryLabel={currentTask.category ? categoryLabel(currentTask.category, getCategoryByName) : null}
                projectTitle={currentTask.projectId ? projectNamesById.get(currentTask.projectId) ?? null : null}
                colors={colors}
                styles={styles}
              />
            </View>

            <FieldControl
              field={active.id}
              colors={colors}
              styles={styles}
              onEstimate={e => apply(estimatePatchFor(e))}
              onPriority={p => apply({ priority: p })}
              onCategory={name => apply({ category: name })}
              onStreak={() => apply({ showStreak: true })}
              onVacation={() => apply({ vacationPause: true })}
              customOpen={customOpen}
              customText={customText}
              customUnit={customUnit}
              onOpenCustom={() => setCustomOpen(true)}
              onCustomTextChange={setCustomText}
              onCustomUnitChange={setCustomUnit}
              onCustomSubmit={applyCustomEstimate}
            />

            <View style={styles.actionRow}>
              <PressableScale style={styles.skipButton} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip this task for now">
                <Text style={styles.skipText}>Skip for now</Text>
              </PressableScale>
              <PressableScale
                style={styles.skipButton}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={`Leave ${field.label.toLowerCase()} unset for this task and don't ask again`}
              >
                <Text style={styles.skipText}>Leave {field.label.toLowerCase()} unset</Text>
              </PressableScale>
            </View>
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
        <NumberPadAccessory />
      </View>
    );
  }

  const categoryField = CATEGORY_BACKFILL_FIELDS.find(f => f.id === active.id)!;
  const currentCategoryTaskCount = currentCategory
    ? tasks.filter(t => t.category === currentCategory.name && !t.completed && !t.archived).length
    : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader title={categoryField.label} onBack={backToFields} backAccessibilityLabel="Back to fields" />
      {sessionTotal > 0 && (
        <Text style={styles.progress}>{doneCount} of {sessionTotal} done</Text>
      )}

      {currentCategory ? (
        <ScrollView
          contentContainerStyle={[styles.reviewContent, { paddingBottom: tabBarHeight + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.itemCard, shadows.card]}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {currentCategory.emoji ? `${currentCategory.emoji} ${currentCategory.name}` : currentCategory.name}
            </Text>
            <View style={styles.metaRow}>
              <View style={styles.metaChip}>
                <Ionicons name="checkbox-outline" size={iconSize.xs} color={colors.textSecondary} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {currentCategoryTaskCount} {currentCategoryTaskCount === 1 ? 'task' : 'tasks'}
                </Text>
              </View>
            </View>
          </View>

          <PressableScale
            style={[styles.toggleButton, { backgroundColor: colors.accent }]}
            onPress={applyCategory}
            accessibilityRole="button"
            accessibilityLabel={categoryField.label}
          >
            <Ionicons name={CATEGORY_FIELD_ICONS[active.id].button} size={iconSize.md} color={colors.onAccent} />
            <Text style={styles.toggleButtonText}>{categoryField.label}</Text>
          </PressableScale>

          <View style={styles.actionRow}>
            <PressableScale style={styles.skipButton} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip this category for now">
              <Text style={styles.skipText}>Skip for now</Text>
            </PressableScale>
            <PressableScale
              style={styles.skipButton}
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={`Leave "${categoryField.label}" off for this category and don't ask again`}
            >
              <Text style={styles.skipText}>Leave this off</Text>
            </PressableScale>
          </View>
        </ScrollView>
      ) : (
        <EmptyState
          icon="checkmark-circle-outline"
          title="All caught up"
          subtitle="Every category already has this set. Pick another field to keep going."
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

/**
 * Same schedule/category/project meta chips `ArchivedRow` shows, because a
 * title alone is often not enough to place a task by — "Book activities" only
 * reads once you know it's part of the Iceland trip. Missing every one of
 * these is possible (a plain standalone task) and just means there's nothing
 * more to show; it's not a reason to invent context that isn't on the row.
 *
 * The due date is the one addition beyond ArchivedRow's own set, and it earns
 * its place here specifically: a generated meal task's title and chain step
 * are the same on every day it's unanswered ("Breakfast" / "Choose
 * breakfast"), so a run of them in the queue is otherwise indistinguishable —
 * tapping a value on one and landing on an identical-looking card for the
 * next day reads as the tap having done nothing.
 */
function TaskContextRow({
  task, categoryLabel, projectTitle, colors, styles,
}: {
  task: Task;
  categoryLabel: string | null;
  projectTitle: string | null;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const repeat = task.recurrenceType !== 'none' ? describeTaskRecurrence(task) : null;
  const due = task.dueDate ? format(new Date(task.dueDate), 'EEE, MMM d') : null;
  if (!due && !repeat && !categoryLabel && !projectTitle) return null;

  return (
    <View style={styles.metaRow}>
      {due && (
        <View style={styles.metaChip}>
          <Ionicons name="calendar-outline" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{due}</Text>
        </View>
      )}
      {repeat && (
        <View style={styles.metaChip}>
          <Ionicons name="repeat" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{repeat}</Text>
        </View>
      )}
      {categoryLabel && (
        <View style={styles.metaChip}>
          <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{categoryLabel}</Text>
        </View>
      )}
      {projectTitle && (
        <View style={styles.metaChip}>
          <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textSecondary} />
          <Text style={styles.metaText} numberOfLines={1}>{projectTitle}</Text>
        </View>
      )}
    </View>
  );
}

interface FieldControlProps {
  field: BackfillFieldId;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onEstimate: (effort: Effort) => void;
  onPriority: (priority: (typeof PRIORITY_SEGMENTS)[number]['value']) => void;
  onCategory: (name: string | null) => void;
  onStreak: () => void;
  onVacation: () => void;
  customOpen: boolean;
  customText: string;
  customUnit: 'min' | 'hr';
  onOpenCustom: () => void;
  onCustomTextChange: (text: string) => void;
  onCustomUnitChange: (unit: 'min' | 'hr') => void;
  onCustomSubmit: () => void;
}

function FieldControl({
  field, colors, styles, onEstimate, onPriority, onCategory, onStreak, onVacation,
  customOpen, customText, customUnit, onOpenCustom, onCustomTextChange, onCustomUnitChange, onCustomSubmit,
}: FieldControlProps) {
  if (field === 'estimate') {
    return (
      <View>
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
          <PressableScale
            style={[styles.pill, customOpen && styles.pillActive]}
            onPress={onOpenCustom}
            accessibilityRole="button"
            accessibilityLabel="Enter an exact time estimate"
          >
            <Text style={styles.pillText}>Custom</Text>
            <Text style={styles.pillHint}>exact</Text>
          </PressableScale>
        </View>
        {customOpen && (
          <View style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              value={customText}
              onChangeText={onCustomTextChange}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              autoFocus
            />
            <View style={styles.customUnitToggle}>
              <SegmentedControl
                label="Unit"
                value={customUnit}
                onChange={onCustomUnitChange}
                options={DURATION_UNIT_SEGMENTS}
              />
            </View>
            <PressableScale
              style={styles.customSetButton}
              onPress={onCustomSubmit}
              accessibilityRole="button"
              accessibilityLabel="Set this time estimate"
            >
              <Text style={styles.customSetText}>Set</Text>
            </PressableScale>
          </View>
        )}
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

  if (field === 'category') {
    return (
      <View style={[styles.categoryCard, { backgroundColor: colors.bgSecondary }]}>
        <CategoryPickerList value={null} onSelect={onCategory} showNone={false} maxHeight={360} />
      </View>
    );
  }

  if (field === 'streak') {
    return (
      <PressableScale
        style={[styles.toggleButton, { backgroundColor: colors.orange }]}
        onPress={onStreak}
        accessibilityRole="button"
        accessibilityLabel="Show streak on row"
      >
        <Ionicons name="flame" size={iconSize.md} color={colors.onAccent} />
        <Text style={styles.toggleButtonText}>Show streak on row</Text>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      style={[styles.toggleButton, { backgroundColor: colors.accent }]}
      onPress={onVacation}
      accessibilityRole="button"
      accessibilityLabel="Turn on vacation pause"
    >
      <Ionicons name="airplane" size={iconSize.md} color={colors.onAccent} />
      <Text style={styles.toggleButtonText}>Turn on vacation pause</Text>
    </PressableScale>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  entitySwitch: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },

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

  progress: {
    color: colors.textTertiary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    paddingTop: spacing.sm,
  },

  reviewContent: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.lg },
  // Shared by both the task card and the category card on the per-item
  // review step — entity-agnostic layout, no task-specific meaning.
  itemCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    gap: spacing.xs,
  },
  itemTitle: { color: colors.text, fontSize: font.lg, lineHeight: lineHeight.lg, fontWeight: fontWeight.semibold },
  itemNotes: { color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm },
  // Wraps rather than squeezing, same call ArchivedRow's own meta row makes —
  // a task carrying a schedule, a category and a project has more than fits
  // on one line at 390pt.
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  metaText: { color: colors.textSecondary, fontSize: font.xs },

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
  pillActive: { backgroundColor: colors.accentSubtle },

  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  customInput: {
    color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold,
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 72, textAlign: 'center',
  },
  // A track next to the number it labels, so it takes a width rather than
  // stretching across the row — same call TaskEditor's own unitToggle makes.
  customUnitToggle: { width: 104 },
  customSetButton: {
    paddingVertical: 8, paddingHorizontal: spacing.md,
    borderRadius: radius.sm, backgroundColor: colors.accent,
  },
  customSetText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold },

  categoryCard: { borderRadius: radius.md, padding: spacing.sm },

  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  toggleButtonText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },

  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  skipButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  skipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.regular },
});
