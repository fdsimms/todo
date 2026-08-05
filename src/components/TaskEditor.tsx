import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SortableList } from './SortableList';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { RemindMePicker } from './RemindMePicker';
import { WhenPicker } from './WhenPicker';
import { CalendarPicker } from './CalendarPicker';
import { WeekdaySelector } from './WeekdaySelector';
import { format, addMonths, addDays, subDays, differenceInCalendarDays } from 'date-fns';
import type { Task, Priority, Effort, RecurrenceType, ChainItem, TimeOfDay } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS, EFFORT_LABELS, TITLE_MAX_LENGTH } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, lineHeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { tagColor } from '../utils/tagColor';
import { useTaskStore, CONTENT_FIELDS } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useShallow } from 'zustand/react/shallow';
import { formatDueDate, formatHHMM, hhmmToDate, dateToHHMM, getDeadlineFromOffset, getDeadlineFromMonthDay, getDayStart, getCurrentDayStart } from '../utils/dateUtils';
import { generateId } from '../utils/id';
import { findArchivedMatch } from '../utils/archiveMatch';
import { suggestTaskAttributes, suggestTaskEffort } from '../services/aiSuggestions';
import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration } from '../utils/effort';
import { SuggestedCategorySheet } from './SuggestedCategorySheet';
import { CollapsibleField } from './CollapsibleField';
import { EditorRow } from './EditorRow';
import { KNOWN_LINK_APPS } from '../constants/linkApps';

/** Pre-filled values carried over from the quick add modal when creating a new task. */
export interface TaskDraft {
  title: string;
  priority: Priority;
  effort: Effort;
  estimatedMinutes: number | null;
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
  /** Preselects the Chain toggle when opening a brand-new task. */
  chainEnabled?: boolean;
}

interface Props {
  visible: boolean;
  task?: Task | null;
  initialDraft?: Partial<TaskDraft> | null;
  onClose: () => void;
  // Overrides for the category/tag pickers' autocomplete lists. Used by
  // DemoScreen so editing a sample task can't leak real category/tag names
  // (e.g. a "Supplements" category) into the suggestion pills — omit to use
  // every real category/tag, as every other call site does.
  categoryOptions?: string[];
  tagOptions?: string[];
  // Fired right after a brand-new category is registered (via the "New"
  // field or the AI suggestion sheet) — categories are a permanent registry
  // entry (unlike tags, which vanish with the last task using them), so a
  // restricted editor (e.g. DemoScreen) needs this to know what to clean up
  // afterward rather than blocking creation outright.
  onCategoryCreated?: (name: string) => void;
}

type PickerMode = 'none' | 'reminder';

/** Editor sections that collapse to a one-line summary of their current value. */
type FieldKey = 'category' | 'project' | 'tags' | 'priority' | 'effort' | 'timeSpent' | 'subtasks';

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: 'Never',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Nth-weekday-of-month picker options ("every 2nd Tuesday", "every last Friday").
export const ORDINAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

// WeekdaySelector toggles a day in/out of an array; the Nth-weekday-of-month
// picker needs exactly one day selected at a time, so this wraps its
// onChange to always keep the most recently tapped day (ignoring a tap that
// would deselect the only day, since a weekday must stay chosen).
export function onlyNewestWeekday(current: number[], setDays: (days: number[]) => void): (days: number[]) => void {
  return (days: number[]) => {
    if (days.length === 0) return;
    const added = days.find(d => !current.includes(d));
    setDays(added !== undefined ? [added] : [days[days.length - 1]]);
  };
}

const RECURRENCE_UNIT_SINGULAR: Record<Exclude<RecurrenceType, 'none'>, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

function recurrenceUnitLabel(type: RecurrenceType, interval: number): string {
  if (type === 'none') return '';
  const unit = RECURRENCE_UNIT_SINGULAR[type];
  return interval === 1 ? unit : `${unit}s`;
}

function formatRecurrenceSummary(type: RecurrenceType, interval: number): string {
  if (type === 'none') return '';
  return `Every ${interval} ${recurrenceUnitLabel(type, interval)}`;
}

export function TaskEditor({ visible, task, initialDraft, onClose, categoryOptions, tagOptions, onCategoryCreated }: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);
  const setLastAction = useTaskStore(s => s.setLastAction);
  const addSubtask = useTaskStore(s => s.addSubtask);
  const toggleSubtask = useTaskStore(s => s.toggleSubtask);
  const deleteSubtask = useTaskStore(s => s.deleteSubtask);
  const reorderSubtasks = useTaskStore(s => s.reorderSubtasks);
  const subtasksOf = useTaskStore(s => s.subtasksOf);
  const archiveTask = useTaskStore(s => s.archiveTask);
  const unarchiveTask = useTaskStore(s => s.unarchiveTask);
  const archivedTasks = useTaskStore(useShallow(s => s.archivedTasks()));
  const allTagsStore = useTaskStore(useShallow(s => s.allTags()));
  const allCategoriesStore = useTaskStore(useShallow(s => s.allCategories()));
  const allTags = tagOptions ?? allTagsStore;
  const allCategories = categoryOptions ?? allCategoriesStore;
  const categories = useCategoryStore(useShallow(s => s.categories));
  const addCategory = useTaskStore(s => s.addCategory);
  const projects = useProjectStore(useShallow(s => s.projects.filter(p => !p.archived)));
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [aiLoading, setAiLoading] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [deadlineOffsetDays, setDeadlineOffsetDays] = useState<number | null>(null);
  const [deadlineMonthDay, setDeadlineMonthDay] = useState<number | null>(null);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [windowPickerMode, setWindowPickerMode] = useState<'none' | 'start' | 'end'>('none');
  const [windowPickerDate, setWindowPickerDate] = useState(new Date());
  const [deferUntil, setDeferUntil] = useState<Date | null>(null);
  const [reminderTime, setReminderTime] = useState<Date | null>(null);
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
  const [effortAiLoading, setEffortAiLoading] = useState(false);
  const [actualMinutes, setActualMinutes] = useState<number | null>(null);
  const [logTimeText, setLogTimeText] = useState('');
  const [logTimeUnit, setLogTimeUnit] = useState<'min' | 'hr'>('min');
  const [pinned, setPinned] = useState(false);
  const [vacationPause, setVacationPause] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [customLinkText, setCustomLinkText] = useState('');
  const [streakEditorOpen, setStreakEditorOpen] = useState(false);
  const [streakDraft, setStreakDraft] = useState(0);

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

  const [chainEnabled, setChainEnabled] = useState(false);
  const [chainItems, setChainItems] = useState<ChainItem[]>([]);
  const [chainIndex, setChainIndex] = useState(0);
  const [newChainItemTitle, setNewChainItemTitle] = useState('');
  const [addingChainItem, setAddingChainItem] = useState(false);

  const titleRef = useRef<TextInput>(null);
  const chainInputRef = useRef<TextInput>(null);
  const chainItemSavedRef = useRef(false);
  const subtaskInputRef = useRef<TextInput>(null);
  const subtaskSavedRef = useRef(false);
  const initialStateRef = useRef<string>('');

  useEffect(() => {
    if (!visible) return;
    if (task) {
      setTitle(task.title); setNotes(task.notes); setCategory(task.category ?? null); setProject(task.projectId ?? null); setTags(task.tags);
      setDueDate(task.dueDate ? new Date(task.dueDate) : null);
      setDeadline(task.deadline ? new Date(task.deadline) : null);
      setDeadlineOffsetDays(task.deadlineOffsetDays ?? null);
      setDeadlineMonthDay(task.deadlineMonthDay ?? null);
      setTimeSegments(task.timeSegments ?? []);
      setWindowStart(task.windowStart ?? null);
      setWindowEnd(task.windowEnd ?? null);
      setDeferUntil(task.deferUntil ? new Date(task.deferUntil) : null);
      setReminderTime(task.reminderTime ? new Date(task.reminderTime) : null);
      setRecurrenceType(task.recurrenceType); setRecurrenceInterval(task.recurrenceInterval);
      setRecurrenceDays(task.recurrenceDays ?? []);
      setRecurrenceMonthDay(task.recurrenceMonthDay ?? null);
      setRecurrenceWeekOrdinal(task.recurrenceWeekOrdinal ?? null);
      setRecurrenceFromCompletion(task.recurrenceFromCompletion);
      setRecurrenceEndDate(task.recurrenceEndDate ? new Date(task.recurrenceEndDate) : null);
      setRecurrenceCount(task.recurrenceCount ?? null);
      setPriority(task.priority); setEffort(task.effort); setEstimatedMinutes(task.estimatedMinutes ?? null); setPinned(task.pinned);
      setActualMinutes(task.actualMinutes ?? null);
      setChainEnabled(task.chainEnabled); setChainItems(task.chainItems);
      setChainIndex(task.chainIndex);
      setVacationPause(task.vacationPause ?? false);
      setLinkUrl(task.linkUrl ?? null);
    } else {
      setTitle(initialDraft?.title ?? ''); setNotes(''); setCategory(initialDraft?.category ?? null); setProject(null); setTags(initialDraft?.tags ?? []);
      setDueDate(initialDraft?.dueDate ?? null); setDeadline(null); setDeadlineOffsetDays(null); setDeadlineMonthDay(null); setTimeSegments(initialDraft?.timeSegments ?? []); setWindowStart(null); setWindowEnd(null); setDeferUntil(null); setReminderTime(null);
      setRecurrenceType(initialDraft?.recurrenceType ?? 'none'); setRecurrenceInterval(initialDraft?.recurrenceInterval ?? 1);
      setRecurrenceDays(initialDraft?.recurrenceDays ?? []);
      setRecurrenceMonthDay(initialDraft?.recurrenceMonthDay ?? null);
      setRecurrenceWeekOrdinal(initialDraft?.recurrenceWeekOrdinal ?? null);
      setRecurrenceFromCompletion(initialDraft?.recurrenceFromCompletion ?? false);
      setRecurrenceEndDate(null);
      setRecurrenceCount(null);
      setPriority(initialDraft?.priority ?? 0); setEffort(initialDraft?.effort ?? 0); setEstimatedMinutes(initialDraft?.estimatedMinutes ?? null); setPinned(false);
      setActualMinutes(null);
      setChainEnabled(initialDraft?.chainEnabled ?? false); setChainItems([]); setChainIndex(0);
      setVacationPause(false);
      setLinkUrl(null);
    }
    setShowLinkPicker(false); setCustomLinkText('');
    setPickerMode('none'); setShowWhenPicker(false); setShowDeadlinePicker(false); setShowEndDatePicker(false); setPickerDate(new Date()); setWindowPickerMode('none'); setNewCategory(''); setAddingCategory(false); setNewTag(''); setAddingTag(false);
    setNewSubtaskTitle(''); setAddingSubtask(false);
    setNewChainItemTitle(''); setAddingChainItem(false);
    setAiLoading(false);
    setOpenFields({}); setShowTimeOfDay(false); setShowTimeWindow(false);
    setCustomEffortOpen(false); setCustomEffortText(''); setCustomEffortUnit('min');
    setLogTimeText(''); setLogTimeUnit('min');
    setEffortNote(null); setEffortAiLoading(false);
    setStreakEditorOpen(false); setStreakDraft(task?.streakCount ?? 0);
    setPendingCategory(null);
    setTimeout(() => titleRef.current?.focus(), 100);
    initialStateRef.current = JSON.stringify({
      title: task ? task.title : (initialDraft?.title ?? ''),
      notes: task ? task.notes : '',
      category: task ? (task.category ?? null) : (initialDraft?.category ?? null),
      projectId: task ? (task.projectId ?? null) : null,
      tags: task ? task.tags : (initialDraft?.tags ?? []),
      dueDate: task ? (task.dueDate ?? null) : (initialDraft?.dueDate?.toISOString() ?? null),
      deadline: task?.deadline ?? null,
      deadlineOffsetDays: task?.deadlineOffsetDays ?? null,
      deadlineMonthDay: task?.deadlineMonthDay ?? null,
      windowStart: task?.windowStart ?? null,
      windowEnd: task?.windowEnd ?? null,
      deferUntil: task?.deferUntil ?? null,
      reminderTime: task?.reminderTime ?? null,
      recurrenceType: task ? task.recurrenceType : (initialDraft?.recurrenceType ?? 'none'),
      recurrenceInterval: task ? task.recurrenceInterval : (initialDraft?.recurrenceInterval ?? 1),
      recurrenceDays: task ? (task.recurrenceDays ?? []) : (initialDraft?.recurrenceDays ?? []),
      recurrenceMonthDay: task ? (task.recurrenceMonthDay ?? null) : (initialDraft?.recurrenceMonthDay ?? null),
      recurrenceWeekOrdinal: task ? (task.recurrenceWeekOrdinal ?? null) : (initialDraft?.recurrenceWeekOrdinal ?? null),
      recurrenceFromCompletion: task ? task.recurrenceFromCompletion : (initialDraft?.recurrenceFromCompletion ?? false),
      recurrenceEndDate: task ? (task.recurrenceEndDate ?? null) : null,
      recurrenceCount: task ? (task.recurrenceCount ?? null) : null,
      priority: task ? task.priority : (initialDraft?.priority ?? 0),
      effort: task ? task.effort : (initialDraft?.effort ?? 0),
      estimatedMinutes: task ? (task.estimatedMinutes ?? null) : (initialDraft?.estimatedMinutes ?? null),
      actualMinutes: task?.actualMinutes ?? null,
      pinned: task?.pinned ?? false,
      chainEnabled: task ? task.chainEnabled : (initialDraft?.chainEnabled ?? false),
      chainItems: task?.chainItems ?? [],
      chainIndex: task?.chainIndex ?? 0,
      vacationPause: task?.vacationPause ?? false,
      linkUrl: task?.linkUrl ?? null,
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

  const save = () => {
    if (!title.trim()) return;

    if (!task) {
      const archivedMatch = findArchivedMatch(archivedTasks, title.trim());
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
      timeSegments, windowStart, windowEnd, deferUntil: deferUntil?.toISOString() ?? null,
      reminderTime: reminderTime?.toISOString() ?? null,
      recurrenceType, recurrenceInterval,
      recurrenceDays: recurrenceType === 'weekly' ? recurrenceDays : recurrenceType === 'monthly' && recurrenceWeekOrdinal !== null ? recurrenceDays : [],
      recurrenceMonthDay: recurrenceType === 'monthly' && recurrenceWeekOrdinal === null ? recurrenceMonthDay : null,
      recurrenceWeekOrdinal: recurrenceType === 'monthly' ? recurrenceWeekOrdinal : null,
      recurrenceEndDate: recurrenceType !== 'none' ? (recurrenceEndDate?.toISOString() ?? null) : null,
      recurrenceCount: recurrenceType !== 'none' ? recurrenceCount : null,
      recurrenceFromCompletion,
      sortOrder: task?.sortOrder ?? 0,
      pinned, priority, effort, estimatedMinutes, actualMinutes,
      chainEnabled: chainEnabled && chainItems.length > 0,
      chainItems,
      chainIndex,
      vacationPause,
      linkUrl,
    };

    const commitSave = (scope?: 'occurrence' | 'series') => {
      haptics.success();
      if (task) {
        const snapshot = { ...task };
        setLastAction({
          label: 'Edit saved',
          undo: () => updateTask(snapshot.id, snapshot),
        });
        updateTask(task.id, data, scope === 'occurrence' ? { scope: 'occurrence' } : undefined);
      } else {
        animateLayout();
        addTask(data);
      }
      onClose();
    };

    // Recurring tasks: content-field edits (title, notes, tags, etc. — the
    // fields that otherwise silently carry forward to every future
    // occurrence) need the user to pick a scope. Repeat-section/schedule-only
    // edits have exactly one sensible meaning and save directly.
    if (task && task.recurrenceType !== 'none') {
      const record = data as unknown as Record<string, unknown>;
      const taskRecord = task as unknown as Record<string, unknown>;
      const contentChanged = CONTENT_FIELDS.some(
        key => JSON.stringify(record[key]) !== JSON.stringify(taskRecord[key])
      );
      if (contentChanged) {
        Alert.alert(
          'Update recurring task',
          'This task repeats. Apply this change to just this task, or to this and all future occurrences?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'This Task', onPress: () => commitSave('occurrence') },
            { text: 'This and Future Tasks', onPress: () => commitSave('series') },
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

  const openPicker = (mode: PickerMode) => {
    if (mode === 'reminder') {
      const defaultDate = dueDate ?? new Date();
      defaultDate.setHours(9, 0, 0, 0);
      setPickerDate(reminderTime ?? defaultDate);
    }
    setPickerMode(mode);
  };

  const confirmPicker = (confirmed: Date) => {
    if (pickerMode === 'reminder') setReminderTime(confirmed);
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
      windowStart, windowEnd,
      deferUntil: deferUntil?.toISOString() ?? null,
      reminderTime: reminderTime?.toISOString() ?? null,
      recurrenceType, recurrenceInterval, recurrenceDays, recurrenceFromCompletion,
      recurrenceEndDate: recurrenceEndDate?.toISOString() ?? null,
      recurrenceCount,
      priority, effort, estimatedMinutes, actualMinutes, pinned, chainEnabled, chainItems, chainIndex, vacationPause,
      linkUrl,
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
        'This task repeats. Skip just this occurrence, or delete it and stop the series?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Skip This Occurrence',
            onPress: () => {
              skipNextRecurrence(task.id);
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
      if (result.effort > 0 && effort === 0) { setEffort(result.effort); setEstimatedMinutes(EFFORT_MINUTES[result.effort]); }
      const newTags = result.tags.filter(t => !tags.includes(t));
      if (newTags.length > 0) setTags(prev => [...prev, ...newTags]);
      if (result.category && !category) setCategory(result.category);
      else if (result.newCategory && !category) setPendingCategory(result.newCategory);
    } catch {
      // silently fail — no API key or network issue
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

  const handleEstimateEffort = async () => {
    setEffortAiLoading(true);
    setEffortNote(null);
    try {
      const result = await suggestTaskEffort(title.trim(), notes);
      if (result.minutes != null) {
        setEstimatedMinutes(result.minutes);
        setEffort(minutesToEffort(result.minutes));
        setCustomEffortOpen(false);
        setEffortNote(result.reason);
      } else {
        // The model abstained — surface why and leave the estimate untouched.
        setEffortNote(result.reason);
      }
    } catch {
      setEffortNote('Could not estimate right now.');
    } finally {
      setEffortAiLoading(false);
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} hitSlop={8}>
            <Text style={styles.headerBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{task ? 'Edit Task' : 'New Task'}</Text>
          <TouchableOpacity onPress={save} hitSlop={8}>
            <Text style={[styles.headerBtn, styles.headerSave, !title.trim() && styles.disabled]}>
              {task ? 'Save' : 'Add'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
          <TextInput
            ref={titleRef}
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

          {/* Schedule — when the task surfaces, and how it repeats */}
          <Text style={styles.groupLabel}>Schedule</Text>
          <View style={styles.optionsCard}>
            <EditorRow
              icon="calendar"
              label="Date"
              hint="The day it shows up on Today"
              value={dueDate ? formatDueDate(dueDate.toISOString()) : undefined}
              onPress={() => setShowWhenPicker(true)}
              onClear={dueDate ? () => { setDueDate(null); setTimeSegments([]); } : undefined}
            />
            <View style={styles.sep} />
            <EditorRow
              icon="flag-outline"
              label="Deadline"
              hint={deadlineOffsetDays === null && deadlineMonthDay === null ? 'A target date to hit — separate from Date' : undefined}
              value={
                deadlineOffsetDays !== null
                  ? (deadline ? `${formatDueDate(deadline.toISOString())} (${deadlineOffsetDays === 1 ? '1 day' : `${deadlineOffsetDays} days`} before due)` : 'Set a Date first')
                  : deadlineMonthDay !== null
                  ? (deadline ? `${formatDueDate(deadline.toISOString())} (${deadlineMonthDay === -1 ? 'last day of the month' : `${ordinal(deadlineMonthDay)} of the month`})` : 'Set a Date first')
                  : (deadline ? formatDueDate(deadline.toISOString()) : undefined)
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
                    >
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.intervalValue}>{deadlineOffsetDays}</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setDeadlineOffsetDays(d => (d ?? 0) + 1)}
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
                        >
                          <Ionicons name="remove" size={16} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.intervalValue}>{ordinal(deadlineMonthDay)}</Text>
                        <TouchableOpacity
                          style={styles.intervalBtn}
                          onPress={() => setDeadlineMonthDay(Math.min(31, deadlineMonthDay + 1))}
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
              icon="hourglass-outline"
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
              icon="notifications"
              label="Remind me"
              hint="Send a notification at this time"
              value={reminderTime ? format(reminderTime, "MMM d 'at' h:mm a") : undefined}
              onPress={() => openPicker('reminder')}
              onClear={reminderTime ? () => setReminderTime(null) : undefined}
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
              <>
                <View style={styles.scheduleRow}>
                  {(['daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[]).map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.schedulePill, recurrenceType === type && styles.schedulePillActive]}
                      onPress={() => setRecurrenceType(type)}
                    >
                      <Text style={[styles.schedulePillText, recurrenceType === type && styles.schedulePillTextActive]}>
                        {RECURRENCE_LABELS[type]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.intervalRow}>
                  <Text style={styles.intervalLabel}>Every</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => setRecurrenceInterval(Math.max(1, recurrenceInterval - 1))}
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalValue}>{recurrenceInterval}</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => setRecurrenceInterval(recurrenceInterval + 1)}
                  >
                    <Ionicons name="add" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalLabel}>{recurrenceUnitLabel(recurrenceType, recurrenceInterval)}</Text>
                </View>
                {recurrenceType === 'weekly' && (
                  <View style={styles.weekdayRow}>
                    <WeekdaySelector value={recurrenceDays} onChange={setRecurrenceDays} />
                  </View>
                )}
                {recurrenceType === 'monthly' && (
                  <View style={styles.scheduleRow}>
                    <TouchableOpacity
                      style={[styles.schedulePill, recurrenceMonthDay === null && recurrenceWeekOrdinal === null && styles.schedulePillActive]}
                      onPress={() => { setRecurrenceMonthDay(null); setRecurrenceWeekOrdinal(null); }}
                    >
                      <Text style={[styles.schedulePillText, recurrenceMonthDay === null && recurrenceWeekOrdinal === null && styles.schedulePillTextActive]}>
                        Same day as due date
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.schedulePill, recurrenceMonthDay !== null && recurrenceMonthDay > 0 && styles.schedulePillActive]}
                      onPress={() => { setRecurrenceWeekOrdinal(null); setRecurrenceMonthDay(recurrenceMonthDay && recurrenceMonthDay > 0 ? recurrenceMonthDay : (dueDate ?? new Date()).getDate()); }}
                    >
                      <Text style={[styles.schedulePillText, recurrenceMonthDay !== null && recurrenceMonthDay > 0 && styles.schedulePillTextActive]}>
                        On a day
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.schedulePill, recurrenceMonthDay === -1 && styles.schedulePillActive]}
                      onPress={() => { setRecurrenceWeekOrdinal(null); setRecurrenceMonthDay(-1); }}
                    >
                      <Text style={[styles.schedulePillText, recurrenceMonthDay === -1 && styles.schedulePillTextActive]}>
                        Last day
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.schedulePill, recurrenceWeekOrdinal !== null && styles.schedulePillActive]}
                      onPress={() => {
                        setRecurrenceMonthDay(null);
                        setRecurrenceWeekOrdinal(recurrenceWeekOrdinal ?? 1);
                        if (recurrenceDays.length === 0) setRecurrenceDays([(dueDate ?? new Date()).getDay()]);
                      }}
                    >
                      <Text style={[styles.schedulePillText, recurrenceWeekOrdinal !== null && styles.schedulePillTextActive]}>
                        On a weekday
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                {recurrenceType === 'monthly' && recurrenceMonthDay !== null && recurrenceMonthDay > 0 && (
                  <View style={styles.intervalRow}>
                    <Text style={styles.intervalLabel}>On the</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setRecurrenceMonthDay(Math.max(1, recurrenceMonthDay - 1))}
                    >
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.intervalValue}>{ordinal(recurrenceMonthDay)}</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setRecurrenceMonthDay(Math.min(31, recurrenceMonthDay + 1))}
                    >
                      <Ionicons name="add" size={16} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                )}
                {recurrenceType === 'monthly' && recurrenceWeekOrdinal !== null && (
                  <>
                    <View style={styles.scheduleRow}>
                      {ORDINAL_OPTIONS.map(({ value, label }) => (
                        <TouchableOpacity
                          key={value}
                          style={[styles.schedulePill, recurrenceWeekOrdinal === value && styles.schedulePillActive]}
                          onPress={() => setRecurrenceWeekOrdinal(value)}
                        >
                          <Text style={[styles.schedulePillText, recurrenceWeekOrdinal === value && styles.schedulePillTextActive]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.weekdayRow}>
                      <WeekdaySelector value={recurrenceDays} onChange={onlyNewestWeekday(recurrenceDays, setRecurrenceDays)} />
                    </View>
                  </>
                )}
                <View style={styles.scheduleRow}>
                  <TouchableOpacity
                    style={[styles.schedulePill, !recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => setRecurrenceFromCompletion(false)}
                  >
                    <Text style={[styles.schedulePillText, !recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      On schedule
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => setRecurrenceFromCompletion(true)}
                  >
                    <Text style={[styles.schedulePillText, recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      After completion
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.scheduleRow}>
                  <Text style={[styles.intervalLabel, styles.endsLabel]}>Ends</Text>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceEndMode === 'never' && styles.schedulePillActive]}
                    onPress={setRecurrenceEndNever}
                  >
                    <Text style={[styles.schedulePillText, recurrenceEndMode === 'never' && styles.schedulePillTextActive]}>
                      Never
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceEndMode === 'date' && styles.schedulePillActive]}
                    onPress={setRecurrenceEndOnDate}
                  >
                    <Text style={[styles.schedulePillText, recurrenceEndMode === 'date' && styles.schedulePillTextActive]}>
                      On date
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceEndMode === 'count' && styles.schedulePillActive]}
                    onPress={setRecurrenceEndAfterCount}
                  >
                    <Text style={[styles.schedulePillText, recurrenceEndMode === 'count' && styles.schedulePillTextActive]}>
                      After
                    </Text>
                  </TouchableOpacity>
                </View>
                {recurrenceEndMode === 'date' && recurrenceEndDate && (
                  <View style={styles.endDateRow}>
                    <TouchableOpacity
                      style={styles.endDateChip}
                      onPress={() => setShowEndDatePicker(true)}
                      activeOpacity={interaction.activeOpacity}
                    >
                      <Ionicons name="calendar-outline" size={14} color={colors.accent} />
                      <Text style={styles.endDateChipText}>{format(recurrenceEndDate, 'MMM d, yyyy')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {recurrenceEndMode === 'count' && (
                  <View style={styles.intervalRow}>
                    <Text style={styles.intervalLabel}>After</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setRecurrenceCount(c => Math.max(1, (c ?? 1) - 1))}
                    >
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.intervalValue}>{recurrenceCount ?? 1}</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setRecurrenceCount(c => (c ?? 0) + 1)}
                    >
                      <Ionicons name="add" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.intervalLabel}>
                      {(recurrenceCount ?? 1) === 1 ? 'occurrence' : 'occurrences'}
                    </Text>
                  </View>
                )}
              </>
            )}
            <View style={styles.sep} />
            <View style={styles.cardSection}>
              <View style={styles.chainHeader}>
                <Ionicons name="link" size={14} color={chainEnabled ? colors.accent : colors.textTertiary} />
                <Text style={[styles.sectionLabel, { marginBottom: 0, flex: 1 }]}>Chain</Text>
                <TouchableOpacity
                  style={[styles.chainToggle, chainEnabled && styles.chainToggleOn]}
                  onPress={() => setChainEnabled(v => !v)}
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
                          <TouchableOpacity
                            onLongPress={(e) => drag(e.nativeEvent.pageY)}
                            delayLongPress={150}
                            hitSlop={8}
                            style={styles.dragHandle}
                          >
                            <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              const next = chainItems.filter((_, j) => j !== actualIdx);
                              setChainItems(next);
                              if (chainIndex >= next.length) setChainIndex(Math.max(0, next.length - 1));
                            }}
                            hitSlop={8}
                            style={styles.chainItemDelete}
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
                          if (t) setChainItems(prev => [...prev, { id: generateId(), title: t, notes: '' }]);
                          setNewChainItemTitle('');
                          setTimeout(() => {
                            chainItemSavedRef.current = false;
                            chainInputRef.current?.focus();
                          }, 50);
                        }}
                        onBlur={() => {
                          if (chainItemSavedRef.current) return;
                          const t = newChainItemTitle.trim();
                          if (t) setChainItems(prev => [...prev, { id: generateId(), title: t, notes: '' }]);
                          setNewChainItemTitle('');
                          setAddingChainItem(false);
                        }}
                      />
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addChainItemBtn}
                      onPress={() => setAddingChainItem(true)}
                    >
                      <Ionicons name="add" size={14} color={colors.accent} />
                      <Text style={styles.addChainItemText}>Add item</Text>
                    </TouchableOpacity>
                  )}
                  {chainIndex < chainItems.length && chainItems.length > 1 && (
                    <Text style={styles.chainCurrentHint}>
                      Tap a number to set the current position. Next up: {chainItems[(chainIndex + 1) % chainItems.length]?.title}
                    </Text>
                  )}
                </>
              )}
            </View>
          </View>

          {/* Organize — collapsed to the chosen value until you tap in */}
          <Text style={styles.groupLabel}>Organize</Text>
          <View style={styles.sectionCard}>
            <CollapsibleField
              label="Category"
              summary={category ? categoryLabel(category, categories) : undefined}
              hint="One home for the task — drives the Categories screen and its filters."
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
                {addingCategory ? (
                  <TextInput
                    autoFocus
                    style={styles.tagInput}
                    value={newCategory}
                    onChangeText={setNewCategory}
                    onSubmitEditing={() => {
                      const c = newCategory.trim();
                      if (c) { addCategory(c); setCategory(c); onCategoryCreated?.(c); closeField('category'); }
                      setNewCategory(''); setAddingCategory(false);
                    }}
                    onBlur={() => {
                      const c = newCategory.trim();
                      if (c) { addCategory(c); setCategory(c); onCategoryCreated?.(c); closeField('category'); }
                      setNewCategory(''); setAddingCategory(false);
                    }}
                    placeholder="category name"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                    autoCapitalize="words"
                  />
                ) : (
                  <TouchableOpacity style={styles.addTagBtn} onPress={() => setAddingCategory(true)}>
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addTagText}>New</Text>
                  </TouchableOpacity>
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
                  <TouchableOpacity style={styles.addTagBtn} onPress={() => setAddingTag(true)}>
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addTagText}>Add tag</Text>
                  </TouchableOpacity>
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
              right={!!anthropicApiKey && (
                <TouchableOpacity
                  style={styles.suggestBtn}
                  onPress={handleEstimateEffort}
                  disabled={effortAiLoading || !title.trim()}
                  hitSlop={8}
                >
                  {effortAiLoading
                    ? <ActivityIndicator size="small" color={colors.purple} />
                    : (
                      <>
                        <Ionicons name="sparkles-outline" size={12} color={colors.purple} />
                        <Text style={styles.suggestBtnText}>AI estimate</Text>
                      </>
                    )
                  }
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
                <SortableList
                  data={subtasks}
                  onReorder={(newData) => reorderSubtasks(task.id, newData.map(s => s.id))}
                  renderItem={(sub, _i, drag) => (
                    <View style={styles.subtaskRow}>
                      <TouchableOpacity
                        onPress={() => toggleSubtask(sub.id)}
                        hitSlop={6}
                        style={styles.subtaskCheck}
                      >
                        <Ionicons
                          name={sub.completed ? 'checkmark-circle' : 'ellipse-outline'}
                          size={20}
                          color={sub.completed ? colors.green : colors.bgQuaternary}
                        />
                      </TouchableOpacity>
                      <Text style={[styles.subtaskTitle, sub.completed && styles.subtaskDone]}>
                        {sub.title}
                      </Text>
                      <TouchableOpacity
                        onLongPress={(e) => drag(e.nativeEvent.pageY)}
                        delayLongPress={150}
                        hitSlop={8}
                        style={styles.dragHandle}
                      >
                        <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => deleteSubtask(sub.id)}
                        hitSlop={8}
                        style={styles.subtaskDelete}
                      >
                        <Ionicons name="close" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  )}
                />
                {addingSubtask ? (
                  <View style={styles.subtaskInputRow}>
                    <Ionicons name="ellipse-outline" size={20} color={colors.bgQuaternary} />
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
                        if (t) addSubtask(task.id, t);
                        setNewSubtaskTitle('');
                        setTimeout(() => {
                          subtaskSavedRef.current = false;
                          subtaskInputRef.current?.focus();
                        }, 50);
                      }}
                      onBlur={() => {
                        if (subtaskSavedRef.current) return;
                        const t = newSubtaskTitle.trim();
                        if (t) addSubtask(task.id, t);
                        setNewSubtaskTitle('');
                        setAddingSubtask(false);
                      }}
                    />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addSubtaskBtn}
                    onPress={() => setAddingSubtask(true)}
                  >
                    <Ionicons name="add" size={14} color={colors.accent} />
                    <Text style={styles.addSubtaskText}>Add subtask</Text>
                  </TouchableOpacity>
                )}
              </CollapsibleField>
            </View>
          )}

          {/* Everything else — rarely changed, so it sits last */}
          <Text style={styles.groupLabel}>More</Text>
          <View style={styles.optionsCard}>
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
            <TouchableOpacity style={styles.optionRow} onPress={() => { haptics.tap(); setVacationPause(v => !v); }} activeOpacity={interaction.activeOpacity}>
              <Ionicons name="airplane-outline" size={18} color={vacationPause ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Vacation pause</Text>
                <Text style={styles.optionHint}>Hide and protect streak during vacation mode</Text>
              </View>
              <View style={[styles.toggle, vacationPause && styles.toggleOn]}>
                <View style={[styles.toggleKnob, vacationPause && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
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
                    >
                      <Ionicons name="remove" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.intervalValue}>{streakDraft}</Text>
                    <TouchableOpacity
                      style={styles.intervalBtn}
                      onPress={() => setStreakDraft(d => d + 1)}
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
        </ScrollView>

        <RemindMePicker
          visible={pickerMode !== 'none'}
          value={pickerDate}
          onConfirm={confirmPicker}
          onClear={reminderTime ? () => { setReminderTime(null); setPickerMode('none'); } : undefined}
          onCancel={() => setPickerMode('none')}
        />
        <WhenPicker
          visible={showWhenPicker}
          value={dueDate}
          timeSegments={timeSegments}
          taskTitle={title}
          taskNotes={notes}
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
              onCategoryCreated?.(pendingCategory);
              haptics.success();
            }
            setPendingCategory(null);
          }}
          onDismiss={() => setPendingCategory(null)}
        />
      </KeyboardAvoidingView>

    </Modal>
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
  headerBtn: { color: colors.accent, fontSize: font.md },
  headerSave: { fontWeight: '600' },
  disabled: { opacity: 0.4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 320 },
  titleInput: {
    color: colors.text, fontSize: font.xl, fontWeight: '500',
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, minHeight: 68,
    lineHeight: lineHeight.xl,
    letterSpacing: -0.3,
    textAlignVertical: 'top',
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
  addTagBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.bgQuaternary, borderStyle: 'dashed',
  },
  addTagText: { color: colors.accent, fontSize: font.sm },
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
  weekdayRow: {
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
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
  endsLabel: { marginRight: spacing.xs },
  endDateRow: {
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  endDateChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  endDateChipText: { color: colors.accent, fontSize: font.sm, fontWeight: '500' },
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
  addSubtaskBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: spacing.sm,
  },
  addSubtaskText: { color: colors.accent, fontSize: font.sm },
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
  addChainItemBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: spacing.sm,
  },
  addChainItemText: { color: colors.accent, fontSize: font.sm },
  chainCurrentHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16,
    marginTop: spacing.xs,
  },
});
