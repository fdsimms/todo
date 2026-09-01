// One item inside a template. Same progressive-disclosure shape as TaskEditor
// (cards under uppercase group labels, nothing expanded by default), but the
// dates are offsets from the run rather than real dates.
//
//   ==== <name> ====        the section banners through the logic half
//   OffsetRow, makeStyles   the offset row and styles, at the bottom
//
// What a run asks before it creates anything is docs/arch/template-questions.md.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { Priority, Effort, TimeOfDay, TemplateAnchor, TemplateItem, TemplateItemCondition, RecurrenceType, ChainItem, DeliverableKind, Polarity } from '../types';
import { PRIORITY_LABELS, EFFORT_LABELS, EFFORT_HINTS, TITLE_MAX_LENGTH } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { tagColor } from '../utils/tagColor';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { describeConditions, questionLabel, toggleItemCondition } from '../utils/templateQuestions';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import {
  anchorLabel,
  formatOffsetWithAnchor,
  formatMinutesOffset,
  itemPlaceholders,
  normalizePlaceholderName,
  withPlaceholder,
  withoutPlaceholder,
  RUN_PLACEHOLDER,
} from '../utils/templateUtils';
import { categoryLabel } from '../utils/categoryLabel';
import { formatHHMM, hhmmToDate, dateToHHMM } from '../utils/dateUtils';
import { generateId } from '../utils/id';
import { deliverableMeta } from '../utils/deliverables';
import { SortableList } from './SortableList';
import { DeliverableKindPicker } from './DeliverableKindPicker';
import { StepMinutes } from './StepMinutes';
import { StepQuestion } from './StepQuestion';
import { nextChainStepTitle } from '../utils/chain';
import { ChainStepQuestionSheet } from './ChainStepQuestionSheet';
import { RecurrencePicker } from './RecurrencePicker';
import { SegmentedControl } from './SegmentedControl';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { EditorSheet } from './EditorSheet';
import { NumberPadAccessory } from './NumberPadAccessory';
import { CountStepper } from './CountStepper';

// Ceilings for the two steppers whose hand-rolled versions had none. Both sit
// well past any real value; CountStepper needs a bound to disable its + key
// at, and an unbounded stepper is one a long press can run to nonsense.
const MAX_REMINDER_OFFSET_MINUTES = 10080;   // a week, in 15-minute steps
const MAX_CUSTOM_ESTIMATE_MINUTES = 600;     // ten hours


/** Editor sections that collapse to a one-line summary of their current value. */
type FieldKey = 'blanks' | 'conditions' | 'category' | 'tags' | 'priority' | 'effort' | 'subtasks' | 'chainSteps' | 'deliverable';

interface Props {
  visible: boolean;
  templateId: string;
  /** Shown under the header title so it's clear which template is being edited. */
  templateName?: string;
  /** Item being edited, or null to create a new one. */
  item: TemplateItem | null;
  /** Pre-fill for a new item handed off from TemplateItemQuickAdd. Ignored when editing an existing item. */
  initialDraft?: Partial<TemplateItem> | null;
  onClose: () => void;
}

/**
 * Trimmed TaskEditor-style form for a single template item: title, notes,
 * optional flag, due/defer offsets relative to the anchor date, time of day,
 * category, tags, priority and effort.
 */
export function TemplateItemEditor({ visible, templateId, templateName, item, initialDraft, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addItem = useTemplateStore(s => s.addItem);
  const updateItem = useTemplateStore(s => s.updateItem);
  // Only a choice can gate an item: a number or a free-text answer has no
  // fixed set to pick from, so there's nothing an author could tick.
  const choiceQuestions = useTemplateStore(
    useShallow(s => (s.templates.find(t => t.id === templateId)?.questions ?? []).filter(q => q.kind === 'choice'))
  );

  // ==== local state: the draft, one piece of state per field ====
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [optional, setOptional] = useState(false);
  const [conditions, setConditions] = useState<TemplateItemCondition[]>([]);
  // True while a subtask/chain row is mid-drag. The sheet's ScrollView has to
  // stand down for the drag to survive the first finger move — a JS responder
  // nested *inside* a scroll view doesn't stop it from claiming the touch (see
  // SortableList's onDragStateChange).
  const [draggingRow, setDraggingRow] = useState(false);
  const [anchor, setAnchor] = useState<TemplateAnchor>('start');
  const [dueOffsetDays, setDueOffsetDays] = useState<number | null>(null);
  const [deferOffsetDays, setDeferOffsetDays] = useState<number | null>(null);
  const [deadlineOffsetDays, setDeadlineOffsetDays] = useState<number | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [windowPickerMode, setWindowPickerMode] = useState<'none' | 'start' | 'end'>('none');
  const [windowPickerDate, setWindowPickerDate] = useState(new Date());
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [vacationPause, setVacationPause] = useState(false);
  const [excludeFromSuggestions, setExcludeFromSuggestions] = useState(false);
  const [polarity, setPolarity] = useState<Polarity>('positive');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number | null>(null);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  const [recurrenceCount, setRecurrenceCount] = useState<number | null>(null);
  const [deliverableKind, setDeliverableKind] = useState<DeliverableKind | null>(null);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [chainItems, setChainItems] = useState<ChainItem[]>([]);
  // By id rather than index — see the same state in TaskEditor.
  const [questionStepId, setQuestionStepId] = useState<string | null>(null);
  const [chainIndex, setChainIndex] = useState(0);
  const [addingChainItem, setAddingChainItem] = useState(false);
  const [newChainItemTitle, setNewChainItemTitle] = useState('');
  const chainInputRef = useRef<TextInput>(null);
  const chainItemSavedRef = useRef(false);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string }[]>([]);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const subtaskInputRef = useRef<TextInput>(null);
  const subtaskSavedRef = useRef(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingBlank, setAddingBlank] = useState(false);
  const [newBlank, setNewBlank] = useState('');
  // Same progressive disclosure as TaskEditor: each picker collapses to its
  // current value so the form reads as a list of fields, not a wall of pills.
  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [showTimeOfDay, setShowTimeOfDay] = useState(false);
  const [showTimeWindow, setShowTimeWindow] = useState(false);

  // ==== effects: loading the item into the draft ====
  useEffect(() => {
    if (!visible) return;
    const draft = item ? null : initialDraft;
    setTitle(item?.title ?? draft?.title ?? '');
    setNotes(item?.notes ?? draft?.notes ?? '');
    setOptional(item?.optional ?? draft?.optional ?? false);
    setConditions(item?.conditions ?? draft?.conditions ?? []);
    setAnchor(item?.anchor ?? draft?.anchor ?? 'start');
    setDueOffsetDays(item?.dueOffsetDays ?? draft?.dueOffsetDays ?? null);
    setDeferOffsetDays(item?.deferOffsetDays ?? draft?.deferOffsetDays ?? null);
    setDeadlineOffsetDays(item?.deadlineOffsetDays ?? draft?.deadlineOffsetDays ?? null);
    setWindowStart(item?.windowStart ?? draft?.windowStart ?? null);
    setWindowEnd(item?.windowEnd ?? draft?.windowEnd ?? null);
    setReminderOffsetMinutes(item?.reminderOffsetMinutes ?? draft?.reminderOffsetMinutes ?? null);
    setTimeSegments(item?.timeSegments ?? draft?.timeSegments ?? []);
    setTags(item?.tags ?? draft?.tags ?? []);
    setCategory(item?.category ?? draft?.category ?? null);
    setPriority(item?.priority ?? draft?.priority ?? 0);
    setEffort(item?.effort ?? draft?.effort ?? 0);
    setEstimatedMinutes(item?.estimatedMinutes ?? draft?.estimatedMinutes ?? null);
    setVacationPause(item?.vacationPause ?? draft?.vacationPause ?? false);
    setExcludeFromSuggestions(item?.excludeFromSuggestions ?? draft?.excludeFromSuggestions ?? false);
    setPolarity(item?.polarity ?? draft?.polarity ?? 'positive');
    setRecurrenceType(item?.recurrenceType ?? draft?.recurrenceType ?? 'none');
    setRecurrenceInterval(item?.recurrenceInterval ?? draft?.recurrenceInterval ?? 1);
    setRecurrenceDays(item?.recurrenceDays ?? draft?.recurrenceDays ?? []);
    setRecurrenceMonthDay(item?.recurrenceMonthDay ?? draft?.recurrenceMonthDay ?? null);
    setRecurrenceFromCompletion(item?.recurrenceFromCompletion ?? draft?.recurrenceFromCompletion ?? false);
    setRecurrenceCount(item?.recurrenceCount ?? draft?.recurrenceCount ?? null);
    setDeliverableKind(item?.deliverableKind ?? draft?.deliverableKind ?? null);
    setChainEnabled(item?.chainEnabled ?? draft?.chainEnabled ?? false);
    setChainItems(item?.chainItems ?? draft?.chainItems ?? []);
    setQuestionStepId(null);
    setChainIndex(item?.chainIndex ?? draft?.chainIndex ?? 0);
    setSubtasks(item?.subtasks ?? draft?.subtasks ?? []);
    setAddingTag(false);
    setNewTag('');
    setAddingBlank(false);
    setNewBlank('');
    setAddingChainItem(false);
    setNewChainItemTitle('');
    setAddingSubtask(false);
    setNewSubtaskTitle('');
    setOpenFields({});
    setShowTimeOfDay(false);
    setShowTimeWindow(false);
  }, [visible, item, initialDraft]);

  const conditionSummary = describeConditions(conditions, choiceQuestions);

  /**
   * Tick one answer on or off. A question left with no answers ticked drops its
   * condition entirely rather than being kept as an empty one — "included for
   * none of the answers" is a state nothing could act on, and it's how the
   * field says "every run" again.
   */
  const toggleCondition = (questionId: string, option: string) => {
    haptics.tap();
    setConditions(prev => toggleItemCondition(prev, questionId, option));
  };

  const fieldOpen = (key: FieldKey, fallback = false) => openFields[key] ?? fallback;
  const toggleField = (key: FieldKey, fallback = false) =>
    setOpenFields(prev => ({ ...prev, [key]: !(prev[key] ?? fallback) }));
  const closeField = (key: FieldKey) => {
    animateLayout();
    setOpenFields(prev => ({ ...prev, [key]: false }));
  };

  const openWindowPicker = (which: 'start' | 'end') => {
    const current = which === 'start' ? windowStart : windowEnd;
    const fallback = which === 'start' ? '08:00' : '13:00';
    setWindowPickerDate(hhmmToDate(current ?? fallback));
    setWindowPickerMode(which);
  };

  const confirmWindowPicker = () => {
    const hhmm = dateToHHMM(windowPickerDate);
    if (windowPickerMode === 'start') setWindowStart(hhmm);
    else if (windowPickerMode === 'end') setWindowEnd(hhmm);
    setWindowPickerMode('none');
  };

  // A step, subtask, tag or blank typed into its "add new" field but never
  // submitted (no return, no blur — e.g. tapping Save while the field still
  // has focus) would otherwise be silently dropped: handleSave reads this
  // state as closed over from the current render, and there's no guarantee
  // the field's onBlur has fired — or its setState flushed — before it
  // runs. These mirror the onBlur commit logic so handleSave can run it
  // explicitly instead of relying on blur ordering — same fix TaskEditor
  // already applies to its own chain/subtask/link fields.
  const resolvePendingChainItems = (): ChainItem[] => {
    const t = newChainItemTitle.trim();
    return t ? [...chainItems, { id: generateId(), title: t, estimatedMinutes: null }] : chainItems;
  };
  const resolvePendingSubtasks = (): { id: string; title: string }[] => {
    const t = newSubtaskTitle.trim();
    return t ? [...subtasks, { id: generateId(), title: t }] : subtasks;
  };
  const resolvePendingTags = (): string[] => {
    const t = newTag.trim();
    return t && !tags.includes(t) ? [...tags, t] : tags;
  };
  const resolvePendingTitle = (baseTitle: string): string => {
    const name = normalizePlaceholderName(newBlank);
    return name ? withPlaceholder(baseTitle, name) : baseTitle;
  };

  // ==== save ====
  const handleSave = () => {
    if (!title.trim()) return;
    const effectiveChainItems = resolvePendingChainItems();
    const effectiveSubtasks = resolvePendingSubtasks();
    const updates = {
      title: resolvePendingTitle(title.trim()),
      notes,
      optional,
      conditions,
      anchor,
      dueOffsetDays,
      deferOffsetDays,
      deadlineOffsetDays,
      windowStart,
      windowEnd,
      reminderOffsetMinutes: dueOffsetDays !== null ? reminderOffsetMinutes : null,
      timeSegments,
      tags: resolvePendingTags(),
      category,
      priority,
      effort,
      estimatedMinutes,
      vacationPause,
      excludeFromSuggestions,
      polarity,
      recurrenceType,
      recurrenceInterval,
      recurrenceDays: recurrenceType === 'weekly' ? recurrenceDays : [],
      recurrenceMonthDay: recurrenceType === 'monthly' ? recurrenceMonthDay : null,
      recurrenceFromCompletion,
      recurrenceCount: recurrenceType !== 'none' ? recurrenceCount : null,
      deliverableKind,
      chainEnabled: chainEnabled && effectiveChainItems.length > 0,
      chainItems: effectiveChainItems,
      chainIndex: effectiveChainItems.length > 0 ? Math.min(chainIndex, effectiveChainItems.length - 1) : 0,
      subtasks: effectiveSubtasks,
    };
    if (item) {
      updateItem(templateId, item.id, updates);
    } else if (!addItem(templateId, updates)) {
      // Nothing was stored — closing here would throw away a whole editor's
      // worth of work on a row that will never appear. See addItem.
      haptics.error();
      Alert.alert(
        'Couldn’t add that item',
        'This template couldn’t be found, so nothing was saved. Go back to Templates and open it again, then retry.',
      );
      return;
    }
    haptics.success();
    onClose();
  };

  const addTagFromInput = () => {
    const t = newTag.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setNewTag('');
    setAddingTag(false);
  };

  // Every blank this item declares, across all four fields that can hold one.
  const blanks = useMemo(
    () => itemPlaceholders({ title, notes, subtasks, chainItems }),
    [title, notes, subtasks, chainItems]
  );

  // The new blank goes on the end of the title: it's the field every item has,
  // it's the one the blank is nearly always for, and it's on screen while this
  // section is open, so the token lands somewhere the user can see and move.
  const addBlankFromInput = () => {
    const name = normalizePlaceholderName(newBlank);
    if (name) setTitle(prev => withPlaceholder(prev, name));
    setNewBlank('');
    setAddingBlank(false);
  };

  /** Take a blank out of every field that mentions it — the chip's × is the only undo for a token typed into notes or a step. */
  const removeBlank = (name: string) => {
    haptics.tap();
    setTitle(prev => withoutPlaceholder(prev, name));
    setNotes(prev => withoutPlaceholder(prev, name));
    // A subtask or step whose whole title was the blank has nothing left to be,
    // so it goes with it rather than sitting there as an untitled row.
    setSubtasks(subtasks
      .map(s => ({ ...s, title: withoutPlaceholder(s.title, name) }))
      .filter(s => s.title.trim()));
    const nextChain = chainItems
      .map(c => ({ ...c, title: withoutPlaceholder(c.title, name) }))
      .filter(c => c.title.trim());
    setChainItems(nextChain);
    // Same re-clamp the step delete button does: the starting step can't point
    // past the end of a list that just got shorter.
    setChainIndex(i => Math.min(i, Math.max(0, nextChain.length - 1)));
  };

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
  const timeOfDaySummary = timeSegments.length > 0
    ? timeSegments.map(capitalize).join(', ')
    : undefined;
  const timeWindowSummary = (windowStart || windowEnd)
    ? `${windowStart ? formatHHMM(windowStart) : 'Any'} – ${windowEnd ? formatHHMM(windowEnd) : 'Any'}`
    : undefined;

  // ==== render. Everything below is JSX ====
  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      scrollEnabled={!draggingRow}
      header={
        <>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} />
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>{item ? 'Edit item' : 'New item'}</Text>
            {!!templateName && (
              <Text style={styles.headerSubtitle} numberOfLines={1}>{templateName}</Text>
            )}
          </View>
          <SheetHeaderButton
            label={item ? 'Save' : 'Add'}
            onPress={handleSave}
            disabled={!title.trim()}
          />
        </>
      }
      footer={
        <>
          <ChainStepQuestionSheet
            visible={questionStepId !== null}
            step={chainItems.find(c => c.id === questionStepId) ?? null}
            nextStepTitle={nextChainStepTitle(chainItems, questionStepId)}
            onSave={patch => setChainItems(prev => prev.map(
              c => (c.id === questionStepId ? { ...c, ...patch } : c),
            ))}
            onClose={() => setQuestionStepId(null)}
          />
          <NumberPadAccessory />
        </>
      }
    >
      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="Task title"
        placeholderTextColor={colors.textTertiary}
        maxLength={TITLE_MAX_LENGTH}
        multiline blurOnSubmit
      />
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes"
        placeholderTextColor={colors.textTertiary}
        multiline
      />

      {/* Blanks. Sits directly under the two fields it's about, and its hint is
          the only place the {name} syntax is written down anywhere in the app. */}
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Blanks"
          summary={blanks.length > 0 ? blanks.map(n => `{${n}}`).join(' ') : undefined}
          hint={`Type {a name in braces} in the title, notes, a subtask or a chain step. Applying the template asks for each one and puts what you enter in its place. {${RUN_PLACEHOLDER}} is filled in with the name you give the run.`}
          expanded={fieldOpen('blanks', blanks.length > 0)}
          onToggle={() => toggleField('blanks', blanks.length > 0)}
        >
          <View style={styles.blankRow}>
            {blanks.map(name => (
              <TouchableOpacity
                key={name}
                style={styles.blankChip}
                onPress={() => removeBlank(name)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Remove the ${name} blank`}
              >
                <Text style={styles.blankChipText}>{`{${name}}`}</Text>
                <Ionicons name="close" size={12} color={colors.accent} />
              </TouchableOpacity>
            ))}
            {addingBlank ? (
              <TextInput
                autoFocus
                style={styles.blankInput}
                value={newBlank}
                onChangeText={setNewBlank}
                onSubmitEditing={addBlankFromInput}
                onBlur={addBlankFromInput}
                placeholder="e.g. destination"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
              />
            ) : (
              <InlineAction icon="add" label="Add blank" variant="neutral" onPress={() => setAddingBlank(true)} />
            )}
          </View>
        </CollapsibleField>
      </View>

      {/* Only when. Sits beside Blanks because both are about what the run's
          answers do to this item — one writes them into the title, this one
          decides whether the item arrives ticked. Hidden outright when the
          template asks nothing to condition on: an empty picker of answers
          that don't exist explains itself to nobody, and the place to write
          one is the template's own editor. */}
      {choiceQuestions.length > 0 && (
        <View style={styles.sectionCard}>
          <CollapsibleField
            label="Checked by default for"
            summary={conditionSummary ?? undefined}
            emptySummary="Every run"
            hint="Arrives pre-checked when the run's answer is one of these. Everything stays on the list either way, so you can still check or uncheck it when you apply the template."
            expanded={fieldOpen('conditions', conditionSummary !== null)}
            onToggle={() => toggleField('conditions', conditionSummary !== null)}
          >
            {choiceQuestions.map(question => (
              <View key={question.id} style={styles.conditionBlock}>
                <Text style={styles.conditionLabel} numberOfLines={1}>{questionLabel(question)}</Text>
                <View style={styles.blankRow}>
                  {question.options.map(option => {
                    const on = conditions.some(c => c.questionId === question.id && c.values.includes(option));
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[styles.conditionPill, on && styles.conditionPillOn]}
                        onPress={() => toggleCondition(question.id, option)}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${questionLabel(question)}: ${option}`}
                      >
                        <Text style={[styles.conditionPillText, on && styles.conditionPillTextOn]}>{option}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </CollapsibleField>
        </View>
      )}

      {/* Scheduling relative to one of the template's two anchor dates */}
      <Text style={styles.groupLabel}>Schedule</Text>
      <View style={styles.optionsCard}>
        <View style={styles.optionRow}>
          <Ionicons name="pin-outline" size={18} color={colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Count days from</Text>
            <Text style={styles.optionHint}>
              Template items have no fixed date. Every offset below counts from this date, which you pick when applying the template.
            </Text>
          </View>
        </View>
        <View style={styles.anchorRow}>
          <SegmentedControl
            label="Count days from"
            value={anchor}
            onChange={setAnchor}
            options={(['start', 'end'] as TemplateAnchor[]).map(a => ({ value: a, label: anchorLabel(a) }))}
          />
        </View>
        <View style={styles.sep} />
        <OffsetRow
          icon="calendar"
          label="Due date"
          hint="When the task is due."
          offset={dueOffsetDays}
          anchor={anchor}
          onChange={setDueOffsetDays}
          colors={colors}
          styles={styles}
        />
        <View style={styles.sep} />
        <OffsetRow
          icon="eye-off-outline"
          label="Hide until"
          hint="Keeps the task off Today until this day."
          offset={deferOffsetDays}
          anchor={anchor}
          onChange={setDeferOffsetDays}
          colors={colors}
          styles={styles}
        />
        <View style={styles.sep} />
        <OffsetRow
          icon="flag-outline"
          label="Deadline"
          hint="A hard cut-off, shown separately from the due date."
          offset={deadlineOffsetDays}
          anchor={anchor}
          onChange={setDeadlineOffsetDays}
          colors={colors}
          styles={styles}
        />
        <View style={styles.sep} />
        <EditorRow
          icon="time-outline"
          label="Time of day"
          hint="Hold it back until a part of the day."
          value={timeOfDaySummary}
          expanded={showTimeOfDay}
          onPress={() => { animateLayout(); setShowTimeOfDay(v => !v); }}
          onClear={timeSegments.length > 0 ? () => setTimeSegments([]) : undefined}
        />
        {showTimeOfDay && (
          <View style={styles.timePillRow}>
            {(['morning', 'afternoon', 'evening', 'night'] as TimeOfDay[]).map(tod => {
              const active = timeSegments.includes(tod);
              return (
                <TouchableOpacity
                  key={tod}
                  style={[styles.timePill, active && styles.timePillActive]}
                  onPress={() => {
                    haptics.tap();
                    setTimeSegments(prev => prev.includes(tod) ? [] : [tod]);
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
        <View style={styles.sep} />
        <EditorRow
          icon="timer-outline"
          label="Time window"
          hint="Only active for part of the day, then expires."
          value={timeWindowSummary}
          expanded={showTimeWindow}
          onPress={() => { animateLayout(); setShowTimeWindow(v => !v); }}
          onClear={(windowStart || windowEnd)
            ? () => { setWindowStart(null); setWindowEnd(null); setWindowPickerMode('none'); }
            : undefined}
        />
        {showTimeWindow && (
          <>
            <View style={styles.timePillRow}>
              <TouchableOpacity
                style={[styles.timePill, !!windowStart && styles.timePillActive]}
                onPress={() => openWindowPicker('start')}
              >
                <Text style={[styles.timePillText, !!windowStart && styles.timePillTextActive]}>
                  {windowStart ? formatHHMM(windowStart) : 'Start'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.timePill, !!windowEnd && styles.timePillActive]}
                onPress={() => openWindowPicker('end')}
              >
                <Text style={[styles.timePillText, !!windowEnd && styles.timePillTextActive]}>
                  {windowEnd ? formatHHMM(windowEnd) : 'End'}
                </Text>
              </TouchableOpacity>
            </View>
            {windowPickerMode !== 'none' && (
              <>
                <DateTimePicker
                  value={windowPickerDate}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_e, d) => d && setWindowPickerDate(d)}
                  themeVariant={isDark ? 'dark' : 'light'}
                />
                <View style={styles.intervalRow}>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => setWindowPickerMode('none')}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel time window"
                  >
                    <Ionicons name="close" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={confirmWindowPicker}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm time window"
                  >
                    <Ionicons name="checkmark" size={16} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
        <View style={styles.sep} />
        <View style={styles.optionRow}>
          <Ionicons
            name="notifications"
            size={18}
            color={reminderOffsetMinutes !== null ? colors.accent : colors.textSecondary}
          />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Remind me</Text>
            {dueOffsetDays === null ? (
              <Text style={styles.optionHint}>Set a due date first</Text>
            ) : reminderOffsetMinutes === null ? (
              <Text style={styles.optionHint}>Minutes before the resolved due date</Text>
            ) : null}
          </View>
          {dueOffsetDays !== null && (
            reminderOffsetMinutes !== null ? (
              <TouchableOpacity
                onPress={() => setReminderOffsetMinutes(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear reminder"
              >
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.setBtn}
                onPress={() => { haptics.tap(); setReminderOffsetMinutes(60); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Set a reminder"
              >
                <Text style={styles.setOffsetText}>Set</Text>
              </TouchableOpacity>
            )
          )}
        </View>
        {dueOffsetDays !== null && reminderOffsetMinutes !== null && (
          <View style={styles.intervalRow}>
            <CountStepper
              value={reminderOffsetMinutes}
              onChange={m => setReminderOffsetMinutes(m ?? 60)}
              min={5}
              max={MAX_REMINDER_OFFSET_MINUTES}
              step={15}
              format={formatMinutesOffset}
              label="Reminder lead time"
            />
          </View>
        )}
        <View style={styles.sep} />
        <View style={styles.optionRow}>
          <Ionicons name="repeat" size={18} color={recurrenceType !== 'none' ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Repeat</Text>
            {recurrenceType === 'none' && <Text style={styles.optionHint}>Recreates on this schedule when applied and completed</Text>}
          </View>
          {recurrenceType !== 'none' ? (
            <TouchableOpacity
              onPress={() => setRecurrenceType('none')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear repeat schedule"
            >
              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.setBtn}
              onPress={() => { haptics.tap(); setRecurrenceType('daily'); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Set a repeat schedule"
            >
              <Text style={styles.setOffsetText}>Set</Text>
            </TouchableOpacity>
          )}
        </View>
        {recurrenceType !== 'none' && (
          <RecurrencePicker
            recurrenceType={recurrenceType}
            onChangeType={setRecurrenceType}
            recurrenceInterval={recurrenceInterval}
            onChangeInterval={setRecurrenceInterval}
            recurrenceDays={recurrenceDays}
            onChangeDays={setRecurrenceDays}
            recurrenceMonthDay={recurrenceMonthDay}
            onChangeMonthDay={setRecurrenceMonthDay}
            seedMonthDay={() => 1}
            recurrenceFromCompletion={recurrenceFromCompletion}
            onChangeFromCompletion={setRecurrenceFromCompletion}
            recurrenceCount={recurrenceCount}
            onChangeCount={setRecurrenceCount}
            countUnitLabel={() => 'occurrences'}
            neverEndsLabel="Never ends"
            afterCountLabel="After N"
            onSelectEndNever={() => setRecurrenceCount(null)}
            onSelectEndCount={() => setRecurrenceCount(c => c ?? 5)}
          />
        )}
      </View>

      {/* How the task behaves once the template is applied */}
      <Text style={styles.groupLabel}>Options</Text>
      <View style={styles.optionsCard}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setOptional(!optional); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Optional"
          accessibilityState={{ checked: optional }}
        >
          <Ionicons name="help-circle-outline" size={18} color={optional ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Optional</Text>
            <Text style={styles.optionHint}>Starts unchecked in the apply sheet, so it's skipped by default</Text>
          </View>
          <View style={[styles.toggle, optional && styles.toggleOn]}>
            <View style={[styles.toggleKnob, optional && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        <View style={styles.sep} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setVacationPause(!vacationPause); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Pause on vacation"
          accessibilityState={{ checked: vacationPause }}
        >
          <Ionicons name="airplane-outline" size={18} color={vacationPause ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Pause on vacation</Text>
            <Text style={styles.optionHint}>Hidden while vacation mode is on</Text>
          </View>
          <View style={[styles.toggle, vacationPause && styles.toggleOn]}>
            <View style={[styles.toggleKnob, vacationPause && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        <View style={styles.sep} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setExcludeFromSuggestions(!excludeFromSuggestions); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Skip in suggestions"
          accessibilityState={{ checked: excludeFromSuggestions }}
        >
          <Ionicons name="color-wand-outline" size={18} color={excludeFromSuggestions ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Skip in suggestions</Text>
            <Text style={styles.optionHint}>Keeps tasks created from this item out of suggested pins and focus sessions</Text>
          </View>
          <View style={[styles.toggle, excludeFromSuggestions && styles.toggleOn]}>
            <View style={[styles.toggleKnob, excludeFromSuggestions && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        <View style={styles.sep} />
        {/* The template-side half of Task.polarity. A "quit smoking" template
            that could only produce ordinary tasks would be missing the one
            thing it exists to set up. */}
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setPolarity(p => (p === 'negative' ? 'positive' : 'negative')); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Something to avoid"
          accessibilityState={{ checked: polarity === 'negative' }}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={18}
            color={polarity === 'negative' ? colors.accent : colors.textSecondary}
          />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Something to avoid</Text>
            <Text style={styles.optionHint}>Never completed. It stays on Today and counts the days you get through without it</Text>
          </View>
          <View style={[styles.toggle, polarity === 'negative' && styles.toggleOn]}>
            <View style={[styles.toggleKnob, polarity === 'negative' && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Chain */}
      <View style={styles.sectionCard}>
          <CollapsibleField
            label="Chain"
            summary={
              chainEnabled
                ? (chainItems.length > 1
                    ? `Step ${chainIndex + 1} of ${chainItems.length}`
                    : chainItems.length === 1
                      ? '1 step, add one more'
                      : 'No steps yet')
                : undefined
            }
            emptySummary="Off"
            // Always shown while expanded, on or off — matching TaskEditor's
            // identical fix (#791): this used to be gated on !chainEnabled, so
            // it vanished the moment Chain was turned on, and the Repeat clause
            // was gated on Chain being *off*, so a chain with Repeat off never
            // saw it either.
            hint={
              'Step through a list of items, one per completion. Finishing one reveals the next.'
              + (recurrenceType !== 'none' ? ' With Repeat on, the whole chain starts over once it finishes.' : '')
            }
            expanded={fieldOpen('chainSteps', chainEnabled)}
            onToggle={() => toggleField('chainSteps', chainEnabled)}
            right={
              <TouchableOpacity
                style={[styles.toggle, chainEnabled && styles.toggleOn]}
                onPress={() => { haptics.tap(); setChainEnabled(v => !v); }}
                accessibilityRole="switch"
                accessibilityLabel="Chain"
                accessibilityState={{ checked: chainEnabled }}
              >
                <View style={[styles.toggleKnob, chainEnabled && styles.toggleKnobOn]} />
              </TouchableOpacity>
            }
          >
          {chainEnabled && (
            <>
              <SortableList
                onDragStateChange={setDraggingRow}
                data={chainItems}
                onReorder={(newData) => {
                  const activeItemId = chainItems[chainIndex]?.id;
                  setChainItems(newData);
                  const newIdx = newData.findIndex(c => c.id === activeItemId);
                  if (newIdx !== -1) setChainIndex(newIdx);
                }}
                renderItem={(chainItem, displayIndex, drag) => {
                  const actualIdx = chainItems.findIndex(c => c.id === chainItem.id);
                  const isCurrentStep = actualIdx === chainIndex;
                  return (
                    <View style={styles.chainItemRow}>
                      <TouchableOpacity
                        onPress={() => setChainIndex(actualIdx)}
                        hitSlop={6}
                        style={styles.chainItemIndexBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Set starting step to ${chainItem.title}`}
                      >
                        <View style={[styles.chainItemDot, isCurrentStep && styles.chainItemDotActive]}>
                          <Text style={[styles.chainItemDotText, isCurrentStep && styles.chainItemDotTextActive]}>
                            {displayIndex + 1}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.chainItemTitle}
                        onLongPress={drag}
                        delayLongPress={interaction.delayLongPress}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Reorder chain step ${chainItem.title}`}
                      >
                        <Text style={[styles.chainItemTitleText, isCurrentStep && styles.chainItemTitleActive]}>
                          {chainItem.title}
                        </Text>
                      </TouchableOpacity>
                      <StepMinutes
                        value={chainItem.estimatedMinutes}
                        label={chainItem.title}
                        onChange={mins => setChainItems(prev => prev.map(
                          c => (c.id === chainItem.id ? { ...c, estimatedMinutes: mins } : c),
                        ))}
                      />
                      <StepQuestion
                        step={chainItem}
                        datesNextStep={chainItem.deliverableDatesNextStep === true}
                        onPress={() => setQuestionStepId(chainItem.id)}
                      />
                      <TouchableOpacity
                        onPress={() => {
                          // Same by-id tracking as the SortableList's own
                          // onReorder above — deleting an earlier step shifts
                          // every later index down, so re-clamping the old
                          // chainIndex by position would silently land on the
                          // wrong step.
                          const activeItemId = chainItems[chainIndex]?.id;
                          const next = chainItems.filter((_, j) => j !== actualIdx);
                          setChainItems(next);
                          if (activeItemId === chainItem.id) {
                            setChainIndex(Math.min(actualIdx, Math.max(0, next.length - 1)));
                          } else {
                            const newIdx = next.findIndex(c => c.id === activeItemId);
                            setChainIndex(newIdx !== -1 ? newIdx : Math.max(0, next.length - 1));
                          }
                        }}
                        hitSlop={8}
                        style={styles.chainItemDelete}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove chain step ${chainItem.title}`}
                      >
                        <Ionicons name="close" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
              {addingChainItem ? (
                <View style={styles.chainInputRow}>
                  <View style={styles.chainItemDot}>
                    <Text style={styles.chainItemDotText}>{chainItems.length + 1}</Text>
                  </View>
                  <TextInput
                    ref={chainInputRef}
                    autoFocus
                    style={styles.chainInput}
                    value={newChainItemTitle}
                    onChangeText={setNewChainItemTitle}
                    placeholder="Item title"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={TITLE_MAX_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      chainItemSavedRef.current = true;
                      const t = newChainItemTitle.trim();
                      if (t) setChainItems(prev => [...prev, { id: generateId(), title: t, estimatedMinutes: null }]);
                      setNewChainItemTitle('');
                      setTimeout(() => {
                        chainItemSavedRef.current = false;
                        chainInputRef.current?.focus();
                      }, 50);
                    }}
                    onBlur={() => {
                      if (chainItemSavedRef.current) return;
                      const t = newChainItemTitle.trim();
                      if (t) setChainItems(prev => [...prev, { id: generateId(), title: t, estimatedMinutes: null }]);
                      setNewChainItemTitle('');
                      setAddingChainItem(false);
                    }}
                  />
                </View>
              ) : (
                <InlineAction
                  icon="add"
                  label="Add item"
                  onPress={() => setAddingChainItem(true)}
                  style={styles.addBtnSpacing}
                />
              )}
              {chainItems.length > 0 && (
                <Text style={styles.optionHint}>
                  Times are per step; a step left blank uses the item's own estimate.
                </Text>
              )}
              {chainItems.length > 1 && (
                <Text style={styles.optionHint}>
                  Tap a number to set which step a task made from this template starts on.
                  {chainIndex > 0 ? ` Starts on step ${chainIndex + 1}: ${chainItems[chainIndex]?.title}.` : ''}
                </Text>
              )}
            </>
          )}
          </CollapsibleField>
      </View>

      {/* Ask on completion. Its own card below Chain, the way TaskEditor puts
          it below the kinds: it answers the same question they do — what
          finishing this task means — and a chained or repeating item can end
          in a decision too. */}
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Ask on completion"
          summary={deliverableKind ? deliverableMeta(deliverableKind).label : undefined}
          emptySummary="Nothing"
          hint={
            deliverableKind
              ? deliverableMeta(deliverableKind).hint
              : 'Asks you to record an answer when the task is completed, and keeps it in the Logbook.'
          }
          expanded={fieldOpen('deliverable')}
          onToggle={() => toggleField('deliverable')}
        >
          <DeliverableKindPicker
            value={deliverableKind}
            onChange={kind => { setDeliverableKind(kind); closeField('deliverable'); }}
          />
        </CollapsibleField>
      </View>

      {/* Subtasks */}
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Subtasks"
          summary={subtasks.length > 0 ? `${subtasks.length} step${subtasks.length === 1 ? '' : 's'}` : undefined}
          hint="Checklist items created alongside the task when the template is applied."
          expanded={fieldOpen('subtasks', true)}
          onToggle={() => toggleField('subtasks', true)}
        >
          <SortableList
            onDragStateChange={setDraggingRow}
            data={subtasks}
            onReorder={setSubtasks}
            renderItem={(sub, _displayIndex, drag) => (
              <View style={styles.chainItemRow}>
                <TouchableOpacity
                  style={styles.chainItemTitle}
                  onLongPress={drag}
                  delayLongPress={interaction.delayLongPress}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Reorder subtask ${sub.title}`}
                >
                  <Text style={styles.chainItemTitleText}>{sub.title}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSubtasks(prev => prev.filter(s => s.id !== sub.id))}
                  hitSlop={8}
                  style={styles.chainItemDelete}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete subtask ${sub.title}`}
                >
                  <Ionicons name="close" size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
          />
          {addingSubtask ? (
            <View style={styles.chainInputRow}>
              <TextInput
                ref={subtaskInputRef}
                autoFocus
                style={styles.chainInput}
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

      {/* Category + Tags */}
      <Text style={styles.groupLabel}>Organize</Text>
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Category"
          summary={category ? categoryLabel(category, categories) : undefined}
          hint="One home for the task. Drives the Categories screen and its filters."
          expanded={fieldOpen('category')}
          onToggle={() => toggleField('category')}
        >
          <View style={styles.pillRow}>
            <TouchableOpacity
              style={[styles.pill, !category && styles.pillActiveNeutral]}
              onPress={() => { haptics.tap(); setCategory(null); closeField('category'); }}
            >
              <Text style={[styles.pillText, !category && styles.pillTextActive]}>None</Text>
            </TouchableOpacity>
            {allCategories.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.pill, category === cat && styles.pillActiveNeutral]}
                onPress={() => { haptics.tap(); setCategory(cat); closeField('category'); }}
              >
                <Text style={[styles.pillText, category === cat && styles.pillTextActive]}>{categoryLabel(cat, categories)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Tags"
          summary={tags.length > 0 ? tags.join(', ') : undefined}
          hint="Free-form labels. A task can carry several, and you can filter or search by them."
          expanded={fieldOpen('tags')}
          onToggle={() => toggleField('tags')}
        >
          <View style={styles.tagRow}>
            {tags.map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, { backgroundColor: tagColor(tag) + '33' }]}
                onPress={() => setTags(prev => prev.filter(t => t !== tag))}
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

      {/* Priority + Effort */}
      <Text style={styles.groupLabel}>Priority & effort</Text>
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Priority"
          summary={priority > 0 ? PRIORITY_LABELS[priority] : undefined}
          hint="Ranks the task against everything else on Today."
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
          hint="Roughly how long this takes, so a day's list can be sized realistically."
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
                {EFFORT_HINTS[e] ? (
                  <Text style={styles.pillHint}>{EFFORT_HINTS[e]}</Text>
                ) : null}
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
                  accessibilityLabel="Clear custom estimate"
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </>
            ) : (
              <InlineAction
                label="Set a custom estimate"
                haptic
                onPress={() => setEstimatedMinutes(30)}
              />
            )}
          </View>
        </CollapsibleField>
      </View>
    </EditorSheet>
  );
}

/**
 * A due/defer offset row: "None" until set, then a − / + stepper over the
 * human offset label ("3 days before", "On anchor day") with a clear button.
 */
function OffsetRow({
  icon, label, hint, offset, anchor, onChange, colors, styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  offset: number | null;
  anchor: TemplateAnchor;
  onChange: (offset: number | null) => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <>
      <View style={styles.optionRow}>
        <Ionicons name={icon} size={18} color={offset !== null ? colors.accent : colors.textSecondary} />
        <View style={styles.optionContent}>
          <Text style={styles.optionLabel}>{label}</Text>
          <Text style={styles.optionHint}>
            {offset !== null ? formatOffsetWithAnchor(offset, anchor) : hint}
          </Text>
        </View>
        {offset !== null ? (
          <TouchableOpacity
            onPress={() => onChange(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
          >
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.setBtn}
            onPress={() => { haptics.tap(); onChange(0); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Set ${label.toLowerCase()}`}
          >
            <Text style={styles.setOffsetText}>Set</Text>
          </TouchableOpacity>
        )}
      </View>
      {offset !== null && (
        <View style={styles.intervalRow}>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChange(offset - 1)}
            accessibilityRole="button"
            accessibilityLabel="One day earlier"
          >
            <Ionicons name="remove" size={16} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.intervalValue}>{formatOffsetWithAnchor(offset, anchor)}</Text>
          <TouchableOpacity
            style={styles.intervalBtn}
            onPress={() => onChange(offset + 1)}
            accessibilityRole="button"
            accessibilityLabel="One day later"
          >
            <Ionicons name="add" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}
    </>
  );
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
  disabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, minHeight: 68,
    letterSpacing: -0.3,
    textAlignVertical: 'top',
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.lg, minHeight: 50,
    // No lineHeight on a TextInput. RN maps it onto the iOS paragraph style's
    // minimum/maximum line height with no compensating baseline offset, so the
    // glyphs are drawn a full line height below the top of the line box rather
    // than one ascent below it: the notes sat low in the field while the caret
    // stayed centred, and the placeholder inherited the same attributes so an
    // empty field looked wrong too. The minHeight above is what keeps the box
    // the size the lineHeight used to imply.
  },
  sectionCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
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
  blankRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  blankChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
  },
  blankChipText: { color: colors.accent, fontSize: font.sm, fontWeight: '500' },
  blankInput: {
    color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4, paddingHorizontal: 4, minWidth: 80,
  },
  /** Lifts an InlineAction off the list it appends to, and keeps it from stretching in a column. */
  addBtnSpacing: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  tagSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  tagSuggestion: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  tagSuggestionText: { color: colors.textSecondary, fontSize: font.xs },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  pillActiveNeutral: { backgroundColor: colors.bgQuaternary },
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  pillHint: { color: colors.textTertiary, fontSize: 10, marginTop: 2 },
  /** One question's row of answers. Multi-select, so the pills fill with accent rather than taking the segmented track's raised treatment — several can be on at once. */
  conditionBlock: { gap: spacing.xs, marginTop: spacing.sm },
  conditionLabel: { color: colors.textSecondary, fontSize: font.xs },
  conditionPill: {
    paddingHorizontal: 12, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  conditionPillOn: { backgroundColor: colors.accentFill },
  conditionPillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  conditionPillTextOn: { color: colors.onAccent, fontWeight: '600' },
  anchorRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  timePillRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  timePill: {
    flex: 1, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  timePillActive: { backgroundColor: colors.accent },
  timePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  timePillTextActive: { color: colors.bg, fontWeight: '600' },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.xs,
  },
  optionsCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md + 18 + spacing.md },
  setBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  setOffsetText: { color: colors.accent, fontSize: font.sm, fontWeight: '600' },
  intervalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  intervalBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  intervalValue: {
    flex: 1, color: colors.text, fontSize: font.md, fontWeight: '600',
    textAlign: 'center',
  },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: colors.bg,
  },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
  // The quiet caption after the estimate stepper, matching how a unit sits
  // beside a stepper elsewhere. CountStepper renders the number itself.
  intervalValueSm: { color: colors.textSecondary, fontSize: font.sm },
  chainItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  chainItemIndexBtn: { padding: 2 },
  chainItemDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  chainItemDotActive: { backgroundColor: colors.accentFill },
  chainItemDotText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  chainItemDotTextActive: { color: colors.onAccent },
  chainItemTitle: { flex: 1 },
  chainItemTitleText: { color: colors.text, fontSize: font.md },
  chainItemTitleActive: { color: colors.accent, fontWeight: '600' },
  chainItemDelete: { padding: 4 },
  chainInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  chainInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent, paddingVertical: 2,
  },
});
