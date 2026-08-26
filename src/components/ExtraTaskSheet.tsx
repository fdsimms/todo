import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Effort, ExtraTaskDraft, Priority, TimeOfDay } from '../types';
import { EFFORT_LABELS, EFFORT_HINTS, PRIORITY_LABELS, TITLE_MAX_LENGTH } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { tagColor } from '../utils/tagColor';
import { categoryLabel } from '../utils/categoryLabel';
import { generateId } from '../utils/id';
import { emptyExtraTaskDraft, extraTaskDraftIsEmpty } from '../utils/extraTask';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import { SegmentedControl } from './SegmentedControl';
import { CollapsibleField } from './CollapsibleField';
import { EditorRow } from './EditorRow';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SortableList } from './SortableList';
import { EditorSheet } from './EditorSheet';
import { CountStepper } from './CountStepper';

// Ten hours, well past any real estimate. CountStepper needs a bound to
// disable its + key at; the hand-rolled version it replaced had none.
const MAX_CUSTOM_ESTIMATE_MINUTES = 600;


/** Editor sections that collapse to a one-line summary of their current value. */
type FieldKey = 'category' | 'project' | 'tags' | 'priority' | 'effort' | 'subtasks';

const TIME_SEGMENTS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

interface Props {
  visible: boolean;
  /** The title the rule already carries, shown as the sheet's subtitle. */
  taskTitle: string;
  draft: ExtraTaskDraft | null;
  /** Null whenever nothing past the title is set, so the row keeps reading as "just the title". */
  onSave: (draft: ExtraTaskDraft | null) => void;
  onClose: () => void;
}

/**
 * What the "Extra task" rule adds, past its title — notes, where it's filed,
 * how it's ranked, how long it takes and its checklist.
 *
 * A sheet rather than more rows under the Extra task field, which is where
 * this started: the field is one line in the middle of a group in the middle
 * of TaskEditor, and unfolding eight pickers there buries the task actually
 * being edited under a second task's worth of form. The shape is
 * TemplateItemEditor's, which answers the same question ("what will this task
 * look like when something else creates it") from the same primitives.
 *
 * **It says what the task *is*, never when it happens.** The rule already
 * answers that — due with the next occurrence, or today when there isn't one
 * — so a date, a defer, a reminder or a repeat here would be a second
 * schedule contradicting the first. See ExtraTaskDraft.
 */
export function ExtraTaskSheet({ visible, taskTitle, draft, onSave, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const projects = useProjectStore(useShallow(s => s.projects.filter(p => !p.archived)));

  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string }[]>([]);

  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [showTimeOfDay, setShowTimeOfDay] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const subtaskInputRef = useRef<TextInput>(null);
  const subtaskSavedRef = useRef(false);
  // True while a subtask row is mid-drag. The sheet's ScrollView has to stand
  // down for the drag to survive the first finger move — a JS responder
  // nested inside a scroll view doesn't stop it claiming the touch (see
  // SortableList's onDragStateChange).
  const [draggingRow, setDraggingRow] = useState(false);

  // Seeded whenever the sheet opens rather than on `draft` changing: the save
  // hands a fresh object back up, and re-seeding from it mid-edit would fight
  // whatever is being typed.
  useEffect(() => {
    if (!visible) return;
    const seed = draft ?? emptyExtraTaskDraft();
    setNotes(seed.notes);
    setCategory(seed.category);
    setProjectId(seed.projectId);
    setTags(seed.tags);
    setPriority(seed.priority);
    setEffort(seed.effort);
    setEstimatedMinutes(seed.estimatedMinutes);
    setTimeSegments(seed.timeSegments);
    setSubtasks(seed.subtasks);
    setOpenFields({});
    setShowTimeOfDay(seed.timeSegments.length > 0);
    setAddingTag(false);
    setNewTag('');
    setAddingSubtask(false);
    setNewSubtaskTitle('');
    // `draft` is deliberately not a dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const fieldOpen = (key: FieldKey, fallback = false) => openFields[key] ?? fallback;
  const toggleField = (key: FieldKey, fallback = false) =>
    setOpenFields(prev => ({ ...prev, [key]: !(prev[key] ?? fallback) }));
  const closeField = (key: FieldKey) => {
    animateLayout();
    setOpenFields(prev => ({ ...prev, [key]: false }));
  };

  const addTagFromInput = () => {
    const t = newTag.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setNewTag('');
    setAddingTag(false);
  };

  const saveAndClose = () => {
    // Whatever is still sitting unsubmitted in the tag and subtask fields
    // counts. Both commit on blur, and pressing Done blurs them — but that
    // commit is a state update this render hasn't seen, so reading `tags` and
    // `subtasks` alone silently drops the last thing typed. Merged rather than
    // read from state so it can't depend on whether RN happens to blur before
    // the press handler runs.
    const pendingTag = newTag.trim();
    const pendingSubtask = newSubtaskTitle.trim();
    const next: ExtraTaskDraft = {
      notes: notes.trim(),
      category,
      projectId,
      tags: pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags,
      priority,
      effort,
      estimatedMinutes,
      timeSegments,
      subtasks: pendingSubtask
        ? [...subtasks, { id: generateId(), title: pendingSubtask }]
        : subtasks,
    };
    // An untouched draft is stored as null, so a rule that says nothing past
    // its title keeps reading that way — and keeps spawning the task exactly
    // as it did before this sheet existed.
    onSave(extraTaskDraftIsEmpty(next) ? null : next);
    onClose();
  };

  const timeOfDaySummary = timeSegments.length > 0 ? capitalize(timeSegments[0]) : undefined;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      scrollEnabled={!draggingRow}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} minWidth={56} />
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Extra task</Text>
            {!!taskTitle.trim() && (
              <Text style={styles.headerSubtitle} numberOfLines={1}>{taskTitle.trim()}</Text>
            )}
          </View>
          <View style={styles.headerSpacer} />
        </>
      }
    >
      <View style={styles.sectionCard}>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. The tin lives in the case pocket"
          placeholderTextColor={colors.textTertiary}
          multiline
          accessibilityLabel="Notes for the task to add"
        />
      </View>

      <Text style={styles.groupLabel}>Organize</Text>
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Category"
          summary={category ? categoryLabel(category, categories) : undefined}
          emptySummary="Same as this task"
          hint="Where the added task is filed. Left alone it lands in the same category as the task that adds it."
          expanded={fieldOpen('category')}
          onToggle={() => toggleField('category')}
        >
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, !category && styles.pillActiveNeutral]}
              onPress={() => { haptics.tap(); setCategory(null); closeField('category'); }}
            >
              <Text style={[styles.pillText, !category && styles.pillTextActive]}>Same as this task</Text>
            </TouchableOpacity>
            {allCategories.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.pill, category === cat && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setCategory(cat); closeField('category'); }}
              >
                <Text style={[styles.pillText, category === cat && styles.pillTextActive]}>
                  {categoryLabel(cat, categories)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </CollapsibleField>

        {projects.length > 0 && (
          <>
            <View style={styles.cardSep} />
            <CollapsibleField
              label="Project"
              summary={projects.find(p => p.id === projectId)?.title}
              emptySummary="Same as this task"
              hint="Which project the added task counts toward. Left alone it follows the task that adds it."
              expanded={fieldOpen('project')}
              onToggle={() => toggleField('project')}
            >
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !projectId && styles.pillActiveNeutral]}
                  onPress={() => { haptics.tap(); setProjectId(null); closeField('project'); }}
                >
                  <Text style={[styles.pillText, !projectId && styles.pillTextActive]}>Same as this task</Text>
                </TouchableOpacity>
                {projects.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pill, projectId === p.id && styles.pillActiveNeutral]}
                    onPress={() => { haptics.tap(); setProjectId(p.id); closeField('project'); }}
                  >
                    <Text style={[styles.pillText, projectId === p.id && styles.pillTextActive]}>{p.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </CollapsibleField>
          </>
        )}

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Tags"
          summary={tags.length > 0 ? tags.join(', ') : undefined}
          hint="Free-form labels on the added task. It never inherits the tags of the task that adds it."
          expanded={fieldOpen('tags')}
          onToggle={() => toggleField('tags')}
        >
          <View style={styles.tagRow}>
            {tags.map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, { backgroundColor: tagColor(tag) + '33' }]}
                onPress={() => { haptics.tap(); setTags(prev => prev.filter(t => t !== tag)); }}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
              >
                <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                <Text style={[styles.tagChipText, { color: tagColor(tag) }]}>{tag}</Text>
                <Ionicons name="close" size={12} color={tagColor(tag)} />
              </TouchableOpacity>
            ))}
            {addingTag ? (
              <TextInput
                autoFocus
                style={styles.tagInput}
                value={newTag}
                onChangeText={setNewTag}
                onSubmitEditing={addTagFromInput}
                onBlur={addTagFromInput}
                placeholder="Tag name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
              />
            ) : (
              <InlineAction icon="add" label="Add tag" variant="neutral" onPress={() => setAddingTag(true)} />
            )}
          </View>
          {allTags.filter(t => !tags.includes(t)).length > 0 && (
            <View style={styles.tagSuggestions}>
              {allTags.filter(t => !tags.includes(t)).slice(0, 6).map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={styles.tagSuggestion}
                  onPress={() => setTags(prev => [...prev, tag])}
                >
                  <Text style={styles.tagSuggestionText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </CollapsibleField>
      </View>

      <Text style={styles.groupLabel}>Priority &amp; effort</Text>
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Priority"
          summary={priority > 0 ? PRIORITY_LABELS[priority] : undefined}
          hint="Ranks the added task against everything else on the day it lands."
          expanded={fieldOpen('priority')}
          onToggle={() => toggleField('priority')}
        >
          <SegmentedControl
            label="Priority"
            value={priority}
            onChange={p => { setPriority(p); closeField('priority'); }}
            columns={3}
            options={PRIORITY_SEGMENTS}
          />
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Effort"
          summary={estimatedMinutes !== null ? `${estimatedMinutes} min` : effort > 0 ? EFFORT_LABELS[effort] : undefined}
          emptySummary="Not set"
          hint="Roughly how long the added task takes, so the day it lands on can be sized realistically."
          expanded={fieldOpen('effort')}
          onToggle={() => toggleField('effort')}
        >
          <View style={styles.pillRow}>
            {([0, 1, 2, 3, 4, 5, 6] as Effort[]).map(e => (
              <TouchableOpacity
                key={e}
                style={[styles.pill, effort === e && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setEffort(e); }}
              >
                <Text style={[styles.pillText, effort === e && styles.pillTextActive]}>
                  {e === 0 ? '—' : EFFORT_LABELS[e]}
                </Text>
                {EFFORT_HINTS[e] ? <Text style={styles.pillHint}>{EFFORT_HINTS[e]}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.intervalRow}>
            {estimatedMinutes !== null ? (
              <>
                <CountStepper
                  value={estimatedMinutes}
                  onChange={m => setEstimatedMinutes(m ?? 30)}
                  min={5}
                  max={MAX_CUSTOM_ESTIMATE_MINUTES}
                  step={5}
                  format={n => `${n} min`}
                  label="Estimate"
                />
                <Text style={styles.intervalValueSm}>(custom)</Text>
                <TouchableOpacity
                  onPress={() => setEstimatedMinutes(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear the estimate"
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </>
            ) : (
              <InlineAction label="Set a custom estimate" haptic onPress={() => setEstimatedMinutes(30)} />
            )}
          </View>
        </CollapsibleField>
      </View>

      <Text style={styles.groupLabel}>More</Text>
      <View style={styles.sectionCard}>
        <EditorRow
          icon="time-outline"
          label="Time of day"
          hint="Hold the added task back until a part of its day."
          value={timeOfDaySummary}
          expanded={showTimeOfDay}
          onPress={() => { animateLayout(); setShowTimeOfDay(v => !v); }}
          onClear={timeSegments.length > 0 ? () => setTimeSegments([]) : undefined}
        />
        {showTimeOfDay && (
          <View style={styles.timePillRow}>
            {TIME_SEGMENTS.map(tod => {
              const active = timeSegments.includes(tod);
              return (
                <TouchableOpacity
                  key={tod}
                  style={[styles.timePill, active && styles.timePillActive]}
                  onPress={() => {
                    haptics.tap();
                    setTimeSegments(prev => (prev.includes(tod) ? [] : [tod]));
                  }}
                >
                  <Text style={[styles.timePillText, active && styles.timePillTextActive]}>
                    {capitalize(tod)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Subtasks"
          summary={subtasks.length > 0 ? `${subtasks.length} step${subtasks.length === 1 ? '' : 's'}` : undefined}
          hint="Checklist items created alongside the added task, always unchecked."
          expanded={fieldOpen('subtasks', true)}
          onToggle={() => toggleField('subtasks', true)}
        >
          <SortableList
            onDragStateChange={setDraggingRow}
            data={subtasks}
            onReorder={setSubtasks}
            renderItem={(sub, _displayIndex, drag) => (
              <View style={styles.subtaskRow}>
                <TouchableOpacity
                  style={styles.subtaskTitleWrapper}
                  onLongPress={drag}
                  delayLongPress={interaction.delayLongPress}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Reorder subtask ${sub.title}`}
                >
                  <Text style={styles.subtaskTitle}>{sub.title}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSubtasks(prev => prev.filter(s => s.id !== sub.id))}
                  hitSlop={8}
                  style={styles.subtaskDelete}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove subtask ${sub.title}`}
                >
                  <Ionicons name="close" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
          />
          {addingSubtask ? (
            <View style={styles.subtaskInputRow}>
              <TextInput
                ref={subtaskInputRef}
                autoFocus
                style={styles.subtaskInput}
                value={newSubtaskTitle}
                onChangeText={setNewSubtaskTitle}
                placeholder="Subtask title"
                placeholderTextColor={colors.textTertiary}
                maxLength={TITLE_MAX_LENGTH}
                returnKeyType="done"
                onSubmitEditing={() => {
                  subtaskSavedRef.current = true;
                  const t = newSubtaskTitle.trim();
                  if (t) setSubtasks(prev => [...prev, { id: generateId(), title: t }]);
                  setNewSubtaskTitle('');
                  setTimeout(() => {
                    subtaskSavedRef.current = false;
                    subtaskInputRef.current?.focus();
                  }, 50);
                }}
                onBlur={() => {
                  if (subtaskSavedRef.current) return;
                  const t = newSubtaskTitle.trim();
                  if (t) setSubtasks(prev => [...prev, { id: generateId(), title: t }]);
                  setNewSubtaskTitle('');
                  setAddingSubtask(false);
                }}
              />
            </View>
          ) : (
            <InlineAction
              icon="add"
              label="Add subtask"
              onPress={() => setAddingSubtask(true)}
              style={styles.addBtnSpacing}
            />
          )}
        </CollapsibleField>
      </View>
    </EditorSheet>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  headerSubtitle: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1 },
  headerSpacer: { minWidth: 56 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.md, paddingBottom: 120 },
  notesInput: {
    color: colors.text, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, minHeight: 76,
    textAlignVertical: 'top',
  },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.xs,
  },
  sectionCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActiveNeutral: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  pillHint: { color: colors.textTertiary, fontSize: 10, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagChipText: { fontSize: font.sm, fontWeight: '500' },
  tagInput: {
    color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4, paddingHorizontal: 4, minWidth: 80,
  },
  tagSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  tagSuggestion: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  tagSuggestionText: { color: colors.textSecondary, fontSize: font.xs },
  intervalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  // The quiet caption after the estimate stepper, matching how a unit sits
  // beside a stepper elsewhere. CountStepper renders the number itself.
  intervalValueSm: { color: colors.textSecondary, fontSize: font.sm },
  timePillRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md,
  },
  timePill: {
    flex: 1, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  timePillActive: { backgroundColor: colors.accent },
  timePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  timePillTextActive: { color: colors.onAccent, fontWeight: '600' },
  subtaskRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  subtaskTitleWrapper: { flex: 1 },
  subtaskTitle: { color: colors.text, fontSize: font.md },
  subtaskDelete: { padding: 4 },
  subtaskInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  subtaskInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent, paddingVertical: 2,
  },
  /** Lifts an InlineAction off the list it appends to, and keeps it from stretching in a column. */
  addBtnSpacing: { marginTop: spacing.sm, alignSelf: 'flex-start' },
});
