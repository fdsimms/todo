import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
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
import { spacing, radius, font, fontWeight, animation, interaction, iconSize, type Colors } from '../theme';
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
  QUICK_ADD_CHIP_LABELS,
  QUICK_ADD_CHIP_LIMIT,
  TIMED_MINUTE_OPTIONS,
  type QuickAddChip,
  type TaskKind,
  type TypeValues,
} from '../utils/taskKinds';
import { resolvePillOverflow } from '../utils/pillOverflow';
import { MAX_TARGET_UNIT_LENGTH } from '../utils/quotaUnit';
import { WhenPicker } from './WhenPicker';
import { WeekdaySelector } from './WeekdaySelector';
import { PressableScale } from './PressableScale';
import { CountStepper } from './CountStepper';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { HighlightedText } from './HighlightedText';
import { suggestTitles } from '../utils/titleSuggestions';
import { findArchivedMatch } from '../utils/archiveMatch';
import { parseTaskInput, describeSchedule, parseLinkInput, parsePhoneInput, parseEmailInput, parseDurationInput, parseCategoryAndTagsInput, type ParsedCategoryAndTags } from '../utils/parseTaskInput';
import { KNOWN_LINK_APPS, linkAppsFor } from '../constants/linkApps';
import { tagColor } from '../utils/tagColor';
import { formatPhoneInput } from '../utils/phone';
import { format } from 'date-fns/format';
import { getLogicalToday, getLogicalTomorrow, getLogicalNow } from '../utils/dateUtils';
import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration } from '../utils/effort';
import { TaskEditor, type TaskDraft } from './TaskEditor';
import { ORDINAL_OPTIONS, RECURRENCE_LABELS, onlyNewestWeekday, ordinal } from './RecurrencePicker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenFull: (draft: TaskDraft) => void;
  /**
   * Which list this was opened from — determines the default due date.
   * Omit to fall back to Settings' newTaskDefaults.destination (Today/Inbox/
   * Unscheduled) — see the `visible` effect below.
   */
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
  initialType?: TaskKind;
  /** Seeds the title field on open, e.g. handing a search query straight into a new task. */
  initialTitle?: string;
}

type ActivePanel = 'priority' | 'effort' | 'tags' | 'category' | 'repeat' | 'segment' | 'link' | 'phone' | 'email' | null;

/** One attribute chip in the quick-add toolbar. See `chipDescriptors`. */
interface ToolChipDescriptor {
  key: QuickAddChip;
  /** Omitted only by priority, which shows a coloured dot instead. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** `null` is the resting state — the chip then reads its label instead. */
  value: string | null;
  /** The panel this chip opens. Omitted by chips that open their own picker. */
  panel?: Exclude<ActivePanel, null>;
  /** Overrides the accent tint a set chip normally takes. */
  tint?: string;
  dotColor?: string;
  /** Long free text (a URL, an address) that has to give way rather than wrap. */
  truncate?: boolean;
  /** Set only by chips that don't just toggle `panel`. */
  onPress?: () => void;
}

/** The type row's labels and icons. Order is fixed: plain first, then the modes. */

/** Known app name for a link scheme, else the raw URL. */
function linkLabel(url: string): string {
  return KNOWN_LINK_APPS.find(app => app.scheme === url)?.name ?? url;
}

/** Tooltip label for a "#word" match — category, tag count/name, or both joined. */
function categoryTagsLabel(parsed: ParsedCategoryAndTags, categories: Parameters<typeof categoryLabel>[1]): string {
  const parts: string[] = [];
  if (parsed.category) parts.push(categoryLabel(parsed.category, categories));
  if (parsed.tags.length > 0) {
    parts.push(parsed.tags.length > 1 ? `${parsed.tags.length} tags` : `#${parsed.tags[0]}`);
  }
  return parts.join(' + ');
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
  visible, onClose, onOpenFull, context, onCreated, onResumed, seed, seedLabel,
  initialType = 'task', initialTitle,
}: Props) {
  const addTask = useTaskStore(s => s.addTask);
  const unarchiveTask = useTaskStore(s => s.unarchiveTask);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const categories = useCategoryStore(useShallow(s => s.categories));
  const tasks = useTaskStore(s => s.tasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const newTaskDefaults = useSettingsStore(s => s.newTaskDefaults);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  // Which list this actually lands in: the caller's explicit choice (a
  // screen's current sub-view, a project's "unscheduled" drop) if it named
  // one, else Settings' destination default.
  const effectiveContext = context ?? newTaskDefaults.destination;
  // Holds the task created by this sheet while its editor is open — only used
  // when newTaskDefaults.openEditorAfterQuickAdd is on (see createTask below).
  const [postCreateTask, setPostCreateTask] = useState<Task | null>(null);
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

  // `onDone` runs after `onClose`, once the sheet has actually faded out —
  // callers that also need to change what's on screen behind the sheet (e.g.
  // switching Today's view to wherever a just-created task landed) pass it
  // here instead of doing that first. Doing it first used to change the
  // background while the sheet was still fully visible on top of it: a flash
  // of the wrong screen, then the sheet vanishing over it a beat later.
  const dismiss = (onDone?: () => void) => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.95);
      sheetOpacity.setValue(0);
      onClose();
      onDone?.();
    });
  };

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [customEffortText, setCustomEffortText] = useState('');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [emailAddress, setEmailAddress] = useState<string | null>(null);
  const [type, setType] = useState<TaskKind>('task');
  const [timedMinutes, setTimedMinutes] = useState<number | null>(null);
  const [customTimedText, setCustomTimedText] = useState('');
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [targetUnit, setTargetUnit] = useState('');
  const [chainItems, setChainItems] = useState<ChainItem[]>([]);
  const [newStepTitle, setNewStepTitle] = useState('');
  const [customLinkText, setCustomLinkText] = useState('');
  const [phoneText, setPhoneText] = useState('');
  const [emailText, setEmailText] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  // Lifts the toolbar's cap for this sheet only. Deliberately not persisted:
  // the folded chips are the rarely-wanted ones, so the next task starts from
  // the short toolbar again rather than inheriting a decision made once.
  const [showAllChips, setShowAllChips] = useState(false);
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
  // Whether the drop's placement still applies — the chip can shake it off.
  const [seedActive, setSeedActive] = useState(false);
  // Read only when the sheet opens: a seed that changes identity mid-edit must
  // not re-run the reset below and wipe what's already been typed.
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (visible) {
      setTitle(initialTitle ?? '');
      setPriority(newTaskDefaults.priority ?? 0);
      setEffort(newTaskDefaults.effort ?? 0);
      setEstimatedMinutes(null);
      setCustomEffortText('');
      setDueDate(
        effectiveContext === 'later' ? getLogicalTomorrow(dayResetTime)
        : effectiveContext === 'inbox' || effectiveContext === 'unscheduled' ? null
        : getLogicalToday(dayResetTime)
      );
      setTimeSegments(newTaskDefaults.timeSegment ? [newTaskDefaults.timeSegment] : []);
      setTags([]);
      // Applied after the reset rather than folded into it, so a drop's
      // category overrides the default instead of racing it.
      setCategory(seedRef.current?.category ?? newTaskDefaults.category);
      setSeedActive(!!seedRef.current);
      setLinkUrl(null);
      setPhoneNumber(null);
      setEmailAddress(null);
      setDeadline(null);
      setType(initialType);
      setTimedMinutes(initialType === 'timed' ? DEFAULT_TIMED_MINUTES : null);
      setCustomTimedText('');
      setTargetCount(initialType === 'target' ? DEFAULT_TARGET_COUNT : null);
      setChainItems([]);
      setNewStepTitle('');
      setCustomLinkText('');
      setPhoneText('');
      setEmailText('');
      setTagInput('');
      setActivePanel(null);
      setShowAllChips(false);
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
      setPostCreateTask(null);
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
      ]).start();
      // Focus (and the keyboard's own slide-up) starts alongside the sheet
      // animation rather than after it, so the keyboard is up sooner.
      inputRef.current?.focus();
    }
  }, [visible, effectiveContext, initialType, initialTitle]);

  // Natural-language scheduling: detect a trailing date/recurrence phrase in
  // the title ("go for a run on tuesday", "water plants every 3 days"). The
  // phrase is highlighted in the input and described in a tooltip; nothing is
  // applied until the user taps the tooltip.
  const parsed = useMemo(
    () => (title.trim() ? parseTaskInput(title, getLogicalNow(dayResetTime)) : null),
    [title, dayResetTime]
  );
  // "pay rent tmrw #home #errand" — one or more "#word" tokens, the first
  // naming a category and the rest naming tags (see
  // parseCategoryAndTagsInput for the priority rule). Same single tooltip
  // slot, checked right after the schedule phrase (and before link/phone/
  // duration below) so a trailing token that blocks the suffix-anchored
  // schedule match — the phrase has to reach the true end of the title —
  // doesn't leave both undetected: this fires instead, and once the token is
  // stripped the schedule phrase parses cleanly on the next keystroke or tap.
  // Only matches tokens that name a real category/tag, so a stray "#"
  // elsewhere in the title never lights it up.
  const categoryTagsParsed = useMemo(
    () => (!parsed && title.trim()
      ? parseCategoryAndTagsInput(title, categories.map(c => c.name), allTags)
      : null),
    [title, parsed, categories, allTags]
  );
  // Pasted URL/app-link detection — same tooltip mechanism as the schedule
  // parse above, just not suffix-anchored. Only checked when no schedule
  // phrase or category/tag token matched, so the tooltips never compete for
  // the same slot.
  const linkParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && title.trim() ? parseLinkInput(title) : null),
    [title, parsed, categoryTagsParsed]
  );
  // "call the doctor 555-123-4567" — the same mechanism again, for the number
  // rather than the URL. Checked after the link so a tel: URL someone pasted
  // still reads as a link, and deliberately stricter about what counts (see
  // looksLikePhoneNumber): this one is reading prose full of digits, so a
  // year or a price must not light it up.
  const phoneParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && !linkParsed && title.trim() ? parsePhoneInput(title) : null),
    [title, parsed, categoryTagsParsed, linkParsed]
  );
  // "email jane@example.com about the invoice" — the same mechanism again,
  // for an address rather than a number. Checked after phone so a title that
  // happens to contain both keeps reading as whichever comes first in the
  // priority chain, and email addresses don't collide with the phone pattern
  // since "@" and letters aren't dial digits.
  const emailParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && !linkParsed && !phoneParsed && title.trim() ? parseEmailInput(title) : null),
    [title, parsed, categoryTagsParsed, linkParsed, phoneParsed]
  );
  // "play violin for 15 minutes" — a duration, not a schedule. Same single
  // tooltip slot, checked last, so a schedule, category/tag token, link or
  // contact phrase always wins.
  //
  // Only offered from the plain type, because accepting it switches the sheet
  // into Timed: it's how someone who has never picked a type discovers there
  // is one. Someone already part-way through a Chain or a Target has said what
  // they're making, and a tooltip shouldn't overrule it.
  const durationParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && !linkParsed && !phoneParsed && !emailParsed && type === 'task' && title.trim() ? parseDurationInput(title) : null),
    [title, parsed, categoryTagsParsed, linkParsed, phoneParsed, emailParsed, type]
  );
  const activeMatch = parsed
    ? { matchStart: parsed.matchStart, matchedText: parsed.matchedText }
    : categoryTagsParsed
      ? {
          matchStart: categoryTagsParsed.matchStart,
          matchedText: title.slice(categoryTagsParsed.matchStart, categoryTagsParsed.matchEnd),
        }
      : linkParsed
        ? { matchStart: linkParsed.matchStart, matchedText: linkParsed.url }
        : phoneParsed
          ? { matchStart: phoneParsed.matchStart, matchedText: phoneParsed.number }
          : emailParsed
            ? { matchStart: emailParsed.matchStart, matchedText: emailParsed.address }
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
    setDeadline(parsed.schedule.deadline ?? null);
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

  // Apply the detected "#category"/"#tag" tokens and strip them from the title.
  const applyCategoryTags = () => {
    if (!categoryTagsParsed) return;
    haptics.success();
    animateLayout();
    setTitle(categoryTagsParsed.cleanTitle);
    if (categoryTagsParsed.category) setCategory(categoryTagsParsed.category);
    if (categoryTagsParsed.tags.length > 0) {
      setTags(prev => [...new Set([...prev, ...categoryTagsParsed.tags])]);
    }
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

  // Apply the detected email address and strip it from the title.
  const applyEmail = () => {
    if (!emailParsed) return;
    haptics.success();
    animateLayout();
    setTitle(emailParsed.cleanTitle);
    setEmailAddress(emailParsed.address);
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

  const commitEmail = () => {
    const t = emailText.trim();
    setEmailAddress(t || null);
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
      deadline: deadline?.toISOString() ?? null,
      timeSegments,
      tags,
      category,
      linkUrl,
      phoneNumber,
      emailAddress,
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
    // Files the task exactly as before either way; the setting only decides
    // whether the sheet hands off straight into the full editor for it
    // (postCreateTask, rendered below) instead of just closing.
    if (newTaskDefaults.openEditorAfterQuickAdd) {
      setPostCreateTask(task);
    }
    // onCreated can switch Today's whole sub-view (Today/Later/Unscheduled/
    // Inbox) to wherever the new task landed — deferred until the sheet has
    // finished fading out, so that switch never happens behind a sheet that's
    // still on screen. See dismiss's onDone.
    dismiss(() => onCreated?.(task, seedActive));
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
      emailAddress,
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
    if (panel === 'email') {
      setEmailText(emailAddress ?? '');
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


  const customEffortActive = estimatedMinutes != null && estimatedMinutes !== effortToMinutes(effort);

  const applyEffortPreset = (e: Effort) => {
    haptics.tap();
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
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setEstimatedMinutes(null);
      setEffort(0);
      return;
    }
    setEstimatedMinutes(n);
    setEffort(minutesToEffort(n));
  };


  const PRIORITY_LABELS_SHORT = ['None', 'Low', 'Med', 'High', 'Urgent'] as const;

  const formatDate = (d: Date) => {
    const today = getLogicalToday(dayResetTime);
    const tomorrow = getLogicalTomorrow(dayResetTime);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return format(d, 'MMM d');
  };

  /**
   * The attribute toolbar, as data.
   *
   * One descriptor per chip rather than ten near-identical blocks of JSX: they
   * differ only in icon, value and which panel they open, and keeping them as
   * copies is what let the resting label go missing from all ten at once.
   *
   * `value` is the whole state model — `null` is "unset", and everything else
   * (the accent tint, the label the chip reads, the overflow exemption)
   * follows from it.
   */
  const chipDescriptors: ToolChipDescriptor[] = [
    {
      key: 'date', icon: 'calendar-outline',
      value: dueDate != null ? formatDate(dueDate) : null,
      onPress: () => setWhenPickerVisible(true),
    },
    {
      key: 'repeat', icon: 'repeat', panel: 'repeat',
      value: recurrenceType !== 'none' ? RECURRENCE_LABELS[recurrenceType] : null,
    },
    {
      key: 'segment', panel: 'segment',
      icon: timeSegments.length > 0 ? SEGMENTS.find(s => s.key === timeSegments[0])!.icon : 'partly-sunny-outline',
      value: timeSegments.length > 0 ? SEGMENTS.find(s => s.key === timeSegments[0])!.label : null,
      // A segment keeps its own time-of-day colour rather than the generic
      // accent — it's the one attribute whose value is already colour-coded
      // everywhere else in the app.
      tint: timeSegments.length > 0 ? {
        morning: colors.timeMorning,
        afternoon: colors.timeAfternoon,
        evening: colors.timeEvening,
        night: colors.timeNight,
      }[timeSegments[0]] : undefined,
    },
    {
      key: 'priority', panel: 'priority',
      value: priority > 0 ? PRIORITY_LABELS_SHORT[priority] : null,
      // Priority has no glyph anywhere in the app — it's a coloured dot, and
      // at rest it takes the same grey as the other chips' icons.
      dotColor: priority > 0 ? PRIORITY_COLORS[priority] : colors.textSecondary,
      tint: priority > 0 ? PRIORITY_COLORS[priority] : undefined,
    },
    {
      key: 'category', icon: 'folder-outline', panel: 'category',
      value: category !== null ? categoryLabel(category, categories) : null,
    },
    {
      key: 'effort', icon: 'barbell', panel: 'effort',
      value: effort > 0
        ? (estimatedMinutes != null ? formatDuration(estimatedMinutes) : EFFORT_LABELS[effort])
        : null,
    },
    {
      key: 'tags', icon: 'pricetag-outline', panel: 'tags',
      value: tags.length > 0 ? tags.slice(0, 2).join(', ') : null,
    },
    {
      key: 'link', icon: 'link-outline', panel: 'link',
      value: linkUrl !== null ? linkLabel(linkUrl) : null, truncate: true,
    },
    {
      key: 'phone', icon: 'call-outline', panel: 'phone',
      value: phoneNumber, truncate: true,
    },
    {
      key: 'email', icon: 'mail-outline', panel: 'email',
      value: emailAddress, truncate: true,
    },
  ];

  const chipOverflow = resolvePillOverflow(
    chipDescriptors
      .filter(c => isChipVisible(type, c.key))
      .map(c => ({
        ...c,
        label: QUICK_ADD_CHIP_LABELS[c.key],
        onPress: c.onPress ?? (() => togglePanel(c.panel!)),
        // What the cap exempts: a chip the typed title already filled in
        // ("pay rent tmrw #home") must not be the one that gets folded away.
        selected: c.value !== null,
      })),
    // No `query` — this is a fixed toolbar, not one of the searchable pill
    // grids the helper was written for, so it's used purely for the cap. The
    // rule is the same one and worth not writing twice.
    { limit: QUICK_ADD_CHIP_LIMIT, showAll: showAllChips },
  );
  const visibleChips = chipOverflow.visible;
  const hiddenChipCount = chipOverflow.hiddenCount;

  const suggestedTags = allTags.filter(t => !tags.includes(t)).slice(0, 8);

  return (
    <>
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={() => dismiss()}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView
          intensity={isDark ? 20 : 15}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />
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
                  <Ionicons name="close" size={13} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

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
                placeholderTextColor={colors.textSecondary}
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
                  <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
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
                  onPress={parsed ? applyParse : categoryTagsParsed ? applyCategoryTags : linkParsed ? applyLink : phoneParsed ? applyPhone : emailParsed ? applyEmail : applyDuration}
                  onLayout={e => setBubbleW(e.nativeEvent.layout.width)}
                >
                  <Ionicons
                    name={
                      parsed
                        ? (parsed.schedule.recurrenceType !== 'none'
                            ? 'repeat'
                            : parsed.schedule.deadline ? 'flag-outline' : 'calendar-outline')
                        : categoryTagsParsed
                          ? (categoryTagsParsed.category ? 'pricetag-outline' : 'pricetags-outline')
                          : linkParsed
                            ? 'link-outline'
                            : phoneParsed
                              ? 'call-outline'
                              : emailParsed
                                ? 'mail-outline'
                                : 'timer-outline'
                    }
                    size={14}
                    color={colors.onAccent}
                  />
                  <Text style={styles.tooltipText}>
                    {parsed
                      ? describeSchedule(parsed.schedule, getLogicalNow(dayResetTime))
                      : categoryTagsParsed
                        ? categoryTagsLabel(categoryTagsParsed, categories)
                        : linkParsed
                          ? linkLabel(linkParsed.url)
                          : phoneParsed
                            ? `Call ${phoneParsed.number}`
                            : emailParsed
                              ? `Email ${emailParsed.address}`
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
                  placeholderTextColor={colors.textSecondary}
                  inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
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
                  placeholderTextColor={colors.textSecondary}
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
                        <Ionicons name="close" size={14} color={colors.textSecondary} />
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
                  placeholderTextColor={colors.textSecondary}
                  maxLength={TITLE_MAX_LENGTH}
                  returnKeyType="next"
                  blurOnSubmit={false}
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
              table in utils/taskKinds is the only place that decides what
              a type takes off the toolbar — a chip left ungated here would
              silently ignore being listed there. */}
          <View style={styles.toolbar}>
            {visibleChips.map(chip => (
              <TouchableOpacity
                key={chip.key}
                style={[
                  styles.toolChip,
                  chip.panel !== undefined && activePanel === chip.panel && styles.toolChipActive,
                  chip.value !== null && styles.toolChipSet,
                ]}
                onPress={chip.onPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                // Same shape EditorRow uses — the label names the field and the
                // value follows it, rather than the two being alternatives.
                accessibilityLabel={`${chip.label}${chip.value !== null ? `: ${chip.value}` : ''}`}
              >
                {chip.dotColor !== undefined
                  ? <View style={[styles.priorityDot, { backgroundColor: chip.dotColor }]} />
                  : <Ionicons
                      name={chip.icon!}
                      size={iconSize.sm}
                      // A set chip takes the accent unless it carries a colour
                      // of its own; only a resting one is grey.
                      color={chip.tint ?? (chip.value !== null ? colors.accent : colors.textSecondary)}
                    />}
                <Text
                  style={[
                    styles.toolChipText,
                    chip.value !== null && styles.toolChipTextSet,
                    chip.value !== null && chip.tint !== undefined && { color: chip.tint },
                    chip.truncate && styles.toolChipTextTruncate,
                  ]}
                  numberOfLines={1}
                >
                  {chip.value ?? chip.label}
                </Text>
              </TouchableOpacity>
            ))}

            {/* One disclosure for the rest, rather than four rows of pills
                above the keyboard. Never appears for a single chip, and never
                swallows one that's already set — see resolvePillOverflow. */}
            {hiddenChipCount > 0 && (
              <TouchableOpacity
                style={styles.toolChip}
                onPress={() => { haptics.tap(); setShowAllChips(true); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Show ${hiddenChipCount} more options`}
              >
                <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textSecondary} />
                <Text style={styles.toolChipText}>{hiddenChipCount} more</Text>
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
                      <Ionicons name={seg.icon} size={iconSize.sm} color={active ? segColor : colors.textSecondary} />
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
                  placeholderTextColor={colors.textSecondary}
                  inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
                />
              </View>
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
                  placeholderTextColor={colors.textSecondary}
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
              {/* A horizontal scroll rather than a wrapping row: KNOWN_LINK_APPS is
                  long enough that wrapping it full-width turned this panel into a
                  wall of pills before the URL input was even reached. One row keeps
                  the panel's height in line with every other quick-add panel. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsScroll}>
                <View style={styles.linkAppRow}>
                  {linkAppsFor(kitchenEnabled).map(app => (
                    <TouchableOpacity
                      key={app.scheme}
                      style={[styles.linkAppChip, linkUrl === app.scheme && styles.linkAppChipActive]}
                      onPress={() => { haptics.tap(); setLinkUrl(app.scheme); setActivePanel(null); }}
                      activeOpacity={interaction.activeOpacity}
                    >
                      <Ionicons
                        name={app.icon as never}
                        size={iconSize.sm}
                        color={linkUrl === app.scheme ? colors.onAccent : colors.textSecondary}
                      />
                      <Text style={[styles.linkAppChipText, linkUrl === app.scheme && styles.linkAppChipTextActive]}>
                        {app.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.linkCustomRow}>
                <Ionicons name="globe-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.linkCustomInput}
                  value={customLinkText}
                  onChangeText={setCustomLinkText}
                  onSubmitEditing={commitCustomLink}
                  onBlur={commitCustomLink}
                  placeholder="https://... or app://"
                  placeholderTextColor={colors.textSecondary}
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
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
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
                  onChangeText={t => setPhoneText(formatPhoneInput(t))}
                  onSubmitEditing={commitPhone}
                  onBlur={commitPhone}
                  placeholder="(555) 123-4567"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  // No return key on the iOS phone pad, and the only other way
                  // to blur this field is a tap outside — which in this sheet
                  // dismisses the whole thing, taking the number with it. So
                  // blur is still what saves, and the checkmark is what makes
                  // that reachable. Same pairing the editor's phone row uses.
                />
                <TouchableOpacity
                  onPress={commitPhone}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm phone number"
                >
                  <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
                </TouchableOpacity>
                {phoneNumber !== null && (
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); setPhoneNumber(null); setPhoneText(''); setActivePanel(null); }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear phone number"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {activePanel === 'email' && (
            <View style={styles.panel}>
              <View style={styles.linkCustomRow}>
                <Ionicons name="mail-outline" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.linkCustomInput}
                  value={emailText}
                  onChangeText={setEmailText}
                  onSubmitEditing={commitEmail}
                  onBlur={commitEmail}
                  placeholder="name@example.com"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                {emailAddress !== null && (
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); setEmailAddress(null); setEmailText(''); setActivePanel(null); }}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
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
      <NumberPadAccessory />
    </Modal>
    {/* newTaskDefaults.openEditorAfterQuickAdd hand-off — see createTask. A
        sibling of the sheet above rather than something rendered inside it,
        so it stays mounted (and visible) once the sheet has closed. */}
    <TaskEditor
      visible={postCreateTask !== null}
      task={postCreateTask}
      onClose={() => setPostCreateTask(null)}
    />
    </>
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
    width: interaction.pillHeight,
    height: interaction.pillHeight,
    borderRadius: interaction.pillHeight / 2,
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
  typeSummaryRow: {
    marginBottom: spacing.sm,
  },
  typeSummary: {
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: 16,
  },
  typeControl: {
    marginBottom: spacing.sm,
  },
  typeBlocked: {
    color: colors.textSecondary,
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
    height: interaction.pillHeight,
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
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotText: {
    color: colors.textSecondary,
    fontSize: font.xs,
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
    gap: 6,
    paddingHorizontal: 14,
    // Height rather than padding: these carry a mix of icons, coloured dots and
    // text, which don't share a natural line box, and a toolbar of pills at
    // three different heights reads as broken. 44 is the HIG touch minimum,
    // which none of these chips previously met (they stood about 25pt).
    minHeight: interaction.pillHeight,
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
    color: colors.textSecondary,
    fontSize: font.sm,
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
    width: interaction.pillHeight,
    height: interaction.pillHeight,
    borderRadius: interaction.pillHeight / 2,
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
    paddingHorizontal: 14,
    minHeight: interaction.pillHeight,
    justifyContent: 'center',
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
    height: interaction.pillHeight,
  },
  targetStepperCaption: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  presetChip: {
    paddingHorizontal: 14,
    minHeight: interaction.pillHeight,
    justifyContent: 'center',
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
    color: colors.textSecondary,
    fontSize: font.xs,
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
    paddingHorizontal: 14,
    minHeight: interaction.pillHeight,
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
  linkAppRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: 2,
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
