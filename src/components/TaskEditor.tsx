import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Animated,
} from 'react-native';
import { SortableList } from './SortableList';
import { MiniFabList } from './MiniFabList';
import { EditorSheet } from './EditorSheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PinIcon } from './PinIcon';
import DateTimePicker from '@react-native-community/datetimepicker';
import { RemindMePicker } from './RemindMePicker';
import { WhenPicker } from './WhenPicker';
import { CalendarPicker } from './CalendarPicker';
import { PressableScale } from './PressableScale';
import { ChainStepMinutes } from './ChainStepMinutes';
import { format } from 'date-fns/format';
import { addMonths } from 'date-fns/addMonths';
import { addDays } from 'date-fns/addDays';
import { subDays } from 'date-fns/subDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Task, Priority, Effort, RecurrenceType, ChainItem, TimeOfDay, ReminderKind } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, TITLE_MAX_LENGTH } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, border, interaction, animation, checkboxRadius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { MAX_TARGET_COUNT, MIN_TARGET_COUNT } from '../utils/quickAddTypes';
import { MAX_TARGET_UNIT_LENGTH, formatQuotaProgress, formatQuotaTarget, normalizeTargetUnit } from '../utils/quotaUnit';
import { tagColor } from '../utils/tagColor';
import { useTaskStore, CONTENT_FIELDS } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useShallow } from 'zustand/react/shallow';
import { formatDeadlineDate, formatScheduledDate, formatHHMM, formatTimeOfDay, hhmmToDate, dateToHHMM, getDeadlineFromOffset, getDeadlineFromMonthDay, getDayStart, getCurrentDayStart, getLogicalNow, seriesMonthDaysFrom } from '../utils/dateUtils';
import { generateId } from '../utils/id';
import { findArchivedMatch } from '../utils/archiveMatch';
import { parseTaskInput, describeSchedule } from '../utils/parseTaskInput';
import { suggestTaskAttributes, describeAIError } from '../services/aiSuggestions';
import { estimateEffort } from '../utils/effortEstimator';
import { suggestSegment } from '../utils/rhythms';
import { rhythmOptionsFromSettings } from '../utils/rhythmsSettings';
import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration } from '../utils/effort';
import { SuggestedCategorySheet } from './SuggestedCategorySheet';
import { CollapsibleField } from './CollapsibleField';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorRow } from './EditorRow';
import { CountStepper } from './CountStepper';
import { BlockerPickerSheet } from './BlockerPickerSheet';
import { displayTitleFor } from '../utils/visibilityUtils';
import { RecurrencePicker, ordinal } from './RecurrencePicker';
import { recurrenceUnitLabel } from '../utils/recurrenceLabels';
import { KNOWN_LINK_APPS } from '../constants/linkApps';

/** Pre-filled values carried over from the quick add modal when creating a new task. */
export interface TaskDraft {
  title: string;
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null;
  /** Countdown target, carried over when quick add parses "for 15 minutes". */
  timedMinutes?: number | null;
  dueDate: Date | null;
  timeSegments: TimeOfDay[];
  tags: string[];
  category: string | null;
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  recurrenceDays: number[];
  recurrenceMonthDay: number | null;
  recurrenceWeekOrdinal: number | null;
  recurrenceFromCompletion: boolean;
  recurrenceEndDate: Date | null;
  recurrenceCount: number | null;
  /** Preselects the Chain toggle when opening a brand-new task. */
  chainEnabled?: boolean;
  /** Steps already built in quick add, so "More details" doesn't drop them. */
  chainItems?: ChainItem[];
  /** Drops a brand-new task straight into a project — set when the editor is opened from one. */
  projectId?: string | null;
  /** Same, for a stack. The task adopts the stack's category on the way in, as it would through addExistingToGroup. */
  groupId?: string | null;
  linkUrl?: string | null;
  targetCount?: number | null;
  targetUnit?: string | null;
}

interface Props {
  visible: boolean;
  task?: Task | null;
  initialDraft?: Partial<TaskDraft> | null;
  onClose: () => void;
}

type PickerMode = 'none' | 'reminder';

/** Editor sections that collapse to a one-line summary of their current value. */
type FieldKey = 'stack' | 'category' | 'project' | 'tags' | 'priority' | 'effort' | 'duration' | 'timeSpent' | 'subtasks';

// Presets for the Duration field, in minutes — the common "do this for a bit"
// spans, including the 25-minute pomodoro.
const DURATION_PRESETS = [5, 10, 15, 25, 30, 45, 60] as const;

// Matches the inline subtask checkbox in TaskItem, so a subtask looks the same
// whether it's read in the expanded row or in this editor.
const SUBTASK_CHECKBOX_SIZE = 16;

function formatRecurrenceSummary(type: RecurrenceType, interval: number): string {
  if (type === 'none') return '';
  return `Every ${interval} ${recurrenceUnitLabel(type, interval)}`;
}

export function TaskEditor({ visible, task, initialDraft, onClose }: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const addTaskSeries = useTaskStore(s => s.addTaskSeries);
  const applyTaskDates = useTaskStore(s => s.applyTaskDates);
  const updateTask = useTaskStore(s => s.updateTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const markMissed = useTaskStore(s => s.markMissed);
  const setLastAction = useTaskStore(s => s.setLastAction);
  const addSubtask = useTaskStore(s => s.addSubtask);
  const toggleSubtask = useTaskStore(s => s.toggleSubtask);
  const deleteSubtask = useTaskStore(s => s.deleteSubtask);
  const reorderSubtasks = useTaskStore(s => s.reorderSubtasks);
  const subtasksOf = useTaskStore(s => s.subtasksOf);
  const seriesRowsOf = useTaskStore(s => s.seriesRowsOf);
  const deleteSeries = useTaskStore(s => s.deleteSeries);
  const archiveTask = useTaskStore(s => s.archiveTask);
  const unarchiveTask = useTaskStore(s => s.unarchiveTask);
  const allTagsStore = useTaskStore(useShallow(s => s.allTags()));
  const allCategoriesStore = useTaskStore(useShallow(s => s.allCategories()));
  const allTags = allTagsStore;
  const allCategories = allCategoriesStore;
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addCategory = useTaskStore(s => s.addCategory);
  const removeFromGroup = useTaskStore(s => s.removeFromGroup);
  const addExistingToGroup = useTaskStore(s => s.addExistingToGroup);
  const allGroups = useTaskGroupStore(useShallow(s => s.groups));
  const projects = useProjectStore(useShallow(s => s.projects.filter(p => !p.archived)));
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [aiLoading, setAiLoading] = useState(false);
  // True while a subtask/chain row is mid-drag. The sheet's ScrollView has to
  // stand down for the drag to survive the first finger move — a JS responder
  // nested *inside* a scroll view doesn't stop it from claiming the touch (see
  // SortableList's onDragStateChange).
  const [draggingRow, setDraggingRow] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // Which stack the task will belong to once saved. Local like every other
  // field here, so Cancel actually cancels — the membership change is applied
  // in commitSave (see the groupId handling there), not as the pill is tapped.
  const [groupId, setGroupId] = useState<string | null>(null);
  // Derived from the local pick, not from task.groupId, so the locked Category
  // row below reflects the stack you just chose rather than the one you're
  // still saved into.
  const selectedGroup = allGroups.find(g => g.id === groupId) ?? null;
  const [project, setProject] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  // Dates beyond the first. `dueDate` stays the set's earliest — everything
  // else in this editor (deadline offsets, month-day seeds, the When picker)
  // is written against a single due date, so the series rides alongside it
  // rather than replacing it. Full set = [dueDate, ...extraDates].
  const [extraDates, setExtraDates] = useState<Date[]>([]);
  const [showDatesPicker, setShowDatesPicker] = useState(false);
  const [seriesRepeats, setSeriesRepeats] = useState(false);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [deadlineOffsetDays, setDeadlineOffsetDays] = useState<number | null>(null);
  const [deadlineMonthDay, setDeadlineMonthDay] = useState<number | null>(null);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [targetUnit, setTargetUnit] = useState('');
  const [showTargetCount, setShowTargetCount] = useState(false);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [windowPickerMode, setWindowPickerMode] = useState<'none' | 'start' | 'end'>('none');
  const [windowPickerDate, setWindowPickerDate] = useState(new Date());
  const [deferUntil, setDeferUntil] = useState<Date | null>(null);
  const [reminderTime, setReminderTime] = useState<Date | null>(null);
  const [reminderKind, setReminderKind] = useState<ReminderKind>('notification');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number | null>(null);
  const [recurrenceWeekOrdinal, setRecurrenceWeekOrdinal] = useState<number | null>(null);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<Date | null>(null);
  const [recurrenceCount, setRecurrenceCount] = useState<number | null>(null);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [customEffortOpen, setCustomEffortOpen] = useState(false);
  const [customEffortText, setCustomEffortText] = useState('');
  const [customEffortUnit, setCustomEffortUnit] = useState<'min' | 'hr'>('min');
  const [effortNote, setEffortNote] = useState<string | null>(null);
  const [segmentNote, setSegmentNote] = useState<string | null>(null);
  const [actualMinutes, setActualMinutes] = useState<number | null>(null);
  const [logTimeText, setLogTimeText] = useState('');
  const [logTimeUnit, setLogTimeUnit] = useState<'min' | 'hr'>('min');
  const [timedMinutes, setTimedMinutes] = useState<number | null>(null);
  const [durationText, setDurationText] = useState('');
  const [durationUnit, setDurationUnit] = useState<'min' | 'hr'>('min');
  const [pinned, setPinned] = useState(false);
  const [vacationPause, setVacationPause] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [blockedById, setBlockedById] = useState<string | null>(null);
  const [showBlockerPicker, setShowBlockerPicker] = useState(false);
  // Just the blocker's title, for the row's value. Selecting the one task
  // rather than the whole list keeps unrelated task changes from re-rendering
  // the editor.
  const blockerTask = useTaskStore(s => (blockedById ? s.tasks.find(t => t.id === blockedById) : undefined));
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [customLinkText, setCustomLinkText] = useState('');
  const [streakEditorOpen, setStreakEditorOpen] = useState(false);
  const [streakDraft, setStreakDraft] = useState(0);
  const [showStreak, setShowStreak] = useState(false);

  // Every picker section starts collapsed to its current value; opening one is
  // an explicit tap, so the form reads as a list of named fields rather than a
  // wall of pills. `undefined` means "still on the default for this field".
  const [openFields, setOpenFields] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [showTimeOfDay, setShowTimeOfDay] = useState(false);
  const [showTimeWindow, setShowTimeWindow] = useState(false);

  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>('none');
  const [showWhenPicker, setShowWhenPicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(new Date());
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);
  // Where the add button was dropped, if it was dragged rather than tapped.
  // Null means the end of the list, which is what a tap and `addSubtask` both
  // mean anyway. Cleared whenever the field closes, or a later tap would
  // silently insert at a slot chosen for a different session.
  const [pendingSubtaskIndex, setPendingSubtaskIndex] = useState<number | null>(null);

  const [chainEnabled, setChainEnabled] = useState(false);
  const [chainItems, setChainItems] = useState<ChainItem[]>([]);
  const [chainIndex, setChainIndex] = useState(0);
  const [chainStepOnSchedule, setChainStepOnSchedule] = useState(false);
  const [newChainItemTitle, setNewChainItemTitle] = useState('');
  const [addingChainItem, setAddingChainItem] = useState(false);

  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const scheduleTooltipAnim = useRef(new Animated.Value(0)).current;
  const hadScheduleParse = useRef(false);

  const titleRef = useRef<TextInput>(null);
  const chainInputRef = useRef<TextInput>(null);
  const chainItemSavedRef = useRef(false);
  const initialStateRef = useRef<string>('');

  useEffect(() => {
    if (!visible) return;
    if (task) {
      setTitle(task.title); setNotes(task.notes); setCategory(task.category ?? null); setProject(task.projectId ?? null); setTags(task.tags);
      setGroupId(task.groupId ?? null);
      setDueDate(task.dueDate ? new Date(task.dueDate) : null);
      // The set's other live dates. Completed ones are left out: they're
      // history, and showing them as editable schedule would invite deleting
      // a day that already happened.
      setExtraDates(
        task.seriesId
          ? seriesRowsOf(task.seriesId)
              .filter(t => t.id !== task.id && !t.completed && t.dueDate)
              .map(t => new Date(t.dueDate!))
              .sort((a, b) => +a - +b)
          : []
      );
      setSeriesRepeats(!!task.seriesId && task.seriesMonthDays.length > 0);
      setDeadline(task.deadline ? new Date(task.deadline) : null);
      setDeadlineOffsetDays(task.deadlineOffsetDays ?? null);
      setDeadlineMonthDay(task.deadlineMonthDay ?? null);
      setTimeSegments(task.timeSegments ?? []);
      setWindowStart(task.windowStart ?? null);
      setWindowEnd(task.windowEnd ?? null);
      setTargetCount(task.targetCount ?? null);
      setTargetUnit(task.targetUnit ?? '');
      setDeferUntil(task.deferUntil ? new Date(task.deferUntil) : null);
      setReminderTime(task.reminderTime ? new Date(task.reminderTime) : null);
      setReminderKind(task.reminderKind ?? 'notification');
      setRecurrenceType(task.recurrenceType); setRecurrenceInterval(task.recurrenceInterval);
      setRecurrenceDays(task.recurrenceDays ?? []);
      setRecurrenceMonthDay(task.recurrenceMonthDay ?? null);
      setRecurrenceWeekOrdinal(task.recurrenceWeekOrdinal ?? null);
      setRecurrenceFromCompletion(task.recurrenceFromCompletion);
      setRecurrenceEndDate(task.recurrenceEndDate ? new Date(task.recurrenceEndDate) : null);
      setRecurrenceCount(task.recurrenceCount ?? null);
      setPriority(task.priority); setEffort(task.effort); setEstimatedMinutes(task.estimatedMinutes ?? null); setPinned(task.pinned);
      setActualMinutes(task.actualMinutes ?? null);
      setTimedMinutes(task.timedMinutes ?? null);
      setChainEnabled(task.chainEnabled); setChainItems(task.chainItems);
      setChainIndex(task.chainIndex);
      setChainStepOnSchedule(task.chainStepOnSchedule ?? false);
      setVacationPause(task.vacationPause ?? false);
      setShowStreak(task.showStreak ?? false);
      setLinkUrl(task.linkUrl ?? null);
      setBlockedById(task.blockedById ?? null);
    } else {
      setTitle(initialDraft?.title ?? ''); setNotes(''); setCategory(initialDraft?.category ?? null); setProject(initialDraft?.projectId ?? null); setTags(initialDraft?.tags ?? []);
      setGroupId(initialDraft?.groupId ?? null);
      setDueDate(initialDraft?.dueDate ?? null); setExtraDates([]); setSeriesRepeats(false); setDeadline(null); setDeadlineOffsetDays(null); setDeadlineMonthDay(null); setTimeSegments(initialDraft?.timeSegments ?? []); setWindowStart(null); setWindowEnd(null); setTargetCount(initialDraft?.targetCount ?? null); setTargetUnit(initialDraft?.targetUnit ?? ''); setDeferUntil(null); setReminderTime(null); setReminderKind('notification');
      setRecurrenceType(initialDraft?.recurrenceType ?? 'none'); setRecurrenceInterval(initialDraft?.recurrenceInterval ?? 1);
      setRecurrenceDays(initialDraft?.recurrenceDays ?? []);
      setRecurrenceMonthDay(initialDraft?.recurrenceMonthDay ?? null);
      setRecurrenceWeekOrdinal(initialDraft?.recurrenceWeekOrdinal ?? null);
      setRecurrenceFromCompletion(initialDraft?.recurrenceFromCompletion ?? false);
      setRecurrenceEndDate(initialDraft?.recurrenceEndDate ?? null);
      setRecurrenceCount(initialDraft?.recurrenceCount ?? null);
      setPriority(initialDraft?.priority ?? 0); setEffort(initialDraft?.effort ?? 0); setEstimatedMinutes(initialDraft?.estimatedMinutes ?? null); setPinned(false);
      setActualMinutes(null);
      setTimedMinutes(initialDraft?.timedMinutes ?? null);
      setChainEnabled(initialDraft?.chainEnabled ?? false); setChainItems(initialDraft?.chainItems ?? []); setChainIndex(0);
      setVacationPause(false);
      setShowStreak(false);
      setLinkUrl(initialDraft?.linkUrl ?? null);
      setBlockedById(null);
    }
    setShowBlockerPicker(false);
    setShowLinkPicker(false); setCustomLinkText('');
    setPickerMode('none'); setShowWhenPicker(false); setShowDeadlinePicker(false); setShowEndDatePicker(false); setPickerDate(new Date()); setWindowPickerMode('none'); setNewCategory(''); setAddingCategory(false); setNewTag(''); setAddingTag(false);
    setNewSubtaskTitle(''); setAddingSubtask(false); setPendingSubtaskIndex(null);
    setNewChainItemTitle(''); setAddingChainItem(false);
    setAiLoading(false);
    setOpenFields({}); setShowTimeOfDay(false); setShowTimeWindow(false);
    setCustomEffortOpen(false); setCustomEffortText(''); setCustomEffortUnit('min');
    setLogTimeText(''); setLogTimeUnit('min');
    setDurationText(''); setDurationUnit('min');
    setEffortNote(null);
    setSegmentNote(null);
    setStreakEditorOpen(false); setStreakDraft(task?.streakCount ?? 0);
    setPendingCategory(null);
    setTimeout(() => titleRef.current?.focus(), 100);
    initialStateRef.current = JSON.stringify({
      title: task ? task.title : (initialDraft?.title ?? ''),
      notes: task ? task.notes : '',
      category: task ? (task.category ?? null) : (initialDraft?.category ?? null),
      projectId: task ? (task.projectId ?? null) : (initialDraft?.projectId ?? null),
      tags: task ? task.tags : (initialDraft?.tags ?? []),
      dueDate: task ? (task.dueDate ?? null) : (initialDraft?.dueDate?.toISOString() ?? null),
      deadline: task
        ? (task.deadlineOffsetDays !== null && task.deadlineOffsetDays !== undefined && task.dueDate
            ? getDeadlineFromOffset(new Date(task.dueDate), task.deadlineOffsetDays).toISOString()
            : task.deadlineMonthDay !== null && task.deadlineMonthDay !== undefined && task.dueDate
            ? getDeadlineFromMonthDay(new Date(task.dueDate), task.deadlineMonthDay).toISOString()
            : task.deadline ?? null)
        : null,
      deadlineOffsetDays: task?.deadlineOffsetDays ?? null,
      deadlineMonthDay: task?.deadlineMonthDay ?? null,
      timeSegments: task ? (task.timeSegments ?? []) : (initialDraft?.timeSegments ?? []),
      windowStart: task?.windowStart ?? null,
      windowEnd: task?.windowEnd ?? null,
      targetCount: task ? (task.targetCount ?? null) : (initialDraft?.targetCount ?? null),
      targetUnit: normalizeTargetUnit(task ? task.targetUnit : initialDraft?.targetUnit),
      deferUntil: task?.deferUntil ?? null,
      reminderTime: task?.reminderTime ?? null,
      reminderKind: task?.reminderKind ?? 'notification',
      recurrenceType: task ? task.recurrenceType : (initialDraft?.recurrenceType ?? 'none'),
      recurrenceInterval: task ? task.recurrenceInterval : (initialDraft?.recurrenceInterval ?? 1),
      recurrenceDays: task ? (task.recurrenceDays ?? []) : (initialDraft?.recurrenceDays ?? []),
      recurrenceMonthDay: task ? (task.recurrenceMonthDay ?? null) : (initialDraft?.recurrenceMonthDay ?? null),
      recurrenceWeekOrdinal: task ? (task.recurrenceWeekOrdinal ?? null) : (initialDraft?.recurrenceWeekOrdinal ?? null),
      recurrenceFromCompletion: task ? task.recurrenceFromCompletion : (initialDraft?.recurrenceFromCompletion ?? false),
      recurrenceEndDate: task ? (task.recurrenceEndDate ?? null) : (initialDraft?.recurrenceEndDate?.toISOString() ?? null),
      recurrenceCount: task ? (task.recurrenceCount ?? null) : (initialDraft?.recurrenceCount ?? null),
      priority: task ? task.priority : (initialDraft?.priority ?? 0),
      effort: task ? task.effort : (initialDraft?.effort ?? 0),
      estimatedMinutes: task ? (task.estimatedMinutes ?? null) : (initialDraft?.estimatedMinutes ?? null),
      actualMinutes: task?.actualMinutes ?? null,
      timedMinutes: task ? (task.timedMinutes ?? null) : (initialDraft?.timedMinutes ?? null),
      pinned: task?.pinned ?? false,
      chainEnabled: task ? task.chainEnabled : (initialDraft?.chainEnabled ?? false),
      chainItems: task ? task.chainItems : (initialDraft?.chainItems ?? []),
      chainIndex: task?.chainIndex ?? 0,
      chainStepOnSchedule: task?.chainStepOnSchedule ?? false,
      vacationPause: task?.vacationPause ?? false,
      showStreak: task?.showStreak ?? false,
      linkUrl: task ? (task.linkUrl ?? null) : (initialDraft?.linkUrl ?? null),
      blockedById: task?.blockedById ?? null,
    });
  }, [visible, task]);

  // Relative deadline ("N days before due" or "day of month") tracks the Date
  // field live in the editor too, so the preview shown here always matches
  // what completeTask will recompute on the next occurrence.
  useEffect(() => {
    if (deadlineOffsetDays !== null && dueDate) {
      setDeadline(getDeadlineFromOffset(dueDate, deadlineOffsetDays));
    } else if (deadlineMonthDay !== null && dueDate) {
      setDeadline(getDeadlineFromMonthDay(dueDate, deadlineMonthDay));
    }
  }, [dueDate, deadlineOffsetDays, deadlineMonthDay]);

  // Natural-language scheduling: detect a trailing date/recurrence phrase in
  // the title ("go running on wednesday", "water plants every 3 days") the
  // same way the quick-add modal does. The phrase is highlighted and
  // described in a banner below the title; nothing is applied until tapped.
  const parsedSchedule = useMemo(
    () => (title.trim() ? parseTaskInput(title, getLogicalNow(dayResetTime)) : null),
    [title, dayResetTime]
  );
  const scheduleMatchEnd = parsedSchedule ? parsedSchedule.matchStart + parsedSchedule.matchedText.length : 0;

  // Pop the banner in when a phrase is first detected (not on every keystroke
  // that merely extends it).
  useEffect(() => {
    if (parsedSchedule && !hadScheduleParse.current) {
      scheduleTooltipAnim.setValue(0);
      Animated.spring(scheduleTooltipAnim, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
    }
    hadScheduleParse.current = parsedSchedule != null;
  }, [parsedSchedule]);

  // Apply the suggested schedule and strip the phrase from the title.
  const applyParsedSchedule = () => {
    if (!parsedSchedule) return;
    haptics.success();
    animateLayout();
    setTitle(parsedSchedule.cleanTitle);
    setDueDate(parsedSchedule.schedule.dueDate);
    setTimeSegments(parsedSchedule.schedule.timeSegments);
    setRecurrenceType(parsedSchedule.schedule.recurrenceType);
    setRecurrenceInterval(parsedSchedule.schedule.recurrenceInterval);
    setRecurrenceDays(parsedSchedule.schedule.recurrenceDays);
    setRecurrenceMonthDay(parsedSchedule.schedule.recurrenceMonthDay ?? null);
    setRecurrenceWeekOrdinal(parsedSchedule.schedule.recurrenceWeekOrdinal ?? null);
    setRecurrenceEndDate(parsedSchedule.schedule.recurrenceEndDate ? new Date(parsedSchedule.schedule.recurrenceEndDate) : null);
    setRecurrenceCount(parsedSchedule.schedule.recurrenceCount ?? null);
    setRecurrenceFromCompletion(parsedSchedule.schedule.recurrenceFromCompletion ?? false);
  };

  const save = () => {
    if (!title.trim()) return;

    if (!task) {
      const archivedMatch = findArchivedMatch(useTaskStore.getState().archivedTasks(), title.trim());
      if (archivedMatch) {
        Alert.alert(
          'Resume archived task?',
          `You archived "${archivedMatch.title}" a while back. Resume it instead of creating a new one? History and stats carry over, but the streak restarts.`,
          [
            { text: 'Create New', onPress: () => proceedWithSave() },
            {
              text: 'Resume',
              style: 'default',
              onPress: () => {
                haptics.success();
                unarchiveTask(archivedMatch.id);
                onClose();
              },
            },
          ],
        );
        return;
      }
    }
    proceedWithSave();
  };

  const proceedWithSave = () => {
    const data = {
      title: title.trim(), notes, category, projectId: project, tags,
      dueDate: dueDate?.toISOString() ?? null,
      deadline: deadline?.toISOString() ?? null,
      deadlineOffsetDays,
      deadlineMonthDay: recurrenceType === 'monthly' ? deadlineMonthDay : null,
      timeSegments, windowStart, windowEnd, targetCount,
      // Cleared with the count it labels — a unit left behind on a task that is
      // no longer a target has nothing to sit beside, and would come back the
      // moment a target did.
      targetUnit: targetCount !== null ? normalizeTargetUnit(targetUnit) : null,
      deferUntil: deferUntil?.toISOString() ?? null,
      reminderTime: reminderTime?.toISOString() ?? null,
      reminderKind,
      recurrenceType, recurrenceInterval,
      recurrenceDays: recurrenceType === 'weekly' ? recurrenceDays : recurrenceType === 'monthly' && recurrenceWeekOrdinal !== null ? recurrenceDays : [],
      recurrenceMonthDay: recurrenceType === 'monthly' && recurrenceWeekOrdinal === null ? recurrenceMonthDay : null,
      recurrenceWeekOrdinal: recurrenceType === 'monthly' ? recurrenceWeekOrdinal : null,
      recurrenceEndDate: recurrenceType !== 'none' ? (recurrenceEndDate?.toISOString() ?? null) : null,
      recurrenceCount: recurrenceType !== 'none' ? recurrenceCount : null,
      recurrenceFromCompletion,
      sortOrder: task?.sortOrder ?? 0,
      pinned, priority, effort, estimatedMinutes, actualMinutes, timedMinutes,
      chainEnabled: chainEnabled && chainItems.length > 0,
      chainItems,
      chainIndex,
      // Cleared whenever the control isn't on screen to set, same reasoning as
      // showStreak below: the mode only renders for a chain that has a repeat,
      // so a stale `true` left on a task whose chain or repeat was turned off
      // would quietly turn it into a rotation if either came back.
      chainStepOnSchedule:
        chainEnabled && chainItems.length > 0 && recurrenceType !== 'none' && chainStepOnSchedule,
      vacationPause,
      // Only a recurring task has a streak to show, and the toggle is only
      // offered there — don't strand a stale `true` on a task that stopped
      // recurring, or the chip would be waiting if it ever recurs again.
      showStreak: recurrenceType !== 'none' && showStreak,
      linkUrl: resolveLinkUrl(),
      blockedById,
    };

    // The whole set of dates this task falls on, earliest first. A single
    // date is an ordinary task and never becomes a series.
    const allDates = [...(dueDate ? [dueDate] : []), ...extraDates].sort((a, b) => +a - +b);
    const repeat = seriesRepeats && allDates.length >= 2
      ? { monthDays: seriesMonthDaysFrom(allDates), repeatMonths: 1 }
      : undefined;

    const commitSave = (scope?: 'occurrence' | 'series') => {
      haptics.success();
      if (task) {
        const snapshot = { ...task };
        updateTask(task.id, data, scope === 'occurrence' ? { scope: 'occurrence' } : undefined);
        // Membership after the field write, not before: addExistingToGroup
        // places the task at the end of its new stack, and `data` still carries
        // the sortOrder the task had before the move — writing that second
        // would put the placement straight back.
        if (groupId !== (task.groupId ?? null)) {
          if (groupId) addExistingToGroup(task.id, groupId);
          else removeFromGroup(task.id);
        }
        // Schedule second, and only when a set is actually in play: it adds,
        // drops and repoints sibling rows, none of which a plain single-date
        // task has.
        if (allDates.length >= 2 || task.seriesId) {
          applyTaskDates(task.id, allDates, repeat);
        }
        // Last of all, so it replaces the narrower undo addExistingToGroup
        // registers for itself — this snapshot puts the whole task back,
        // stack membership and category included.
        setLastAction({
          label: 'Edit saved',
          undo: () => updateTask(snapshot.id, snapshot),
        });
      } else {
        animateLayout();
        // groupId only rides along on the create path; for an existing task the
        // store methods above own the move, since they place it in the stack's
        // order and cascade the category as well as setting the field.
        const newData = { ...data, groupId };
        if (allDates.length >= 2) {
          addTaskSeries(newData, allDates, repeat);
        } else {
          addTask(newData);
        }
      }
      onClose();
    };

    // Recurring tasks and dated series: content-field edits (title, notes,
    // tags, etc. — the fields that otherwise silently carry forward to every
    // future occurrence, or across to the set's other dates) need the user to
    // pick a scope. Repeat-section/schedule-only edits have exactly one
    // sensible meaning and save directly.
    if (task && (task.recurrenceType !== 'none' || task.seriesId)) {
      const record = data as unknown as Record<string, unknown>;
      const taskRecord = task as unknown as Record<string, unknown>;
      const contentChanged = CONTENT_FIELDS.some(
        key => JSON.stringify(record[key]) !== JSON.stringify(taskRecord[key])
      );
      if (contentChanged) {
        const isSeries = !!task.seriesId && task.recurrenceType === 'none';
        Alert.alert(
          isSeries ? 'Update task on several dates' : 'Update recurring task',
          isSeries
            ? 'This task falls on more than one date. Apply this change to just this date, or to this and its later dates?'
            : 'This task repeats. Apply this change to just this task, or to this and all future occurrences?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: isSeries ? 'This Date' : 'This Task', onPress: () => commitSave('occurrence') },
            { text: isSeries ? 'This and Later Dates' : 'This and Future Tasks', onPress: () => commitSave('series') },
          ],
        );
        return;
      }
    }
    commitSave();
  };

  // Manually correcting a streak is for the "I actually did this yesterday
  // but forgot to tap complete" case — so a count increase also pushes the
  // streakDate anchor forward (never past yesterday), preserving continuity
  // for the next real completion instead of leaving it to see a gap and
  // reset anyway. Reset always clears the anchor.
  const applyStreakChange = (rawCount: number) => {
    if (!task) return;
    const clamped = Math.max(0, Math.round(rawCount));
    if (clamped === task.streakCount) {
      setStreakEditorOpen(false);
      return;
    }

    const { dayResetTime } = useSettingsStore.getState();
    const yesterday = subDays(getCurrentDayStart(), 1);
    let newStreakDate: string | null;
    if (clamped === 0) {
      newStreakDate = null;
    } else if (task.streakDate) {
      const delta = clamped - task.streakCount;
      const shifted = addDays(getDayStart(new Date(task.streakDate), dayResetTime), delta);
      newStreakDate = (shifted > yesterday ? yesterday : shifted).toISOString();
    } else {
      newStreakDate = yesterday.toISOString();
    }

    const increasing = clamped > task.streakCount;
    Alert.alert(
      clamped === 0 ? 'Reset streak?' : `Set streak to ${clamped} day${clamped === 1 ? '' : 's'}?`,
      clamped === 0
        ? 'This clears the current streak count and history.'
        : `This manually ${increasing ? 'credits' : 'reduces'} the streak, as if it had been ${increasing ? 'completed' : 'not completed'} on schedule. Only do this to fix a task you actually completed but forgot to mark done.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: clamped === 0 ? 'Reset' : 'Confirm',
          style: clamped === 0 ? 'destructive' : 'default',
          onPress: () => {
            haptics.success();
            updateTask(task.id, { streakCount: clamped, streakDate: newStreakDate });
            setStreakEditorOpen(false);
          },
        },
      ],
    );
  };

  const fieldOpen = (key: FieldKey, fallback = false) => openFields[key] ?? fallback;
  const toggleField = (key: FieldKey, fallback = false) =>
    setOpenFields(prev => ({ ...prev, [key]: !(prev[key] ?? fallback) }));
  // Picking a single-choice value is the whole reason the section was open, so
  // fold it back up and let the summary row show what was chosen.
  const closeField = (key: FieldKey) => {
    animateLayout();
    setOpenFields(prev => ({ ...prev, [key]: false }));
  };

  // Opening "Time spent" drops you straight into the input, so prefill it from
  // whatever is already logged before the section unfolds.
  const toggleTimeSpent = () => {
    if (!fieldOpen('timeSpent')) {
      if (actualMinutes != null && actualMinutes % 60 === 0) {
        setLogTimeUnit('hr');
        setLogTimeText(String(actualMinutes / 60));
      } else {
        setLogTimeUnit('min');
        setLogTimeText(actualMinutes != null ? String(actualMinutes) : '');
      }
    }
    toggleField('timeSpent');
  };

  // Same prefill dance for Duration — open it and the current target is already
  // in the input, ready to be edited rather than retyped.
  const toggleDuration = () => {
    if (!fieldOpen('duration')) {
      if (timedMinutes != null && timedMinutes % 60 === 0) {
        setDurationUnit('hr');
        setDurationText(String(timedMinutes / 60));
      } else {
        setDurationUnit('min');
        setDurationText(timedMinutes != null ? String(timedMinutes) : '');
      }
    }
    toggleField('duration');
  };

  const openPicker = (mode: PickerMode) => {
    if (mode === 'reminder') {
      const defaultDate = dueDate ?? new Date();
      defaultDate.setHours(9, 0, 0, 0);
      setPickerDate(reminderTime ?? defaultDate);
    }
    setPickerMode(mode);
  };

  const confirmPicker = (confirmed: Date, kind?: ReminderKind) => {
    if (pickerMode === 'reminder') {
      setReminderTime(confirmed);
      if (kind) setReminderKind(kind);
    }
    setPickerMode('none');
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

  const addTagFromInput = () => {
    const t = newTag.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setNewTag(''); setAddingTag(false);
  };

  const commitCustomLink = () => {
    const t = customLinkText.trim();
    setLinkUrl(t || null);
    setShowLinkPicker(false);
  };

  /**
   * Rescues a shopping item captured in the wrong place — "buy milk" typed
   * into quick-add before you thought about which list it belonged on.
   *
   * Uses the live `title` rather than task.title so an edit in this session
   * comes along, and goes through addByName so the usual parsing applies: the
   * quantity is split off and a name already in the catalog is put back on the
   * list rather than duplicated. Confirms because it deletes the task.
   */
  const handleSendToGroceries = () => {
    if (!task) return;
    const raw = title.trim() || task.title;
    if (!raw) return;
    Alert.alert(
      'Send to groceries?',
      `“${raw}” moves to your grocery list, and this task is deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            useGroceryStore.getState().addByName(raw);
            deleteTask(task.id);
            haptics.success();
            onClose();
          },
        },
      ]
    );
  };

  // Save can fire before the custom link input's onBlur/onSubmitEditing has
  // committed its text to `linkUrl` state (e.g. tapping the header Save
  // button blurs the input and saves in the same gesture, so this render's
  // `linkUrl` closure is still stale). Fall back to the live text box value.
  const resolveLinkUrl = () => {
    const t = customLinkText.trim();
    return showLinkPicker && t ? t : linkUrl;
  };

  const enableRecurrence = () => {
    if (recurrenceType === 'none') setRecurrenceType('daily');
  };

  const recurrenceEndMode: 'never' | 'date' | 'count' =
    recurrenceEndDate ? 'date' : recurrenceCount !== null ? 'count' : 'never';

  const setRecurrenceEndNever = () => {
    setRecurrenceEndDate(null);
    setRecurrenceCount(null);
  };

  const setRecurrenceEndOnDate = () => {
    setRecurrenceCount(null);
    if (!recurrenceEndDate) setRecurrenceEndDate(addMonths(dueDate ?? new Date(), 1));
    setShowEndDatePicker(true);
  };

  const setRecurrenceEndAfterCount = () => {
    setRecurrenceEndDate(null);
    if (recurrenceCount === null) setRecurrenceCount(5);
  };

  const handleCancel = () => {
    const current = JSON.stringify({
      title, notes, category, projectId: project, tags,
      dueDate: dueDate?.toISOString() ?? null,
      deadline: deadline?.toISOString() ?? null,
      deadlineOffsetDays,
      deadlineMonthDay,
      timeSegments,
      windowStart, windowEnd,
      targetCount,
      targetUnit: targetCount !== null ? normalizeTargetUnit(targetUnit) : null,
      deferUntil: deferUntil?.toISOString() ?? null,
      reminderTime: reminderTime?.toISOString() ?? null,
      reminderKind,
      recurrenceType, recurrenceInterval, recurrenceDays, recurrenceMonthDay, recurrenceWeekOrdinal, recurrenceFromCompletion,
      recurrenceEndDate: recurrenceEndDate?.toISOString() ?? null,
      recurrenceCount,
      priority, effort, estimatedMinutes, actualMinutes, timedMinutes, pinned, chainEnabled, chainItems, chainIndex, chainStepOnSchedule, vacationPause,
      showStreak,
      linkUrl,
      blockedById,
    });
    if (current !== initialStateRef.current) {
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. Are you sure you want to discard them?',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onClose },
        ],
      );
    } else {
      onClose();
    }
  };

  const handleDelete = () => {
    if (!task) return;
    if (task.recurrenceType !== 'none') {
      Alert.alert(
        'Delete recurring task',
        'This task repeats. Mark just this occurrence missed, or delete it and stop the series?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Mark Missed',
            onPress: () => {
              markMissed(task.id);
              onClose();
            },
          },
          {
            text: 'Delete and Stop Series',
            style: 'destructive',
            onPress: () => {
              haptics.success();
              deleteTask(task.id);
              onClose();
            },
          },
        ],
      );
      return;
    }
    // A dated series has real rows for its other dates, so deleting is
    // ambiguous the same way it is for a recurrence — this date, or the lot.
    // Either way the set's completed dates stay in the Logbook.
    const seriesId = task.seriesId;
    const remaining = seriesId
      ? seriesRowsOf(seriesId).filter(t => !t.completed).length
      : 0;
    if (seriesId && remaining > 1) {
      Alert.alert(
        'Delete task on several dates',
        `This task falls on ${remaining} remaining dates. Delete just this one, or all of them?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Just This Date',
            onPress: () => {
              haptics.success();
              deleteTask(task.id);
              onClose();
            },
          },
          {
            text: 'All Dates',
            style: 'destructive',
            onPress: () => {
              haptics.success();
              deleteSeries(seriesId);
              onClose();
            },
          },
        ],
      );
      return;
    }
    Alert.alert(
      'Delete task?',
      `Delete "${task.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptics.success();
            deleteTask(task.id);
            onClose();
          },
        },
      ],
    );
  };

  const handleSuggest = async () => {
    setAiLoading(true);
    try {
      const result = await suggestTaskAttributes(title.trim(), notes, allTags, allCategories);
      if (result.effort > 0) {
        setEffort(prev => {
          if (prev !== 0) return prev;
          setEstimatedMinutes(EFFORT_MINUTES[result.effort]);
          return result.effort;
        });
      }
      if (result.tags.length > 0) {
        setTags(prev => [...new Set([...prev, ...result.tags])]);
      }
      setCategory(prev => {
        if (prev) return prev;
        if (result.category) return result.category;
        if (result.newCategory) setPendingCategory(result.newCategory);
        return prev;
      });
    } catch (e) {
      Alert.alert('AI suggestion failed', describeAIError(e));
    } finally {
      setAiLoading(false);
    }
  };

  // Whether the current estimate is a precise value that isn't one of the presets.
  const customEffortActive = estimatedMinutes != null && estimatedMinutes !== effortToMinutes(effort);

  const applyEffortPreset = (e: Effort) => {
    setEffort(e);
    setEstimatedMinutes(EFFORT_MINUTES[e]);
    setCustomEffortOpen(false);
    setEffortNote(null);
  };

  const openCustomEffort = () => {
    // Prefill from the current precise estimate, if any.
    if (estimatedMinutes != null) {
      if (estimatedMinutes % 60 === 0) {
        setCustomEffortUnit('hr');
        setCustomEffortText(String(estimatedMinutes / 60));
      } else {
        setCustomEffortUnit('min');
        setCustomEffortText(String(estimatedMinutes));
      }
    } else {
      setCustomEffortText('');
      setCustomEffortUnit('min');
    }
    setEffortNote(null);
    setCustomEffortOpen(true);
  };

  const applyCustomEffort = (text: string, unit: 'min' | 'hr') => {
    const n = parseFloat(text);
    if (!Number.isFinite(n) || n <= 0) {
      // Empty/invalid clears the estimate back to unknown.
      setEstimatedMinutes(null);
      setEffort(0);
      return;
    }
    const minutes = Math.round(unit === 'hr' ? n * 60 : n);
    setEstimatedMinutes(minutes);
    setEffort(minutesToEffort(minutes));
  };

  // Manually log how long the task actually took. The measured time becomes the
  // recorded actual and also drives the estimate/effort, matching the stopwatch.
  const applyLoggedTime = (text: string, unit: 'min' | 'hr') => {
    const n = parseFloat(text);
    if (!Number.isFinite(n) || n <= 0) {
      setActualMinutes(null);
      return;
    }
    const minutes = Math.max(1, Math.round(unit === 'hr' ? n * 60 : n));
    setActualMinutes(minutes);
    setEstimatedMinutes(minutes);
    setEffort(minutesToEffort(minutes));
  };

  // The countdown target. Unlike logged time this deliberately leaves the
  // estimate alone — how long you mean to sit with a task and how long the task
  // is reckoned to take aren't always the same number.
  const applyDuration = (text: string, unit: 'min' | 'hr') => {
    const n = parseFloat(text);
    if (!Number.isFinite(n) || n <= 0) {
      setTimedMinutes(null);
      return;
    }
    setTimedMinutes(Math.max(1, Math.round(unit === 'hr' ? n * 60 : n)));
  };

  const handleEstimateEffort = () => {
    const result = estimateEffort(
      title.trim(),
      { notes, category, tags, previousOccurrenceId: task?.previousOccurrenceId ?? null, excludeTaskId: task?.id ?? null },
      useTaskStore.getState().tasks,
    );
    if (result.minutes != null) {
      setEstimatedMinutes(result.minutes);
      setEffort(minutesToEffort(result.minutes));
      setCustomEffortOpen(false);
    }
    // Otherwise not enough timer history yet — the reason explains why, estimate untouched.
    setEffortNote(result.reason);
  };

  // The time-of-day counterpart of handleEstimateEffort: same local-history
  // lookup, same abstain-with-a-reason behaviour, reading completedAt instead
  // of actualMinutes. See utils/rhythms.
  const handleSuggestSegment = () => {
    const result = suggestSegment(
      title.trim(),
      { category, tags, seriesId: task?.seriesId ?? null, excludeTaskId: task?.id ?? null },
      useTaskStore.getState().tasks,
      rhythmOptionsFromSettings(),
    );
    if (result) {
      haptics.tap();
      setTimeSegments([result.segment]);
      setSegmentNote(result.reason);
    } else {
      setSegmentNote('Not enough history yet to tell when you do this.');
    }
  };

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const timeOfDaySummary = timeSegments.length > 0
    ? timeSegments.map(capitalize).join(', ')
    : undefined;
  const timeWindowSummary = (windowStart || windowEnd)
    ? `${windowStart ? formatHHMM(windowStart) : 'Any'} – ${windowEnd ? formatHHMM(windowEnd) : 'Any'}`
    : undefined;
  const effortSummary = customEffortActive && estimatedMinutes != null
    ? formatDuration(estimatedMinutes)
    : effort > 0 ? EFFORT_LABELS[effort] : undefined;
  const subtasks = task ? subtasksOf(task.id) : [];

  /**
   * Adds a subtask at the seam the add button was dropped on, or at the end if
   * it was only tapped.
   *
   * `addSubtask` always appends, so the placement is a renumber afterwards
   * rather than a different insert: snapshot the sibling ids *before* the
   * insert, splice the new one in, hand the whole order back. `subtasksOf`
   * returns every row with this parent and nothing else, so that list is
   * complete and reorderSubtasks' flat 1..n renumber is right.
   *
   * The index then advances, because this field stays focused for a burst of
   * entries (blurOnSubmit={false}) — three typed after one drop should stay in
   * the order they were typed, not have the second and third jump to the end.
   */
  const commitSubtask = (title: string) => {
    const trimmed = title.trim();
    if (!task || !trimmed) return;
    const index = pendingSubtaskIndex;
    const created = addSubtask(task.id, trimmed);
    if (index === null || index >= subtasks.length) return;
    const ids = subtasks.map(s => s.id);
    ids.splice(Math.max(0, index), 0, created.id);
    reorderSubtasks(task.id, ids);
    setPendingSubtaskIndex(index + 1);
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={handleCancel}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      scrollEnabled={!draggingRow}
      header={
        <>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} />
          <Text style={styles.headerTitle}>{task ? 'Edit Task' : 'New Task'}</Text>
          <SheetHeaderButton
            label={task ? 'Save' : 'Add'}
            onPress={save}
            disabled={!title.trim()}
          />
        </>
      }
      footer={
        <>
          <RemindMePicker
            visible={pickerMode !== 'none'}
            value={pickerDate}
            kind={reminderKind}
            onConfirm={confirmPicker}
            onClear={reminderTime ? () => { setReminderTime(null); setReminderKind('notification'); setPickerMode('none'); } : undefined}
            onCancel={() => setPickerMode('none')}
          />
          <WhenPicker
            visible={showWhenPicker}
            value={dueDate}
            timeSegments={timeSegments}
            taskId={task?.id}
            taskTitle={title}
            taskNotes={notes}
            taskTags={tags}
            taskCategory={category}
            taskPriority={priority}
            taskEffort={effort}
            taskEstimatedMinutes={estimatedMinutes}
            onConfirm={(date, segs) => {
              if (date) {
                const noon = new Date(date);
                noon.setHours(12, 0, 0, 0);
                setDueDate(noon);
              } else {
                setDueDate(null);
              }
              setTimeSegments(segs);
              setShowWhenPicker(false);
            }}
            onClear={() => {
              setDueDate(null);
              setTimeSegments([]);
              setShowWhenPicker(false);
            }}
            onCancel={() => setShowWhenPicker(false)}
          />
          <CalendarPicker
            visible={showDatesPicker}
            value={null}
            multiple
            values={[...(dueDate ? [dueDate] : []), ...extraDates].sort((a, b) => +a - +b)}
            mode="date"
            title="Dates"
            onConfirm={() => {}}
            onConfirmMultiple={(dates) => {
              // The earliest becomes the Date row; the rest hang off it. Times
              // are normalised to noon like the When picker does, so a date's
              // own day is unambiguous either side of a dayResetTime.
              const noons = dates.map(d => { const n = new Date(d); n.setHours(12, 0, 0, 0); return n; });
              setDueDate(noons[0] ?? null);
              setExtraDates(noons.slice(1));
              if (noons.length < 2) setSeriesRepeats(false);
              setShowDatesPicker(false);
            }}
            onCancel={() => setShowDatesPicker(false)}
          />
          <CalendarPicker
            visible={showEndDatePicker}
            value={recurrenceEndDate}
            mode="date"
            title="End Date"
            onConfirm={(date) => { setRecurrenceEndDate(date); setShowEndDatePicker(false); }}
            onCancel={() => setShowEndDatePicker(false)}
          />
          <WhenPicker
            visible={showDeadlinePicker}
            value={deadline}
            title="Deadline"
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={(date) => { setDeadline(date); setShowDeadlinePicker(false); }}
            onClear={() => { setDeadline(null); setShowDeadlinePicker(false); }}
            onCancel={() => setShowDeadlinePicker(false)}
          />
          <SuggestedCategorySheet
            visible={pendingCategory !== null}
            categoryName={pendingCategory ?? ''}
            onConfirm={() => {
              if (pendingCategory) {
                addCategory(pendingCategory);
                setCategory(pendingCategory);
                haptics.success();
              }
              setPendingCategory(null);
            }}
            onDismiss={() => setPendingCategory(null)}
          />
          <BlockerPickerSheet
            visible={showBlockerPicker}
            taskId={task?.id ?? null}
            context={{ groupId, projectId: project, category }}
            onClose={() => setShowBlockerPicker(false)}
            onSelect={setBlockedById}
          />
        </>
      }
    >
      <View style={styles.titleWrap}>
        {parsedSchedule && (
          <Text style={[styles.titleInput, styles.titleOverlay]} pointerEvents="none">
            {title.slice(0, parsedSchedule.matchStart)}
            <Text style={styles.titleHighlight}>{title.slice(parsedSchedule.matchStart, scheduleMatchEnd)}</Text>
            {title.slice(scheduleMatchEnd)}
          </Text>
        )}
        <TextInput
          ref={titleRef}
          style={[styles.titleInput, parsedSchedule && styles.titleInputHidden]}
          value={title}
          onChangeText={setTitle}
          placeholder="Task title"
          placeholderTextColor={colors.textTertiary}
          maxLength={TITLE_MAX_LENGTH}
          // iOS's own inline predictive-text completion draws its candidate
          // directly into the field, on top of (and misaligned with) the
          // schedule-phrase overlay above — it reads as our highlight
          // glitching. Autocorrect off suppresses that native suggestion.
          autoCorrect={false}
          multiline blurOnSubmit
        />
      </View>

      {/* Schedule banner — detected date/recurrence phrase; tap to apply */}
      {parsedSchedule && (
        <Animated.View
          style={[styles.scheduleBanner, {
            opacity: scheduleTooltipAnim,
            transform: [
              { translateY: scheduleTooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
              { scale: scheduleTooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
            ],
          }]}
        >
          <PressableScale style={styles.scheduleBannerBtn} onPress={applyParsedSchedule}>
            <Ionicons
              name={parsedSchedule.schedule.recurrenceType !== 'none' ? 'repeat' : 'calendar-outline'}
              size={14}
              color={colors.onAccent}
            />
            <Text style={styles.scheduleBannerText} numberOfLines={1}>
              {describeSchedule(parsedSchedule.schedule, getLogicalNow(dayResetTime))}
            </Text>
            <View style={styles.scheduleBannerDot} />
            <Text style={styles.scheduleBannerHint}>Tap to set</Text>
          </PressableScale>
        </Animated.View>
      )}
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes"
        placeholderTextColor={colors.textTertiary}
        multiline
      />

      {/* Schedule — when the task surfaces, and how it repeats */}
      <Text style={styles.groupLabel}>Schedule</Text>
      <View style={styles.optionsCard}>
        <EditorRow
          icon="calendar"
          label="Date"
          hint="The day it shows up on Today"
          value={dueDate ? formatScheduledDate(dueDate.toISOString()) : undefined}
          onPress={() => setShowWhenPicker(true)}
          onClear={dueDate ? () => { setDueDate(null); setExtraDates([]); setTimeSegments([]); } : undefined}
        />
        <View style={styles.sep} />
        <EditorRow
          icon="calendar-number-outline"
          label="More dates"
          hint="The same task on several days — each date gets its own row"
          value={
            extraDates.length > 0
              ? `${extraDates.length + (dueDate ? 1 : 0)} dates · ${extraDates.map(d => format(d, 'MMM d')).join(', ')}`
              : undefined
          }
          onPress={() => setShowDatesPicker(true)}
          onClear={extraDates.length > 0 ? () => setExtraDates([]) : undefined}
        />
        {extraDates.length > 0 && (
          <View style={styles.scheduleRow}>
            <TouchableOpacity
              style={[styles.schedulePill, !seriesRepeats && styles.schedulePillActive]}
              onPress={() => setSeriesRepeats(false)}
            >
              <Text style={[styles.schedulePillText, !seriesRepeats && styles.schedulePillTextActive]}>
                Just these dates
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.schedulePill, seriesRepeats && styles.schedulePillActive]}
              onPress={() => setSeriesRepeats(true)}
            >
              <Text style={[styles.schedulePillText, seriesRepeats && styles.schedulePillTextActive]}>
                Every month
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {extraDates.length > 0 && seriesRepeats && (
          <Text style={styles.seriesRepeatHint}>
            {`Comes back on the ${seriesMonthDaysFrom([...(dueDate ? [dueDate] : []), ...extraDates])
              .map(d => (d === -1 ? 'last day' : ordinal(d)))
              .join(' and ')} of every month, once all of this month's are done.`}
          </Text>
        )}
        <View style={styles.sep} />
        <EditorRow
          icon="flag-outline"
          label="Deadline"
          hint={deadlineOffsetDays === null && deadlineMonthDay === null ? 'A target date to hit — separate from Date' : undefined}
          value={
            deadlineOffsetDays !== null
              ? (deadline ? `${formatDeadlineDate(deadline.toISOString())} (${deadlineOffsetDays === 1 ? '1 day' : `${deadlineOffsetDays} days`} before due)` : 'Set a Date first')
              : deadlineMonthDay !== null
              ? (deadline ? `${formatDeadlineDate(deadline.toISOString())} (${deadlineMonthDay === -1 ? 'last day of the month' : `${ordinal(deadlineMonthDay)} of the month`})` : 'Set a Date first')
              : (deadline ? formatDeadlineDate(deadline.toISOString()) : undefined)
          }
          onPress={() => { if (deadlineOffsetDays === null && deadlineMonthDay === null) setShowDeadlinePicker(true); }}
          onClear={(deadline || deadlineOffsetDays !== null || deadlineMonthDay !== null) ? () => { setDeadline(null); setDeadlineOffsetDays(null); setDeadlineMonthDay(null); } : undefined}
        />
        {recurrenceType !== 'none' && (deadline || deadlineOffsetDays !== null || deadlineMonthDay !== null) && (
          <>
            <View style={styles.scheduleRow}>
              <TouchableOpacity
                style={[styles.schedulePill, deadlineOffsetDays === null && deadlineMonthDay === null && styles.schedulePillActive]}
                onPress={() => { setDeadlineOffsetDays(null); setDeadlineMonthDay(null); }}
              >
                <Text style={[styles.schedulePillText, deadlineOffsetDays === null && deadlineMonthDay === null && styles.schedulePillTextActive]}>
                  Fixed date
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.schedulePill, deadlineOffsetDays !== null && styles.schedulePillActive]}
                onPress={() => {
                  setDeadlineMonthDay(null);
                  setDeadlineOffsetDays(prev => {
                    if (prev !== null) return prev;
                    if (deadline && dueDate) {
                      const diff = differenceInCalendarDays(dueDate, deadline);
                      if (diff > 0) return diff;
                    }
                    return 1;
                  });
                }}
              >
                <Text style={[styles.schedulePillText, deadlineOffsetDays !== null && styles.schedulePillTextActive]}>
                  Before due date
                </Text>
              </TouchableOpacity>
              {recurrenceType === 'monthly' && (
                <TouchableOpacity
                  style={[styles.schedulePill, deadlineMonthDay !== null && styles.schedulePillActive]}
                  onPress={() => { setDeadlineOffsetDays(null); setDeadlineMonthDay(prev => prev ?? -1); }}
                >
                  <Text style={[styles.schedulePillText, deadlineMonthDay !== null && styles.schedulePillTextActive]}>
                    Day of month
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {deadlineOffsetDays !== null && (
              <View style={styles.intervalRow}>
                <TouchableOpacity
                  style={styles.intervalBtn}
                  onPress={() => setDeadlineOffsetDays(d => Math.max(1, (d ?? 1) - 1))}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease deadline offset"
                >
                  <Ionicons name="remove" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.intervalValue}>{deadlineOffsetDays}</Text>
                <TouchableOpacity
                  style={styles.intervalBtn}
                  onPress={() => setDeadlineOffsetDays(d => (d ?? 0) + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Increase deadline offset"
                >
                  <Ionicons name="add" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.intervalLabel}>
                  {deadlineOffsetDays === 1 ? 'day before due, every occurrence' : 'days before due, every occurrence'}
                </Text>
              </View>
            )}
            {deadlineMonthDay !== null && (
              <>
                <View style={styles.scheduleRow}>
                  <TouchableOpacity
                    style={[styles.schedulePill, deadlineMonthDay > 0 && styles.schedulePillActive]}
                    onPress={() => setDeadlineMonthDay(deadlineMonthDay > 0 ? deadlineMonthDay : (dueDate ?? new Date()).getDate())}
                  >
                    <Text style={[styles.schedulePillText, deadlineMonthDay > 0 && styles.schedulePillTextActive]}>
                      On a day
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, deadlineMonthDay === -1 && styles.schedulePillActive]}
                    onPress={() => setDeadlineMonthDay(-1)}
                  >
                    <Text style={[styles.schedulePillText, deadlineMonthDay === -1 && styles.schedulePillTextActive]}>
                      Last day
                    </Text>
                  </TouchableOpacity>
                </View>
                {deadlineMonthDay > 0 && (
                  <View style={styles.intervalRow}>
                    <Text style={styles.intervalLabel}>On the</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setDeadlineMonthDay(Math.max(1, deadlineMonthDay - 1))}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease day of month"
                    >
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.intervalValue}>{ordinal(deadlineMonthDay)}</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setDeadlineMonthDay(Math.min(31, deadlineMonthDay + 1))}
                      accessibilityRole="button"
                      accessibilityLabel="Increase day of month"
                    >
                      <Ionicons name="add" size={16} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </>
        )}
        <View style={styles.sep} />
        <EditorRow
          icon="time-outline"
          label="Time of day"
          hint="Hold it back until a part of the day"
          value={timeOfDaySummary}
          expanded={showTimeOfDay}
          onPress={() => { animateLayout(); setShowTimeOfDay(v => !v); }}
          onClear={timeSegments.length > 0 ? () => setTimeSegments([]) : undefined}
        />
        {showTimeOfDay && (
          <>
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
            <View style={styles.segmentSuggestRow}>
              <TouchableOpacity
                style={styles.suggestBtn}
                onPress={handleSuggestSegment}
                disabled={!title.trim()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Suggest a time of day from past completions"
              >
                <Ionicons name="analytics-outline" size={12} color={colors.purple} />
                <Text style={styles.suggestBtnText}>From history</Text>
              </TouchableOpacity>
              {segmentNote ? (
                <Text style={styles.segmentNote}>{segmentNote}</Text>
              ) : null}
            </View>
          </>
        )}
        <View style={styles.sep} />
        <EditorRow
          icon="timer-outline"
          label="Time window"
          hint="Only active for part of the day, then expires"
          value={timeWindowSummary}
          expanded={showTimeWindow}
          onPress={() => { animateLayout(); setShowTimeWindow(v => !v); }}
          onClear={(windowStart || windowEnd)
            ? () => { setWindowStart(null); setWindowEnd(null); setWindowPickerMode('none'); }
            : undefined}
        />
        {showTimeWindow && (
          <>
            <View style={styles.windowPillRow}>
              <TouchableOpacity
                style={[styles.timePill, styles.windowPill, !!windowStart && styles.timePillActive]}
                onPress={() => openWindowPicker('start')}
              >
                <Text style={[styles.timePillText, !!windowStart && styles.timePillTextActive]}>
                  {windowStart ? formatHHMM(windowStart) : 'Start'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.timePill, styles.windowPill, !!windowEnd && styles.timePillActive]}
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
                  style={styles.windowPickerWidget}
                />
                <View style={styles.pickerButtons}>
                  <TouchableOpacity style={styles.pickerBtn} onPress={() => setWindowPickerMode('none')}>
                    <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.pickerBtn, styles.pickerBtnPrimary]} onPress={confirmWindowPicker}>
                    <Text style={[styles.pickerBtnText, { color: colors.text }]}>Set</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
        <View style={styles.sep} />
        <EditorRow
          icon="speedometer-outline"
          label="Daily target"
          hint="Log it several times a day; only shows up when you fall behind"
          value={targetCount !== null ? formatQuotaTarget(targetCount, targetUnit) : undefined}
          expanded={showTargetCount}
          onPress={() => { animateLayout(); setShowTargetCount(v => !v); }}
          onClear={targetCount !== null ? () => { setTargetCount(null); setTargetUnit(''); setShowTargetCount(false); } : undefined}
        />
        {showTargetCount && (
          <>
            <View style={styles.targetStepperRow}>
              <CountStepper
                value={targetCount}
                onChange={next => {
                  setTargetCount(next);
                  // A quota only makes sense day to day: the count resets
                  // because each new occurrence starts at zero, so without
                  // a daily repeat there'd be nothing to reset it.
                  if (next !== null) enableRecurrence();
                }}
                min={MIN_TARGET_COUNT}
                max={MAX_TARGET_COUNT}
                // The floor clears it, so the row's × isn't the only way out of
                // being a quota once you've opened this.
                allowNull
                emptyLabel="Off"
                format={n => `${n}×`}
                label="Daily target"
                describeValue={n => (n === null ? 'off' : `${n} ${normalizeTargetUnit(targetUnit) ?? 'times'} a day`)}
              />
              {/* The unit is only ever read next to the count, so it's typed
                  next to it too — and it's hidden while there's no count,
                  since on its own it labels nothing. */}
              {targetCount !== null && (
                <TextInput
                  style={styles.targetUnitInput}
                  value={targetUnit}
                  onChangeText={setTargetUnit}
                  placeholder="units"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={MAX_TARGET_UNIT_LENGTH}
                  autoCapitalize="none"
                  returnKeyType="done"
                  accessibilityLabel="Unit for the daily target, optional"
                />
              )}
            </View>
            {/* Says what the row will read as rather than what the field is
                for: the unit's whole job is how the meter comes out, and a
                preview answers "plural or singular?" without a rule to
                explain. */}
            <Text style={styles.targetStepperCaption}>
              {targetCount === null
                ? 'Not a daily target'
                : `Shows as ${formatQuotaProgress(0, targetCount, targetUnit)}, a day`}
            </Text>
          </>
        )}
        <View style={styles.sep} />
        <EditorRow
          icon={reminderKind === 'alarm' ? 'alarm' : 'notifications'}
          label="Remind me"
          hint={reminderKind === 'alarm' ? 'Ring an alarm at this time' : 'Send a notification at this time'}
          value={reminderTime ? `${format(reminderTime, 'MMM d')} at ${formatTimeOfDay(reminderTime)}` : undefined}
          onPress={() => openPicker('reminder')}
          onClear={reminderTime ? () => { setReminderTime(null); setReminderKind('notification'); } : undefined}
        />
        <View style={styles.sep} />
        <EditorRow
          icon="hourglass-outline"
          label="Waiting on"
          hint="Stay hidden until another task is done"
          value={
            blockerTask
              ? displayTitleFor(blockerTask)
              : blockedById ? 'Task no longer exists' : undefined
          }
          onPress={() => setShowBlockerPicker(true)}
          onClear={blockedById ? () => setBlockedById(null) : undefined}
        />
        <View style={styles.sep} />
        <EditorRow
          icon="repeat"
          label="Repeat"
          hint="Come back on a schedule after each completion"
          value={recurrenceType !== 'none' ? formatRecurrenceSummary(recurrenceType, recurrenceInterval) : undefined}
          onPress={enableRecurrence}
          onClear={recurrenceType !== 'none' ? () => setRecurrenceType('none') : undefined}
        />
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
            seedMonthDay={() => (dueDate ?? new Date()).getDate()}
            recurrenceFromCompletion={recurrenceFromCompletion}
            onChangeFromCompletion={setRecurrenceFromCompletion}
            recurrenceCount={recurrenceCount}
            onChangeCount={setRecurrenceCount}
            weekOrdinal={{
              value: recurrenceWeekOrdinal,
              onChange: setRecurrenceWeekOrdinal,
              seedWeekday: () => (dueDate ?? new Date()).getDay(),
            }}
            onSelectEndNever={setRecurrenceEndNever}
            onSelectEndCount={setRecurrenceEndAfterCount}
            endDate={{
              value: recurrenceEndDate,
              onSelect: setRecurrenceEndOnDate,
              onOpenPicker: () => setShowEndDatePicker(true),
            }}
          />
        )}
        <View style={styles.sep} />
        <View style={styles.cardSection}>
          <View style={styles.chainHeader}>
            <Ionicons name="git-commit" size={14} color={chainEnabled ? colors.accent : colors.textTertiary} />
            <Text style={[styles.sectionLabel, { marginBottom: 0, flex: 1 }]}>Chain</Text>
            <TouchableOpacity
              style={[styles.chainToggle, chainEnabled && styles.chainToggleOn]}
              onPress={() => { haptics.tap(); setChainEnabled(v => !v); }}
              accessibilityRole="switch"
              accessibilityLabel="Chain"
              accessibilityState={{ checked: chainEnabled }}
            >
              <View style={[styles.chainToggleKnob, chainEnabled && styles.chainToggleKnobOn]} />
            </TouchableOpacity>
          </View>
          {!chainEnabled && (
            <Text style={styles.chainHint}>
              Step through a list of items, one per completion — finishing one reveals the next.
              {recurrenceType !== 'none' ? ' With Repeat on, the whole chain starts over once it finishes.' : ''}
            </Text>
          )}
          {chainEnabled && (
            <>
              <SortableList
                onDragStateChange={setDraggingRow}
                data={chainItems}
                onReorder={(newData) => {
                  const activeItemId = chainItems[chainIndex]?.id;
                  setChainItems(newData);
                  const newIdx = newData.findIndex(item => item.id === activeItemId);
                  if (newIdx !== -1) setChainIndex(newIdx);
                }}
                renderItem={(item, displayIndex, drag) => {
                  const actualIdx = chainItems.findIndex(c => c.id === item.id);
                  const isCurrentStep = actualIdx === chainIndex;
                  return (
                    <View style={styles.chainItemRow}>
                      <TouchableOpacity
                        onPress={() => setChainIndex(actualIdx)}
                        hitSlop={6}
                        style={styles.chainItemIndexBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Set current step to ${item.title}`}
                      >
                        <View style={[styles.chainItemDot, isCurrentStep && styles.chainItemDotActive]}>
                          <Text style={[styles.chainItemDotText, isCurrentStep && styles.chainItemDotTextActive]}>
                            {displayIndex + 1}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      <Text style={[styles.chainItemTitle, isCurrentStep && styles.chainItemTitleActive]}>
                        {item.title}
                      </Text>
                      <ChainStepMinutes
                        value={item.estimatedMinutes}
                        label={item.title}
                        onChange={mins => setChainItems(prev => prev.map(
                          c => (c.id === item.id ? { ...c, estimatedMinutes: mins } : c),
                        ))}
                      />
                      <TouchableOpacity
                        onLongPress={drag}
                        delayLongPress={150}
                        hitSlop={8}
                        style={styles.dragHandle}
                        accessibilityRole="button"
                        accessibilityLabel={`Reorder chain step ${item.title}`}
                      >
                        <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          // Track the active step by id (like onReorder above) rather
                          // than by index — deleting an earlier step shifts every later
                          // index down, so re-clamping the old chainIndex against the
                          // new length silently lands on the wrong step.
                          const activeItemId = chainItems[chainIndex]?.id;
                          const next = chainItems.filter((_, j) => j !== actualIdx);
                          setChainItems(next);
                          if (activeItemId === item.id) {
                            // The active step itself was deleted — land on whatever now
                            // occupies its old slot (i.e. the step after it).
                            setChainIndex(Math.min(actualIdx, Math.max(0, next.length - 1)));
                          } else {
                            const newIdx = next.findIndex(c => c.id === activeItemId);
                            setChainIndex(newIdx !== -1 ? newIdx : Math.max(0, next.length - 1));
                          }
                        }}
                        hitSlop={8}
                        style={styles.chainItemDelete}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove chain step ${item.title}`}
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
                <Text style={styles.chainCurrentHint}>
                  Times are per step; a step left blank uses the task's own estimate.
                </Text>
              )}
              {chainItems.length > 1 && (
                <View style={styles.chainModeBlock}>
                  <Text style={styles.chainModeLabel}>Next step</Text>
                  <View style={styles.chainModeRow}>
                    {([false, true] as const).map(onSchedule => {
                      const active = chainStepOnSchedule === onSchedule;
                      // "On the next repeat" needs a repeat to wait for. Shown
                      // disabled rather than hidden so the choice — and the
                      // fact that Repeat is what unlocks it — stays visible.
                      const disabled = onSchedule && recurrenceType === 'none';
                      return (
                        <TouchableOpacity
                          key={String(onSchedule)}
                          style={[
                            styles.chainModePill,
                            active && styles.chainModePillActive,
                            disabled && styles.chainModePillDisabled,
                          ]}
                          disabled={disabled}
                          onPress={() => { haptics.tap(); setChainStepOnSchedule(onSchedule); }}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active, disabled }}
                          accessibilityLabel={onSchedule ? 'Next step on the next repeat' : 'Next step right away'}
                        >
                          <Text
                            style={[
                              styles.chainModePillText,
                              active && styles.chainModePillTextActive,
                              disabled && styles.chainModePillTextDisabled,
                            ]}
                          >
                            {onSchedule ? 'On the next repeat' : 'Right away'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={styles.chainCurrentHint}>
                    {recurrenceType === 'none'
                      ? 'Steps follow each other as you finish them. Add a repeat to spread them over days instead.'
                      : chainStepOnSchedule
                        ? 'One step per repeat — the chain rotates through its steps rather than running straight through.'
                        : 'Finishing a step brings up the next one immediately; the repeat starts the whole chain over.'}
                  </Text>
                </View>
              )}
              {chainIndex < chainItems.length && chainItems.length > 1 && (
                <Text style={styles.chainCurrentHint}>
                  {(() => {
                    // Timing lives in the Next step block above, so this stays
                    // about position — with one exception. In "Right away" mode
                    // the wrap is the single step that *does* wait for the
                    // repeat, which is exactly what that block doesn't say and
                    // what makes step 1 look like it should have been today's.
                    const prefix = 'Tap a number to set the current position.';
                    if (chainIndex === chainItems.length - 1) {
                      return recurrenceType === 'none'
                        ? `${prefix} This is the last step — the chain ends here.`
                        : `${prefix} Last step — the chain starts over on the next repeat.`;
                    }
                    return `${prefix} Next up: ${chainItems[(chainIndex + 1) % chainItems.length]?.title}`;
                  })()}
                </Text>
              )}
            </>
          )}
        </View>
      </View>

      {/* Organize — collapsed to the chosen value until you tap in */}
      <Text style={styles.groupLabel}>Organize</Text>
      <View style={styles.sectionCard}>
        {/* Until this row existed the editor never mentioned stacks at
            all: a task couldn't tell you it was in one, and the only ways
            out were the stack editor's ✕ and dragging the row out of the
            group on Today. It leads the section because it's what the
            locked Category row below points at. */}
        {/* Only when there's something to pick. An empty picker would teach
            nothing — stacks are created from the + menu on Today, not here. */}
        {allGroups.length > 0 && (
          <>
            <CollapsibleField
              label="Stack"
              summary={selectedGroup ? selectedGroup.title : undefined}
              hint="Groups this task with others you do together. The stack sets the shared category for everything in it."
              expanded={fieldOpen('stack')}
              onToggle={() => toggleField('stack')}
            >
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !groupId && styles.pillActiveNeutral]}
                  onPress={() => { haptics.tap(); setGroupId(null); closeField('stack'); }}
                >
                  <Text style={[styles.pillText, !groupId && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {allGroups.map(g => (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.pill, groupId === g.id && styles.pillActiveNeutral]}
                    onPress={() => {
                      haptics.tap();
                      setGroupId(g.id);
                      // A stack owns its members' category (see addExistingToGroup),
                      // so adopt it here rather than letting the locked row keep
                      // showing a value the save is about to overwrite.
                      setCategory(g.category);
                      closeField('stack');
                    }}
                  >
                    <Text style={[styles.pillText, groupId === g.id && styles.pillTextActive]} numberOfLines={1}>{g.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </CollapsibleField>
            <View style={styles.cardSep} />
          </>
        )}
        <CollapsibleField
          label="Category"
          summary={category ? categoryLabel(category, categories) : undefined}
          hint="One home for the task — drives the Categories screen and its filters."
          expanded={fieldOpen('category')}
          onToggle={() => toggleField('category')}
          // A stack owns its members' category, so there's nothing to pick
          // here while the task is in one — the value would be overwritten
          // by the next cascade. Changing it means changing the stack's,
          // or leaving the stack.
          locked={selectedGroup !== null}
          lockedHint={selectedGroup ? `From the ${selectedGroup.title} stack.` : undefined}
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
            {addingCategory ? (
              <TextInput
                autoFocus
                style={styles.tagInput}
                value={newCategory}
                onChangeText={setNewCategory}
                onSubmitEditing={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeField('category'); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                onBlur={() => {
                  const c = newCategory.trim();
                  if (c) { addCategory(c); setCategory(c); closeField('category'); }
                  setNewCategory(''); setAddingCategory(false);
                }}
                placeholder="category name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="words"
              />
            ) : (
              <InlineAction icon="add" label="New" accessibilityLabel="New category" onPress={() => setAddingCategory(true)} />
            )}
          </View>
        </CollapsibleField>

        {projects.length > 0 && (
          <>
            <View style={styles.cardSep} />
            <CollapsibleField
              label="Project"
              summary={projects.find(p => p.id === project)?.title}
              hint="Files the task under a project so it counts toward that project's progress."
              expanded={fieldOpen('project')}
              onToggle={() => toggleField('project')}
            >
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, !project && styles.pillActiveNeutral]}
                  onPress={() => { haptics.tap(); setProject(null); closeField('project'); }}
                >
                  <Text style={[styles.pillText, !project && styles.pillTextActive]}>None</Text>
                </TouchableOpacity>
                {projects.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pill, project === p.id && styles.pillActiveNeutral]}
                    onPress={() => { haptics.tap(); setProject(p.id); closeField('project'); }}
                  >
                    <Text style={[styles.pillText, project === p.id && styles.pillTextActive]}>{p.title}</Text>
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
          hint="Free-form labels. A task can carry several, and you can filter or search by them."
          expanded={fieldOpen('tags')}
          onToggle={() => toggleField('tags')}
          right={!!anthropicApiKey && (
            <TouchableOpacity
              style={styles.suggestBtn}
              onPress={handleSuggest}
              disabled={aiLoading || !title.trim()}
              hitSlop={8}
            >
              {aiLoading
                ? <ActivityIndicator size="small" color={colors.purple} />
                : (
                  <>
                    <Ionicons name="sparkles-outline" size={12} color={colors.purple} />
                    <Text style={styles.suggestBtnText}>Suggest</Text>
                  </>
                )
              }
            </TouchableOpacity>
          )}
        >
          <View style={styles.tagRow}>
            {tags.map(tag => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, { backgroundColor: tagColor(tag) + '33' }]}
                onPress={() => { haptics.tap(); setTags(prev => prev.filter(t => t !== tag)); }}
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
                placeholder="tag name"
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
                  onPress={() => { haptics.tap(); setTags(prev => [...prev, tag]); }}
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
          <View style={styles.pillRow}>
            {([0, 1, 2, 3, 4] as Priority[]).map(p => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.pill,
                  priority === p && p === 0 && styles.pillActiveNeutral,
                  priority === p && p > 0 && { backgroundColor: PRIORITY_COLORS[p] },
                ]}
                onPress={() => { haptics.tap(); setPriority(p); closeField('priority'); }}
              >
                <Text style={[styles.pillText, priority === p && styles.pillTextActive]}>
                  {PRIORITY_LABELS[p]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Effort"
          summary={effortSummary}
          emptySummary="Not set"
          hint="Roughly how long this takes, so a day's list can be sized realistically."
          expanded={fieldOpen('effort')}
          onToggle={() => toggleField('effort')}
          right={(
            <TouchableOpacity
              style={styles.suggestBtn}
              onPress={handleEstimateEffort}
              disabled={!title.trim()}
              hitSlop={8}
            >
              <Ionicons name="sparkles-outline" size={12} color={colors.purple} />
              <Text style={styles.suggestBtnText}>Estimate</Text>
            </TouchableOpacity>
          )}
        >
          <View style={styles.pillRow}>
            {([0, 1, 2, 3, 4, 5, 6] as Effort[]).map(e => {
              const active = !customEffortActive && effort === e;
              const presetMins = EFFORT_MINUTES[e];
              return (
                <TouchableOpacity
                  key={e}
                  style={[styles.pill, active && styles.pillActiveNeutral]}
                  onPress={() => { haptics.tap(); applyEffortPreset(e); closeField('effort'); }}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {e === 0 ? '—' : EFFORT_LABELS[e]}
                  </Text>
                  {presetMins != null ? (
                    <Text style={styles.pillHint}>{formatDuration(presetMins)}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.pill, customEffortActive && styles.pillActiveNeutral]}
              onPress={openCustomEffort}
            >
              <Text style={[styles.pillText, customEffortActive && styles.pillTextActive]}>
                {customEffortActive && estimatedMinutes != null ? formatDuration(estimatedMinutes) : 'Custom'}
              </Text>
              <Text style={styles.pillHint}>exact</Text>
            </TouchableOpacity>
          </View>
          {customEffortOpen && (
            <View style={styles.customEffortRow}>
              <TextInput
                style={styles.customEffortInput}
                value={customEffortText}
                onChangeText={t => { setCustomEffortText(t); applyCustomEffort(t, customEffortUnit); }}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
              <View style={styles.unitToggle}>
                {(['min', 'hr'] as const).map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.unitChip, customEffortUnit === u && styles.unitChipActive]}
                    onPress={() => { setCustomEffortUnit(u); applyCustomEffort(customEffortText, u); }}
                  >
                    <Text style={[styles.unitChipText, customEffortUnit === u && styles.unitChipTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {effortNote ? (
            <Text style={styles.effortNote}>{effortNote}</Text>
          ) : null}
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Duration"
          summary={timedMinutes != null ? formatDuration(timedMinutes) : undefined}
          emptySummary="Untimed"
          hint="Counts down on the task's row while you work. When it runs out the task is marked ready to complete."
          expanded={fieldOpen('duration')}
          onToggle={toggleDuration}
        >
          <View style={styles.pillRow}>
            {DURATION_PRESETS.map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.pill, timedMinutes === m && styles.pillActiveNeutral]}
                onPress={() => {
                  haptics.tap();
                  // Tapping the active preset clears it — the only way back
                  // to untimed without emptying the input by hand.
                  const next = timedMinutes === m ? null : m;
                  setTimedMinutes(next);
                  setDurationUnit('min');
                  setDurationText(next != null ? String(next) : '');
                }}
              >
                <Text style={[styles.pillText, timedMinutes === m && styles.pillTextActive]}>
                  {formatDuration(m)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.customEffortRow}>
            <TextInput
              style={styles.customEffortInput}
              value={durationText}
              onChangeText={t => { setDurationText(t); applyDuration(t, durationUnit); }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.unitToggle}>
              {(['min', 'hr'] as const).map(u => (
                <TouchableOpacity
                  key={u}
                  style={[styles.unitChip, durationUnit === u && styles.unitChipActive]}
                  onPress={() => { setDurationUnit(u); applyDuration(durationText, u); }}
                >
                  <Text style={[styles.unitChipText, durationUnit === u && styles.unitChipTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </CollapsibleField>

        <View style={styles.cardSep} />

        <CollapsibleField
          label="Time spent"
          summary={actualMinutes != null ? formatDuration(actualMinutes) : undefined}
          emptySummary="Not logged"
          hint="How long it actually took. Time it with the stopwatch on the task's row, or log it here — either way it also sets the estimate."
          expanded={fieldOpen('timeSpent')}
          onToggle={toggleTimeSpent}
        >
          <View style={styles.customEffortRow}>
            <TextInput
              style={styles.customEffortInput}
              value={logTimeText}
              onChangeText={t => { setLogTimeText(t); applyLoggedTime(t, logTimeUnit); }}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <View style={styles.unitToggle}>
              {(['min', 'hr'] as const).map(u => (
                <TouchableOpacity
                  key={u}
                  style={[styles.unitChip, logTimeUnit === u && styles.unitChipActive]}
                  onPress={() => { setLogTimeUnit(u); applyLoggedTime(logTimeText, u); }}
                >
                  <Text style={[styles.unitChipText, logTimeUnit === u && styles.unitChipTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </CollapsibleField>
      </View>

      {/* Subtasks — only shown when editing an existing task */}
      {task && (
        <View style={styles.sectionCard}>
          <CollapsibleField
            label="Subtasks"
            summary={subtasks.length > 0 ? `${subtasks.filter(s => s.completed).length}/${subtasks.length} done` : undefined}
            emptySummary="None"
            expanded={fieldOpen('subtasks', subtasks.length > 0)}
            onToggle={() => toggleField('subtasks', subtasks.length > 0)}
          >
            <MiniFabList
              onDragStateChange={setDraggingRow}
              data={subtasks}
              onReorder={(newData) => reorderSubtasks(task.id, newData.map(s => s.id))}
              accessibilityLabel="Add subtask"
              fabHidden={addingSubtask}
              onAdd={index => {
                setPendingSubtaskIndex(index);
                setAddingSubtask(true);
              }}
              renderItem={(sub, _i, drag) => (
                <View style={styles.subtaskRow}>
                  <TouchableOpacity
                    onPress={() => toggleSubtask(sub.id)}
                    hitSlop={6}
                    style={styles.subtaskCheck}
                    accessibilityRole="checkbox"
                    accessibilityLabel={sub.title}
                    accessibilityState={{ checked: sub.completed }}
                  >
                    <View style={[styles.subtaskBox, sub.completed && styles.subtaskBoxDone]}>
                      {sub.completed && (
                        <Ionicons name="checkmark" size={11} color={colors.onAccent} />
                      )}
                    </View>
                  </TouchableOpacity>
                  <Text style={[styles.subtaskTitle, sub.completed && styles.subtaskDone]}>
                    {sub.title}
                  </Text>
                  <TouchableOpacity
                    onLongPress={drag}
                    delayLongPress={150}
                    hitSlop={8}
                    style={styles.dragHandle}
                    accessibilityRole="button"
                    accessibilityLabel={`Reorder subtask ${sub.title}`}
                  >
                    <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => deleteSubtask(sub.id)}
                    hitSlop={8}
                    style={styles.subtaskDelete}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete subtask ${sub.title}`}
                  >
                    <Ionicons name="close" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              )}
              footer={addingSubtask ? (
                <View style={styles.subtaskInputRow}>
                  {/* An empty copy of the row checkbox, so the field being typed
                      into lines up with the subtasks above it. */}
                  <View style={styles.subtaskCheck}>
                    <View style={styles.subtaskBox} />
                  </View>
                  <TextInput
                    autoFocus
                    style={styles.subtaskInput}
                    value={newSubtaskTitle}
                    onChangeText={setNewSubtaskTitle}
                    placeholder="Subtask title"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={TITLE_MAX_LENGTH}
                    returnKeyType="next"
                    // Adding subtasks is a burst, not one edit: submitting keeps
                    // the field focused so the keyboard never drops between them.
                    // This used to blur on submit and refocus on a 50ms timer,
                    // which dismissed and reopened the keyboard on every entry.
                    blurOnSubmit={false}
                    onSubmitEditing={() => {
                      commitSubtask(newSubtaskTitle);
                      setNewSubtaskTitle('');
                    }}
                    onBlur={() => {
                      commitSubtask(newSubtaskTitle);
                      setNewSubtaskTitle('');
                      setAddingSubtask(false);
                      setPendingSubtaskIndex(null);
                    }}
                  />
                </View>
              ) : null}
            />
          </CollapsibleField>
        </View>
      )}

      {/* Everything else — rarely changed, so it sits last */}
      <Text style={styles.groupLabel}>More</Text>
      <View style={styles.optionsCard}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setPinned(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Pin to Today"
          accessibilityState={{ checked: pinned }}
        >
          <PinIcon filled={pinned} size={18} color={pinned ? colors.orange : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Pin to Today</Text>
            <Text style={styles.optionHint}>Hoist this to the top of Today, above everything else</Text>
          </View>
          <View style={[styles.toggle, pinned && styles.toggleOn]}>
            <View style={[styles.toggleKnob, pinned && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        <View style={styles.sep} />
        <EditorRow
          icon="link-outline"
          label="Link"
          hint="Open an app or link from the task"
          value={
            KNOWN_LINK_APPS.find(app => app.scheme === linkUrl)?.name
              ?? (linkUrl ?? undefined)
          }
          expanded={showLinkPicker}
          onPress={() => {
            if (linkUrl && !KNOWN_LINK_APPS.some(app => app.scheme === linkUrl)) {
              setCustomLinkText(linkUrl);
            }
            setShowLinkPicker(v => !v);
          }}
          onClear={linkUrl ? () => { setLinkUrl(null); setCustomLinkText(''); setShowLinkPicker(false); } : undefined}
        />
        {showLinkPicker && (
          <>
            <View style={styles.linkPickerRow}>
              {KNOWN_LINK_APPS.map(app => (
                <TouchableOpacity
                  key={app.scheme}
                  style={[styles.linkAppChip, linkUrl === app.scheme && styles.linkAppChipActive]}
                  onPress={() => { setLinkUrl(app.scheme); setShowLinkPicker(false); }}
                >
                  <Ionicons
                    name={app.icon as never}
                    size={13}
                    color={linkUrl === app.scheme ? colors.bg : colors.textSecondary}
                  />
                  <Text style={[styles.linkAppChipText, linkUrl === app.scheme && styles.linkAppChipTextActive]}>
                    {app.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.linkCustomRow}>
              <Ionicons name="globe-outline" size={16} color={colors.textSecondary} />
              <TextInput
                style={styles.linkCustomInput}
                value={customLinkText}
                onChangeText={setCustomLinkText}
                onSubmitEditing={commitCustomLink}
                onBlur={commitCustomLink}
                placeholder="https://... or app://"
                placeholderTextColor={colors.textTertiary}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>
          </>
        )}
        <View style={styles.sep} />
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { haptics.tap(); setVacationPause(v => !v); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="switch"
          accessibilityLabel="Vacation pause"
          accessibilityState={{ checked: vacationPause }}
        >
          <Ionicons name="airplane-outline" size={18} color={vacationPause ? colors.accent : colors.textSecondary} />
          <View style={styles.optionContent}>
            <Text style={styles.optionLabel}>Vacation pause</Text>
            <Text style={styles.optionHint}>Hide and protect streak during vacation mode</Text>
          </View>
          <View style={[styles.toggle, vacationPause && styles.toggleOn]}>
            <View style={[styles.toggleKnob, vacationPause && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
        {task && !task.parentId && (
          <>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={handleSendToGroceries}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Send to groceries"
            >
              <Ionicons name="cart-outline" size={18} color={colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Send to groceries</Text>
                <Text style={styles.optionHint}>
                  Move this to the grocery list — for a &ldquo;buy milk&rdquo; captured as a task
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </>
        )}
        {task && task.recurrenceType !== 'none' && (
          <>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                if (task.archived) {
                  unarchiveTask(task.id);
                } else {
                  haptics.success();
                  archiveTask(task.id);
                  onClose();
                }
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityLabel="Archive"
              accessibilityState={{ checked: task.archived }}
            >
              <Ionicons name="archive-outline" size={18} color={task.archived ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Archive</Text>
                <Text style={styles.optionHint}>
                  {task.archived
                    ? 'Hidden from every list — resuming resets your streak'
                    : 'Hide indefinitely, keeping history — find it later in Archived'}
                </Text>
              </View>
              <View style={[styles.toggle, task.archived && styles.toggleOn]}>
                <View style={[styles.toggleKnob, task.archived && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                setStreakDraft(task.streakCount);
                setStreakEditorOpen(o => !o);
              }}
              activeOpacity={interaction.activeOpacity}
            >
              <Ionicons name="flame-outline" size={18} color={task.streakCount > 0 ? colors.orange : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Streak</Text>
                <Text style={styles.optionHint}>
                  {task.streakCount > 0 ? `${task.streakCount} day streak — tap to correct` : 'No streak yet'}
                </Text>
              </View>
              <Ionicons name={streakEditorOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            {streakEditorOpen && (
              <View style={styles.intervalRow}>
                <TouchableOpacity
                  style={styles.intervalBtn}
                  onPress={() => setStreakDraft(d => Math.max(0, d - 1))}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease streak count"
                >
                  <Ionicons name="remove" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.intervalValue}>{streakDraft}</Text>
                <TouchableOpacity
                  style={styles.intervalBtn}
                  onPress={() => setStreakDraft(d => d + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Increase streak count"
                >
                  <Ionicons name="add" size={16} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.intervalLabel}>day{streakDraft === 1 ? '' : 's'}</Text>
                <TouchableOpacity
                  style={[styles.streakApplyBtn, streakDraft === task.streakCount && styles.streakApplyBtnDisabled]}
                  onPress={() => applyStreakChange(streakDraft)}
                  disabled={streakDraft === task.streakCount}
                >
                  <Text style={[styles.streakApplyText, streakDraft === task.streakCount && styles.streakApplyTextDisabled]}>
                    {streakDraft === 0 ? 'Reset' : 'Apply'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
        {/* Keyed off the draft's recurrence, not the saved task's, so it shows
            up the moment a repeat is picked on a brand new task too. */}
        {recurrenceType !== 'none' && (
          <>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => {
                haptics.tap();
                setShowStreak(v => !v);
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityLabel="Show streak on row"
              accessibilityState={{ checked: showStreak }}
            >
              <Ionicons name="flame" size={18} color={showStreak ? colors.orange : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Show streak on row</Text>
                <Text style={styles.optionHint}>Keep the streak count visible on the task itself, not just in here</Text>
              </View>
              <View style={[styles.toggle, showStreak && styles.toggleOn]}>
                <View style={[styles.toggleKnob, showStreak && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>

      {task && (
        <View style={[styles.optionsCard, { marginTop: spacing.xl }]}>
          <TouchableOpacity style={styles.optionRow} onPress={handleDelete} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="trash-outline" size={18} color={colors.red} />
            <View style={styles.optionContent}>
              <Text style={[styles.optionLabel, { color: colors.red }]}>Delete Task</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}
    </EditorSheet>
  );
}


const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 320 },
  titleWrap: {
    position: 'relative',
  },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, minHeight: 68,
    letterSpacing: -0.3,
    textAlignVertical: 'top',
  },
  // Positioned exactly over the real input; shows the highlighted phrase
  // while the actual TextInput's own text is made transparent, so the
  // native input stays purely controlled via `value` (no children).
  titleOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
  },
  titleInputHidden: {
    color: 'transparent',
  },
  titleHighlight: {
    color: colors.accent,
    fontWeight: '700',
    backgroundColor: colors.accentSubtle,
  },
  scheduleBanner: {
    marginHorizontal: spacing.md,
    marginTop: -4,
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
  },
  scheduleBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  scheduleBannerText: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: '600',
    flexShrink: 1,
  },
  scheduleBannerDot: {
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: colors.onAccent,
    opacity: 0.6,
  },
  scheduleBannerHint: {
    color: colors.onAccent,
    fontSize: font.xs,
    fontWeight: '500',
    opacity: 0.75,
  },
  notesInput: {
    color: colors.textSecondary, fontSize: font.md,
    paddingHorizontal: spacing.md, paddingBottom: spacing.lg, minHeight: 50,
    lineHeight: 22,
  },
  sectionCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  cardSection: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  cardSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm,
  },
  suggestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.purple + '22',
  },
  suggestBtnText: { color: colors.purple, fontSize: font.xs, fontWeight: '600' },
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
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  pillTextActive: { color: colors.text, fontWeight: '600' },
  pillHint: { color: colors.textTertiary, fontSize: 10, marginTop: 2 },
  customEffortRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
  },
  customEffortInput: {
    color: colors.text, fontSize: font.md, fontWeight: '600',
    backgroundColor: colors.bgTertiary, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 72, textAlign: 'center',
  },
  unitToggle: { flexDirection: 'row', gap: 4 },
  unitChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  unitChipActive: { backgroundColor: colors.bgQuaternary },
  unitChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  unitChipTextActive: { color: colors.text, fontWeight: '600' },
  effortNote: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm },
  segmentSuggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  segmentNote: { color: colors.textTertiary, fontSize: font.xs, flexShrink: 1 },
  timePillRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  timePill: {
    flex: 1, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  timePillActive: { backgroundColor: colors.accent },
  timePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  timePillTextActive: { color: colors.bg, fontWeight: '600' },
  windowPillRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  windowPill: { flex: 1 },
  targetStepperRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.xs,
  },
  targetStepperCaption: {
    color: colors.textTertiary, fontSize: font.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  targetUnitInput: {
    flex: 1, color: colors.text, fontSize: font.sm,
    borderBottomWidth: border.sm, borderBottomColor: colors.separator,
    // Height rather than lineHeight — see the TextInput note in CLAUDE.md.
    height: 32,
  },
  linkPickerRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  linkAppChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  linkAppChipActive: { backgroundColor: colors.accent },
  linkAppChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  linkAppChipTextActive: { color: colors.bg, fontWeight: '600' },
  linkCustomRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  linkCustomInput: {
    flex: 1, color: colors.text, fontSize: font.sm,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 4,
  },
  windowPickerWidget: { height: 180 },
  pickerButtons: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  pickerBtn: {
    flex: 1, paddingVertical: 11, borderRadius: radius.md,
    alignItems: 'center', backgroundColor: colors.bgTertiary,
  },
  pickerBtnPrimary: { backgroundColor: colors.accent },
  pickerBtnText: { fontSize: font.md, fontWeight: '600' },
  groupLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
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
  intervalRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  intervalLabel: { color: colors.textSecondary, fontSize: font.sm },
  scheduleRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  schedulePill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  schedulePillActive: { backgroundColor: colors.accent },
  schedulePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  schedulePillTextActive: { color: colors.bg },
  seriesRepeatHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  intervalBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  intervalValue: {
    color: colors.text, fontSize: font.md, fontWeight: '600',
    minWidth: 24, textAlign: 'center',
  },
  streakApplyBtn: {
    marginLeft: 'auto', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.orange,
  },
  streakApplyBtnDisabled: { backgroundColor: colors.bgTertiary },
  streakApplyText: { color: colors.onAccent, fontSize: font.sm, fontWeight: '600' },
  streakApplyTextDisabled: { color: colors.textTertiary },
  toggle: {
    width: 46, height: 27, borderRadius: 14,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: colors.orange },
  toggleKnob: {
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: colors.bg,
  },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
  subtaskRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  subtaskCheck: { padding: 2 },
  subtaskBox: {
    width: SUBTASK_CHECKBOX_SIZE,
    height: SUBTASK_CHECKBOX_SIZE,
    borderRadius: checkboxRadius(SUBTASK_CHECKBOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  subtaskBoxDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  subtaskTitle: {
    flex: 1, color: colors.text, fontSize: font.md,
  },
  subtaskDone: {
    color: colors.textTertiary, textDecorationLine: 'line-through',
  },
  subtaskDelete: { padding: 4 },
  dragHandle: { padding: 4 },
  subtaskInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
  },
  subtaskInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 2,
  },
  chainHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  chainToggle: {
    width: 42, height: 25, borderRadius: 13,
    backgroundColor: colors.bgQuaternary, justifyContent: 'center', paddingHorizontal: 3,
  },
  chainToggleOn: { backgroundColor: colors.accent },
  chainToggleKnob: {
    width: 19, height: 19, borderRadius: 10,
    backgroundColor: colors.bg,
  },
  chainToggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },
  chainHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16,
  },
  chainItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  chainItemIndexBtn: { padding: 2 },
  chainItemDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  chainItemDotActive: { backgroundColor: colors.accent },
  chainItemDotText: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '700',
  },
  chainItemDotTextActive: { color: colors.bg },
  chainItemTitle: {
    flex: 1, color: colors.text, fontSize: font.md,
  },
  chainItemTitleActive: { color: colors.accent, fontWeight: '600' },
  chainItemDelete: { padding: 4 },
  chainInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7,
  },
  chainInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    borderBottomWidth: 1, borderBottomColor: colors.accent,
    paddingVertical: 2,
  },
  chainCurrentHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16,
    marginTop: spacing.xs,
  },
  chainModeBlock: { marginTop: spacing.md },
  chainModeLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.xs,
  },
  chainModeRow: { flexDirection: 'row', gap: spacing.xs },
  chainModePill: {
    flex: 1, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  chainModePillActive: { backgroundColor: colors.accent },
  chainModePillDisabled: { opacity: 0.4 },
  chainModePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  chainModePillTextActive: { color: colors.onAccent, fontWeight: '600' },
  chainModePillTextDisabled: { color: colors.textTertiary },
});
