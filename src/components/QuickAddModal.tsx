import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  StyleSheet,
  Keyboard,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { categoryLabel } from '../utils/categoryLabel';
import { useShallow } from 'zustand/react/shallow';
import type { Priority, Effort, TimeOfDay, RecurrenceType, Task, ChainItem } from '../types';
import { PRIORITY_COLORS, EFFORT_LABELS, TITLE_MAX_LENGTH } from '../types';
import { generateId } from '../utils/id';
import {
  bakedFields,
  blockedReason,
  canSaveType,
  isChipVisible,
  typeSummary,
  DEFAULT_TARGET_COUNT,
  DEFAULT_TIMED_MINUTES,
  MAX_TARGET_COUNT,
  MIN_TARGET_COUNT,
  TIMED_MINUTE_OPTIONS,
  type QuickAddType,
  type TypeValues,
} from '../utils/quickAddTypes';
import { MAX_TARGET_UNIT_LENGTH } from '../utils/quotaUnit';
import { WhenPicker } from './WhenPicker';
import { WeekdaySelector } from './WeekdaySelector';
import { PressableScale } from './PressableScale';
import { CountStepper } from './CountStepper';
import { HighlightedText } from './HighlightedText';
import { suggestTitles } from '../utils/titleSuggestions';
import { findArchivedMatch } from '../utils/archiveMatch';
import { parseTaskInput, describeSchedule, parseLinkInput, parsePhoneInput, parseDurationInput } from '../utils/parseTaskInput';
import { KNOWN_LINK_APPS } from '../constants/linkApps';
import { tagColor } from '../utils/tagColor';
import { format } from 'date-fns/format';
import { getLogicalToday, getLogicalTomorrow, getLogicalNow } from '../utils/dateUtils';
import { suggestTaskAttributes, describeAIError } from '../services/aiSuggestions';
import { estimateEffort } from '../utils/effortEstimator';
import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration } from '../utils/effort';
import { SuggestedCategorySheet } from './SuggestedCategorySheet';
import { type TaskDraft } from './TaskEditor';
import { ORDINAL_OPTIONS, RECURRENCE_LABELS, onlyNewestWeekday, ordinal } from './RecurrencePicker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenFull: (draft: TaskDraft) => void;
  /** Which list this was opened from — determines the default due date. Defaults to 'today'. */
  context?: 'today' | 'later' | 'inbox' | 'unscheduled';
  /**
   * Called right after a new task is created (not on the "resume archived"
   * path). `placed` is false when there was no seed, or when the chip shook it
   * off — a caller that also wanted to position the row shouldn't.
   */
  onCreated?: (task: Task, placed: boolean) => void;
  /** Called instead of onCreated when the user resumes an archived task rather than creating one. */
  onResumed?: (task: Task) => void;
  /**
   * Placement handed in by a drag of the add button onto the list. `category`
   * seeds the form's own category field (so it shows, and can be changed like
   * any other); `groupId` and `pinned` ride along to addTask untouched.
   */
  seed?: { category?: string | null; groupId?: string; pinned?: boolean };
  /** Names the seed on a removable chip, e.g. "Errands". No chip without one. */
  seedLabel?: string | null;
  /** Which task type the sheet opens in — the add menu's Chain entry lands here. */
  initialType?: QuickAddType;
}

type ActivePanel = 'priority' | 'effort' | 'tags' | 'category' | 'repeat' | 'segment' | 'link' | 'phone' | null;

/** The type row's labels and icons. Order is fixed: plain first, then the modes. */
const TYPE_META: { key: QuickAddType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'task', label: 'Task', icon: 'checkbox-outline' },
  { key: 'timed', label: 'Timed', icon: 'timer-outline' },
  { key: 'target', label: 'Target', icon: 'speedometer-outline' },
  { key: 'chain', label: 'Chain', icon: 'git-commit-outline' },
];

/** Known app name for a link scheme, else the raw URL. */
function linkLabel(url: string): string {
  return KNOWN_LINK_APPS.find(app => app.scheme === url)?.name ?? url;
}

const SEGMENTS: { key: TimeOfDay; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'morning', label: 'Morning', icon: 'sunny-outline' },
  { key: 'afternoon', label: 'Afternoon', icon: 'partly-sunny-outline' },
  { key: 'evening', label: 'Evening', icon: 'moon-outline' },
  { key: 'night', label: 'Night', icon: 'moon' },
];

// Singular/plural units for the interval stepper ("Every 2 weeks").
const RECURRENCE_UNITS: Record<Exclude<RecurrenceType, 'none'>, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};


export function QuickAddModal({
  visible, onClose, onOpenFull, context = 'today', onCreated, onResumed, seed, seedLabel,
  initialType = 'task',
}: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const addCategory = useTaskStore(s => s.addCategory);
  const unarchiveTask = useTaskStore(s => s.unarchiveTask);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const tasks = useTaskStore(s => s.tasks);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);
  const tagInputRef = useRef<TextInput>(null);
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const translateYAnim = useRef(new Animated.Value(16)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // Independent of the keyboard's own slide-up motion — rather than tracking
  // it 1:1 (which reads as the sheet getting shoved), the sheet glides to its
  // new centered resting spot on its own spring once the keyboard height is
  // known, landing shortly after the keyboard settles.
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      Animated.spring(keyboardOffsetAnim, {
        toValue: -height / 2,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardOffsetAnim, {
        toValue: 0,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => { scaleAnim.setValue(0.95); sheetOpacity.setValue(0); onClose(); });
  };

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [customEffortText, setCustomEffortText] = useState('');
  const [effortNote, setEffortNote] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [type, setType] = useState<QuickAddType>('task');
  const [timedMinutes, setTimedMinutes] = useState<number | null>(null);
  const [customTimedText, setCustomTimedText] = useState('');
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [targetUnit, setTargetUnit] = useState('');
  const [chainItems, setChainItems] = useState<ChainItem[]>([]);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [customLinkText, setCustomLinkText] = useState('');
  const [phoneText, setPhoneText] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number | null>(null);
  const [recurrenceWeekOrdinal, setRecurrenceWeekOrdinal] = useState<number | null>(null);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
  const [recurrenceCount, setRecurrenceCount] = useState<number | null>(null);
  const [recurrenceFromCompletion, setRecurrenceFromCompletion] = useState(false);
  // Natural-language suggestion measurements: mirror-text widths locate the
  // highlighted phrase so the tooltip can point at it.
  const [inputW, setInputW] = useState(0);
  const [prefixW, setPrefixW] = useState<number | null>(null);
  const [matchW, setMatchW] = useState<number | null>(null);
  const [tooltipRowW, setTooltipRowW] = useState(0);
  const [bubbleW, setBubbleW] = useState(0);
  const tooltipAnim = useRef(new Animated.Value(0)).current;
  const hadParse = useRef(false);
  const [whenPickerVisible, setWhenPickerVisible] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  // Whether the drop's placement still applies — the chip can shake it off.
  const [seedActive, setSeedActive] = useState(false);
  // Read only when the sheet opens: a seed that changes identity mid-edit must
  // not re-run the reset below and wipe what's already been typed.
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (visible) {
      setTitle('');
      setPriority(0);
      setEffort(0);
      setEstimatedMinutes(null);
      setCustomEffortText('');
      setEffortNote(null);
      setDueDate(
        context === 'later' ? getLogicalTomorrow(dayResetTime)
        : context === 'inbox' || context === 'unscheduled' ? null
        : getLogicalToday(dayResetTime)
      );
      setTimeSegments([]);
      setTags([]);
      // Applied after the reset rather than folded into it, so a drop's
      // category overrides the default instead of racing it.
      setCategory(seedRef.current?.category ?? null);
      setSeedActive(!!seedRef.current);
      setLinkUrl(null);
      setPhoneNumber(null);
      setType(initialType);
      setTimedMinutes(initialType === 'timed' ? DEFAULT_TIMED_MINUTES : null);
      setCustomTimedText('');
      setTargetCount(initialType === 'target' ? DEFAULT_TARGET_COUNT : null);
      setChainItems([]);
      setNewStepTitle('');
      setCustomLinkText('');
      setPhoneText('');
      setTagInput('');
      setActivePanel(null);
      // A quota resets by spawning its next occurrence, so opening straight
      // into Target has to arrive with the repeat already on.
      setRecurrenceType(initialType === 'target' ? 'daily' : 'none');
      setRecurrenceInterval(1);
      setRecurrenceDays([]);
      setRecurrenceMonthDay(null);
      setRecurrenceWeekOrdinal(null);
      setRecurrenceEndDate(null);
      setRecurrenceCount(null);
      setRecurrenceFromCompletion(false);
      setPrefixW(null);
      setMatchW(null);
      tooltipAnim.setValue(0);
      hadParse.current = false;
      setWhenPickerVisible(false);
      setAiLoading(false);
      setPendingCategory(null);
      scaleAnim.setValue(0.95);
      translateYAnim.setValue(16);
      sheetOpacity.setValue(0);
      backdropOpacity.setValue(0);
      keyboardOffsetAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(sheetOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start(() => {
        // Focus (and the keyboard's own slide-up) is deferred until the sheet
        // has settled, so the two motions don't overlap and fight each other.
        inputRef.current?.focus();
      });
    }
  }, [visible, context, initialType]);

  // Natural-language scheduling: detect a trailing date/recurrence phrase in
  // the title ("go for a run on tuesday", "water plants every 3 days"). The
  // phrase is highlighted in the input and described in a tooltip; nothing is
  // applied until the user taps the tooltip.
  const parsed = useMemo(
    () => (title.trim() ? parseTaskInput(title, getLogicalNow(dayResetTime)) : null),
    [title, dayResetTime]
  );
  // Pasted URL/app-link detection — same tooltip mechanism as the schedule
  // parse above, just not suffix-anchored. Only checked when no schedule
  // phrase matched, so the two tooltips never compete for the same slot.
  const linkParsed = useMemo(
    () => (!parsed && title.trim() ? parseLinkInput(title) : null),
    [title, parsed]
  );
  // "call the doctor 555-123-4567" — the same mechanism again, for the number
  // rather than the URL. Checked after the link so a tel: URL someone pasted
  // still reads as a link, and deliberately stricter about what counts (see
  // looksLikePhoneNumber): this one is reading prose full of digits, so a
  // year or a price must not light it up.
  const phoneParsed = useMemo(
    () => (!parsed && !linkParsed && title.trim() ? parsePhoneInput(title) : null),
    [title, parsed, linkParsed]
  );
  // "play violin for 15 minutes" — a duration, not a schedule. Same single
  // tooltip slot, checked last, so a schedule or link phrase always wins.
  //
  // Only offered from the plain type, because accepting it switches the sheet
  // into Timed: it's how someone who has never picked a type discovers there
  // is one. Someone already part-way through a Chain or a Target has said what
  // they're making, and a tooltip shouldn't overrule it.
  const durationParsed = useMemo(
    () => (!parsed && !linkParsed && !phoneParsed && type === 'task' && title.trim() ? parseDurationInput(title) : null),
    [title, parsed, linkParsed, phoneParsed, type]
  );
  const activeMatch = parsed
    ? { matchStart: parsed.matchStart, matchedText: parsed.matchedText }
    : linkParsed
      ? { matchStart: linkParsed.matchStart, matchedText: linkParsed.url }
      : phoneParsed
        ? { matchStart: phoneParsed.matchStart, matchedText: phoneParsed.number }
        : durationParsed
          ? {
              matchStart: durationParsed.matchStart,
              matchedText: title.slice(durationParsed.matchStart, durationParsed.matchEnd),
            }
          : null;
  const matchEnd = activeMatch ? activeMatch.matchStart + activeMatch.matchedText.length : 0;

  // Suggest previously-used titles that match what's being typed. Suppressed
  // while a schedule/link phrase is detected so the list doesn't fight the
  // tooltip that renders just below the input row.
  const suggestions = useMemo(
    () => (activeMatch ? [] : suggestTitles(tasks, title)),
    [tasks, title, activeMatch]
  );

  const applySuggestion = (suggestion: string) => {
    haptics.tap();
    setTitle(suggestion);
    inputRef.current?.focus();
  };

  // Pop the tooltip in when a phrase is first detected (not on every keystroke
  // that merely extends it).
  useEffect(() => {
    if (activeMatch && !hadParse.current) {
      tooltipAnim.setValue(0);
      Animated.spring(tooltipAnim, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
    }
    hadParse.current = activeMatch != null;
  }, [activeMatch]);

  // Tooltip geometry: center the bubble under the highlighted phrase and aim
  // the caret at it, clamped to the row. Mirror-text widths land a frame after
  // the parse appears; until then the tooltip is still fading in from 0.
  const CARET_W = 12;
  let bubbleLeft = 0;
  let caretLeft = 14;
  if (activeMatch && prefixW != null && matchW != null) {
    const center = Math.min((prefixW + matchW) / 2, Math.max(inputW - 8, 0));
    bubbleLeft = Math.min(Math.max(center - bubbleW / 2, 0), Math.max(tooltipRowW - bubbleW, 0));
    caretLeft = Math.min(
      Math.max(center - bubbleLeft - CARET_W / 2, 10),
      Math.max(bubbleW - CARET_W - 10, 10),
    );
  }

  // Apply the suggested schedule and strip the phrase from the title.
  const applyParse = () => {
    if (!parsed) return;
    haptics.success();
    animateLayout();
    setTitle(parsed.cleanTitle);
    setDueDate(parsed.schedule.dueDate);
    setTimeSegments(parsed.schedule.timeSegments);
    setRecurrenceType(parsed.schedule.recurrenceType);
    setRecurrenceInterval(parsed.schedule.recurrenceInterval);
    setRecurrenceDays(parsed.schedule.recurrenceDays);
    setRecurrenceMonthDay(parsed.schedule.recurrenceMonthDay ?? null);
    setRecurrenceWeekOrdinal(parsed.schedule.recurrenceWeekOrdinal ?? null);
    setRecurrenceEndDate(parsed.schedule.recurrenceEndDate ?? null);
    setRecurrenceCount(parsed.schedule.recurrenceCount ?? null);
    setRecurrenceFromCompletion(parsed.schedule.recurrenceFromCompletion ?? false);
  };

  // Apply the detected link and strip it from the title.
  const applyLink = () => {
    if (!linkParsed) return;
    haptics.success();
    animateLayout();
    setTitle(linkParsed.cleanTitle);
    setLinkUrl(linkParsed.url);
  };

  // Apply the detected number and strip it from the title.
  const applyPhone = () => {
    if (!phoneParsed) return;
    haptics.success();
    animateLayout();
    setTitle(phoneParsed.cleanTitle);
    setPhoneNumber(phoneParsed.number);
  };

  // Apply the detected duration and strip the phrase from the title. Typing
  // "for 15 minutes" is someone describing a timed task in their own words, so
  // accepting it switches the sheet into that mode rather than quietly setting
  // a field they'd have no way to see.
  const applyDuration = () => {
    if (!durationParsed) return;
    haptics.success();
    animateLayout();
    setTitle(durationParsed.cleanTitle);
    setType('timed');
    setTimedMinutes(durationParsed.minutes);
    setCustomTimedText('');
  };

  const addStep = (stepTitle: string) => {
    const t = stepTitle.trim();
    if (!t) return;
    haptics.tap();
    animateLayout();
    setChainItems(prev => [...prev, { id: generateId(), title: t, estimatedMinutes: null }]);
    setNewStepTitle('');
  };

  const removeStep = (id: string) => {
    haptics.tap();
    animateLayout();
    setChainItems(prev => prev.filter(s => s.id !== id));
  };

  // A step typed but not yet submitted still counts — the main add button is
  // right there, and losing the last step to an un-hit return key is the
  // failure this mode would be judged on.
  const pendingStep = newStepTitle.trim();
  const resolvedChainItems = useMemo(
    // The id is regenerated on each keystroke and only ever committed by
    // createTask, so churn here costs nothing.
    () => (pendingStep ? [...chainItems, { id: generateId(), title: pendingStep, estimatedMinutes: null }] : chainItems),
    [chainItems, pendingStep],
  );

  const typeValues: TypeValues = {
    timedMinutes,
    targetCount,
    targetUnit,
    chainItems: resolvedChainItems,
    recurrenceType,
    effort,
    estimatedMinutes,
  };
  const summary = typeSummary(type, typeValues);
  const blocked = blockedReason(type, typeValues);

  /**
   * Switching type seeds the new mode's defining value and drops the previous
   * one's — a duration left over from Timed must not ride along invisibly into
   * a plain task (bakedFields enforces the same rule at save time).
   */
  const selectType = (next: QuickAddType) => {
    if (next === type) return;
    haptics.tap();
    animateLayout();
    setType(next);
    setActivePanel(null);
    setTimedMinutes(next === 'timed' ? (timedMinutes ?? DEFAULT_TIMED_MINUTES) : null);
    if (next !== 'timed') setCustomTimedText('');
    setTargetCount(next === 'target' ? (targetCount ?? DEFAULT_TARGET_COUNT) : null);
    if (next !== 'target') setTargetUnit('');
    if (next !== 'chain') {
      setChainItems([]);
      setNewStepTitle('');
    }
    // Target's repeat is baked in; leaving Target takes back only the repeat
    // it set for you, never one that was already there.
    if (next === 'target' && recurrenceType === 'none') setRecurrenceType('daily');
    if (type === 'target' && next !== 'target' && recurrenceType === 'daily' && recurrenceInterval === 1) {
      setRecurrenceType('none');
    }
  };

  const applyCustomTimed = (text: string) => {
    setCustomTimedText(text);
    const n = parseInt(text, 10);
    setTimedMinutes(Number.isFinite(n) && n > 0 ? n : null);
  };

  const commitCustomLink = () => {
    const t = customLinkText.trim();
    setLinkUrl(t || null);
    setActivePanel(null);
  };

  const commitPhone = () => {
    const t = phoneText.trim();
    setPhoneNumber(t || null);
    setActivePanel(null);
  };

  const createTask = (finalTitle: string) => {
    haptics.success();
    animateLayout();
    const baked = bakedFields(type, typeValues);
    const task = addTask({
      title: finalTitle,
      priority,
      ...baked,
      dueDate: dueDate?.toISOString() ?? null,
      timeSegments,
      tags,
      category,
      linkUrl,
      phoneNumber,
      // recurrenceType deliberately absent — it comes from `baked` above,
      // which is what turns a Target into a daily task.
      recurrenceInterval,
      recurrenceDays,
      recurrenceMonthDay,
      recurrenceWeekOrdinal,
      recurrenceEndDate,
      recurrenceCount,
      recurrenceFromCompletion,
      // addTask takes both, and ignores sortOrder — a drop that also wants a
      // position splices it in afterwards, from onCreated.
      ...(seedActive && seed?.groupId ? { groupId: seed.groupId } : {}),
      ...(seedActive && seed?.pinned ? { pinned: true } : {}),
    });
    onCreated?.(task, seedActive);
    dismiss();
  };

  const handleAdd = () => {
    const finalTitle = title.trim();
    if (!finalTitle || !canSaveType(type, typeValues)) return;

    const archivedMatch = findArchivedMatch(useTaskStore.getState().archivedTasks(), finalTitle);
    if (archivedMatch) {
      Alert.alert(
        'Resume archived task?',
        `You archived "${archivedMatch.title}" a while back. Resume it instead of creating a new one? History and stats carry over, but the streak restarts.`,
        [
          { text: 'Create New', onPress: () => createTask(finalTitle) },
          {
            text: 'Resume',
            style: 'default',
            onPress: () => {
              haptics.success();
              unarchiveTask(archivedMatch.id);
              onResumed?.(archivedMatch);
              dismiss();
            },
          },
        ],
      );
      return;
    }

    createTask(finalTitle);
  };

  const handleOpenFull = () => {
    const baked = bakedFields(type, typeValues);
    onOpenFull({
      title: title.trim(),
      priority,
      ...baked,
      dueDate,
      timeSegments,
      tags,
      category,
      linkUrl,
      phoneNumber,
      recurrenceInterval,
      recurrenceDays,
      recurrenceMonthDay,
      recurrenceWeekOrdinal,
      recurrenceFromCompletion,
      recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null,
      recurrenceCount,
    });
  };

  const togglePanel = (panel: ActivePanel) => {
    haptics.tap();
    setActivePanel(prev => prev === panel ? null : panel);
    if (panel === 'tags') {
      setTimeout(() => tagInputRef.current?.focus(), 100);
    }
    if (panel === 'link' && linkUrl && !KNOWN_LINK_APPS.some(app => app.scheme === linkUrl)) {
      setCustomLinkText(linkUrl);
    }
    if (panel === 'phone') {
      setPhoneText(phoneNumber ?? '');
    }
  };

  const toggleSegment = (seg: TimeOfDay) => {
    haptics.tap();
    setTimeSegments(prev => (prev.includes(seg) ? [] : [seg]));
  };

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      haptics.tap();
      setTags(prev => [...prev, t]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    haptics.tap();
    setTags(prev => prev.filter(t => t !== tag));
  };

  const toggleExistingTag = (tag: string) => {
    haptics.tap();
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleSuggest = async () => {
    if (!title.trim()) return;
    setAiLoading(true);
    try {
      const result = await suggestTaskAttributes(title.trim(), '', allTags, allCategories);
      if (result.effort > 0) {
        setEffort(prev => {
          if (prev !== 0) return prev;
          setEstimatedMinutes(EFFORT_MINUTES[result.effort]);
          return result.effort;
        });
      }
      if (result.tags.length > 0) setTags(prev => [...new Set([...prev, ...result.tags])]);
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

  const customEffortActive = estimatedMinutes != null && estimatedMinutes !== effortToMinutes(effort);

  const applyEffortPreset = (e: Effort) => {
    haptics.tap();
    setEffortNote(null);
    setCustomEffortText('');
    // Tapping the active preset clears the estimate.
    if (!customEffortActive && effort === e) {
      setEffort(0);
      setEstimatedMinutes(null);
    } else {
      setEffort(e);
      setEstimatedMinutes(EFFORT_MINUTES[e]);
    }
  };

  const applyCustomEffort = (text: string) => {
    setCustomEffortText(text);
    setEffortNote(null);
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setEstimatedMinutes(null);
      setEffort(0);
      return;
    }
    setEstimatedMinutes(n);
    setEffort(minutesToEffort(n));
  };

  const handleEstimateEffort = () => {
    if (!title.trim()) return;
    const result = estimateEffort(title.trim(), { category, tags }, useTaskStore.getState().tasks);
    if (result.minutes != null) {
      setEstimatedMinutes(result.minutes);
      setEffort(minutesToEffort(result.minutes));
      setCustomEffortText('');
    }
    setEffortNote(result.reason);
  };

  const PRIORITY_LABELS_SHORT = ['None', 'Low', 'Med', 'High', 'Urgent'] as const;

  const formatDate = (d: Date) => {
    const today = getLogicalToday(dayResetTime);
    const tomorrow = getLogicalTomorrow(dayResetTime);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return format(d, 'MMM d');
  };

  const suggestedTags = allTags.filter(t => !tags.includes(t)).slice(0, 8);

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView
          intensity={isDark ? 20 : 15}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, shadows.sheet, { opacity: sheetOpacity, transform: [{ scale: scaleAnim }, { translateY: Animated.add(translateYAnim, keyboardOffsetAnim) }] }]}>
          {/* Where the button was dropped. Removable: the drop chose a place,
              it didn't commit you to one. */}
          {seedActive && seedLabel ? (
            <View style={styles.seedRow}>
              <View style={styles.seedChip}>
                <Ionicons name="return-down-forward" size={13} color={colors.accent} />
                <Text style={styles.seedChipText} numberOfLines={1}>{seedLabel}</Text>
                <TouchableOpacity
                  onPress={() => {
                    haptics.tap();
                    if (seed?.category && category === seed.category) setCategory(null);
                    setSeedActive(false);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove placement ${seedLabel}`}
                >
                  <Ionicons name="close" size={13} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Task type. Sits above the field rather than behind a chip
              because these modes were the app's least-discovered feature —
              you can't choose a shape you've never been shown. Picking one
              bakes its defining fields in and drops the chips it just
              answered (see utils/quickAddTypes). */}
          <View style={styles.typeRow}>
            {TYPE_META.map(t => {
              const active = type === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                  onPress={() => selectType(t.key)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${t.label} task`}
                >
                  <Ionicons
                    name={t.icon}
                    size={13}
                    color={active ? colors.accent : colors.textTertiary}
                  />
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Title input row */}
          <View style={styles.row}>
            <View style={styles.inputWrap}>
              {activeMatch && (
                <Text style={[styles.input, styles.inputOverlay]} pointerEvents="none">
                  {title.slice(0, activeMatch.matchStart)}
                  <Text style={styles.inputHighlight}>{title.slice(activeMatch.matchStart, matchEnd)}</Text>
                  {title.slice(matchEnd)}
                </Text>
              )}
              <TextInput
                ref={inputRef}
                style={[styles.input, activeMatch && styles.inputHidden]}
                placeholder="New task…"
                placeholderTextColor={colors.textTertiary}
                value={title}
                onChangeText={setTitle}
                onSubmitEditing={handleAdd}
                returnKeyType="done"
                maxLength={TITLE_MAX_LENGTH}
                // iOS's own inline predictive-text completion draws its candidate
                // directly into the field, on top of (and misaligned with) the
                // schedule-phrase overlay above — it reads as our highlight
                // glitching. Autocorrect off suppresses that native suggestion.
                autoCorrect={false}
                blurOnSubmit={false}
                onLayout={e => setInputW(e.nativeEvent.layout.width)}
              />
              {/* Invisible mirrors of the input text — their widths locate the
                  highlighted phrase so the tooltip can point at it. */}
              {activeMatch && (
                <View style={styles.measureWrap} pointerEvents="none">
                  <Text style={styles.measureText} onLayout={e => setPrefixW(e.nativeEvent.layout.width)}>
                    {title.slice(0, activeMatch.matchStart)}
                  </Text>
                  <Text style={styles.measureText} onLayout={e => setMatchW(e.nativeEvent.layout.width)}>
                    {title.slice(0, activeMatch.matchStart)}
                    <Text style={styles.inputHighlight}>{title.slice(activeMatch.matchStart, matchEnd)}</Text>
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[styles.addBtn, (!title.trim() || blocked !== null) && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!title.trim() || blocked !== null}
              accessibilityRole="button"
              accessibilityLabel="Add task"
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>

          {/* Autosuggest — previously-used titles matching the current input */}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsBox}>
              {suggestions.map((s, i) => (
                <TouchableOpacity
                  key={s.title}
                  style={[styles.suggestionItem, i > 0 && styles.suggestionItemDivider]}
                  onPress={() => applySuggestion(s.title)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Use previous task: ${s.title}`}
                >
                  <Ionicons name="time-outline" size={15} color={colors.textTertiary} />
                  <HighlightedText
                    text={s.title}
                    ranges={s.ranges}
                    style={styles.suggestionTitle}
                    highlightStyle={styles.suggestionTitleHighlight}
                    numberOfLines={1}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Schedule/link tooltip — points at the highlighted phrase; tap to apply */}
          {activeMatch && (
            <Animated.View
              style={[styles.tooltipRow, {
                opacity: tooltipAnim,
                transform: [
                  { translateY: tooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
                  { scale: tooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
                ],
              }]}
              onLayout={e => setTooltipRowW(e.nativeEvent.layout.width)}
            >
              <View style={[styles.tooltipAnchor, { marginLeft: bubbleLeft }]}>
                <View style={[styles.tooltipCaret, { marginLeft: caretLeft }]} />
                <PressableScale
                  style={styles.tooltipBubble}
                  onPress={parsed ? applyParse : linkParsed ? applyLink : phoneParsed ? applyPhone : applyDuration}
                  onLayout={e => setBubbleW(e.nativeEvent.layout.width)}
                >
                  <Ionicons
                    name={
                      parsed
                        ? (parsed.schedule.recurrenceType !== 'none' ? 'repeat' : 'calendar-outline')
                        : linkParsed
                          ? 'link-outline'
                          : phoneParsed
                            ? 'call-outline'
                            : 'timer-outline'
                    }
                    size={14}
                    color={colors.onAccent}
                  />
                  <Text style={styles.tooltipText}>
                    {parsed
                      ? describeSchedule(parsed.schedule, getLogicalNow(dayResetTime))
                      : linkParsed
                        ? linkLabel(linkParsed.url)
                        : phoneParsed
                          ? `Call ${phoneParsed.number}`
                          : `Timer · ${formatDuration(durationParsed!.minutes)}`}
                  </Text>
                  <View style={styles.tooltipDot} />
                  <Text style={styles.tooltipHint}>Tap to set</Text>
                </PressableScale>
              </View>
            </Animated.View>
          )}

          {/* What the chosen type decides for you, in one line. These modes
              have no other explanation anywhere in the app. */}
          {summary && (
            <View style={styles.typeSummaryRow}>
              <Text style={styles.typeSummary}>{summary}</Text>
            </View>
          )}

          {/* The type's defining control — inline rather than behind a chip,
              since it's the whole reason the mode was picked. */}
          {type === 'timed' && (
            <View style={styles.typeControl}>
              <View style={styles.presetRow}>
                {TIMED_MINUTE_OPTIONS.map(m => {
                  const active = timedMinutes === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.presetChip, active && styles.presetChipActive]}
                      onPress={() => {
                        haptics.tap();
                        setTimedMinutes(m);
                        setCustomTimedText('');
                      }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${m} minutes`}
                    >
                      <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                        {formatDuration(m)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TextInput
                  style={styles.inlineCustomInput}
                  value={customTimedText}
                  onChangeText={applyCustomTimed}
                  keyboardType="number-pad"
                  placeholder="custom"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Custom duration in minutes"
                />
              </View>
            </View>
          )}

          {type === 'target' && (
            <View style={styles.typeControl}>
              <View style={styles.targetStepperRow}>
                <CountStepper
                  value={targetCount}
                  onChange={setTargetCount}
                  min={MIN_TARGET_COUNT}
                  max={MAX_TARGET_COUNT}
                  // No clearing here: in this mode the target is the task.
                  format={n => `${n}×`}
                  label="Daily target"
                  describeValue={n => `${n} ${targetUnit.trim() || 'times'} a day`}
                />
                {/* Optional: what the count counts, so "5/12 8oz glasses" can
                    be read off the row without the title spelling it out. */}
                <TextInput
                  style={styles.targetUnitInput}
                  value={targetUnit}
                  onChangeText={setTargetUnit}
                  placeholder="units"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={MAX_TARGET_UNIT_LENGTH}
                  autoCapitalize="none"
                  accessibilityLabel="Unit for the daily target, optional"
                />
                <Text style={styles.targetStepperCaption}>a day</Text>
              </View>
            </View>
          )}

          {type === 'chain' && (
            <View style={styles.typeControl}>
              {chainItems.length > 0 && (
                <ScrollView style={styles.stepList} keyboardShouldPersistTaps="handled">
                  {chainItems.map((item, i) => (
                    <View key={item.id} style={styles.stepRow}>
                      <View style={styles.stepDot}>
                        <Text style={styles.stepDotText}>{i + 1}</Text>
                      </View>
                      <Text style={styles.stepTitle} numberOfLines={1}>{item.title}</Text>
                      <TouchableOpacity
                        onPress={() => removeStep(item.id)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove step ${item.title}`}
                      >
                        <Ionicons name="close" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
              <View style={styles.stepInputRow}>
                <View style={styles.stepDot}>
                  <Text style={styles.stepDotText}>{chainItems.length + 1}</Text>
                </View>
                <TextInput
                  style={styles.stepInput}
                  value={newStepTitle}
                  onChangeText={setNewStepTitle}
                  onSubmitEditing={() => addStep(newStepTitle)}
                  placeholder={chainItems.length === 0 ? 'First step…' : 'Next step…'}
                  placeholderTextColor={colors.textTertiary}
                  maxLength={TITLE_MAX_LENGTH}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  autoCorrect={false}
                />
                {pendingStep.length > 0 && (
                  <TouchableOpacity
                    onPress={() => addStep(newStepTitle)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Add step ${pendingStep}`}
                  >
                    <Ionicons name="add-circle" size={20} color={colors.accent} />
                  </TouchableOpacity>
                )}
              </View>
              {blocked && <Text style={styles.typeBlocked}>{blocked}</Text>}
            </View>
          )}

          {/* Attribute toolbar. Every chip is gated on isChipVisible, so the
              table in utils/quickAddTypes is the only place that decides what
              a type takes off the toolbar — a chip left ungated here would
              silently ignore being listed there. */}
          <View style={styles.toolbar}>
            {/* Due date chip */}
            {isChipVisible(type, 'date') && (
              <TouchableOpacity
                style={[styles.toolChip, dueDate != null && styles.toolChipSet]}
                onPress={() => setWhenPickerVisible(true)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={dueDate ? `Date: ${formatDate(dueDate)}` : 'Set date'}
              >
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={dueDate ? colors.accent : colors.textTertiary}
                />
                {dueDate != null && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                    {formatDate(dueDate)}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Repeat chip */}
            {isChipVisible(type, 'repeat') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'repeat' && styles.toolChipActive, recurrenceType !== 'none' && styles.toolChipSet]}
                onPress={() => togglePanel('repeat')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={recurrenceType !== 'none' ? `Repeat: ${RECURRENCE_LABELS[recurrenceType]}` : 'Set repeat'}
              >
                <Ionicons
                  name="repeat"
                  size={13}
                  color={recurrenceType !== 'none' ? colors.accent : colors.textTertiary}
                />
                {recurrenceType !== 'none' && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                    {RECURRENCE_LABELS[recurrenceType]}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Segment chip */}
            {isChipVisible(type, 'segment') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'segment' && styles.toolChipActive, timeSegments.length > 0 && styles.toolChipSet]}
                onPress={() => togglePanel('segment')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={timeSegments.length > 0 ? `Segment: ${SEGMENTS.find(s => s.key === timeSegments[0])!.label}` : 'Set time segment'}
              >
                <Ionicons
                  name={timeSegments.length > 0 ? SEGMENTS.find(s => s.key === timeSegments[0])!.icon : 'partly-sunny-outline'}
                  size={13}
                  color={timeSegments.length > 0 ? {
                    morning: colors.timeMorning,
                    afternoon: colors.timeAfternoon,
                    evening: colors.timeEvening,
                    night: colors.timeNight,
                  }[timeSegments[0]] : colors.textTertiary}
                />
                {timeSegments.length > 0 && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                    {SEGMENTS.find(s => s.key === timeSegments[0])!.label}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Priority chip */}
            {isChipVisible(type, 'priority') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'priority' && styles.toolChipActive, priority > 0 && styles.toolChipSet]}
                onPress={() => togglePanel('priority')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={priority > 0 ? `Priority: ${PRIORITY_LABELS_SHORT[priority]}` : 'Set priority'}
              >
                <View style={[styles.priorityDot, { backgroundColor: priority > 0 ? PRIORITY_COLORS[priority] : colors.textTertiary }]} />
                {priority > 0 && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                    {PRIORITY_LABELS_SHORT[priority]}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Effort chip */}
            {isChipVisible(type, 'effort') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'effort' && styles.toolChipActive, effort > 0 && styles.toolChipSet]}
                onPress={() => togglePanel('effort')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={effort > 0 ? `Effort: ${estimatedMinutes != null ? formatDuration(estimatedMinutes) : EFFORT_LABELS[effort]}` : 'Set effort'}
              >
                <Ionicons
                  name="barbell"
                  size={13}
                  color={effort > 0 ? colors.accent : colors.textTertiary}
                />
                {effort > 0 && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                    {estimatedMinutes != null ? formatDuration(estimatedMinutes) : EFFORT_LABELS[effort]}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Tags chip */}
            {isChipVisible(type, 'tags') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'tags' && styles.toolChipActive, tags.length > 0 && styles.toolChipSet]}
                onPress={() => togglePanel('tags')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={tags.length > 0 ? `Tags: ${tags.join(', ')}` : 'Set tags'}
              >
                <Ionicons
                  name="pricetag-outline"
                  size={13}
                  color={tags.length > 0 ? colors.accent : colors.textTertiary}
                />
                {tags.length > 0 && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                    {tags.slice(0, 2).join(', ')}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Category chip */}
            {isChipVisible(type, 'category') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'category' && styles.toolChipActive, category !== null && styles.toolChipSet]}
                onPress={() => togglePanel('category')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={category !== null ? `Category: ${categoryLabel(category, categories)}` : 'Set category'}
              >
                <Ionicons
                  name="folder-outline"
                  size={13}
                  color={category ? colors.accent : colors.textTertiary}
                />
                {category !== null && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet]}>
                    {categoryLabel(category, categories)}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Link chip */}
            {isChipVisible(type, 'link') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'link' && styles.toolChipActive, linkUrl !== null && styles.toolChipSet]}
                onPress={() => togglePanel('link')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={linkUrl !== null ? `Link: ${linkLabel(linkUrl)}` : 'Set link'}
              >
                <Ionicons
                  name="link-outline"
                  size={13}
                  color={linkUrl ? colors.accent : colors.textTertiary}
                />
                {linkUrl !== null && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet, styles.toolChipTextTruncate]} numberOfLines={1}>
                    {linkLabel(linkUrl)}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Phone chip */}
            {isChipVisible(type, 'phone') && (
              <TouchableOpacity
                style={[styles.toolChip, activePanel === 'phone' && styles.toolChipActive, phoneNumber !== null && styles.toolChipSet]}
                onPress={() => togglePanel('phone')}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={phoneNumber !== null ? `Phone: ${phoneNumber}` : 'Set phone number'}
              >
                <Ionicons
                  name="call-outline"
                  size={13}
                  color={phoneNumber ? colors.accent : colors.textTertiary}
                />
                {phoneNumber !== null && (
                  <Text style={[styles.toolChipText, styles.toolChipTextSet, styles.toolChipTextTruncate]} numberOfLines={1}>
                    {phoneNumber}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* AI Suggest chip */}
            {!!anthropicApiKey && !!title.trim() && (
              <TouchableOpacity
                style={[styles.toolChip, styles.aiChip]}
                onPress={handleSuggest}
                disabled={aiLoading}
                activeOpacity={interaction.activeOpacity}
              >
                {aiLoading
                  ? <ActivityIndicator size="small" color={colors.purple} />
                  : <Ionicons name="sparkles-outline" size={13} color={colors.purple} />
                }
                {!aiLoading && <Text style={[styles.toolChipText, styles.aiChipText]}>Suggest</Text>}
              </TouchableOpacity>
            )}
          </View>

          {/* Inline panels */}
          {activePanel === 'segment' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {SEGMENTS.map(seg => {
                  const active = timeSegments.includes(seg.key);
                  const segColor = {
                    morning: colors.timeMorning,
                    afternoon: colors.timeAfternoon,
                    evening: colors.timeEvening,
                    night: colors.timeNight,
                  }[seg.key];
                  return (
                    <TouchableOpacity
                      key={seg.key}
                      style={[
                        styles.priorityChip,
                        active && styles.priorityChipActive,
                        active && { borderColor: segColor, backgroundColor: segColor + '22' },
                      ]}
                      onPress={() => toggleSegment(seg.key)}
                      activeOpacity={interaction.activeOpacity}
                    >
                      <Ionicons name={seg.icon} size={13} color={active ? segColor : colors.textTertiary} />
                      <Text style={[
                        styles.presetChipText,
                        active && styles.presetChipTextActive,
                        active && { color: segColor },
                      ]}>
                        {seg.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {activePanel === 'priority' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {([0, 1, 2, 3, 4] as Priority[]).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityChip,
                      priority === p && styles.priorityChipActive,
                      priority === p && p > 0 && { borderColor: PRIORITY_COLORS[p], backgroundColor: PRIORITY_COLORS[p] + '22' },
                    ]}
                    onPress={() => {
                      haptics.tap();
                      setPriority(p);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    {p > 0 && <View style={[styles.priorityChipDot, { backgroundColor: PRIORITY_COLORS[p] }]} />}
                    <Text style={[
                      styles.presetChipText,
                      priority === p && styles.presetChipTextActive,
                      priority === p && p > 0 && { color: PRIORITY_COLORS[p] },
                    ]}>
                      {PRIORITY_LABELS_SHORT[p]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {activePanel === 'repeat' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[]).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.presetChip, recurrenceType === t && styles.presetChipActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceType(t);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.presetChipText, recurrenceType === t && styles.presetChipTextActive]}>
                      {RECURRENCE_LABELS[t]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {recurrenceType !== 'none' && (
                <View style={styles.intervalRow}>
                  <Text style={styles.intervalLabel}>Every</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceInterval(Math.max(1, recurrenceInterval - 1));
                    }}
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalValue}>{recurrenceInterval}</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceInterval(recurrenceInterval + 1);
                    }}
                  >
                    <Ionicons name="add" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalLabel}>
                    {RECURRENCE_UNITS[recurrenceType][recurrenceInterval === 1 ? 0 : 1]}
                  </Text>
                </View>
              )}
              {recurrenceType === 'weekly' && (
                <View style={styles.weekdayRow}>
                  <WeekdaySelector
                    value={recurrenceDays}
                    onChange={setRecurrenceDays}
                  />
                </View>
              )}
              {recurrenceType === 'monthly' && (
                <View style={styles.scheduleRow}>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceMonthDay === null && recurrenceWeekOrdinal === null && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceMonthDay(null);
                      setRecurrenceWeekOrdinal(null);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.schedulePillText, recurrenceMonthDay === null && recurrenceWeekOrdinal === null && styles.schedulePillTextActive]}>
                      Same day as due date
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceMonthDay !== null && recurrenceMonthDay > 0 && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceWeekOrdinal(null);
                      setRecurrenceMonthDay(recurrenceMonthDay && recurrenceMonthDay > 0 ? recurrenceMonthDay : (dueDate ?? new Date()).getDate());
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.schedulePillText, recurrenceMonthDay !== null && recurrenceMonthDay > 0 && styles.schedulePillTextActive]}>
                      On a day
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceMonthDay === -1 && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceWeekOrdinal(null);
                      setRecurrenceMonthDay(-1);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.schedulePillText, recurrenceMonthDay === -1 && styles.schedulePillTextActive]}>
                      Last day
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceWeekOrdinal !== null && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceMonthDay(null);
                      setRecurrenceWeekOrdinal(recurrenceWeekOrdinal ?? 1);
                      if (recurrenceDays.length === 0) setRecurrenceDays([(dueDate ?? new Date()).getDay()]);
                    }}
                    activeOpacity={interaction.activeOpacity}
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
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceMonthDay(Math.max(1, recurrenceMonthDay - 1));
                    }}
                  >
                    <Ionicons name="remove" size={16} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={styles.intervalValue}>{ordinal(recurrenceMonthDay)}</Text>
                  <TouchableOpacity
                    style={styles.intervalBtn}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceMonthDay(Math.min(31, recurrenceMonthDay + 1));
                    }}
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
                        onPress={() => {
                          haptics.tap();
                          setRecurrenceWeekOrdinal(value);
                        }}
                        activeOpacity={interaction.activeOpacity}
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
              {recurrenceType !== 'none' && (
                <View style={styles.scheduleRow}>
                  <TouchableOpacity
                    style={[styles.schedulePill, !recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceFromCompletion(false);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.schedulePillText, !recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      On schedule
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.schedulePill, recurrenceFromCompletion && styles.schedulePillActive]}
                    onPress={() => {
                      haptics.tap();
                      setRecurrenceFromCompletion(true);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.schedulePillText, recurrenceFromCompletion && styles.schedulePillTextActive]}>
                      After completion
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {activePanel === 'effort' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {([1, 2, 3, 4, 5, 6] as Effort[]).map(e => {
                  const active = !customEffortActive && effort === e;
                  return (
                    <TouchableOpacity
                      key={e}
                      style={[styles.presetChip, active && styles.presetChipActive]}
                      onPress={() => applyEffortPreset(e)}
                      activeOpacity={interaction.activeOpacity}
                    >
                      <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                        {EFFORT_LABELS[e]}
                      </Text>
                      <Text style={styles.presetChipHint}>{formatDuration(EFFORT_MINUTES[e]!)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.effortCustomRow}>
                <TextInput
                  style={styles.effortCustomInput}
                  value={customEffortText}
                  onChangeText={applyCustomEffort}
                  keyboardType="number-pad"
                  placeholder="custom min"
                  placeholderTextColor={colors.textTertiary}
                />
                <TouchableOpacity
                  style={styles.effortAiBtn}
                  onPress={handleEstimateEffort}
                  disabled={!title.trim()}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Ionicons name="sparkles-outline" size={12} color={colors.purple} />
                  <Text style={styles.effortAiBtnText}>Estimate</Text>
                </TouchableOpacity>
              </View>
              {effortNote ? <Text style={styles.effortNote}>{effortNote}</Text> : null}
            </View>
          )}

          {activePanel === 'tags' && (
            <View style={styles.panel}>
              {/* Currently selected tags */}
              {tags.length > 0 && (
                <View style={styles.selectedTagsRow}>
                  {tags.map(tag => (
                    <TouchableOpacity
                      key={tag}
                      style={[styles.selectedTagChip, { backgroundColor: tagColor(tag) + '33' }]}
                      onPress={() => removeTag(tag)}
                      activeOpacity={interaction.activeOpacity}
                    >
                      <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                      <Text style={[styles.selectedTagText, { color: tagColor(tag) }]}>{tag}</Text>
                      <Ionicons name="close" size={10} color={tagColor(tag)} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {/* Tag input */}
              <View style={styles.tagInputRow}>
                <TextInput
                  ref={tagInputRef}
                  style={styles.tagInput}
                  placeholder="Add tag…"
                  placeholderTextColor={colors.textTertiary}
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={() => { if (tagInput.trim()) addTag(tagInput); }}
                  returnKeyType="done"
                  blurOnSubmit={false}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {tagInput.trim().length > 0 && (
                  <TouchableOpacity onPress={() => addTag(tagInput)} hitSlop={8}>
                    <Ionicons name="add-circle" size={20} color={colors.accent} />
                  </TouchableOpacity>
                )}
              </View>
              {/* Existing tag suggestions */}
              {suggestedTags.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
                  <View style={styles.suggestionsRow}>
                    {suggestedTags.map(tag => (
                      <TouchableOpacity
                        key={tag}
                        style={styles.suggestionChip}
                        onPress={() => toggleExistingTag(tag)}
                        activeOpacity={interaction.activeOpacity}
                      >
                        <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                        <Text style={styles.suggestionText}>{tag}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>
          )}

          {activePanel === 'category' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={[styles.presetChip, category === null && styles.presetChipActive]}
                  onPress={() => setCategory(null)}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Text style={[styles.presetChipText, category === null && styles.presetChipTextActive]}>None</Text>
                </TouchableOpacity>
                {allCategories.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.presetChip, category === cat && styles.presetChipActive]}
                    onPress={() => {
                      haptics.tap();
                      setCategory(prev => prev === cat ? null : cat);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Text style={[styles.presetChipText, category === cat && styles.presetChipTextActive]}>
                      {categoryLabel(cat, categories)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {activePanel === 'link' && (
            <View style={styles.panel}>
              <View style={styles.presetRow}>
                {KNOWN_LINK_APPS.map(app => (
                  <TouchableOpacity
                    key={app.scheme}
                    style={[styles.linkAppChip, linkUrl === app.scheme && styles.linkAppChipActive]}
                    onPress={() => { haptics.tap(); setLinkUrl(app.scheme); setActivePanel(null); }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Ionicons
                      name={app.icon as never}
                      size={13}
                      color={linkUrl === app.scheme ? colors.onAccent : colors.textSecondary}
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
                {linkUrl !== null && (
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); setLinkUrl(null); setCustomLinkText(''); setActivePanel(null); }}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {activePanel === 'phone' && (
            <View style={styles.panel}>
              <View style={styles.linkCustomRow}>
                <Ionicons name="call-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.linkCustomInput}
                  value={phoneText}
                  onChangeText={setPhoneText}
                  onSubmitEditing={commitPhone}
                  onBlur={commitPhone}
                  placeholder="(555) 123-4567"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                />
                {phoneNumber !== null && (
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); setPhoneNumber(null); setPhoneText(''); setActivePanel(null); }}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* More details */}
          <TouchableOpacity style={styles.moreBtn} onPress={handleOpenFull} activeOpacity={interaction.activeOpacity}>
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.moreBtnText}>More details</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
      <WhenPicker
        visible={whenPickerVisible}
        value={dueDate}
        timeSegments={timeSegments}
        taskTitle={title}
        taskTags={tags}
        taskCategory={category}
        taskPriority={priority}
        taskEffort={effort}
        taskEstimatedMinutes={estimatedMinutes}
        onConfirm={(date, segs) => {
          setDueDate(date);
          setTimeSegments(segs);
          setWhenPickerVisible(false);
        }}
        onClear={() => {
          setDueDate(null);
          setTimeSegments([]);
          setWhenPickerVisible(false);
        }}
        onCancel={() => setWhenPickerVisible(false)}
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
    </Modal>

  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  seedRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  seedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent + '1A',
    maxWidth: '100%',
  },
  seedChipText: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  inputWrap: {
    flex: 1,
    position: 'relative',
  },
  input: {
    fontSize: font.md,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  // Positioned exactly over the real input; shows the highlighted phrase
  // while the actual TextInput's own text is made transparent, so the
  // native input stays purely controlled via `value` (no children).
  inputOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  inputHidden: {
    color: 'transparent',
  },
  inputHighlight: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
    backgroundColor: colors.accentSubtle,
  },
  suggestionsBox: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  suggestionItemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  suggestionTitle: {
    flex: 1,
    fontSize: font.sm,
    color: colors.textSecondary,
  },
  suggestionTitleHighlight: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  // Offscreen mirrors of the input text used purely for width measurement.
  measureWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0,
  },
  measureText: {
    fontSize: font.md,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  typeChip: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  typeChipActive: {
    backgroundColor: colors.accentSubtle,
  },
  typeChipText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  typeChipTextActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  typeSummaryRow: {
    marginBottom: spacing.sm,
  },
  typeSummary: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: 16,
  },
  typeControl: {
    marginBottom: spacing.sm,
  },
  typeBlocked: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.xs,
  },
  inlineCustomInput: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    // Matches presetChip's box so the custom field sits level with the pills.
    // Height rather than lineHeight — see the TextInput note in CLAUDE.md.
    height: 32,
    minWidth: 72,
  },
  // Room for roughly four steps before the list scrolls, so a long chain
  // can't push the sheet past the screen.
  stepList: {
    maxHeight: 132,
    marginBottom: spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotText: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  stepTitle: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
  },
  stepInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgQuaternary,
    paddingVertical: 4,
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  toolChipActive: {
    backgroundColor: colors.bgQuaternary,
  },
  toolChipSet: {
    backgroundColor: colors.accentSubtle,
  },
  toolChipText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  toolChipTextSet: {
    color: colors.accent,
  },
  toolChipTextTruncate: {
    maxWidth: 140,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tooltipRow: {
    marginTop: -4,
    marginBottom: spacing.sm,
  },
  tooltipAnchor: {
    alignSelf: 'flex-start',
  },
  tooltipCaret: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.accent,
  },
  tooltipBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  tooltipText: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  tooltipDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.onAccent,
    opacity: 0.6,
  },
  tooltipHint: {
    color: colors.onAccent,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
    opacity: 0.75,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  intervalLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  intervalBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intervalValue: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    minWidth: 24,
    textAlign: 'center',
  },
  weekdayRow: {
    marginTop: spacing.sm,
  },
  scheduleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  schedulePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  schedulePillActive: {
    backgroundColor: colors.accent,
  },
  schedulePillText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  schedulePillTextActive: {
    color: colors.onAccent,
  },
  panel: {
    marginBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  targetStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  targetUnitInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    // Matches inlineCustomInput / presetChip so it sits level with the stepper.
    // Height rather than lineHeight — see the TextInput note in CLAUDE.md.
    height: 32,
  },
  targetStepperCaption: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
  },
  presetChipActive: {
    backgroundColor: colors.accent,
  },
  presetChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  presetChipTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
  presetChipHint: {
    color: colors.textTertiary,
    fontSize: 10,
    marginTop: 1,
  },
  effortCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  effortCustomInput: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 110,
  },
  effortAiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  effortAiBtnText: {
    color: colors.purple,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  effortNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: spacing.sm,
  },
  clearChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  priorityChipActive: {
    backgroundColor: colors.bgQuaternary,
  },
  priorityChipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  selectedTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  tagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  selectedTagText: {
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  tagInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgQuaternary,
    paddingVertical: 4,
  },
  suggestionsScroll: {
    marginTop: 2,
  },
  suggestionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: 2,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  suggestionText: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  moreBtnText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  aiChip: {
    backgroundColor: colors.purple + '22',
  },
  aiChipText: {
    color: colors.purple,
    fontWeight: '600',
  },
  linkAppChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  linkAppChipActive: {
    backgroundColor: colors.accent,
  },
  linkAppChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  linkAppChipTextActive: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
  linkCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  linkCustomInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: 4,
  },
});
