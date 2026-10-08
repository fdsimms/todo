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
import { PinIcon } from './PinIcon';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { Priority, Effort, TimeOfDay, TemplateAnchor, TemplateItem, TemplateItemCondition, TemplateItemVariant, TemplateAnswerGate, RecurrenceType, ChainItem, RotationItem, DeliverableKind, Polarity, Difficulty, MealSlot, WeatherCondition, QuotaPeriod } from '../types';
import { PRIORITY_LABELS, EFFORT_LABELS, EFFORT_HINTS, TITLE_MAX_LENGTH, MEAL_SLOTS, MEAL_SLOT_LABELS } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { DOSE_UNITS, medicationVocabulary, medicationKey } from '../utils/medicationLog';
import { formatDuration } from '../utils/effort';
import { animateLayout } from '../utils/layoutAnimation';
import { tagColor } from '../utils/tagColor';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { describeConditions, describeVariants, questionLabel, setVariantText, toggleItemCondition, variantText } from '../utils/templateQuestions';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import {
  anchorLabel,
  formatOffsetWithAnchor,
  formatMinutesOffset,
  describePlaceholderTokens,
  itemPlaceholders,
  normalizePlaceholderName,
  withPlaceholder,
  withoutPlaceholder,
  RUN_PLACEHOLDER,
} from '../utils/templateUtils';
import { categoryLabel } from '../utils/categoryLabel';
import { formatHHMM, hhmmToDate, dateToHHMM } from '../utils/dateUtils';
import { generateId } from '../utils/id';
import { deliverableMeta, deliverableOptionsFor, parseDeliverableOptions } from '../utils/deliverables';
import { SortableList } from './SortableList';
import { DeliverableKindPicker } from './DeliverableKindPicker';
import { StepMinutes } from './StepMinutes';
import { StepQuestion } from './StepQuestion';
import { StepMedication } from './StepMedication';
import { StepLink } from './StepLink';
import { nextChainStepTitle } from '../utils/chain';
import { ChainStepQuestionSheet } from './ChainStepQuestionSheet';
import { ChainStepMedicationSheet } from './ChainStepMedicationSheet';
import { ChainStepLinkSheet } from './ChainStepLinkSheet';
import { useSettingsStore } from '../store/useSettingsStore';
import { DIFFICULTY_HINT, DIFFICULTY_PICKER_SEGMENTS, DIFFICULTY_SEGMENTS } from '../utils/rewards';
import { RecurrencePicker } from './RecurrencePicker';
import { SegmentedControl } from './SegmentedControl';
import { WEATHER_CONDITIONS, weatherConditionLabel } from '../utils/weatherTasks';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { PillGroup } from './PillGroup';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { linkHost, parseLabelledLink } from '../utils/textLinks';
import { EditorSheet } from './EditorSheet';
import { NumberPadAccessory } from './NumberPadAccessory';
import { CountStepper } from './CountStepper';
import { MAX_ROTATION_PER_WEEK, rotationPerWeek, rotationTargetTotal, withPerWeek } from '../utils/rotation';
import { normalizeTargetUnit } from '../utils/quotaUnit';
import { formatPhoneInput } from '../utils/phone';
import { capitalize } from '../utils/capitalize';
import { TextField } from './TextField';

// Ceilings for the two steppers whose hand-rolled versions had none. Both sit
// well past any real value; CountStepper needs a bound to disable its + key
// at, and an unbounded stepper is one a long press can run to nonsense.
const MAX_REMINDER_OFFSET_MINUTES = 10080;   // a week, in 15-minute steps
const MAX_CUSTOM_ESTIMATE_MINUTES = 600;     // ten hours
const COMPLETION_TIMER_STEP_MINUTES = 15;
const MAX_COMPLETION_TIMER_MINUTES = 24 * 60; // matches TaskEditor's own ceiling
// The same three bounds TaskEditor uses for a penalty, and for the same
// reasons: a quarter-hour floor because iOS refuses a very short monitored
// interval, and a day's ceiling because past that it stops being a nudge.
const PENALTY_STEP_MINUTES = 15;
const PENALTY_MIN_MINUTES = 15;
const PENALTY_MAX_MINUTES = 24 * 60;


/** Editor sections that collapse to a one-line summary of their current value. */
/** Matches TaskEditor's own cap: a label on a row, not a prescription line. */
const MEDICATION_NAME_MAX_LENGTH = 60;
/** Matches TaskEditor's own cap on the completion timer's note. */
const COMPLETION_TIMER_NOTE_MAX_LENGTH = 120;

type FieldKey = 'blanks' | 'conditions' | 'variants' | 'answerGate' | 'category' | 'tags' | 'priority' | 'effort' | 'difficulty' | 'subtasks' | 'chainSteps' | 'rotationSet' | 'deliverable' | 'completionTimer' | 'penalty' | 'medication' | 'logMealSlot' | 'link' | 'location' | 'weatherWait' | 'target' | 'phone' | 'email' | 'waitsOn';

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
  const tripTemplate = useTemplateStore(s => s.templates.find(t => t.id === templateId)?.anchorsAreAway ?? false);
  // Only a choice can gate an item: a number or a free-text answer has no
  // fixed set to pick from, so there's nothing an author could tick.
  const choiceQuestions = useTemplateStore(
    useShallow(s => (s.templates.find(t => t.id === templateId)?.questions ?? []).filter(q => q.kind === 'choice'))
  );
  // TemplateItem.answerGate: "only if <another item> is answered …".
  const [answerGate, setAnswerGate] = useState<TemplateAnswerGate | null>(null);
  // TemplateItem.blockedByItemIds: other items of this template to wait on.
  const [blockedByItemIds, setBlockedByItemIds] = useState<string[]>([]);
  // The other items in this template that ask a Yes/No or Pick one question,
  // which is what an "Only if" can wait on. An item whose own gate leads back
  // here is left out: the two tasks would each wait on the other for good.
  const templateItems = useTemplateStore(useShallow(s => s.templates.find(t => t.id === templateId)?.items ?? []));
  const questionItems = useMemo(() => {
    const byId = new Map(templateItems.map(i => [i.id, i]));
    const leadsBack = (start: TemplateItem): boolean => {
      const seen = new Set<string>();
      for (let at: TemplateItem | undefined = start; at; at = at.answerGate ? byId.get(at.answerGate.itemId) : undefined) {
        if (at.id === item?.id) return true;
        if (seen.has(at.id)) return false;
        seen.add(at.id);
      }
      return false;
    };
    return templateItems.filter(i =>
      i.id !== item?.id && !i.refTemplateId && deliverableOptionsFor(i).length >= 2 && !leadsBack(i));
  }, [templateItems, item?.id]);
  // What "Waits on" can name: the other task items here, minus any that
  // already wait (however indirectly) on this one, which would hold both for good.
  const waitCandidates = useMemo(() => {
    const byId = new Map(templateItems.map(i => [i.id, i]));
    const waitsOnThis = (start: TemplateItem): boolean => {
      const seen = new Set<string>();
      const stack = [start];
      while (stack.length > 0) {
        const at = stack.pop()!;
        if (at.id === item?.id) return true;
        if (seen.has(at.id)) continue;
        seen.add(at.id);
        for (const id of at.blockedByItemIds ?? []) { const next = byId.get(id); if (next) stack.push(next); }
      }
      return false;
    };
    return templateItems.filter(i => i.id !== item?.id && !i.refTemplateId && !waitsOnThis(i));
  }, [templateItems, item?.id]);
  const waitsOnSummary = blockedByItemIds.length > 0
    ? blockedByItemIds.map(id => templateItems.find(i => i.id === id)?.title || 'An item no longer here').join(', ')
    : null;
  const gateItem = answerGate ? templateItems.find(i => i.id === answerGate.itemId) ?? null : null;
  const gateSummary = answerGate && answerGate.answers.length > 0
    ? `${gateItem?.title || 'An item no longer here'}: ${answerGate.answers.join(' or ')}`
    : null;
  const toggleGateAnswer = (itemId: string, option: string) => {
    haptics.tap();
    setAnswerGate(prev => {
      // Ticking an answer under a different item moves the gate to that item.
      const answers = prev?.itemId === itemId ? prev.answers : [];
      const next = answers.includes(option) ? answers.filter(a => a !== option) : [...answers, option];
      return next.length > 0 ? { itemId, answers: next } : null;
    });
  };
  // Every medication ever logged, for the "Log a dose" name field's own
  // suggestions below — see medicationVocabulary for why this is derived
  // rather than a registry.
  const medicationLogs = useMedicationStore(useShallow(s => s.logs));
  const archivedMedications = useMedicationStore(useShallow(s => s.archived));
  const medicationSuggestions = useMemo(
    () => medicationVocabulary(medicationLogs, archivedMedications),
    [medicationLogs, archivedMedications]
  );

  // ==== local state: the draft, one piece of state per field ====
  const [title, setTitle] = useState('');
  const readableTitle = useMemo(() => describePlaceholderTokens(title), [title]);
  const [notes, setNotes] = useState('');
  const [optional, setOptional] = useState(false);
  const [conditions, setConditions] = useState<TemplateItemCondition[]>([]);
  const [variants, setVariants] = useState<TemplateItemVariant[]>([]);
  // True while a subtask/chain row is mid-drag. The sheet's ScrollView has to
  // stand down for the drag to survive the first finger move — a JS responder
  // nested *inside* a scroll view doesn't stop it from claiming the touch (see
  // SortableList's onDragStateChange).
  const [draggingRow, setDraggingRow] = useState(false);
  const [anchor, setAnchor] = useState<TemplateAnchor>('start');
  const [dueOffsetDays, setDueOffsetDays] = useState<number | null>(null);
  const [deferOffsetDays, setDeferOffsetDays] = useState<number | null>(null);
  const [deadlineOffsetDays, setDeadlineOffsetDays] = useState<number | null>(null);
  const [deadlineTime, setDeadlineTime] = useState<string | null>(null);
  const [deadlineTimePickerOpen, setDeadlineTimePickerOpen] = useState(false);
  const [deadlineTimePickerDate, setDeadlineTimePickerDate] = useState(new Date());
  const [windowStart, setWindowStart] = useState<string | null>(null);
  // Task.linkUrl as typed: read the way a list line is ("Booking https://…"
  // keeps the url), and a bare domain gets its https://.
  const [linkText, setLinkText] = useState('');
  // Task.location as typed; blank saves as none.
  const [locationText, setLocationText] = useState('');
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
  const [completionTimerMinutes, setCompletionTimerMinutes] = useState<number | null>(null);
  const [completionTimerNote, setCompletionTimerNote] = useState<string | null>(null);
  const [medicationName, setMedicationName] = useState<string | null>(null);
  // The typed string, parsed once on save — same call TaskEditor makes, so a
  // half-typed "2." isn't thrown away mid-keystroke.
  const [medicationAmount, setMedicationAmount] = useState('');
  const [medicationUnit, setMedicationUnit] = useState<string | null>(null);
  const [logMealSlot, setLogMealSlot] = useState<MealSlot | null>(null);
  const [penaltyMinutes, setPenaltyMinutes] = useState<number | null>(null);
  const [gatesApps, setGatesApps] = useState(false);
  const [penaltyCutoffTime, setPenaltyCutoffTime] = useState<string | null>(null);
  const [penaltyPickerOpen, setPenaltyPickerOpen] = useState(false);
  const [penaltyPickerDate, setPenaltyPickerDate] = useState(new Date());
  const [vacationPause, setVacationPause] = useState(false);
  const [excludeFromSuggestions, setExcludeFromSuggestions] = useState(false);
  const [weatherWait, setWeatherWait] = useState<WeatherCondition | null>(null);
  const weatherTasksOn = useSettingsStore(s => s.weatherTasks);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [pinEachOccurrence, setPinEachOccurrence] = useState(false);
  const [polarity, setPolarity] = useState<Polarity>('positive');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number | null>(null);
  const [recurrenceMonth, setRecurrenceMonth] = useState<number | null>(null);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  const [recurrenceCount, setRecurrenceCount] = useState<number | null>(null);
  const [recurrenceWeekOrdinal, setRecurrenceWeekOrdinal] = useState<number | null>(null);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [targetUnitText, setTargetUnitText] = useState('');
  const [quotaPeriod, setQuotaPeriod] = useState<QuotaPeriod>('day');
  const [allowOvershoot, setAllowOvershoot] = useState(false);
  const [quotaReminders, setQuotaReminders] = useState(false);
  const [chainStepOnSchedule, setChainStepOnSchedule] = useState(false);
  const [phoneText, setPhoneText] = useState('');
  const [emailText, setEmailText] = useState('');
  const [deliverableKind, setDeliverableKind] = useState<DeliverableKind | null>(null);
  const [deliverableOptionsText, setDeliverableOptionsText] = useState('');
  const [deliverableSetsAway, setDeliverableSetsAway] = useState(false);
  const [chainEnabled, setChainEnabled] = useState(false);
  const [chainItems, setChainItems] = useState<ChainItem[]>([]);
  // By id rather than index — see the same state in TaskEditor.
  const [questionStepId, setQuestionStepId] = useState<string | null>(null);
  const [medicationStepId, setMedicationStepId] = useState<string | null>(null);
  const [linkStepId, setLinkStepId] = useState<string | null>(null);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const rewardsEnabled = useSettingsStore(s => s.rewardsEnabled);
  const [chainIndex, setChainIndex] = useState(0);
  const [addingChainItem, setAddingChainItem] = useState(false);
  const [newChainItemTitle, setNewChainItemTitle] = useState('');
  const [rotationEnabled, setRotationEnabled] = useState(false);
  const [rotationItems, setRotationItems] = useState<RotationItem[]>([]);
  const [addingRotationItem, setAddingRotationItem] = useState(false);
  const [newRotationItemTitle, setNewRotationItemTitle] = useState('');
  const [linkMemberId, setLinkMemberId] = useState<string | null>(null);
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
    setVariants(item?.variants ?? draft?.variants ?? []);
    setAnswerGate(item?.answerGate ?? draft?.answerGate ?? null);
    setAnchor(item?.anchor ?? draft?.anchor ?? 'start');
    setDueOffsetDays(item?.dueOffsetDays ?? draft?.dueOffsetDays ?? null);
    setDeferOffsetDays(item?.deferOffsetDays ?? draft?.deferOffsetDays ?? null);
    setDeadlineOffsetDays(item?.deadlineOffsetDays ?? draft?.deadlineOffsetDays ?? null);
    setDeadlineTime(item?.deadlineTime ?? null);
    setDeadlineTimePickerOpen(false);
    setWindowStart(item?.windowStart ?? draft?.windowStart ?? null);
    setLinkText(item?.linkUrl ?? draft?.linkUrl ?? '');
    setLocationText(item?.location ?? draft?.location ?? '');
    setWindowEnd(item?.windowEnd ?? draft?.windowEnd ?? null);
    setReminderOffsetMinutes(item?.reminderOffsetMinutes ?? draft?.reminderOffsetMinutes ?? null);
    setTimeSegments(item?.timeSegments ?? draft?.timeSegments ?? []);
    setTags(item?.tags ?? draft?.tags ?? []);
    setCategory(item?.category ?? draft?.category ?? null);
    setPriority(item?.priority ?? draft?.priority ?? 0);
    setEffort(item?.effort ?? draft?.effort ?? 0);
    setEstimatedMinutes(item?.estimatedMinutes ?? draft?.estimatedMinutes ?? null);
    setCompletionTimerMinutes(item?.completionTimerMinutes ?? draft?.completionTimerMinutes ?? null);
    setCompletionTimerNote(item?.completionTimerNote ?? draft?.completionTimerNote ?? null);
    setMedicationName(item?.medicationName ?? draft?.medicationName ?? null);
    {
      const seeded = item?.medicationAmount ?? draft?.medicationAmount ?? null;
      setMedicationAmount(seeded !== null ? String(seeded) : '');
    }
    setMedicationUnit(item?.medicationUnit ?? draft?.medicationUnit ?? null);
    setLogMealSlot(item?.logMealSlot ?? draft?.logMealSlot ?? null);
    setPenaltyMinutes(item?.penaltyMinutes ?? draft?.penaltyMinutes ?? null);
    setGatesApps(item?.gatesApps ?? draft?.gatesApps ?? false);
    setPenaltyCutoffTime(item?.penaltyCutoffTime ?? draft?.penaltyCutoffTime ?? null);
    setVacationPause(item?.vacationPause ?? draft?.vacationPause ?? false);
    setExcludeFromSuggestions(item?.excludeFromSuggestions ?? draft?.excludeFromSuggestions ?? false);
    setWeatherWait(item?.weatherWait ?? draft?.weatherWait ?? null);
    setDifficulty(item?.difficulty ?? draft?.difficulty ?? null);
    setPinEachOccurrence(item?.pinEachOccurrence ?? draft?.pinEachOccurrence ?? false);
    setPolarity(item?.polarity ?? draft?.polarity ?? 'positive');
    setRecurrenceType(item?.recurrenceType ?? draft?.recurrenceType ?? 'none');
    setRecurrenceInterval(item?.recurrenceInterval ?? draft?.recurrenceInterval ?? 1);
    setRecurrenceDays(item?.recurrenceDays ?? draft?.recurrenceDays ?? []);
    setRecurrenceMonthDay(item?.recurrenceMonthDay ?? draft?.recurrenceMonthDay ?? null);
    setRecurrenceMonth(item?.recurrenceMonth ?? draft?.recurrenceMonth ?? null);
    setRecurrenceFromCompletion(item?.recurrenceFromCompletion ?? draft?.recurrenceFromCompletion ?? false);
    setRecurrenceCount(item?.recurrenceCount ?? draft?.recurrenceCount ?? null);
    setRecurrenceWeekOrdinal(item?.recurrenceWeekOrdinal ?? draft?.recurrenceWeekOrdinal ?? null);
    setTargetCount(item?.targetCount ?? draft?.targetCount ?? null);
    setTargetUnitText(item?.targetUnit ?? draft?.targetUnit ?? '');
    setQuotaPeriod(item?.quotaPeriod ?? draft?.quotaPeriod ?? 'day');
    setAllowOvershoot(item?.allowOvershoot ?? draft?.allowOvershoot ?? false);
    setQuotaReminders(item?.quotaReminders ?? draft?.quotaReminders ?? false);
    setChainStepOnSchedule(item?.chainStepOnSchedule ?? draft?.chainStepOnSchedule ?? false);
    setPhoneText(item?.phoneNumber ?? draft?.phoneNumber ?? '');
    setEmailText(item?.emailAddress ?? draft?.emailAddress ?? '');
    setBlockedByItemIds(item?.blockedByItemIds ?? draft?.blockedByItemIds ?? []);
    setDeliverableKind(item?.deliverableKind ?? draft?.deliverableKind ?? null);
    setDeliverableOptionsText((item?.deliverableOptions ?? draft?.deliverableOptions ?? []).join(', '));
    setDeliverableSetsAway(item?.deliverableSetsAway ?? draft?.deliverableSetsAway ?? false);
    setChainEnabled(item?.chainEnabled ?? draft?.chainEnabled ?? false);
    setChainItems(item?.chainItems ?? draft?.chainItems ?? []);
    setRotationEnabled(item?.rotationEnabled ?? false);
    setRotationItems(item?.rotationItems ?? []);
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
  const variantSummary = describeVariants(variants, choiceQuestions);

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

  // Defaults to 09:00 rather than the current time, for the reason TaskEditor's
  // own cutoff picker does: this is a time of day somebody means, not whenever
  // the sheet happened to be opened.
  const openPenaltyPicker = () => {
    setPenaltyPickerDate(hhmmToDate(penaltyCutoffTime ?? '09:00'));
    setPenaltyPickerOpen(true);
  };

  const confirmPenaltyPicker = () => {
    setPenaltyCutoffTime(dateToHHMM(penaltyPickerDate));
    setPenaltyPickerOpen(false);
  };

  // 17:00 rather than the current time, as the cutoff picker above does: this
  // is a time of day somebody means, not whenever the sheet was opened.
  const openDeadlineTimePicker = () => {
    setDeadlineTimePickerDate(hhmmToDate(deadlineTime ?? '17:00'));
    setDeadlineTimePickerOpen(true);
  };

  const confirmDeadlineTimePicker = () => {
    setDeadlineTime(dateToHHMM(deadlineTimePickerDate));
    setDeadlineTimePickerOpen(false);
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

  /** The medication a task made from this item records, or null for none. */
  const resolveMedicationName = () => medicationName?.trim() || null;

  /**
   * The dose, or null when there isn't a usable one — needs a medication to
   * belong to, a unit to be read in, and text that parses. Same rule
   * `TaskEditor` applies, since both seed the same pair of task fields.
   */
  const resolveMedicationAmount = () => {
    if (!resolveMedicationName() || !medicationUnit) return null;
    const parsed = Number(medicationAmount.trim());
    return medicationAmount.trim() !== '' && Number.isFinite(parsed) ? parsed : null;
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
      variants,
      // A gate with no answers ticked would rule the task out whatever the
      // answer, so it's dropped rather than saved.
      answerGate: answerGate && answerGate.answers.length > 0 ? answerGate : null,
      anchor,
      dueOffsetDays,
      deferOffsetDays,
      deadlineOffsetDays,
      deadlineTime: deadlineOffsetDays !== null ? deadlineTime : null,
      windowStart,
      windowEnd,
      linkUrl: parseLabelledLink(linkText)?.url ?? null,
      location: locationText.trim() || null,
      reminderOffsetMinutes: dueOffsetDays !== null ? reminderOffsetMinutes : null,
      timeSegments,
      tags: resolvePendingTags(),
      category,
      priority,
      effort,
      estimatedMinutes,
      completionTimerMinutes,
      completionTimerNote,
      medicationName: resolveMedicationName(),
      // Both halves dropped unless there is a name to attach them to and a
      // unit to read the number in — the same pairing TaskEditor saves.
      medicationAmount: resolveMedicationAmount(),
      medicationUnit: resolveMedicationAmount() !== null ? medicationUnit : null,
      logMealSlot,
      penaltyMinutes,
      // Cleared on an avoid-item for the reason TaskEditor clears it: an
      // avoid-task is never completed, so a gate on one could never be met.
      gatesApps: polarity === 'negative' ? false : gatesApps,
      // Cleared with the cost it qualifies, and on an avoid-item, which fails
      // on a tap rather than at a time — the same rule TaskEditor applies.
      penaltyCutoffTime: penaltyMinutes !== null && polarity !== 'negative' ? penaltyCutoffTime : null,
      vacationPause,
      excludeFromSuggestions,
      // Cleared with the repeat or chain it conflicts with, the rule TaskEditor
      // applies on save: only a plain one-off may wait for weather.
      weatherWait: recurrenceType === 'none' && !chainEnabled ? weatherWait : null,
      difficulty,
      // Cleared with the schedule: it only means anything on a repeating task.
      pinEachOccurrence: recurrenceType !== 'none' ? pinEachOccurrence : false,
      // Belt and braces with the row above being hidden for a chain: the two
      // are mutually exclusive, and this is what an item saved by an older
      // build carrying both is normalized by on its next save.
      polarity: chainEnabled && effectiveChainItems.length >= 2 ? 'positive' : polarity,
      recurrenceType,
      recurrenceInterval,
      // A monthly "2nd Tuesday" keeps its weekday in recurrenceDays and has no
      // month day: the three rules TaskEditor saves with.
      recurrenceDays: recurrenceType === 'weekly' || (recurrenceType === 'monthly' && recurrenceWeekOrdinal !== null) ? recurrenceDays : [],
      recurrenceMonthDay: recurrenceType === 'yearly' || (recurrenceType === 'monthly' && recurrenceWeekOrdinal === null) ? recurrenceMonthDay : null,
      recurrenceWeekOrdinal: recurrenceType === 'monthly' ? recurrenceWeekOrdinal : null,
      recurrenceMonth: recurrenceType === 'yearly' ? recurrenceMonth : null,
      recurrenceFromCompletion,
      recurrenceCount: recurrenceType !== 'none' ? recurrenceCount : null,
      deliverableKind,
      deliverableOptions: deliverableKind === 'choice' ? parseDeliverableOptions(deliverableOptionsText) : [],
      deliverableSetsAway: deliverableKind === 'date' && tripTemplate && deliverableSetsAway,
      // A chain needs at least 2 steps — activeChainStep() (src/utils/chain.ts)
      // already treats a single-item chain as equivalent to a plain task, so
      // saving with fewer than 2 items quietly turns Chain back off rather
      // than persisting a meaningless one-step "chain" that a task created
      // from this template would then silently inherit. Matches TaskEditor's
      // own save gate.
      chainEnabled: chainEnabled && effectiveChainItems.length >= 2,
      chainItems: effectiveChainItems,
      // Same two-member floor the task editor applies at save, for the same
      // reason: a set of one gives the picker nothing to ask.
      rotationEnabled: rotationEnabled && rotationItems.length >= 2,
      rotationItems: rotationItems.length >= 2 ? rotationItems : [],
      chainIndex: effectiveChainItems.length > 0 ? Math.min(chainIndex, effectiveChainItems.length - 1) : 0,
      // Only a repeating chain has a next repeat to wait for.
      chainStepOnSchedule: chainEnabled && effectiveChainItems.length >= 2 && recurrenceType !== 'none' && chainStepOnSchedule,
      subtasks: effectiveSubtasks,
      // The rest of a target is dropped with it, as TaskEditor saves it.
      // A rotation's target is the sum of its members' counts, so a count edited
      // after the kind was picked still reaches the task it creates.
      targetCount: rotationEnabled && rotationItems.length >= 2 ? rotationTargetTotal(rotationItems) : targetCount,
      targetUnit: targetCount !== null ? normalizeTargetUnit(targetUnitText) : null,
      quotaPeriod: targetCount !== null ? quotaPeriod : 'day',
      allowOvershoot: targetCount !== null && allowOvershoot,
      quotaReminders: targetCount !== null && quotaReminders,
      phoneNumber: phoneText.trim() || null,
      emailAddress: emailText.trim() || null,
      // Only items still in the template, so a deleted one isn't carried.
      blockedByItemIds: blockedByItemIds.filter(id => templateItems.some(i => i.id === id && i.id !== item?.id)),
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

  // Every blank this item declares, across every field that can hold one.
  const blanks = useMemo(
    () => itemPlaceholders({ title, notes, location: locationText, subtasks, chainItems, rotationItems, variants }),
    [title, notes, locationText, subtasks, chainItems, rotationItems, variants]
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
    setLocationText(prev => withoutPlaceholder(prev, name));
    setVariants(prev => prev.map(v => ({
      ...v,
      ...(v.title ? { title: withoutPlaceholder(v.title, name) } : {}),
      ...(v.notes ? { notes: withoutPlaceholder(v.notes, name) } : {}),
    })));
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

  const timeOfDaySummary = timeSegments.length > 0
    ? timeSegments.map(capitalize).join(', ')
    : undefined;
  const timeWindowSummary = (windowStart || windowEnd)
    ? `${windowStart ? formatHHMM(windowStart) : 'Any'}–${windowEnd ? formatHHMM(windowEnd) : 'Any'}`
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
          <ChainStepMedicationSheet
            visible={medicationStepId !== null}
            step={chainItems.find(c => c.id === medicationStepId) ?? null}
            taskMedicationName={medicationName}
            onSave={patch => setChainItems(prev => prev.map(
              c => (c.id === medicationStepId ? { ...c, ...patch } : c),
            ))}
            onClose={() => setMedicationStepId(null)}
          />
          <ChainStepLinkSheet
            visible={linkStepId !== null}
            step={chainItems.find(c => c.id === linkStepId) ?? null}
            taskLinkUrl={null}
            kitchenEnabled={kitchenEnabled}
            onSave={patch => setChainItems(prev => prev.map(
              c => (c.id === linkStepId ? { ...c, ...patch } : c),
            ))}
            onClose={() => setLinkStepId(null)}
          />
          {/* Its own instance rather than sharing linkStepId: the two lists
              have separate id spaces. */}
          <ChainStepLinkSheet
            visible={linkMemberId !== null}
            step={rotationItems.find(r => r.id === linkMemberId) ?? null}
            taskLinkUrl={null}
            kitchenEnabled={kitchenEnabled}
            onSave={patch => setRotationItems(prev => prev.map(
              r => (r.id === linkMemberId ? { ...r, ...patch } : r),
            ))}
            onClose={() => setLinkMemberId(null)}
          />
          <NumberPadAccessory />
        </>
      }
    >
      <TextField
        style={styles.titleInput}
        value={title}
        onChangeText={setTitle}
        placeholder="Task title"
        placeholderTextColor={colors.textTertiary}
        maxLength={TITLE_MAX_LENGTH}
        multiline blurOnSubmit
      />
      {/* The title in words, shown only when it holds a computed blank: the
          field has to keep the syntax, so this is the one place it is read back. */}
      {readableTitle !== title && (
        <Text style={styles.readableTitle} accessibilityLabel={`Reads as: ${readableTitle}`}>
          Reads as: {readableTitle}
        </Text>
      )}
      <TextField
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
              <TextField
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

      {/* Different text per answer. Same gate as Only when (a choice question to
          key on), and a field of its own rather than a mode of that one: it
          changes what the task says, where that one changes whether it's ticked. */}
      {choiceQuestions.length > 0 && (
        <View style={styles.sectionCard}>
          <CollapsibleField
            label="Different text for"
            summary={variantSummary ?? undefined}
            emptySummary="Same for every answer"
            hint="Replaces the title or notes above when the run's answer is the one named. Leave a field empty to keep the text above. Blanks work in it too."
            expanded={fieldOpen('variants', variantSummary !== null)}
            onToggle={() => toggleField('variants', variantSummary !== null)}
          >
            {choiceQuestions.map(question => (
              <View key={question.id} style={styles.conditionBlock}>
                <Text style={styles.conditionLabel} numberOfLines={1}>{questionLabel(question)}</Text>
                {question.options.map(option => (
                  <View key={option} style={styles.conditionBlock}>
                    <Text style={styles.conditionLabel} numberOfLines={1}>{option}</Text>
                    <TextField
                      style={styles.notesInput}
                      value={variantText(variants, question.id, option, 'title')}
                      onChangeText={text => setVariants(prev => setVariantText(prev, question.id, option, 'title', text))}
                      placeholder={`Title when ${option}`}
                      placeholderTextColor={colors.textTertiary}
                      accessibilityLabel={`Title when ${questionLabel(question)} is ${option}`}
                    />
                    <TextField
                      style={styles.notesInput}
                      value={variantText(variants, question.id, option, 'notes')}
                      onChangeText={text => setVariants(prev => setVariantText(prev, question.id, option, 'notes', text))}
                      placeholder={`Notes when ${option}`}
                      placeholderTextColor={colors.textTertiary}
                      accessibilityLabel={`Notes when ${questionLabel(question)} is ${option}`}
                      multiline
                    />
                  </View>
                ))}
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
            options={(['start', 'end'] as TemplateAnchor[]).map(a => ({ value: a, label: anchorLabel(a, tripTemplate) }))}
          />
        </View>
        <View style={styles.sep} />
        <OffsetRow
          icon="calendar"
          label="Due date"
          hint="When the task is due."
          offset={dueOffsetDays}
          anchor={anchor}
          away={tripTemplate}
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
          away={tripTemplate}
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
          away={tripTemplate}
          onChange={v => { setDeadlineOffsetDays(v); if (v === null) { setDeadlineTime(null); setDeadlineTimePickerOpen(false); } }}
          colors={colors}
          styles={styles}
        />
        {deadlineOffsetDays !== null && (
          <>
            <View style={styles.timePillRow}>
              <TouchableOpacity
                style={[styles.timePill, !!deadlineTime && styles.timePillActive]}
                onPress={openDeadlineTimePicker}
                accessibilityRole="button"
                accessibilityLabel={deadlineTime ? `Deadline time ${formatHHMM(deadlineTime)}` : 'Add a time to the deadline'}
              >
                <Text style={[styles.timePillText, !!deadlineTime && styles.timePillTextActive]}>
                  {deadlineTime ? formatHHMM(deadlineTime) : 'Add a time'}
                </Text>
              </TouchableOpacity>
              {deadlineTime !== null && (
                <TouchableOpacity
                  style={styles.timePill}
                  onPress={() => { setDeadlineTime(null); setDeadlineTimePickerOpen(false); }}
                  accessibilityRole="button"
                  accessibilityLabel="Make the deadline the whole day"
                >
                  <Text style={styles.timePillText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            {deadlineTimePickerOpen && (
              <>
                <DateTimePicker
                  value={deadlineTimePickerDate}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_e, d) => d && setDeadlineTimePickerDate(d)}
                  themeVariant={isDark ? 'dark' : 'light'}
                />
                <View style={styles.intervalRow}>
                  <TouchableOpacity hitSlop={8}
                    style={styles.intervalBtn}
                    onPress={() => setDeadlineTimePickerOpen(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel deadline time"
                  >
                    <Ionicons name="close" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity hitSlop={8}
                    style={styles.intervalBtn}
                    onPress={confirmDeadlineTimePicker}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm deadline time"
                  >
                    <Ionicons name="checkmark" size={16} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
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
                  <TouchableOpacity hitSlop={8}
                    style={styles.intervalBtn}
                    onPress={() => setWindowPickerMode('none')}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel time window"
                  >
                    <Ionicons name="close" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity hitSlop={8}
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
            recurrenceMonth={recurrenceMonth}
            onChangeMonth={setRecurrenceMonth}
            seedMonth={() => 1}
            recurrenceFromCompletion={recurrenceFromCompletion}
            onChangeFromCompletion={setRecurrenceFromCompletion}
            recurrenceCount={recurrenceCount}
            onChangeCount={setRecurrenceCount}
            countUnitLabel={() => 'times'}
            neverEndsLabel="Never ends"
            afterCountLabel="After N"
            onSelectEndNever={() => setRecurrenceCount(null)}
            onSelectEndCount={() => setRecurrenceCount(c => c ?? 5)}
            // A template has no date of its own to seed the weekday from, so
            // "the Nth weekday" starts on Monday and the author picks.
            weekOrdinal={{ value: recurrenceWeekOrdinal, onChange: setRecurrenceWeekOrdinal, seedWeekday: () => 1 }}
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
        {recurrenceType !== 'none' && (
          <>
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setPinEachOccurrence(!pinEachOccurrence); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityLabel="Pin every occurrence"
              accessibilityState={{ checked: pinEachOccurrence }}
            >
              <PinIcon filled={pinEachOccurrence} size={18} color={pinEachOccurrence ? colors.orangeText : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Pin every occurrence</Text>
                <Text style={styles.optionHint}>Each occurrence of tasks created from this item starts out pinned to Today</Text>
              </View>
              <View style={[styles.toggle, pinEachOccurrence && styles.toggleOn]}>
                <View style={[styles.toggleKnob, pinEachOccurrence && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={styles.sep} />
          </>
        )}
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
        {recurrenceType === 'none' && !chainEnabled && (weatherTasksOn || weatherWait !== null) && (
          <>
            <CollapsibleField
              label="Wait for weather"
              summary={weatherWait ? weatherConditionLabel(weatherWait) : undefined}
              emptySummary="Off"
              hint={weatherTasksOn
                ? 'Holds tasks made from this item until the first day in the next 14 with this forecast.'
                : 'Turn on Weather-based tasks in Settings, with location access, so the app can read the forecast. Until then these tasks are not held.'}
              expanded={fieldOpen('weatherWait')}
              onToggle={() => toggleField('weatherWait')}
            >
              <SegmentedControl
                label="Wait for a day that is"
                value={weatherWait}
                onChange={next => setWeatherWait(next === weatherWait ? null : next)}
                options={WEATHER_CONDITIONS.map(c => ({ value: c, label: weatherConditionLabel(c) }))}
              />
            </CollapsibleField>
            <View style={styles.sep} />
          </>
        )}
        <CollapsibleField
          label="Completion timer"
          summary={completionTimerMinutes !== null
            ? [`${formatDuration(completionTimerMinutes)} after completing`, completionTimerNote || null].filter(Boolean).join(': ')
            : undefined}
          hint="Asks to set a reminder this long after a task made from this item is completed, e.g. a two-hour wait before eating after a medication."
          expanded={fieldOpen('completionTimer')}
          onToggle={() => toggleField('completionTimer')}
        >
          <CountStepper
            value={completionTimerMinutes}
            onChange={setCompletionTimerMinutes}
            min={COMPLETION_TIMER_STEP_MINUTES}
            max={MAX_COMPLETION_TIMER_MINUTES}
            step={COMPLETION_TIMER_STEP_MINUTES}
            allowNull
            emptyLabel="Off"
            label="Completion timer"
            format={formatDuration}
            describeValue={n => (n === null ? 'off' : formatDuration(n))}
          />
          {completionTimerMinutes !== null && (
            <TextField
              style={[styles.fieldBox, styles.medicationAmountInput]}
              value={completionTimerNote ?? ''}
              onChangeText={text => setCompletionTimerNote(text || null)}
              placeholder="e.g. Don't eat for 2 hours"
              placeholderTextColor={colors.textTertiary}
              maxLength={COMPLETION_TIMER_NOTE_MAX_LENGTH}
              returnKeyType="done"
              accessibilityLabel="What this reminder is for"
            />
          )}
        </CollapsibleField>
        <View style={styles.sep} />
        {/* Beside the completion timer, whose own hint already names a
            recurring medication as its case. Seeds the task-side pair, so a
            routine template hands out a task that records its dose rather than
            one somebody has to set up again by hand. */}
        <CollapsibleField
          label="Log a dose"
          summary={
            medicationName
              ? [medicationName, resolveMedicationAmount() !== null ? `${resolveMedicationAmount()} ${medicationUnit}` : null]
                  .filter(Boolean).join(', ')
              : undefined
          }
          hint="Tasks made from this item record a dose in your medication log each time they're completed."
          expanded={fieldOpen('medication')}
          onToggle={() => toggleField('medication')}
        >
          <TextField
            style={styles.fieldBox}
            value={medicationName ?? ''}
            onChangeText={text => setMedicationName(text || null)}
            placeholder="e.g. Sertraline"
            placeholderTextColor={colors.textTertiary}
            maxLength={MEDICATION_NAME_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="What tasks from this item record a dose of"
          />
          {/* Picking one of these is what makes it the *same* medication as an
              earlier dose — medicationKey does no fuzzy matching (see
              docs/arch/mood-log.md), so retyping "Sertraline" as "sertraline"
              would otherwise split one medicine's history into two untallied
              entries. */}
          {medicationSuggestions.length > 0 && (
            <PillGroup
              noun="medication"
              surface="card"
              options={medicationSuggestions.map(name => ({
                key: medicationKey(name),
                label: name,
                selected: !!medicationName && medicationKey(name) === medicationKey(medicationName),
                onPress: () => { haptics.tap(); setMedicationName(name); },
              }))}
            />
          )}
          {medicationName !== null && (
            <>
              <TextField
                style={[styles.fieldBox, styles.medicationAmountInput]}
                value={medicationAmount}
                onChangeText={setMedicationAmount}
                placeholder="e.g. 50"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel="How much, optional"
              />
              <SegmentedControl
                options={DOSE_UNITS.map(u => ({ value: u.value, label: u.value }))}
                value={medicationUnit ?? ''}
                columns={5}
                label="Unit"
                surface="card"
                onChange={next => { haptics.tap(); setMedicationUnit(next === medicationUnit ? null : next); }}
              />
            </>
          )}
        </CollapsibleField>
        <View style={styles.sep} />
        {/* Seeds Task.logMealSlot — same reasoning as the medication row
            above: a "Log breakfast" routine template shouldn't need its slot
            re-picked by hand on every application. */}
        <CollapsibleField
          label="Log to food log"
          summary={logMealSlot ? `Offers to log ${MEAL_SLOT_LABELS[logMealSlot].toLowerCase()} when completed` : undefined}
          hint="Tasks made from this item offer to add an entry to your food log, for the slot below, each time they're completed."
          expanded={fieldOpen('logMealSlot')}
          onToggle={() => toggleField('logMealSlot')}
        >
          <SegmentedControl<MealSlot>
            options={MEAL_SLOTS.map(slot => ({ value: slot, label: MEAL_SLOT_LABELS[slot] }))}
            value={logMealSlot ?? 'breakfast'}
            onChange={next => { haptics.tap(); setLogMealSlot(prev => (prev === next ? null : next)); }}
            columns={2}
            label="Meal"
            surface="card"
          />
        </CollapsibleField>
        <View style={styles.sep} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setGatesApps(!gatesApps); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Block apps until done"
          accessibilityState={{ checked: gatesApps }}
        >
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Block apps until done</Text>
            <Text style={styles.optionHint}>Tasks made from this item hold the apps you picked in Settings until they're done</Text>
          </View>
          <View style={[styles.toggle, gatesApps && styles.toggleOn]}>
            <View style={[styles.toggleKnob, gatesApps && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        <View style={styles.sep} />
        <CollapsibleField
          label={polarity === 'negative' ? 'Block apps on a slip' : 'Block apps if missed'}
          summary={penaltyMinutes === null
            ? undefined
            : polarity === 'negative'
              ? `${formatDuration(penaltyMinutes)} each time`
              : penaltyCutoffTime
                ? `${formatDuration(penaltyMinutes)} after ${formatHHMM(penaltyCutoffTime)}`
                : `${formatDuration(penaltyMinutes)} if not done that day`}
          hint="Seeds the cost on tasks made from this item. Needs the setting switched on in Settings before anything is actually blocked."
          expanded={fieldOpen('penalty')}
          onToggle={() => toggleField('penalty')}
        >
          <CountStepper
            value={penaltyMinutes}
            onChange={setPenaltyMinutes}
            min={PENALTY_MIN_MINUTES}
            max={PENALTY_MAX_MINUTES}
            step={PENALTY_STEP_MINUTES}
            allowNull
            emptyLabel="No block"
            label="Block length"
            format={formatDuration}
            describeValue={n => (n === null ? 'no block' : formatDuration(n))}
          />
          {polarity !== 'negative' && penaltyMinutes !== null && (
            <>
              <View style={styles.timePillRow}>
                <TouchableOpacity
                  style={[styles.timePill, !!penaltyCutoffTime && styles.timePillActive]}
                  onPress={openPenaltyPicker}
                >
                  <Text style={[styles.timePillText, !!penaltyCutoffTime && styles.timePillTextActive]}>
                    {penaltyCutoffTime ? formatHHMM(penaltyCutoffTime) : 'End of day'}
                  </Text>
                </TouchableOpacity>
                {penaltyCutoffTime !== null && (
                  <TouchableOpacity
                    style={styles.timePill}
                    onPress={() => { setPenaltyCutoffTime(null); setPenaltyPickerOpen(false); }}
                    accessibilityRole="button"
                    accessibilityLabel="Judge at the end of the day instead"
                  >
                    <Text style={styles.timePillText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              {penaltyPickerOpen && (
                <>
                  <DateTimePicker
                    value={penaltyPickerDate}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_e, d) => d && setPenaltyPickerDate(d)}
                    themeVariant={isDark ? 'dark' : 'light'}
                  />
                  <View style={styles.intervalRow}>
                    <TouchableOpacity hitSlop={8}
                      style={styles.intervalBtn}
                      onPress={() => setPenaltyPickerOpen(false)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel cutoff time"
                    >
                      <Ionicons name="close" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity hitSlop={8}
                      style={styles.intervalBtn}
                      onPress={confirmPenaltyPicker}
                      accessibilityRole="button"
                      accessibilityLabel="Confirm cutoff time"
                    >
                      <Ionicons name="checkmark" size={16} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}
        </CollapsibleField>
        {/* The template-side half of Task.polarity. A "quit smoking" template
            that could only produce ordinary tasks would be missing the one
            thing it exists to set up.

            Hidden once the item is a chain, the same way TaskEditor gates its
            Goal row on kind === 'task': an avoid-task is never completed, and
            a chain is a list of steps advanced by completions. Offering both
            produced an item whose task read as a chain everywhere — which is
            what taskKindOf answers for a row carrying both — with the shield
            drawn on it and the Goal row then hidden behind that kind, so the
            polarity could no longer be reached and turned off. */}
        {!chainEnabled && (
        <>
        <View style={styles.sep} />
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
        </>
        )}
      </View>

      {/* Target: a counted target ("8 glasses a day"), as TaskEditor's Daily
          target row. The interval form and the water link aren't offered here;
          see templateItemParity.test.ts. */}
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Target"
          summary={targetCount !== null
            ? `${targetCount}${normalizeTargetUnit(targetUnitText) ? ` ${normalizeTargetUnit(targetUnitText)}` : '×'} a ${quotaPeriod}`
            : undefined}
          emptySummary="None"
          hint="Count it several times instead of ticking it once, like 8 glasses a day or 3 runs a week."
          expanded={fieldOpen('target', targetCount !== null)}
          onToggle={() => toggleField('target', targetCount !== null)}
        >
          <CountStepper
            value={targetCount}
            onChange={setTargetCount}
            min={2}
            max={99}
            allowNull
            start={2}
            emptyLabel="None"
            label={quotaPeriod === 'week' ? 'Weekly target' : 'Daily target'}
          />
          {targetCount !== null && (
            <>
              <View style={styles.chainModeBlock}>
                <SegmentedControl
                  label="Target per"
                  value={quotaPeriod}
                  onChange={setQuotaPeriod}
                  options={[
                    { value: 'day', label: 'Per day' },
                    { value: 'week', label: 'Per week' },
                  ]}
                />
              </View>
              <TextField
                style={[styles.fieldBox, styles.deliverableOptionsInput]}
                value={targetUnitText}
                onChangeText={setTargetUnitText}
                placeholder="e.g. glasses"
                placeholderTextColor={colors.textTertiary}
                autoCorrect={false}
                returnKeyType="done"
                accessibilityLabel="What the target counts"
              />
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => { haptics.tap(); setQuotaReminders(v => !v); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityLabel="Notify me when each one is due"
                accessibilityState={{ checked: quotaReminders }}
              >
                <Ionicons name="notifications-outline" size={18} color={quotaReminders ? colors.accent : colors.textSecondary} />
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>Notify me when each one is due</Text>
                  <Text style={styles.optionHint}>Send a notification at each one, instead of only showing the task on Today</Text>
                </View>
                <View style={[styles.toggle, quotaReminders && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, quotaReminders && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => { haptics.tap(); setAllowOvershoot(v => !v); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="switch"
                accessibilityLabel="Allow going past target"
                accessibilityState={{ checked: allowOvershoot }}
              >
                <Ionicons name="trending-up-outline" size={18} color={allowOvershoot ? colors.accent : colors.textSecondary} />
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>Allow going past target</Text>
                  <Text style={styles.optionHint}>Keep logging past {targetCount}×. It stays on Today and completes at the end of the {quotaPeriod} with whatever count you reached</Text>
                </View>
                <View style={[styles.toggle, allowOvershoot && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, allowOvershoot && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            </>
          )}
        </CollapsibleField>
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
                onPress={() => {
                  haptics.tap();
                  setChainEnabled(v => {
                    // Same reset applyKind makes when a kind is chosen: the two
                    // can't both hold, and the row above is about to go away.
                    if (!v) setPolarity('positive');
                    return !v;
                  });
                }}
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
                      <StepMedication
                        step={chainItem}
                        taskMedicationName={medicationName}
                        onPress={() => setMedicationStepId(chainItem.id)}
                      />
                      <StepLink
                        step={chainItem}
                        taskLinkUrl={null}
                        onPress={() => setLinkStepId(chainItem.id)}
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
                  <TextField
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
              {chainItems.length > 1 && (
                <View style={styles.chainModeBlock}>
                  <SegmentedControl
                    label="Next step"
                    value={chainStepOnSchedule}
                    onChange={setChainStepOnSchedule}
                    options={[
                      { value: false, label: 'Right away', accessibilityLabel: 'Next step right away' },
                      // Disabled rather than hidden, as in TaskEditor, so it's
                      // visible that a repeat is what unlocks it.
                      { value: true, label: 'On the next repeat', accessibilityLabel: 'Next step on the next repeat', disabled: recurrenceType === 'none' },
                    ]}
                  />
                  <Text style={styles.optionHint}>
                    {recurrenceType === 'none'
                      ? 'Steps follow each other as you finish them. Add a repeat to spread them over days instead.'
                      : chainStepOnSchedule
                        ? 'One step per repeat. The chain rotates through its steps rather than running straight through.'
                        : 'Finishing a step brings up the next one immediately; the repeat starts the whole chain over.'}
                  </Text>
                </View>
              )}
            </>
          )}
          </CollapsibleField>
      </View>

      {/* Rotation. Its own card beside Chain because the two are the pair
          people confuse: both hold a list, and the difference is whether the
          order is fixed. See utils/rotation.ts. */}
      <View style={styles.sectionCard}>
        <CollapsibleField
          label="Rotation"
          summary={
            rotationEnabled
              ? (rotationItems.length > 1
                  ? `${rotationItems.length} things, ${rotationTargetTotal(rotationItems)} times a week`
                  : rotationItems.length === 1
                    ? '1 thing, add one more'
                    : 'Nothing in the set yet')
              : undefined
          }
          emptySummary="Off"
          hint="A set of things to get through each week, in any order, each with its own number of times a week. Checking the task off asks which one you did."
          expanded={fieldOpen('rotationSet', rotationEnabled)}
          onToggle={() => toggleField('rotationSet', rotationEnabled)}
          right={
            <TouchableOpacity
              onPress={() => { haptics.tap(); setRotationEnabled(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              style={[styles.toggle, rotationEnabled && styles.toggleOn]}
              accessibilityRole="switch"
              accessibilityLabel="Rotation"
              accessibilityState={{ checked: rotationEnabled }}
            >
              <View style={[styles.toggleKnob, rotationEnabled && styles.toggleKnobOn]} />
            </TouchableOpacity>
          }
        >
        {rotationEnabled && (
          <>
            <SortableList
              onDragStateChange={setDraggingRow}
              data={rotationItems}
              onReorder={setRotationItems}
              renderItem={(rotationItem, _displayIndex, drag) => (
              <View>
              <View style={styles.chainItemRow}>
                <TouchableOpacity
                  onLongPress={drag}
                  delayLongPress={interaction.delayLongPress}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Reorder ${rotationItem.title}`}
                >
                  <Ionicons name="reorder-two-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                <TextField
                  style={styles.chainInput}
                  value={rotationItem.title}
                  onChangeText={text => setRotationItems(prev => prev.map(
                    r => (r.id === rotationItem.id ? { ...r, title: text } : r)))}
                  placeholder="Name"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={TITLE_MAX_LENGTH}
                />
                <StepLink
                  step={rotationItem}
                  taskLinkUrl={null}
                  onPress={() => setLinkMemberId(rotationItem.id)}
                />
                <TouchableOpacity
                  onPress={() => setRotationItems(prev => prev.filter(r => r.id !== rotationItem.id))}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${rotationItem.title} from the rotation`}
                >
                  <Ionicons name="close" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <View style={styles.rotationCountRow}>
                <Text style={styles.optionHint}>Times a week</Text>
                <CountStepper
                  value={rotationPerWeek(rotationItem)}
                  min={1}
                  max={MAX_ROTATION_PER_WEEK}
                  label={`times a week for ${rotationItem.title || 'this item'}`}
                  format={n => `${n}×`}
                  onChange={n => setRotationItems(prev => prev.map(
                    r => (r.id === rotationItem.id ? withPerWeek(r, n ?? 1) : r)))}
                />
              </View>
              </View>
              )}
            />
            {addingRotationItem ? (
              <View style={styles.chainItemRow}>
                <Ionicons name="reorder-two-outline" size={16} color={colors.bgQuaternary} />
                <TextField
                  autoFocus
                  style={styles.chainInput}
                  value={newRotationItemTitle}
                  onChangeText={setNewRotationItemTitle}
                  placeholder="e.g. Spanish"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={TITLE_MAX_LENGTH}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    const t = newRotationItemTitle.trim();
                    if (t) setRotationItems(prev => [...prev, { id: generateId(), title: t, linkUrl: null }]);
                    setNewRotationItemTitle('');
                  }}
                  onBlur={() => {
                    const t = newRotationItemTitle.trim();
                    if (t) setRotationItems(prev => [...prev, { id: generateId(), title: t, linkUrl: null }]);
                    setNewRotationItemTitle('');
                    setAddingRotationItem(false);
                  }}
                />
              </View>
            ) : (
              <InlineAction
                icon="add"
                label="Add to the set"
                onPress={() => setAddingRotationItem(true)}
                style={styles.addBtnSpacing}
              />
            )}
            {rotationItems.length === 1 && (
              <Text style={styles.optionHint}>
                Add a second one: a rotation needs at least 2 things to save.
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
        {deliverableKind === 'choice' && (
          <TextField
            style={[styles.fieldBox, styles.deliverableOptionsInput]}
            value={deliverableOptionsText}
            onChangeText={setDeliverableOptionsText}
            placeholder="e.g. Yes, No, Maybe"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            accessibilityLabel="Options to pick from, separated by commas"
          />
        )}
        {/* Fewer than two options and completing asks nothing
            (deliverableOptionsFor), so say so where they're typed. */}
        {deliverableKind === 'choice' && parseDeliverableOptions(deliverableOptionsText).length < 2 && (
          <Text style={styles.choiceOptionsHint}>
            Add at least two options, separated by commas. With fewer, completing the task asks nothing.
          </Text>
        )}
        {/* Only on a trip template: "Pick dates" answered with the 14th is
            the trip leaving on the 14th, so the project it lands in can
            learn its Leaving date from the answer. */}
        {deliverableKind === 'date' && tripTemplate && (
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); setDeliverableSetsAway(!deliverableSetsAway); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityLabel="Use the answer as the trip's leaving date"
            accessibilityState={{ checked: deliverableSetsAway }}
          >
            <Ionicons name="airplane-outline" size={18} color={deliverableSetsAway ? colors.accent : colors.textSecondary} />
            <View style={styles.optionContent}>
              <Text style={styles.optionLabel}>Sets the leaving date</Text>
              <Text style={styles.optionHint}>The date you answer becomes the trip's Leaving date, if it doesn't have one yet</Text>
            </View>
            <View style={[styles.toggle, deliverableSetsAway && styles.toggleOn]}>
              <View style={[styles.toggleKnob, deliverableSetsAway && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Only if: the branch half of a decision, as TaskEditor's row of the
          same name. Hidden while no other item asks a question with answers
          to pick, for the reason "Checked by default for" hides itself. */}
      {(questionItems.length > 0 || answerGate !== null) && (
        <View style={styles.sectionCard}>
          <CollapsibleField
            label="Only if"
            summary={gateSummary ?? undefined}
            emptySummary="Always"
            hint="Waits for another item's question to be answered, then shows only for the answers you pick. Any other answer marks it not needed."
            expanded={fieldOpen('answerGate', gateSummary !== null)}
            onToggle={() => toggleField('answerGate', gateSummary !== null)}
          >
            {questionItems.map(q => (
              <View key={q.id} style={styles.conditionBlock}>
                <Text style={styles.conditionLabel} numberOfLines={1}>{q.title || 'Untitled'}</Text>
                <View style={styles.blankRow}>
                  {deliverableOptionsFor(q).map(option => {
                    const on = answerGate?.itemId === q.id && answerGate.answers.includes(option);
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[styles.conditionPill, on && styles.conditionPillOn]}
                        onPress={() => toggleGateAnswer(q.id, option)}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`Only if ${q.title} is ${option}`}
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

      {/* Waits on: TaskEditor's "Waiting on", pointed at other items of this
          template, since the tasks they become don't exist yet. Hidden while
          there's nothing else here to wait on. */}
      {(waitCandidates.length > 0 || blockedByItemIds.length > 0) && (
        <View style={styles.sectionCard}>
          <CollapsibleField
            label="Waits on"
            summary={waitsOnSummary ?? undefined}
            emptySummary="Nothing"
            hint="Holds the task back until these items' tasks are done. An item left unticked when the template is applied is skipped."
            expanded={fieldOpen('waitsOn', waitsOnSummary !== null)}
            onToggle={() => toggleField('waitsOn', waitsOnSummary !== null)}
          >
            <View style={styles.blankRow}>
              {waitCandidates.map(candidate => {
                const on = blockedByItemIds.includes(candidate.id);
                return (
                  <TouchableOpacity
                    key={candidate.id}
                    style={[styles.conditionPill, on && styles.conditionPillOn]}
                    onPress={() => {
                      haptics.tap();
                      setBlockedByItemIds(prev => (on ? prev.filter(id => id !== candidate.id) : [...prev, candidate.id]));
                    }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Waits on ${candidate.title}`}
                  >
                    <Text style={[styles.conditionPillText, on && styles.conditionPillTextOn]} numberOfLines={1}>
                      {candidate.title || 'Untitled'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </CollapsibleField>
        </View>
      )}

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
              <TextField
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
              <TextField
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

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Link"
          summary={parseLabelledLink(linkText) ? linkHost(parseLabelledLink(linkText)!.url) : undefined}
          hint="A page each task made from this item opens from its row, like a booking page or a form."
          expanded={fieldOpen('link')}
          onToggle={() => toggleField('link')}
        >
          <TextField
            style={[styles.fieldBox, styles.deliverableOptionsInput]}
            value={linkText}
            onChangeText={setLinkText}
            placeholder="e.g. https://example.com/booking"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            accessibilityLabel="Link"
          />
          {/* Said here rather than dropped on save without a word. */}
          {linkText.trim() !== '' && !parseLabelledLink(linkText) && (
            <Text style={styles.choiceOptionsHint}>That isn't a link yet, so it won't be saved.</Text>
          )}
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Location"
          summary={locationText.trim() || undefined}
          hint="Where each task made from this item happens, like an appointment's address or a venue."
          expanded={fieldOpen('location')}
          onToggle={() => toggleField('location')}
        >
          <TextField
            style={[styles.fieldBox, styles.deliverableOptionsInput]}
            value={locationText}
            onChangeText={setLocationText}
            placeholder="e.g. 156 William Street"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="Location"
          />
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Phone"
          summary={phoneText.trim() || undefined}
          hint="A number each task made from this item can call, like the clinic or the office."
          expanded={fieldOpen('phone')}
          onToggle={() => toggleField('phone')}
        >
          <TextField
            style={[styles.fieldBox, styles.deliverableOptionsInput]}
            value={phoneText}
            onChangeText={t => setPhoneText(formatPhoneInput(t))}
            placeholder="e.g. (555) 010-0199"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            returnKeyType="done"
            accessibilityLabel="Phone number"
          />
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Email"
          summary={emailText.trim() || undefined}
          hint="An address each task made from this item can write to."
          expanded={fieldOpen('email')}
          onToggle={() => toggleField('email')}
        >
          <TextField
            style={[styles.fieldBox, styles.deliverableOptionsInput]}
            value={emailText}
            onChangeText={setEmailText}
            placeholder="e.g. office@example.com"
            placeholderTextColor={colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="Email address"
          />
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

        {/* Seeds Task.difficulty, and offered on the same terms the task
            editor offers it: only while the coin rules that read it run. */}
        {rewardsEnabled && polarity !== 'negative' && (
          <>
            <View style={styles.cardSep} />
            <CollapsibleField
              label="Difficulty"
              summary={DIFFICULTY_SEGMENTS.find(d => d.value === difficulty)?.label}
              emptySummary="Not set"
              hint={DIFFICULTY_HINT}
              expanded={fieldOpen('difficulty')}
              onToggle={() => toggleField('difficulty')}
            >
              <SegmentedControl
                label="Difficulty"
                value={difficulty}
                onChange={d => { setDifficulty(d); closeField('difficulty'); }}
                options={DIFFICULTY_PICKER_SEGMENTS}
              />
            </CollapsibleField>
          </>
        )}
      </View>
    </EditorSheet>
  );
}

/**
 * A due/defer offset row: "None" until set, then a − / + stepper over the
 * human offset label ("3 days before", "On anchor day") with a clear button.
 */
function OffsetRow({
  icon, label, hint, offset, anchor, away, onChange, colors, styles,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  offset: number | null;
  anchor: TemplateAnchor;
  /** A trip template's: its anchors read as leaving and coming back. */
  away: boolean;
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
            {offset !== null ? formatOffsetWithAnchor(offset, anchor, away) : hint}
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
          <TouchableOpacity hitSlop={8}
            style={styles.intervalBtn}
            onPress={() => onChange(offset - 1)}
            // A week at a time on a hold: "6 weeks before" was 42 taps.
            onLongPress={() => { haptics.tap(); onChange(offset - 7); }}
            delayLongPress={interaction.delayLongPress}
            accessibilityRole="button"
            accessibilityLabel="One day earlier"
            accessibilityHint="Hold to move a week earlier"
          >
            <Ionicons name="remove" size={16} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.intervalValue}>{formatOffsetWithAnchor(offset, anchor, away)}</Text>
          <TouchableOpacity hitSlop={8}
            style={styles.intervalBtn}
            onPress={() => onChange(offset + 1)}
            onLongPress={() => { haptics.tap(); onChange(offset + 7); }}
            delayLongPress={interaction.delayLongPress}
            accessibilityRole="button"
            accessibilityLabel="One day later"
            accessibilityHint="Hold to move a week later"
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
  headerSubtitle: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xs },
  disabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  readableTitle: {
    color: colors.textSecondary, fontSize: font.sm,
    paddingHorizontal: spacing.md, marginBottom: spacing.md,
  },
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
  pillHint: { color: colors.textTertiary, fontSize: font.xxs, marginTop: spacing.xxs },
  /** One question's row of answers. Multi-select, so the pills fill with accent rather than taking the segmented track's raised treatment — several can be on at once. */
  conditionBlock: { gap: spacing.xs, marginTop: spacing.sm },
  conditionLabel: { color: colors.textSecondary, fontSize: font.xs },
  conditionPill: {
    paddingHorizontal: spacing.smd, paddingVertical: spacing.sm,
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
  timePillActive: { backgroundColor: colors.accentFill },
  timePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  timePillTextActive: { color: colors.onAccent, fontWeight: '600' },
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
  rotationCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
    paddingBottom: spacing.xsm,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md + 18 + spacing.md },
  setBtn: {
    paddingHorizontal: spacing.smd, paddingVertical: 5,
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
  chainItemIndexBtn: { padding: spacing.xxs },
  chainItemDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  chainItemDotActive: { backgroundColor: colors.accentFill },
  chainItemDotText: { color: colors.textSecondary, fontSize: font.xxs, fontWeight: '700' },
  chainItemDotTextActive: { color: colors.onAccent },
  chainItemTitle: { flex: 1 },
  chainItemTitleText: { color: colors.text, fontSize: font.md },
  chainItemTitleActive: { color: colors.accent, fontWeight: '600' },
  chainItemDelete: { padding: 4 },
  chainInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  chainInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent, paddingVertical: spacing.xxs,
  },
  /** A single-line text field inside a CollapsibleField, matching TaskEditor's. */
  fieldBox: {
    color: colors.text, fontSize: font.md,
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    // Height rather than lineHeight — see the TextInput note in CLAUDE.md.
    minHeight: 36,
  },
  /** Sits between the medication's name and its unit row. */
  medicationAmountInput: { marginTop: spacing.sm, marginBottom: spacing.sm },
  choiceOptionsHint: { color: colors.textSecondary, fontSize: font.xs, marginHorizontal: spacing.md, marginTop: spacing.xs, marginBottom: spacing.sm },
  // Space around a control stacked inside a collapsible field (the chain's
  // Next step, the target's period), so it doesn't sit against the rows.
  chainModeBlock: { marginTop: spacing.sm, marginBottom: spacing.sm, gap: spacing.xs },
  deliverableOptionsInput: { marginHorizontal: spacing.md, marginVertical: spacing.sm, minHeight: 40 },
});
