// Quick add: the sheet that turns one typed line into a task. One component of
// ~1,800 lines, so grep a landmark rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   makeStyles              styles, at the bottom
//
// The parsing itself lives in src/utils/parseTaskInput.ts and parseNaturalDate.ts;
// this file only decides what to do with what they return.
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
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useProjectStore } from '../store/useProjectStore';
import { categoryLabel } from '../utils/categoryLabel';
import { CategoryPickerSheet } from './CategoryPicker';
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
import { isSimpleChip } from '../utils/simpleTaskForm';
import { featureShown } from '../utils/simpleMode';
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
import { parseTaskInput, describeSchedule, parseLinkInput, parsePhoneInput, parseEmailInput, parseDurationInput, parseSupplyInput, parseCategoryAndTagsInput, parsePeopleInput, type ParsedCategoryAndTags, type ParsedPeople } from '../utils/parseTaskInput';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { clampSupplyCount, formatSupplyLeft, MAX_SUPPLY_COUNT } from '../utils/supply';
import { describeTitleRuleTargets, resolveTitleRules } from '../utils/titleRules';
import { KNOWN_LINK_APPS, linkAppsFor } from '../constants/linkApps';
import { tagColor } from '../utils/tagColor';
import { formatPhoneInput } from '../utils/phone';
import { format } from 'date-fns/format';
import { getLogicalToday, getLogicalTomorrow, getLogicalNow } from '../utils/dateUtils';
import { EFFORT_MINUTES, effortToMinutes, minutesToEffort, formatDuration } from '../utils/effort';
import { TaskEditor, type TaskDraft } from './TaskEditor';
import { RECURRENCE_LABELS, onlyNewestWeekday } from './RecurrencePicker';
import { SegmentedControl } from './SegmentedControl';
import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import { ORDINAL_OPTIONS } from '../utils/recurrenceLabels';
import { ordinal } from '../utils/ordinal';

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
   * `dueDate`/`timeSegments` seed those same visible fields (a drop onto a
   * Later day/time section); `windowStart`/`windowEnd` have no field of their
   * own in this sheet, so — like `groupId`/`pinned` — they ride along
   * untouched, only while the chip is still active.
   */
  seed?: {
    category?: string | null;
    groupId?: string;
    pinned?: boolean;
    dueDate?: string | null;
    timeSegments?: TimeOfDay[];
    windowStart?: string | null;
    windowEnd?: string | null;
  };
  /** Names the seed on a removable chip, e.g. "Errands". No chip without one. */
  seedLabel?: string | null;
  /** Which task type the sheet opens in — the add menu's Chain entry lands here. */
  initialType?: TaskKind;
  /** Seeds the title field on open, e.g. handing a search query straight into a new task. */
  initialTitle?: string;
}

// Category is absent on purpose: it opens its own sheet rather than a panel
// inside this one, the way the date chip opens WhenPicker. The sheet has room
// to list every category, which this sheet — capped to the space above the
// keyboard — does not.
type ActivePanel = 'priority' | 'effort' | 'tags' | 'repeat' | 'segment' | 'link' | 'phone' | 'email' | 'supply' | null;

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

/** "Dustin", or "Dustin + 2" once a plan names more than a couple of people. */
function peopleLabel(parsed: ParsedPeople, people: { id: string; name: string; nickname: string }[]): string {
  const named = parsed.personIds
    .map(id => people.find(p => p.id === id))
    .filter((p): p is { id: string; name: string; nickname: string } => !!p)
    .map(displayNameOf);
  if (named.length === 0) return 'People';
  if (named.length === 1) return named[0];
  if (named.length === 2) return `${named[0]} + ${named[1]}`;
  return `${named[0]} + ${named.length - 1}`;
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
  const categories = useCategoryStore(useShallow(s => s.categories));
  // Archived people are out of the picker but never stripped off a task that
  // already names them, the same call TaskEditor makes.
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));
  // Read only to name a project a title rule files into — quick add has no
  // project picker; see the projectId state below.
  const projects = useProjectStore(useShallow(s => s.projects));
  const tasks = useTaskStore(s => s.tasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const newTaskDefaults = useSettingsStore(s => s.newTaskDefaults);
  const titleRules = useSettingsStore(useShallow(s => s.titleRules));
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleTaskForm = useSettingsStore(s => s.simpleTaskForm);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  // Which list this actually lands in: the caller's explicit choice (a
  // screen's current sub-view, a project's "unscheduled" drop) if it named
  // one, else Settings' destination default.
  const effectiveContext = context ?? newTaskDefaults.destination;
  // The date a fresh sheet opens with, absent a drop seed — factored out so
  // shaking off the seed chip can revert to exactly this rather than to a
  // second, drifting copy of the same rule.
  const defaultDueDate = () =>
    effectiveContext === 'later' ? getLogicalTomorrow(dayResetTime)
    : effectiveContext === 'inbox' || effectiveContext === 'unscheduled' ? null
    : getLogicalToday(dayResetTime);
  // Holds the task created by this sheet while its editor is open — only used
  // when newTaskDefaults.openEditorAfterQuickAdd is on (see createTask below).
  // ==== sheet-level state (keyboard, panels, post-create follow-ups) ====
  const [postCreateTask, setPostCreateTask] = useState<Task | null>(null);
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
  // iOS rounds the keyboard's own top corners, and the sliver that curve
  // exposes is whatever sits behind it in the Modal — here, the dark blurred
  // backdrop. This backs that sliver with the same color as the accessory
  // bar above it, so the corner reads as a continuation of the bar rather
  // than a dim gap. Only needs to be as tall as the keyboard itself.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(height);
      Animated.spring(keyboardOffsetAnim, {
        toValue: -height / 2,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
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

  // The sheet centers in the full screen and, once the keyboard is up,
  // re-centers in what's left above it (see keyboardOffsetAnim). Left
  // unbounded, a sheet tall enough to need that room — several attribute
  // panels open, a long category grid — gets shifted until its own top,
  // title input included, is off the top of the screen. Capping it to the
  // space actually available and letting the rest scroll (below) keeps the
  // title in view no matter how tall the open panel is.
  const sheetMaxHeight = windowHeight - keyboardHeight - insets.top - insets.bottom - spacing.xl * 2;
  const styles = useMemo(() => makeStyles(colors, sheetMaxHeight), [colors, sheetMaxHeight]);

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

  // ==== the draft: every field this sheet can set ====
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [effort, setEffort] = useState<Effort>(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [customEffortText, setCustomEffortText] = useState('');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [timeSegments, setTimeSegments] = useState<TimeOfDay[]>([]);
  // No field of its own in this sheet — see the seed prop's doc comment.
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [windowEnd, setWindowEnd] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  // Only ever written by the "@name" tooltip — quick add has no people picker of
  // its own, the same shape projectId is in below.
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  // Quick add has no project picker of its own — this is only ever written by
  // a title rule, which is the point: filing into a project as you type is
  // something you could otherwise only do by opening the full editor after.
  const [projectId, setProjectId] = useState<string | null>(null);
  // "Not on this task" for whatever a rule filled in. Sheet-lifetime, like
  // showAllChips: the next task starts from the rules again rather than
  // inheriting a decision made once about a different title.
  const [rulesOptedOut, setRulesOptedOut] = useState(false);
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
  const [supplyCount, setSupplyCount] = useState<number | null>(null);
  const [supplyUnit, setSupplyUnit] = useState('');
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
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  // Whether the drop's placement still applies — the chip can shake it off.
  const [seedActive, setSeedActive] = useState(false);
  // Read only when the sheet opens: a seed that changes identity mid-edit must
  // not re-run the reset below and wipe what's already been typed.
  const seedRef = useRef(seed);
  seedRef.current = seed;

  // ==== effects: seeding and resetting the draft ====
  useEffect(() => {
    if (visible) {
      setTitle(initialTitle ?? '');
      setPriority(newTaskDefaults.priority ?? 0);
      setEffort(newTaskDefaults.effort ?? 0);
      setEstimatedMinutes(null);
      setCustomEffortText('');
      setDueDate(
        seedRef.current?.dueDate !== undefined
          ? (seedRef.current.dueDate ? new Date(seedRef.current.dueDate) : null)
          : defaultDueDate()
      );
      setTimeSegments(seedRef.current?.timeSegments ?? (newTaskDefaults.timeSegment ? [newTaskDefaults.timeSegment] : []));
      setWindowStart(seedRef.current?.windowStart ?? null);
      setWindowEnd(seedRef.current?.windowEnd ?? null);
      setTags([]);
      setPersonIds([]);
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
      setSupplyCount(null);
      setSupplyUnit('');
      setProjectId(null);
      setRulesOptedOut(false);
      appliedRuleRef.current = null;
      setPrefixW(null);
      setMatchW(null);
      tooltipAnim.setValue(0);
      hadParse.current = false;
      setWhenPickerVisible(false);
      setCategoryPickerVisible(false);
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

  // Title rules — the authored counterpart to the four parsers below (see
  // utils/titleRules.ts). Those read English and guess, so nothing they find
  // is applied until the tooltip is tapped; a rule is a filing decision the
  // user already wrote down, so it applies itself and says so in the caption
  // under the input. The strip half is deliberately *not* live: rewriting the
  // field someone is typing in would fight the cursor, so `cleanTitle` is
  // taken at handleAdd.
  const ruleFill = useMemo(
    () => (!rulesOptedOut && titleRules.length > 0 && title.trim()
      ? resolveTitleRules(title, titleRules)
      : null),
    [title, titleRules, rulesOptedOut],
  );

  /**
   * Exactly what the effect below last wrote, so a field the user has since
   * changed by hand is recognised and left alone — and so a rule that stops
   * matching (a keystroke later, the word is gone) takes its own values back
   * out instead of leaving them stranded. Comparing against the last write is
   * what makes this need no per-field "touched" bookkeeping: a value that
   * isn't what we put there is, by definition, someone else's.
   */
  const appliedRuleRef = useRef<{
    category: string | null;
    projectId: string | null;
    priority: Priority;
    effort: Effort;
    tags: string[];
  } | null>(null);

  useEffect(() => {
    if (!visible) return;
    // The baseline is what the sheet would hold with no rules at all — the
    // drop's category or Settings' default. A rule is one step more specific
    // than those, so it wins them, and losing the match hands the field back.
    const baseCategory = seedRef.current?.category ?? newTaskDefaults.category;
    const basePriority: Priority = newTaskDefaults.priority ?? 0;
    const baseEffort: Effort = newTaskDefaults.effort ?? 0;
    const prev = appliedRuleRef.current
      ?? { category: baseCategory, projectId: null, priority: basePriority, effort: baseEffort, tags: [] };
    const next = {
      category: ruleFill?.category ?? baseCategory,
      projectId: ruleFill?.projectId ?? null,
      priority: ruleFill && ruleFill.priority !== 0 ? ruleFill.priority : basePriority,
      effort: ruleFill && ruleFill.effort !== 0 ? ruleFill.effort : baseEffort,
      tags: ruleFill?.tags ?? [],
    };
    setCategory(cur => (cur === prev.category ? next.category : cur));
    setProjectId(cur => (cur === prev.projectId ? next.projectId : cur));
    setPriority(cur => (cur === prev.priority ? next.priority : cur));
    setEffort(cur => (cur === prev.effort ? next.effort : cur));
    // Tags accumulate rather than claim a slot (see resolveTitleRules), so the
    // reconcile is per tag: drop the ones this put there and the rule no
    // longer names, keep everything else exactly where it was.
    setTags(cur => {
      const kept = cur.filter(t => !prev.tags.includes(t) || next.tags.includes(t));
      return [...kept, ...next.tags.filter(t => !kept.includes(t))];
    });
    appliedRuleRef.current = next;
    // newTaskDefaults is read through a ref-like baseline that only matters at
    // open; re-running on it would fight a value already applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleFill, visible]);

  /** "“expense” · Work · #receipts" — the word that fired, and what it filled in. */
  const ruleCaption = useMemo(() => {
    if (!ruleFill) return null;
    const targets = describeTitleRuleTargets(
      ruleFill,
      ruleFill.category ? categoryLabel(ruleFill.category, categories) : null,
      projects.find(p => p.id === ruleFill.projectId)?.title ?? null,
    );
    const word = ruleFill.matched[0].match.keyword;
    return targets ? `“${word}” · ${targets}` : `“${word}”`;
  }, [ruleFill, categories, projects]);

  // Natural-language scheduling: detect a trailing date/recurrence phrase in
  // the title ("go for a run on tuesday", "water plants every 3 days"). The
  // phrase is highlighted in the input and described in a tooltip; nothing is
  // applied until the user taps the tooltip.
  // ==== parsing the typed line: date, category/tags, link, phone, email, duration ====
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
  // "beach with @dustin @ansley sat" — one or more "@name" tokens naming people
  // already added. Right after the category/tag token because it is the same
  // shape (a sigil naming something that already exists, never creating one),
  // and before the email parse below because an address's "@" is preceded by a
  // word character and so cannot match this pattern anyway.
  const peopleParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && title.trim() ? parsePeopleInput(title, people) : null),
    [title, parsed, categoryTagsParsed, people]
  );
  const linkParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && !peopleParsed && title.trim() ? parseLinkInput(title) : null),
    [title, parsed, categoryTagsParsed, peopleParsed]
  );
  // "call the doctor 555-123-4567" — the same mechanism again, for the number
  // rather than the URL. Checked after the link so a tel: URL someone pasted
  // still reads as a link, and deliberately stricter about what counts (see
  // looksLikePhoneNumber): this one is reading prose full of digits, so a
  // year or a price must not light it up.
  const phoneParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && !peopleParsed && !linkParsed && title.trim() ? parsePhoneInput(title) : null),
    [title, parsed, categoryTagsParsed, peopleParsed, linkParsed]
  );
  // "email jane@example.com about the invoice" — the same mechanism again,
  // for an address rather than a number. Checked after phone so a title that
  // happens to contain both keeps reading as whichever comes first in the
  // priority chain, and email addresses don't collide with the phone pattern
  // since "@" and letters aren't dial digits.
  const emailParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && !peopleParsed && !linkParsed && !phoneParsed && title.trim() ? parseEmailInput(title) : null),
    [title, parsed, categoryTagsParsed, peopleParsed, linkParsed, phoneParsed]
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
    () => (!parsed && !categoryTagsParsed && !peopleParsed && !linkParsed && !phoneParsed && !emailParsed && type === 'task' && title.trim() ? parseDurationInput(title) : null),
    [title, parsed, categoryTagsParsed, peopleParsed, linkParsed, phoneParsed, emailParsed, type]
  );
  // "replace cpap filter 6 filters left" — a stock this task spends, not a
  // schedule. Last in the chain, so everything above still wins the one slot.
  //
  // **Offered only once the sheet has a repeat**, which is this parser's
  // equivalent of the type gate above it. A supply counts down by riding onto
  // the successor a completion spawns, so on a one-off it would sit at its
  // starting number for ever (see canHoldSupply) — offering it there would be
  // offering a field that does nothing. It also happens to be the cheapest
  // false-positive filter available: "finish the report 3 spare left" on a
  // task with no repeat never gets asked about.
  //
  // The order this composes in is the user's, not ours. Type the whole line
  // and the schedule tooltip comes first (it needs the trailing text); tapping
  // it shortens the title, sets the repeat, and this fires on the remainder.
  const supplyParsed = useMemo(
    () => (!parsed && !categoryTagsParsed && !peopleParsed && !linkParsed && !phoneParsed && !emailParsed
      && !durationParsed && recurrenceType !== 'none' && title.trim()
      ? parseSupplyInput(title) : null),
    [title, parsed, categoryTagsParsed, peopleParsed, linkParsed, phoneParsed, emailParsed, durationParsed, recurrenceType]
  );
  const activeMatch = parsed
    ? { matchStart: parsed.matchStart, matchedText: parsed.matchedText }
    : categoryTagsParsed
      ? {
          matchStart: categoryTagsParsed.matchStart,
          matchedText: title.slice(categoryTagsParsed.matchStart, categoryTagsParsed.matchEnd),
        }
      : peopleParsed
        ? {
            matchStart: peopleParsed.matchStart,
            matchedText: title.slice(peopleParsed.matchStart, peopleParsed.matchEnd),
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
              : supplyParsed
                ? {
                    matchStart: supplyParsed.matchStart,
                    matchedText: title.slice(supplyParsed.matchStart, supplyParsed.matchEnd),
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

  // Apply the detected "@name" tokens and strip them from the title.
  const applyPeople = () => {
    if (!peopleParsed) return;
    haptics.success();
    animateLayout();
    setTitle(peopleParsed.cleanTitle);
    setPersonIds(prev => [...new Set([...prev, ...peopleParsed.personIds])]);
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

  const applySupply = () => {
    if (!supplyParsed) return;
    haptics.success();
    animateLayout();
    setTitle(supplyParsed.cleanTitle);
    setSupplyCount(clampSupplyCount(supplyParsed.count));
    setSupplyUnit(supplyParsed.unit ?? '');
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

  // Add/Open full can fire before the link/phone/email/tag fields' own blur
  // or Enter has committed their text — same race TaskEditor's
  // resolveLinkUrl/resolvePhoneNumber/resolveEmailAddress guard against.
  // Read the live text box instead of trusting state that may not have
  // caught up yet.
  const resolveLinkUrl = () => {
    const t = customLinkText.trim();
    return activePanel === 'link' && t ? t : linkUrl;
  };
  const resolvePhoneNumber = () => {
    const t = phoneText.trim();
    return activePanel === 'phone' && t ? t : phoneNumber;
  };
  const resolveEmailAddress = () => {
    const t = emailText.trim();
    return activePanel === 'email' && t ? t : emailAddress;
  };
  const resolveTags = () => {
    const t = tagInput.trim().toLowerCase();
    return t && !tags.includes(t) ? [...tags, t] : tags;
  };

  // ==== creating the task ====
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
      tags: resolveTags(),
      personIds,
      category,
      linkUrl: resolveLinkUrl(),
      phoneNumber: resolvePhoneNumber(),
      emailAddress: resolveEmailAddress(),
      projectId,
      // recurrenceType deliberately absent — it comes from `baked` above,
      // which is what turns a Target into a daily task.
      recurrenceInterval,
      recurrenceDays,
      recurrenceMonthDay,
      recurrenceWeekOrdinal,
      recurrenceEndDate,
      recurrenceCount,
      recurrenceFromCompletion,
      // Cleared with the repeat it depends on, the same reset the editor does
      // on save: a supply rides onto a successor, and a one-off spawns none.
      // `baked` is what decides recurrenceType here (a Target becomes daily),
      // so this reads the same source rather than the raw chip state.
      supplyCount: (baked.recurrenceType ?? 'none') !== 'none' ? supplyCount : null,
      supplyUnit: (baked.recurrenceType ?? 'none') !== 'none' && supplyCount !== null ? supplyUnit.trim() || null : null,
      // addTask takes both, and ignores sortOrder — a drop that also wants a
      // position splices it in afterwards, from onCreated.
      ...(seedActive && seed?.groupId ? { groupId: seed.groupId } : {}),
      ...(seedActive && seed?.pinned ? { pinned: true } : {}),
      ...(seedActive && seed?.windowStart ? { windowStart: seed.windowStart, windowEnd: seed.windowEnd ?? null } : {}),
    // skipTitleRules: this sheet already resolved them, a keystroke at a time
    // and visibly — re-running them here would put back a category the ✕ on
    // the rule caption just took off.
    }, undefined, { skipTitleRules: true });
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

  // ==== the exits: add, or hand the draft to the full editor ====
  const handleAdd = () => {
    // A rule that strips takes its word out here rather than as you type —
    // rewriting the field under the cursor is the one way this feature would
    // be unusable. Nothing strips unless a rule asked to, and a strip that
    // would empty the title is refused (see stripMatchedKeywords).
    const finalTitle = (ruleFill?.cleanTitle ?? title).trim();
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
      tags: resolveTags(),
      personIds,
      category,
      linkUrl: resolveLinkUrl(),
      phoneNumber: resolvePhoneNumber(),
      emailAddress: resolveEmailAddress(),
      recurrenceInterval,
      recurrenceDays,
      recurrenceMonthDay,
      recurrenceWeekOrdinal,
      recurrenceFromCompletion,
      recurrenceEndDate: recurrenceEndDate ? new Date(recurrenceEndDate) : null,
      recurrenceCount,
      // Handed over as typed rather than cleared the way createTask clears it:
      // the editor is where a repeat can still be added, and dropping the
      // supply on the way in would lose it for someone who opened More details
      // precisely to finish setting one up. The editor applies the same rule
      // on its own save.
      supplyCount,
      supplyUnit: supplyUnit.trim() || null,
    });
  };

  const togglePanel = (panel: ActivePanel) => {
    haptics.tap();
    setActivePanel(prev => prev === panel ? null : panel);
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

  // The four monthly day-anchor modes as one closed set, so the row can be a
  // segmented control rather than four independently-computed pills. Mirrors
  // `RecurrencePicker`'s; both fold the same two nullable fields into one value.
  const monthAnchor: 'dueDate' | 'monthDay' | 'lastDay' | 'weekday' =
    recurrenceWeekOrdinal !== null ? 'weekday'
      : recurrenceMonthDay === -1 ? 'lastDay'
        : recurrenceMonthDay !== null && recurrenceMonthDay > 0 ? 'monthDay'
          : 'dueDate';

  const selectMonthAnchor = (anchor: 'dueDate' | 'monthDay' | 'lastDay' | 'weekday') => {
    switch (anchor) {
      case 'dueDate':
        setRecurrenceWeekOrdinal(null);
        setRecurrenceMonthDay(null);
        break;
      case 'monthDay':
        setRecurrenceWeekOrdinal(null);
        setRecurrenceMonthDay(
          recurrenceMonthDay && recurrenceMonthDay > 0 ? recurrenceMonthDay : (dueDate ?? new Date()).getDate(),
        );
        break;
      case 'lastDay':
        setRecurrenceWeekOrdinal(null);
        setRecurrenceMonthDay(-1);
        break;
      case 'weekday':
        setRecurrenceMonthDay(null);
        setRecurrenceWeekOrdinal(recurrenceWeekOrdinal ?? 1);
        if (recurrenceDays.length === 0) setRecurrenceDays([(dueDate ?? new Date()).getDay()]);
        break;
    }
  };

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
      key: 'category', icon: 'folder-outline',
      value: category !== null ? categoryLabel(category, categories) : null,
      onPress: () => { haptics.tap(); setCategoryPickerVisible(true); },
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
    // Only once there's a repeat to spend it, the same gate the tooltip and
    // the editor's own card live under: without one the field would be a
    // number that never moves. It stays visible with a supply already set, so
    // clearing the repeat can't strand a value with no way back to it.
    ...(recurrenceType !== 'none' || supplyCount !== null ? [{
      key: 'supply' as const, icon: 'cube-outline' as const, panel: 'supply' as const,
      value: supplyCount !== null ? formatSupplyLeft(supplyCount, supplyUnit) : null,
      truncate: true,
    }] : []),
  ];

  const chipOverflow = resolvePillOverflow(
    chipDescriptors
      .filter(c => isChipVisible(type, c.key))
      // "Show fewer fields" trims the toolbar to Date / Time of day / Repeat —
      // except for a chip that already carries a value, which the typed title
      // may well have set ("pay rent tmrw #home"). Hiding one of those would
      // hide a value that has already been applied, which is the one thing a
      // display preference must never do.
      .filter(c => isSimpleChip(c.key, simpleTaskForm) || c.value !== null)
      // Simplified mode takes Effort off the editor, so the chip that sets it
      // goes too. Same exemption for a chip already carrying a value.
      .filter(c => c.key !== 'effort'
        || featureShown('effortRating', simpleMode, c.value !== null))
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

  // ==== render. Everything below is JSX ====
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
      {keyboardHeight > 0 && (
        <View
          pointerEvents="none"
          style={[styles.keyboardBacking, { height: keyboardHeight }]}
        />
      )}
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, shadows.sheet, { opacity: sheetOpacity, transform: [{ scale: scaleAnim }, { translateY: Animated.add(translateYAnim, keyboardOffsetAnim) }] }]}>
          {/* sheetMaxHeight bounds this view; with enough open panels or a
              long category grid the content below the title can outgrow it,
              which used to push the whole sheet — title input included —
              up past the top of the screen once the keyboard's offset was
              added on top. Scrolling the content keeps the title pinned at
              the top of a sheet that can no longer grow past the screen. */}
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
                    if (seed?.dueDate !== undefined && (dueDate?.toISOString() ?? null) === (seed.dueDate ?? null)) {
                      setDueDate(defaultDueDate());
                    }
                    if (seed?.timeSegments && timeSegments === seed.timeSegments) setTimeSegments([]);
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
                keyboardAppearance={isDark ? 'dark' : 'light'}
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
            {/* The arrow moves into the footer as a named button while
                "Show fewer fields" is on — see the footer row below. */}
            {!simpleTaskForm && (
              <TouchableOpacity
                style={[styles.addBtn, (!title.trim() || blocked !== null) && styles.addBtnDisabled]}
                onPress={handleAdd}
                disabled={!title.trim() || blocked !== null}
                accessibilityRole="button"
                accessibilityLabel="Add task"
              >
                <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
              </TouchableOpacity>
            )}
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
                  onPress={parsed ? applyParse : categoryTagsParsed ? applyCategoryTags : peopleParsed ? applyPeople : linkParsed ? applyLink : phoneParsed ? applyPhone : emailParsed ? applyEmail : durationParsed ? applyDuration : applySupply}
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
                          : peopleParsed
                            ? 'people-outline'
                          : linkParsed
                            ? 'link-outline'
                            : phoneParsed
                              ? 'call-outline'
                              : emailParsed
                                ? 'mail-outline'
                                : durationParsed
                                  ? 'timer-outline'
                                  : 'cube-outline'
                    }
                    size={14}
                    color={colors.onAccent}
                  />
                  <Text style={styles.tooltipText}>
                    {parsed
                      ? describeSchedule(parsed.schedule, getLogicalNow(dayResetTime))
                      : categoryTagsParsed
                        ? categoryTagsLabel(categoryTagsParsed, categories)
                        : peopleParsed
                          ? peopleLabel(peopleParsed, people)
                        : linkParsed
                          ? linkLabel(linkParsed.url)
                          : phoneParsed
                            ? `Call ${phoneParsed.number}`
                            : emailParsed
                              ? `Email ${emailParsed.address}`
                              : durationParsed
                                ? `Timer · ${formatDuration(durationParsed.minutes)}`
                                : `Supply · ${formatSupplyLeft(supplyParsed!.count, supplyParsed!.unit)}`}
                  </Text>
                  <View style={styles.tooltipDot} />
                  <Text style={styles.tooltipHint}>Tap to set</Text>
                </PressableScale>
              </View>
            </Animated.View>
          )}

          {/* What a title rule just filled in. Not a tooltip: the tooltips
              below offer a guess and wait to be tapped, while a rule has
              already applied — so this states it and offers the way out.
              Rendered after them so a rule can't displace the caret the
              schedule tooltip aims at its phrase. */}
          {!!ruleCaption && (
            <View style={styles.ruleRow}>
              <Ionicons name="funnel-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.ruleText} numberOfLines={1}>{ruleCaption}</Text>
              <TouchableOpacity
                onPress={() => { haptics.tap(); setRulesOptedOut(true); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Don't use title rules on this task"
              >
                <Ionicons name="close-circle" size={15} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
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
                  inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
                  accessibilityLabel="Custom duration in minutes"
                  keyboardAppearance={isDark ? 'dark' : 'light'}
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
                  keyboardAppearance={isDark ? 'dark' : 'light'}
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
                  placeholderTextColor={colors.textTertiary}
                  maxLength={TITLE_MAX_LENGTH}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
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
                        styles.segmentChip,
                        active && styles.segmentChipActive,
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
              <View style={styles.segmentRow}>
                <SegmentedControl
                  label="Priority"
                  value={priority}
                  onChange={setPriority}
                  columns={3}
                  options={PRIORITY_SEGMENTS}
                />
              </View>
            </View>
          )}

          {activePanel === 'repeat' && (
            <View style={styles.panel}>
              <View style={styles.segmentRow}>
                <SegmentedControl
                  label="Repeats"
                  value={recurrenceType}
                  onChange={setRecurrenceType}
                  options={(['none', 'daily', 'weekly', 'monthly', 'yearly'] as RecurrenceType[])
                    .map(t => ({ value: t, label: RECURRENCE_LABELS[t] }))}
                />
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
                    accessibilityRole="button"
                    accessibilityLabel="Repeat less often"
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
                    accessibilityRole="button"
                    accessibilityLabel="Repeat more often"
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
                <View style={styles.segmentRow}>
                  <SegmentedControl
                    label="On which day"
                    value={monthAnchor}
                    onChange={selectMonthAnchor}
                    columns={2}
                    options={[
                      { value: 'dueDate' as const, label: 'Same day as due date' },
                      { value: 'monthDay' as const, label: 'On a day' },
                      { value: 'lastDay' as const, label: 'Last day' },
                      { value: 'weekday' as const, label: 'On a weekday' },
                    ]}
                  />
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
                    accessibilityRole="button"
                    accessibilityLabel="Earlier day of the month"
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
                    accessibilityRole="button"
                    accessibilityLabel="Later day of the month"
                  >
                    <Ionicons name="add" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>
              )}
              {recurrenceType === 'monthly' && recurrenceWeekOrdinal !== null && (
                <>
                  <View style={styles.segmentRow}>
                    <SegmentedControl
                      label="Which week"
                      value={recurrenceWeekOrdinal}
                      onChange={setRecurrenceWeekOrdinal}
                      options={ORDINAL_OPTIONS.map(({ value, label }) => ({
                        value,
                        label,
                        accessibilityLabel: `${label} week of the month`,
                      }))}
                    />
                  </View>
                  <View style={styles.weekdayRow}>
                    <WeekdaySelector value={recurrenceDays} onChange={onlyNewestWeekday(recurrenceDays, setRecurrenceDays)} />
                  </View>
                </>
              )}
              {recurrenceType !== 'none' && (
                <View style={styles.segmentRow}>
                  <SegmentedControl
                    label="Next due date"
                    value={recurrenceFromCompletion}
                    onChange={setRecurrenceFromCompletion}
                    options={[
                      { value: false, label: 'On schedule' },
                      { value: true, label: 'After completion' },
                    ]}
                  />
                </View>
              )}
            </View>
          )}

          {activePanel === 'supply' && (
            <View style={styles.panel}>
              <View style={styles.targetStepperRow}>
                <CountStepper
                  value={supplyCount}
                  onChange={setSupplyCount}
                  min={0}
                  max={MAX_SUPPLY_COUNT}
                  // The floor is 0 because being out of something is a real
                  // state; allowNull is what gets you back out of tracking a
                  // supply at all, so − at the bottom still has somewhere to go.
                  allowNull
                  emptyLabel="Off"
                  label="Supply"
                  describeValue={n => (n === null ? 'not a supply' : formatSupplyLeft(n, supplyUnit))}
                />
                {supplyCount !== null && (
                  <TextInput
                    style={styles.targetUnitInput}
                    value={supplyUnit}
                    onChangeText={setSupplyUnit}
                    placeholder="e.g. filters"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={MAX_TARGET_UNIT_LENGTH}
                    autoCapitalize="none"
                    accessibilityLabel="What the supply is counted in, optional"
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                  />
                )}
              </View>
              {/* The rest of the supply — pack size, threshold, delivery time —
                  is deliberately only in the editor. They all have workable
                  defaults, and quick add exists to get the task down. */}
              <Text style={styles.targetStepperCaption}>
                {supplyCount === null
                  ? 'One is used each time this is done'
                  : `One used per repeat. More details for the rest.`}
              </Text>
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
                  inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
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
                  placeholderTextColor={colors.textTertiary}
                  value={tagInput}
                  onChangeText={setTagInput}
                  onSubmitEditing={() => { if (tagInput.trim()) addTag(tagInput); }}
                  returnKeyType="done"
                  blurOnSubmit={false}
                  autoCapitalize="none"
                  autoFocus
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                />
                {tagInput.trim().length > 0 && (
                  <TouchableOpacity
                    onPress={() => addTag(tagInput)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Add tag ${tagInput}`}
                  >
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
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                />
                {linkUrl !== null && (
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); setLinkUrl(null); setCustomLinkText(''); setActivePanel(null); }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear link"
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
                  placeholder="e.g. (555) 123-4567"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
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
                  placeholder="e.g. name@example.com"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                />
                {emailAddress !== null && (
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); setEmailAddress(null); setEmailText(''); setActivePanel(null); }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear email address"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* More details — and, with "Show fewer fields" on, the sheet's two
              named buttons. A bare accent arrow beside the field says what it
              looks like and nothing about what it does; naming the action is
              the half of the preference that isn't about hiding things.
              Cancel is what the backdrop tap already did, said out loud. */}
          {simpleTaskForm ? (
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={styles.footerMore}
                onPress={handleOpenFull}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="More details"
              >
                <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
                <Text style={styles.moreBtnText}>More details</Text>
              </TouchableOpacity>
              <View style={styles.footerSpacer} />
              <TouchableOpacity
                style={styles.footerCancel}
                onPress={() => dismiss()}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.footerCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.footerAdd, (!title.trim() || blocked !== null) && styles.footerAddDisabled]}
                onPress={handleAdd}
                disabled={!title.trim() || blocked !== null}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Add task"
              >
                <Text style={[
                  styles.footerAddText,
                  (!title.trim() || blocked !== null) && styles.footerAddTextDisabled,
                ]}>
                  Add task
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.moreBtn} onPress={handleOpenFull} activeOpacity={interaction.activeOpacity}>
              <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.moreBtnText}>More details</Text>
            </TouchableOpacity>
          )}
          </ScrollView>
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
      {/* Inside this sheet's own Modal, same as the date picker above — see
          TaskRelationPickerSheet, which the task editor opens the same way. */}
      <CategoryPickerSheet
        visible={categoryPickerVisible}
        value={category}
        onSelect={setCategory}
        onClose={() => setCategoryPickerVisible(false)}
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

const makeStyles = (colors: Colors, sheetMaxHeight: number) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  keyboardBacking: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgSecondary,
  },
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
    maxHeight: sheetMaxHeight,
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
    // Content is centred because these stretch (below): left-aligned, a chip
    // on a line that only fits two carries all its slack as a trailing gap
    // inside the pill, which is the ragged edge again one level down.
    justifyContent: 'center',
    gap: 5,
    // 10, where the sheet's other pills (`presetChip`, `segmentChip`) use 14.
    // Those sit three or four to a panel; this is the one row where six to
    // nine compete for a single line, and at 14 the widest three ran a few
    // points past the sheet's 294pt of inner width at 390pt — so only two
    // ever landed on a line and the toolbar stood three rows tall with a
    // third of its width unused. Don't put it back without rechecking that
    // arithmetic; the padding is what buys the third chip.
    paddingHorizontal: 10,
    // Grow to fill the line rather than leaving it ragged. Yoga lays each
    // wrapped line out on its own, so this hands whatever the line didn't use
    // to the chips on it: the right edge is flush at any sheet width, label
    // set or text size, and a line that only fits two still reads as
    // deliberate. Shrink covers the opposite case — a chip whose value alone
    // outgrows the line (a long category name) narrows and lets its label
    // ellipsize instead of running past the sheet.
    flexGrow: 1,
    flexShrink: 1,
    // Ceiling on that growth, because a line can hold one chip: tapping "2 more"
    // puts ten on the toolbar, which lands three-three-three-one, and the odd
    // one out grew into a full-width banner that read as a section header
    // rather than as the last pill in a row. Under half the line it stays a
    // pill. A percentage rather than a fixed width so it can't overflow — two
    // of them plus the 4pt gap still fit any sheet width.
    maxWidth: '48%',
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
    // So the chip's own flexShrink reaches the label: a Text in a row keeps
    // its measured width otherwise, and `numberOfLines={1}` never ellipsizes.
    flexShrink: 1,
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
  ruleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.xs, marginBottom: spacing.sm,
  },
  ruleText: { flex: 1, color: colors.textSecondary, fontSize: font.xs },
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
  segmentRow: { marginTop: spacing.sm },
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
    // Fill the line, same as `toolChip` and for the same reason — six short
    // presets otherwise wrap four-then-two and leave the second line half
    // empty under a toolbar that is now flush. Only the single-choice rows
    // (timed minutes, effort) get this; see `segmentChip`. The cap matters
    // more here than on the toolbar: the minute row wraps to a lone "1h"
    // beside the custom field, and uncapped that one word filled the line.
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: '48%',
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
  // The time-of-day chips, and only those since priority moved to a track: a
  // row of toggles rather than one field, so it stays pills — and the tint is
  // the segment's own colour, which a raised grey segment would drop.
  segmentChip: {
    // Deliberately not filling its line the way `presetChip` does. Time of day
    // is multi-select, and a row of pills stretched into one full-width band
    // is how this app draws "pick exactly one of a closed set"
    // (`SegmentedControl`) — the ragged edge is what says these toggle
    // independently. Consistency with the rows above it isn't worth saying the
    // wrong thing about the control.
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
  segmentChipActive: {
    backgroundColor: colors.bgQuaternary,
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
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  footerSpacer: { flex: 1 },
  footerMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  footerCancel: {
    minHeight: interaction.pillHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  footerCancelText: {
    color: colors.textSecondary,
    fontSize: font.md,
  },
  footerAdd: {
    minHeight: interaction.pillHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  footerAddDisabled: { backgroundColor: colors.bgTertiary },
  footerAddText: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  footerAddTextDisabled: { color: colors.textTertiary },
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
