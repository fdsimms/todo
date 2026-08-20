import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Animated,
  StyleSheet,
  Alert,
  Keyboard,
  LayoutChangeEvent,
  Linking,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PinIcon } from './PinIcon';
import type { Task } from '../types';
import { PRIORITY_COLORS, TITLE_MAX_LENGTH } from '../types';
import { useColors } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, animation, interaction, checkboxRadius, type Colors } from '../theme';
import { formatDeadlineDate, formatScheduledDate, formatTaskDate, formatHHMM, dateToHHMM, formatWindowRemaining, getDeadlineCountdown, getEffectiveTaskDate } from '../utils/dateUtils';
import { formatDuration, formatStopwatch } from '../utils/effort';
import { isTimedTask, timerRemaining, timerProgress, timerElapsed } from '../utils/timer';
import { activeSegment, segmentPhase, segmentRemaining, timerSegments } from '../utils/timerSegments';
import { isTaskWindowActive, isTaskExpired, effectiveWindowEnd, isRecurrenceNotYetDue, isTaskNew, isTaskVisible, isQuotaTask, isQuotaPartial, isOnPaceQuota, quotaLeavesTodayAfterLog, quotaNextDueAt, activeChainStepTitle, displayTitleFor } from '../utils/visibilityUtils';
import { asksOnCompletion } from '../utils/deliverables';
import { describeTaskRecurrence } from '../utils/recurrenceLabels';
import { chainPreview, isChainFinish } from '../utils/chain';
import { formatQuotaProgress } from '../utils/quotaUnit';
import { haptics } from '../utils/haptics';
import { openInAppUrl } from '../utils/deepLinks';
import { telUrl, smsUrl } from '../utils/phone';
import { mailtoUrl } from '../utils/email';
import { animateLayout } from '../utils/layoutAnimation';
import { nextMeasuredHeight } from '../utils/measuredHeight';
import { describePendingImport } from '../utils/remindersImport';
import { useNowTick } from '../hooks/useNowTick';
import { useReduceMotion } from '../utils/useReduceMotion';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { MEAL_PLAN_NUDGE_SLOT_COUNT, mealPlanNudgeDayKey } from '../utils/mealPlanNudge';
import {
  describeProjectQuiet,
  projectQuietDays,
  projectReviewProjectId,
} from '../utils/projectReviewTasks';
import { resolveBlocker, waitingCountFor } from '../utils/blockerRegistry';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { WhenPicker } from './WhenPicker';
import { TaskBreakdownSheet } from './TaskBreakdownSheet';
import { DeliverablePromptSheet } from './DeliverablePromptSheet';
import { PressableScale } from './PressableScale';
import { usePaintSelectionRow } from './PaintSelection';
import { SelectionDot } from './SelectionDot';
import { SwipeableRow } from './SwipeableRow';
import { SortableList } from './SortableList';
import { StepMinutes } from './StepMinutes';
import { SpotlightScrim, useSpotlightLinger } from './SpotlightOverlay';
import { ProgressBar } from './ProgressBar';

const CHECKBOX_SIZE = 20;
const SUBTASK_CHECKBOX_SIZE = 16;
// Peak scale of the completion circle's pop bounce (see circleScale below).
// The checkmark glyph nested inside that circle needs to counter-scale by the
// inverse of this so it never gets rendered past its native rasterized size.
const CIRCLE_POP_SCALE = 1.35;
// How long the meter takes to run up to the brim on the unit that meets the
// target. Slower than a logged unit (duration.fast) — this rise is the payoff,
// and the pop that follows it waits this out.
const QUOTA_TOPPING_MS = animation.duration.normal;
// How long a daily-target row stays on Today after a logged unit put it back on
// pace. The point is the burst: four glasses of water drunk at once are four
// taps in one place, rather than one tap here and three more from Later once
// the row has gone. Every further tap pushes this out again, so the window is
// the gap between taps, not a budget for the whole burst.
const QUOTA_LINGER_MS = 4000;

// The daily-target meter's level as a 0–1 fraction of the target. Exported so
// the Logbook can fill its own circle to the same proportion rather than
// collapsing progress to a static dash.
export const quotaFraction = (task: Task) =>
  task.targetCount ? Math.min(1, task.progressCount / task.targetCount) : 0;

interface Props {
  task: Task;
  // The row hands its own id back to these rather than the caller closing over
  // it. That lets a list pass one `useCallback` shared by every row instead of
  // a fresh arrow per row per render, which is what makes the memo below
  // actually hold (see the handlers in TodayScreen). Callers that don't need
  // the id can keep ignoring it — a zero-argument arrow still satisfies these.
  onPress: (id: string) => void;
  onEdit?: (id: string) => void;
  expanded?: boolean;
  subtaskCount?: number;
  subtaskDoneCount?: number;
  subtasks?: Task[];
  drag?: () => void;
  isActive?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onSwipeSelect?: (id: string) => void;
  spotlightDisabled?: boolean;
  showCategory?: boolean;
  showProject?: boolean;
  showGroup?: boolean;
  /**
   * Shows when the task is scheduled, as a meta chip. For lists whose rows are
   * dated all over the place and have no section header saying so — a
   * project's own screen, where the rows are in the project's own order rather
   * than by date. Today's list needs nothing (every row is today) and Later's
   * rows sit under a date header already.
   *
   * A row with no date of its own renders no chip: "not scheduled" is the
   * default state of most of a project, and captioning it would put a chip on
   * nearly every row (the same call tripMarkerFor makes about silence).
   */
  showDate?: boolean;
  showActions?: boolean;
  /** Narrower than `showActions`: drops just the row's pin button, for lists where pinning (a Today concept) doesn't apply but the link and timer actions still do. */
  showPin?: boolean;
  /**
   * Marks this as a *second* row for a task that also renders somewhere else in
   * the same list — Today's pinned block, which shows a copy of each pinned
   * task while the original stays in its category section.
   *
   * All it does is keep the copy out of the paint-select registry, which is
   * keyed by task id: two rows registering the same id means the second
   * overwrites the first, and whichever unmounts first then evicts a row that
   * is still on screen. Exactly the hazard the drag overlay's floating copy
   * already opts out of. Everything else about the copy is a normal row — it
   * completes, swipes and selects like the original, because it *is* the
   * original task.
   */
  duplicateRow?: boolean;
  /** Extra left indent for a group's expanded children, so they read as nested under the group header rather than as ordinary top-level rows. */
  indented?: boolean;
  /** Briefly tints the row to draw the eye to it — a task that was just created, or one jumped to from the new-todos banner. */
  highlighted?: boolean;
  /** Plays the same checkbox-tap complete animation as a real tap, then completes the task — used for a completion that happened in the Today widget so the user can watch it happen here too. */
  autoComplete?: boolean;
  /**
   * Fires true/false around a drag of the row's inline subtask list. The
   * enclosing list has to switch its own `scrollEnabled` off for the duration:
   * a native scroll view only stands down for a JS responder that is one of
   * its *ancestors*, and `SortableList`'s lives below it, so without this the
   * scroll claims the touch on the first finger move and the row is put
   * straight back down. Must be stable across renders (a `useState` setter is
   * ideal) or the memo below stops holding.
   */
  onSubtaskDragStateChange?: (dragging: boolean) => void;
  /** True where the list drops a row the moment it stops being visible — i.e. Today's own list, and only for rows it holds on visibility (a pinned row stays whether or not it's due). Logging a unit that puts a daily target back on pace does exactly that, so the row plays itself out before it goes instead of blinking away mid-tap. */
  hidesWhenOnPace?: boolean;
  /** Accept the schedule an Apple Reminders import parsed but hasn't applied (see Task.pendingImport). Omitted where the suggestion should only be readable — the chip renders either way, and is inert without these. */
  onApplyImport?: (id: string) => void;
  /** Drop that suggestion and leave the task as dictated. */
  onDismissImport?: (id: string) => void;
  /** This row's place in its project's order, shown as a leading step number. Only passed by a sequential project's own screen, where the order is the instruction rather than a preference. */
  stepNumber?: number | null;
  /** Held back by an earlier step of a sequential project: the checkbox becomes a lock and completing is refused, the same way a recurrence that isn't due yet refuses. */
  locked?: boolean;
}

/**
 * Memoized: a task list re-renders its rows on every store mutation, and
 * without this each of those renders is O(all rows) rather than O(the rows
 * that actually changed) — most visible while paint-selecting, where a drag
 * down the column of selection dots mutates the selection on every frame.
 *
 * The shallow prop compare this relies on is only as good as its callers.
 * Every handler passed in has to be stable across renders (`useCallback`) and
 * `subtasks` has to keep its identity — see NO_SUBTASKS and the memoized
 * handlers in TodayScreen. A fresh `[]` or a fresh arrow per render defeats
 * the compare silently: the row still works, it just goes back to re-rendering
 * every time.
 */
export const TaskItem = React.memo(function TaskItem({
  task,
  onPress,
  onEdit,
  expanded = false,
  subtaskCount = 0,
  subtaskDoneCount = 0,
  subtasks = [],
  drag,
  isActive = false,
  selectionMode = false,
  selected = false,
  onSelect,
  onSwipeSelect,
  spotlightDisabled = false,
  showCategory = false,
  showProject = false,
  showGroup = false,
  showDate = false,
  showActions = true,
  showPin = true,
  duplicateRow = false,
  indented = false,
  highlighted = false,
  autoComplete = false,
  hidesWhenOnPace = false,
  onApplyImport,
  onDismissImport,
  onSubtaskDragStateChange,
  stepNumber = null,
  locked = false,
}: Props) {
  const categoryEmoji = useCategoryStore(s => task.category ? s.getCategoryByName(task.category)?.emoji ?? null : null);
  const projectTitle = useProjectStore(s => task.projectId ? s.getProjectById(task.projectId)?.title ?? null : null);
  const groupTitle = useTaskGroupStore(s => task.groupId ? s.getGroupById(task.groupId)?.title ?? null : null);
  // The set's other dates still to come (see Task.seriesId), preformatted so
  // the selector returns a plain string — a fresh array here would re-render
  // every row on every store change. Subscribed rather than read once, so
  // finishing or adding a date updates the line.
  const otherSeriesDates = useTaskStore(s =>
    task.seriesId
      ? s.tasks
          .filter(t => t.seriesId === task.seriesId && t.id !== task.id && !t.completed && !t.archived && t.dueDate)
          .map(t => t.dueDate!)
          .sort()
          .map(iso => formatScheduledDate(iso))
          .join(', ')
      : ''
  );
  // Action functions are built once by the store and never replaced, so
  // reading them via getState() here is safe even though it skips the
  // subscription — there is no update to these references to miss, and
  // TaskItem is mounted once per row, not re-created per render.
  const {
    completeTask,
    uncompleteTask,
    beginCompletionAnimation,
    cancelCompletionAnimation,
    logQuotaUnit,
    unlogQuotaUnit,
    holdQuotaOnToday,
    releaseQuotaHold,
    updateTask,
    setLastAction,
    markTaskSeen,
    markMissed,
    togglePin,
    startTimer,
    stopTimer,
    discardTimer,
    pauseTimer,
    resetTimer,
    setMeasuredTime,
    toggleSubtask,
    deleteSubtask,
    reorderSubtasks,
    duplicateTask,
  } = useTaskStore.getState();
  const handleOpenLink = async () => {
    if (!task.linkUrl) return;
    haptics.tap();
    // A link this app owns (dundundun://groceries) navigates in place. Going
    // out through Linking would come back to us anyway, but as an app-switch
    // round trip that flashes.
    if (openInAppUrl(task.linkUrl)) return;
    try {
      // Skip Linking.canOpenURL: on iOS it only returns true for schemes
      // pre-declared in LSApplicationQueriesSchemes, which would break both
      // the preset chips and arbitrary user-entered custom schemes. openURL
      // itself isn't restricted — it just fails harmlessly if nothing
      // handles the scheme.
      await Linking.openURL(task.linkUrl);
    } catch {
      // silently ignore — no toast infra for this row-level action
    }
  };
  // Sanitised here rather than at save time, so the row keeps showing the
  // number the way it was written (see utils/phone.ts). Null means the field
  // holds nothing a dialler could use, and the button doesn't render at all.
  const callUrl = telUrl(task.phoneNumber);
  const textUrl = smsUrl(task.phoneNumber);
  const handleCall = async () => {
    if (!callUrl) return;
    haptics.tap();
    try {
      // Same reasoning as the link button: no canOpenURL check. tel: needs no
      // LSApplicationQueriesSchemes entry, and on a device with no phone (an
      // iPad) openURL simply does nothing rather than throwing.
      await Linking.openURL(callUrl);
    } catch {
      // silently ignore — no toast infra for this row-level action
    }
  };
  const handleText = async () => {
    if (!textUrl) return;
    haptics.tap();
    try {
      // Same reasoning as handleCall — sms: needs no
      // LSApplicationQueriesSchemes entry either.
      await Linking.openURL(textUrl);
    } catch {
      // silently ignore — no toast infra for this row-level action
    }
  };
  // Same sanitise-at-render, null-hides-the-button pattern as callUrl above.
  const emailUrl = mailtoUrl(task.emailAddress);
  /**
   * Both actions live behind one button, so the choice moves to a prompt.
   * Titled with the number itself — it's the thing being acted on, and it's
   * the last chance to notice it's the wrong one before a call starts.
   */
  const handleContact = () => {
    if (!callUrl) return;
    haptics.tap();
    Alert.alert(
      task.phoneNumber ?? '',
      undefined,
      [
        { text: 'Call', onPress: handleCall },
        ...(textUrl ? [{ text: 'Message', onPress: handleText }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  const handleEmail = async () => {
    if (!emailUrl) return;
    haptics.tap();
    try {
      // Same reasoning as call/link: no canOpenURL check needed for mailto:.
      await Linking.openURL(emailUrl);
    } catch {
      // silently ignore — no toast infra for this row-level action
    }
  };
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const [showWhenPicker, setShowWhenPicker] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showDeliverablePrompt, setShowDeliverablePrompt] = useState(false);
  // The postpone prompt's "Break it up…" needs somewhere to send the user. With
  // a key it's the AI sheet; without one it falls back to the editor, where the
  // subtask field is. A row that can't do either (no onEdit) offers no pill.
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const canBreakUp = !!anthropicApiKey || !!onEdit;
  const handleBreakUp = () => {
    setShowWhenPicker(false);
    if (anthropicApiKey) setShowBreakdown(true);
    else onEdit?.(task.id);
  };
  // Elsewhere in the app a TaskItem only ever mounts for a task that's still
  // incomplete — completing it live is the only way `completing` becomes
  // true, so it's always paired with an in-flight animation. Calendar breaks
  // that assumption on purpose (a day's list has to show what was already
  // done that day), so this seeds true for a task handed in already
  // completed — otherwise the checkbox rendered an empty circle for a task
  // the store already has marked done. `completingRef` (below) stays false
  // in that case, which is what tells the tap handler apart: no animation is
  // in flight to cancel, so a tap has to reverse the real completion instead.
  const [completing, setCompleting] = useState(task.completed);
  // A completion that started from the daily-target meter rather than the
  // checkbox: the row keeps its meter for the animation instead of swapping in
  // a checkmark, and `toppedOut` marks the moment the fill reaches the brim.
  const [quotaCompleting, setQuotaCompleting] = useState(false);
  const [quotaToppedOut, setQuotaToppedOut] = useState(false);
  // The other way a daily target leaves Today: the logged unit didn't meet the
  // target, it just put the task back on pace, so the row is about to stop
  // being visible until the next unit falls due. Same send-off, minus the
  // green — nothing was finished. It plays when the tapping stops rather than
  // on the tap itself; `quotaSettled` is the window in between, where the row
  // is on borrowed time (it says when it's back) but still logs a tap.
  const [pacingOut, setPacingOut] = useState(false);
  const pacingOutRef = useRef(false);
  const [quotaSettled, setQuotaSettled] = useState(false);
  const quotaHeldRef = useRef(false);
  const quotaSendOffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [subtaskTitleEdit, setSubtaskTitleEdit] = useState('');
  // Correcting the time the stopwatch recorded. The draft is separate from the
  // stored value so an abandoned edit leaves it alone, and separate from the
  // open flag because clearing the field is a real state (null = nothing to
  // save yet), not a closed editor.
  const [editingTimed, setEditingTimed] = useState(false);
  const [timedDraft, setTimedDraft] = useState<number | null>(null);
  // Whether the row's chain summary is showing every step instead of just the
  // current/next truncated line — see chainStepPreview.
  const [chainStepsExpanded, setChainStepsExpanded] = useState(false);
  // Natural height of the expansion panel content, measured off-screen so the
  // expansion can animate to the real height instead of an arbitrary cap.
  const [panelHeight, setPanelHeight] = useState(0);
  // Drives the live-counting timer display. We only re-render on a 1s tick while
  // this task's timer is actually running, so idle rows never spin an interval.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const timerRunning = task.timerStartedAt !== null;
  const completingRef = useRef(false);
  const completeAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const circleScale = useRef(new Animated.Value(1)).current;
  // A row can mount already completed — Calendar keeps completed rows in its
  // day list, where every other screen filters them out before TaskItem ever
  // sees them (see the note on `completing` below). Starting the glyph's
  // scale at rest rather than 0 is what keeps the checkmark from mounting
  // invisible on those rows.
  const checkScale = useRef(new Animated.Value(task.completed ? 1 : 0)).current;
  // Counter-scales the checkmark glyph against circleScale's pop, so the
  // glyph's rendered size never exceeds its native rasterized size even
  // while the circle around it balloons to CIRCLE_POP_SCALE.
  const checkGlyphCounterScale = circleScale.interpolate({
    inputRange: [1, CIRCLE_POP_SCALE],
    outputRange: [1, 1 / CIRCLE_POP_SCALE],
    extrapolate: 'clamp',
  });
  const rowOpacity = useRef(new Animated.Value(1)).current;
  // The daily-target meter's level, 0–1. An Animated.Value rather than a height
  // computed straight from progressCount so a logged unit slides up instead of
  // jumping, and so the unit that meets the target can run the fill all the way
  // to the brim — that top-out is this row's completion animation, standing in
  // for the checkmark (see handleComplete).
  const quotaFill = useRef(new Animated.Value(quotaFraction(task))).current;
  // Washes the fill from accent to green over the last of that rise, so the
  // meter lands on the colour every other completion ends on.
  const quotaDone = useRef(new Animated.Value(0)).current;
  // Takes the whole row away — fade and height together — once the burst it
  // belongs to has settled, instead of sitting there for the rest of
  // completeTask's completionHoldIds window (see useTaskStore). The store says
  // *when* (completionCollapseIds), not this row: tap four tasks and all four
  // leave in one frame, rather than each leaving whenever that row's own
  // animation happened to finish, which staggered the list into a cascade in
  // tap order. Runs on the UI thread for the same reason the expand panel below
  // does: a JS-driven height change stutters once other rows have to re-layout
  // under it.
  const collapseProgress = useSharedValue(1);
  const collapseStartedRef = useRef(false);
  // This row played its own completion animation and is waiting for the batch,
  // as opposed to one completed elsewhere (a swipe, the bulk bar, the editor):
  // those never played the tick, so taking them away like this would yank a row
  // that never announced itself. It holds its slot — checked, still fully
  // visible — for as long as the tapping goes on, and stops taking touches while
  // it waits: the completion is committed by then, so the row's own tap handler
  // (handleUndoComplete) would uncheck something it can no longer take back.
  const [awaitingCollapse, setAwaitingCollapse] = useState(false);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  // Remounts the collapse wrapper below, for a row that has to come back after
  // it already collapsed (see restoreFromCompletion). Putting collapseProgress
  // back to 1 is not enough on its own: above 1 the animated style stops
  // returning `height` and `opacity` at all, and Reanimated only ever applies
  // the keys an updater *does* return — so the zeroes committed on the
  // collapse's last frame stay on the native view, exactly the trap
  // AnimatedCollapsible's header describes. A freshly mounted view carries none
  // of it, and this path is rare enough to afford one.
  const [collapseGeneration, setCollapseGeneration] = useState(0);
  // Tints the row briefly so the user can tell which one is being pointed at.
  // Seeded at full strength for a row that mounts already flagged (a task that
  // was just created), so it can't paint one frame untinted before the effect
  // below runs; a row already on screen when the flag arrives (a jump from the
  // new-todos banner) is re-armed there.
  const highlightOpacity = useRef(new Animated.Value(highlighted && !reduceMotion ? 0.35 : 0)).current;
  // Reanimated (UI-thread) shared value drives the expand/collapse. The panel
  // animates `height`, which forces a re-layout of every row below it on each
  // frame — doing that from a JS-thread Animated.Value stutters once the list
  // is long and the JS thread is busy, which is what made the collapse read as
  // two discrete steps. Running it on the UI thread keeps it smooth regardless
  // of how many tasks sit below.
  const expansionProgress = useSharedValue(expanded ? 1 : 0);
  // The spotlighted row stays bright while the rest of the screen dims, and
  // has to keep doing so until the mask has faded back out — dropping the
  // exemption the moment it collapses would flash a scrim over it at full
  // strength and fade *that* out instead.
  //
  // The linger alone isn't enough, because it runs the mask's clock (150ms) and
  // the collapse below runs its own (250ms): the scrim would mount back onto a
  // card that is still shrinking. That mount is what reads as a flash. A newly
  // mounted Animated.View takes its first frame from the *JS* value of the
  // screen's spotlight progress, and that value never moves — the fade is
  // `useNativeDriver: true`, and native-driven animations don't report frames
  // back to JS (see the comment in AnimatedValue.animate) — so the scrim paints
  // once at a stale 0 before the native node connects and overwrites it with
  // the real one. Staying exempt until this row's own collapse has settled puts
  // that mount somewhere both animations have finished, where every value
  // agrees and the extra layer is invisible.
  const [collapsing, setCollapsing] = useState(false);
  const wasExpandedRef = useRef(expanded);
  const isSpotlighted = useSpotlightLinger(expanded) || collapsing;
  // Lets a paint-select drag find this row by its on-screen position. A no-op
  // on screens whose list isn't wrapped in a PaintSelectionProvider — and for
  // any duplicate of a row that's already registered (the floating copy of a
  // row being dragged, the pinned block's copy), which would otherwise take the
  // real row's registration with it when it unmounts.
  const paintRowRef = usePaintSelectionRow(isActive || duplicateRow ? null : task.id);
  const titleInputRef = useRef<TextInput>(null);
  const subtaskTitleInputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Only a row coming *down* from expanded has a collapse to wait out; a row
    // that merely mounted collapsed must keep drawing its scrim right away, or
    // it would sit undimmed under a mask that is already up.
    if (!expanded && wasExpandedRef.current) setCollapsing(true);
    wasExpandedRef.current = expanded;
    // Timing rather than a spring: a spring is underdamped, so it overshoots
    // past 0 on collapse (clamped by the height interpolation), which reads as
    // a jitter at the end. inOut easing accelerates and decelerates so the
    // height change settles as one continuous motion.
    expansionProgress.value = withTiming(
      expanded ? 1 : 0,
      {
        duration: animation.duration.normal,
        easing: Easing.inOut(Easing.cubic),
      },
      // `finished` is false when a re-tap interrupts this animation — the row is
      // expanding again, so it keeps the exemption and the next callback clears it.
      finished => {
        if (finished) runOnJS(setCollapsing)(false);
      },
    );
  }, [expanded]);

  // Height interpolates to the measured panel height; opacity fades only in the
  // first sliver next to the closed state, so the bulk of the motion is a clean
  // height change rather than a half-duration cross-fade overlapping the shrink
  // (the latter is what made collapse look like two separate phases).
  const expandedPanelStyle = useAnimatedStyle(() => ({
    height: interpolate(expansionProgress.value, [0, 1], [0, panelHeight], Extrapolation.CLAMP),
    opacity: interpolate(expansionProgress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  // Left at `{}` (auto height, untouched opacity) until a completion actually
  // starts collapsing the row — locking in `rowHeight` any earlier would clip
  // normal content changes (expanding notes, adding subtasks, etc).
  //
  // The fade lives here, with the height, rather than at the end of each tap's
  // own animation. Running it per tap is what kept the cascade visible after
  // the gaps themselves were batched: the row the user tapped first blinked out
  // on its own clock, the second a beat later, and by the time the batch closed
  // the gaps there was nothing left to see leaving. Opacity leads the height a
  // little so the row is gone before its last few points of height are, instead
  // of shrinking to a visible sliver.
  const collapseStyle = useAnimatedStyle(() => {
    if (collapseProgress.value >= 1) return {};
    const opacity = interpolate(collapseProgress.value, [0.3, 1], [0, 1], Extrapolation.CLAMP);
    if (rowHeight === null) return { opacity };
    return {
      height: interpolate(collapseProgress.value, [0, 1], [0, rowHeight], Extrapolation.CLAMP),
      opacity,
      overflow: 'hidden' as const,
    };
  });

  const handleItemLayout = (e: LayoutChangeEvent) => {
    // Same guard as the panel's, and it matters more here: this is the whole
    // row, so it re-measures on every frame of its own panel animation.
    if (collapseStartedRef.current || !e.nativeEvent?.layout) return;
    // Read the height now, synchronously, rather than inside the updater
    // below: `setRowHeight`'s functional form only *schedules* that function,
    // and React can call it later, during a subsequent render, once this
    // event has already returned — RN recycles the event object after the
    // handler that received it returns, so `e.nativeEvent` reads back null by
    // then. A crash from exactly that showed up in production with a stack
    // through useState's reducer, not through this callback.
    const height = e.nativeEvent.layout.height;
    setRowHeight(prev => nextMeasuredHeight(prev, height));
  };

  // The store flips this on for every row of a burst in the same commit, which
  // is what makes their gaps close together. A plain boolean, so a row only
  // re-renders when its *own* completion is the one being called in.
  const collapseSignal = useTaskStore(s => s.completionCollapseIds.includes(task.id));
  useEffect(() => {
    if (!collapseSignal || !awaitingCollapse) return;
    setAwaitingCollapse(false);
    collapseStartedRef.current = true;
    collapseProgress.value = withTiming(0, {
      duration: animation.duration.normal,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [collapseSignal, awaitingCollapse]);

  // The completion can be taken back while the row is still here — shake-to-undo
  // reaches it for the whole hold, and a Logbook/bulk uncomplete can land inside
  // it too. The row is staying, so it has to drop the completed look it was
  // holding rather than sit there checked and inert, and if the batch already
  // came for it, get its height and opacity back as well.
  //
  // Keyed on leaving the hold rather than on task.completed, which reads false
  // for a *held* completion too (withHeldCompletions masks it), and on the
  // transition rather than the bare value, so the effect can't fire on the frame
  // between setAwaitingCollapse and the hold this row is about to join.
  const heldForCompletion = useTaskStore(s => s.completionHoldIds.includes(task.id));
  const wasHeldRef = useRef(false);
  useEffect(() => {
    const leftHold = wasHeldRef.current && !heldForCompletion;
    wasHeldRef.current = heldForCompletion;
    // collapseStartedRef as well as awaitingCollapse: the batch clears that flag
    // the moment it calls the collapse in, so for the rest of the hold — most of
    // it — the ref is the only thing still saying this row played a completion.
    // That later window is also the one where the row has already gone to zero,
    // which is the state an undo has to reach into and can't be left in: an
    // invisible zero-height row that nothing on screen accounts for. Under a
    // stack it reads as the stack expanding to nothing, since TaskGroupHeader's
    // tally counts the roster rather than what is rendered — "5/6" over a tray
    // holding nothing but its own padding.
    if (!leftHold || !(awaitingCollapse || collapseStartedRef.current)) return;
    // Read the row out of the store rather than trusting the prop: the ordinary
    // way to leave the hold is for it to expire, which leaves the task completed
    // and this row on its way out of the list. Restoring that one would flash it
    // back in for the frame before it unmounts.
    const current = useTaskStore.getState().tasks.find(t => t.id === task.id);
    if (!current || current.completed) return;
    restoreFromCompletion(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldForCompletion, awaitingCollapse]);

  // A row unmounted mid-animation (screen change, filter change) never reaches
  // completeTask, so it has to let the batch go — otherwise the collapse it was
  // waiting on would never be called and the other rows would sit invisible
  // until the hold unmounted them.
  useEffect(() => () => {
    if (completingRef.current) cancelCompletionAnimation(task.id);
  }, []);

  useEffect(() => {
    if (isActive) {
      haptics.impactMedium();
    }
  }, [isActive]);

  useEffect(() => {
    if (!highlighted || reduceMotion) return;
    highlightOpacity.setValue(0.35);
    Animated.timing(highlightOpacity, {
      toValue: 0,
      duration: animation.duration.slow,
      delay: 350,
      useNativeDriver: true,
    }).start();
  }, [highlighted]);

  // Tick once a second only while this task's timer runs, so the elapsed clock
  // updates live without keeping an interval alive on every idle row.
  useEffect(() => {
    if (!timerRunning) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timerRunning, task.timerStartedAt]);

  const elapsedSeconds = timerRunning
    ? Math.max(0, (nowTick - new Date(task.timerStartedAt as string).getTime()) / 1000)
    : 0;

  // Countdown state for timed tasks ("play violin for 15 minutes"). Everything
  // is recomputed from the stored fields against nowTick rather than counted
  // down in state, so a row that mounts after the app was backgrounded — or
  // killed — shows the truth rather than a stale number.
  //
  // `parentId` gates it because a subtask carries `timedMinutes` to mean its
  // stretch of its parent's run (see utils/timerSegments.ts), not a countdown
  // of its own — and a subtask does surface as a row of its own in Search,
  // where a second start button for the same session would be two timers on
  // one task.
  const timed = isTimedTask(task) && task.parentId === null;
  const remainingSeconds = timed ? timerRemaining(task, nowTick) : 0;
  const countdownProgress = timed ? timerProgress(task, nowTick) : 0;
  const timerReady = timed && remainingSeconds <= 0;
  // Part-way through but not running. The chip shows what's left rather than the
  // full target, so a task paused at 5 of 15 minutes doesn't read as untouched.
  const timerPaused = timed && !timerRunning && task.timerElapsedSeconds > 0;

  // One day of the weekly meal-plan nudge (#1585): how many of that day's three
  // meals are planned, and whether that's all of them.
  //
  // `undefined` is a real third answer and is why this isn't `?? 0` — the count
  // is a snapshot of days something has asked about (see `plannedSlotCounts`),
  // so a nudge row rendered before the first refresh, or on a screen that
  // doesn't run one, has no number rather than a zero. Showing 0/3 there would
  // be the app claiming an empty week it hasn't looked at.
  const nudgeDayKey = mealPlanNudgeDayKey(task);
  const plannedMeals = useMealPlanStore(s =>
    nudgeDayKey ? s.plannedSlotCounts[nudgeDayKey] : undefined
  );
  // Ready is a nudge, not a gate: the day being fully planned is the app's
  // observation, and the tick box stays exactly as tappable at 0/3 as at 3/3
  // (see mealPlanNudge.ts on why nothing here completes a task by itself).
  const mealPlanReady =
    plannedMeals !== undefined && plannedMeals >= MEAL_PLAN_NUDGE_SLOT_COUNT && !task.completed;

  // A quiet project's review task: how long the project has actually been
  // silent, which is what the banner this replaced showed beside each name.
  //
  // Both selectors return a primitive or one row, so every non-review task —
  // which is all of them, nearly always — pays one null check and re-renders
  // no more often than it did. The task-list pass runs only for the handful of
  // rows that are review tasks (three at most, see MAX_PROJECT_REVIEW_TASKS),
  // and only its *result* is subscribed to, so a task changing elsewhere in
  // the list doesn't re-render this row unless the day count itself moved.
  const reviewProjectId = projectReviewProjectId(task);
  const reviewProject = useProjectStore(s =>
    reviewProjectId ? s.projects.find(p => p.id === reviewProjectId) ?? null : null
  );
  const quietDays = useTaskStore(s =>
    reviewProjectId
      ? projectQuietDays(reviewProject, s.tasks.filter(t => t.projectId === reviewProjectId))
      : null
  );

  // The stretches the subtasks split the countdown into, and which one the
  // clock is in. Empty for a timed task nobody apportioned, which is what keeps
  // every existing one rendering exactly as before.
  const segments = useMemo(
    () => (timed ? timerSegments(subtasks) : []),
    [timed, subtasks],
  );
  const timerElapsedNow = segments.length > 0 ? timerElapsed(task, nowTick) : 0;
  const liveSegment = segments.length > 0 ? activeSegment(segments, timerElapsedNow) : null;

  // Announce the finish once per run while the row is on screen. The scheduled
  // notification covers the backgrounded case; this is just the in-app nudge.
  const announcedReadyRef = useRef(false);
  useEffect(() => {
    if (!timed || task.completed) return;
    if (remainingSeconds > 0) {
      announcedReadyRef.current = false;
      return;
    }
    if (announcedReadyRef.current) return;
    announcedReadyRef.current = true;
    // Only celebrate a finish we actually watched happen — not every mount of
    // a row whose timer ran out at some point in the past.
    if (timerRunning) haptics.success();
  }, [timed, timerRunning, remainingSeconds > 0, task.completed]);

  const handleTimerToggle = async () => {
    if (timerRunning) {
      await haptics.success();
      // A countdown pauses (banking its progress) rather than finishing and
      // logging — that only happens when the task is completed.
      if (timed) pauseTimer(task.id);
      else stopTimer(task.id);
    } else {
      await haptics.impactMedium();
      startTimer(task.id);
    }
  };

  const handleResetTimer = async () => {
    await haptics.warning();
    resetTimer(task.id);
  };

  const handleDiscardTimer = () => {
    Alert.alert(
      'Discard Timer',
      `Discard the running timer for "${task.title}"? The elapsed time won't be saved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await haptics.warning();
            discardTimer(task.id);
          },
        },
      ]
    );
  };

  // Save and dismiss keyboard whenever the task collapses while title is being edited
  useEffect(() => {
    if (!expanded && isEditingTitle) {
      const trimmed = titleEdit.trim();
      if (trimmed && trimmed !== task.title) {
        updateTask(task.id, { title: trimmed });
      }
      setIsEditingTitle(false);
      Keyboard.dismiss();
    }
  }, [expanded, isEditingTitle]);

  // A time correction is abandoned by collapsing, not saved — unlike the title
  // above, which is a field you were already committed to editing. Reopening
  // the row shows the stored number again rather than a stale draft.
  useEffect(() => {
    if (!expanded && editingTimed) setEditingTimed(false);
  }, [expanded, editingTimed]);

  // Everything below this line that consults the wall clock — the window
  // state, the deadline countdown and its colour, the "N left" text in the
  // expanded panel, the relative due-date label — is computed during render
  // and so is only as fresh as the last render. This row is memoized, which
  // means a passing minute is not by itself a reason for it to re-render;
  // subscribing to the shared heartbeat makes it one. Nothing reads the
  // returned timestamp: the re-render *is* the effect (see nowTick.ts).
  useNowTick();

  const priorityColor = PRIORITY_COLORS[task.priority];
  const windowActive = isTaskWindowActive(task);
  const windowExpired = isTaskExpired(task);
  // Not task.windowEnd: a window that runs into the small hours has no closing
  // time on this day, so there's no countdown to show (see effectiveWindowEnd).
  const windowEnd = effectiveWindowEnd(task);
  const deadlineDays = task.deadline ? getDeadlineCountdown(task.deadline) : null;
  const deadlineColor =
    deadlineDays === null ? colors.textTertiary
    : deadlineDays < 0 ? colors.red
    : deadlineDays <= 2 ? colors.orange
    : colors.textTertiary;
  const isNew = isTaskNew(task);

  const handleContentPress = () => {
    if (isNew) markTaskSeen(task.id);
    if (selectionMode) { onSelect?.(task.id); } else { onPress(task.id); }
  };
  // A recurring task showing early in Later (its day hasn't arrived yet)
  // can't be completed ahead of schedule — see isRecurrenceNotYetDue.
  const recurrenceNotYetDue = isRecurrenceNotYetDue(task);
  // The two reasons this row's checkbox refuses a tap. They read the same to
  // the finger — an error haptic and nothing happening — and differ only in
  // what the circle shows and what it says out loud, so everything that just
  // needs "can this be ticked" asks this one.
  const completionLocked = recurrenceNotYetDue || locked;

  // A decision task asks for a value on the way out (see Task.deliverableKind),
  // so its box carries a "?" instead of sitting empty — the tap is about to
  // open a sheet rather than just tick, and the control that behaves
  // differently is where that belongs. Never while it's completing or locked:
  // those states own the glyph, and both outrank "this one will ask".
  const asksOnComplete = asksOnCompletion(task) && !task.completed;

  // A quota task is logged a unit at a time rather than ticked off once, so
  // its circle becomes a fill meter and a tap logs one glass/rep/page instead
  // of completing — except the last one, which completes for real.
  const isQuota = isQuotaTask(task) && !task.completed;
  // A daily target closed out short of its count (rollover, or an explicit
  // miss) is still `completed`, but a plain checkmark would read as the same
  // full finish an on-target row gets — same distinction Logbook's row draws
  // (isQuotaPartial). Only ever true for a row that mounted already completed:
  // a live completion always forces progressCount up to target (see
  // completeTask), so this can't turn true mid-animation on this row.
  const quotaPartial = isQuotaPartial(task);
  // The completion send-off holds the store back until the row is gone, so the
  // count is read forward for the length of the animation — otherwise the chip
  // still says 7/8 while the meter runs up to the brim. A logged unit needs no
  // such reading: it lands in the store on the tap.
  const quotaLogged = quotaCompleting ? task.targetCount! : task.progressCount;
  const quotaProgress = isQuota
    ? formatQuotaProgress(quotaLogged, task.targetCount!, task.targetUnit)
    : '';
  // When the next unit falls due. Shown for as long as the row is on borrowed
  // time on Today (quotaSettled), and *always* once the task has actually
  // dropped into on-pace/hidden territory (isOnPaceQuota) — that's the same
  // row rendered in Later's Today section, where a partial target ("5/12
  // cups") would otherwise say nothing about when it comes back. Each tap
  // moves it later, being one more logged.
  const quotaReturnAt = quotaSettled || isOnPaceQuota(task)
    ? formatHHMM(dateToHHMM(quotaNextDueAt(task)))
    : '';
  // A completion that came from the meter keeps it — the fill topping out *is*
  // that row's animation. Bulk selection doesn't take it away either: the row
  // says what it always said, and the selection lives on its own control at the
  // trailing edge (see SelectionDot).
  const showQuotaMeter = isQuota && (!completing || quotaCompleting);
  // Shown but no longer a meter to tap: once the run-up starts, the control
  // does what a completing row's checkbox does — undo. Nor while selecting,
  // where every tap on the row means "pick this one".
  const meterInteractive = showQuotaMeter && !completing && !pacingOut && !selectionMode;

  // Opt-in per task (TaskEditor → "Show streak on row"). Shown at zero too, so
  // a habit whose streak just broke doesn't silently lose a chip — the row
  // keeps its height and reads as "back to nothing" rather than "untracked".
  const showStreakChip = task.showStreak && task.recurrenceType !== 'none';

  // Both read through the blocker index rather than scanning the task list, so
  // a long list stays O(1) per row. The selector still runs on every store
  // change, but returns a primitive, so an unchanged count doesn't re-render.
  const waitingCount = useTaskStore(() => waitingCountFor(task.id));
  const blockerTitle = useTaskStore(() => {
    if (!task.blockedById) return undefined;
    const blocker = resolveBlocker(task.blockedById);
    // displayTitleFor, not .title — a chained blocker is named by its active
    // step everywhere else, and this chip shouldn't be the one surface that
    // disagrees.
    return blocker ? displayTitleFor(blocker) : undefined;
  });

  const activeChainItem =
    task.chainEnabled && task.chainItems.length > 0
      ? task.chainItems[task.chainIndex % task.chainItems.length]
      : null;
  // A multi-step chain drives the row's title (collapsed and expanded alike,
  // plus its accessibility label — see displayTitleFor) with a compact
  // step-count badge beside it, instead of a second subtitle line, so the
  // row stays the same height as the others.
  const chainStep = activeChainItem && task.chainItems.length > 1 ? activeChainItem : null;
  const chainStepIndex = task.chainItems.length > 0 ? task.chainIndex % task.chainItems.length : 0;
  const chainPosition = chainStep ? `${chainStepIndex + 1}/${task.chainItems.length}` : '';
  const displayTitle = activeChainStepTitle(task) ?? task.title;
  // Computed once and reused by the expandable step list (#1237) and the row's
  // step-forward/back controls (#786) — same reasoning as chainStepIndex above.
  const chainStepPreview = chainStep ? chainPreview(task) : null;

  const hasExpandContent =
    task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none' || activeChainItem !== null ||
    otherSeriesDates !== '';

  // The stamp outlives the date it explains — that's what lets the drip read a
  // cleared one as "not today" (see Task.autoScheduledAt) — so the chip asks
  // for both. A stamp with no date is a refusal, not a provenance note, and a
  // completed row is history: neither has anything left to explain.
  const autoScheduled = task.autoScheduledAt !== null && task.dueDate !== null && !task.completed;

  // The row's own date, for a list that doesn't say so anywhere else (see
  // showDate). getEffectiveTaskDate is the same "which of the two dates is the
  // one that matters" rule the expanded row's date button reads, so the chip
  // and the button can't name different days. A deferred date is a different
  // fact from a due one — the task isn't there yet — so it takes the eye-off
  // glyph and says so out loud to a screen reader.
  const scheduledIso = showDate ? getEffectiveTaskDate(task) : null;
  const scheduledHidden = scheduledIso !== null && scheduledIso === task.deferUntil && scheduledIso !== task.dueDate;

  // Self-gating: only an Apple Reminders import ever sets pendingImport, and it
  // clears the moment the suggestion is taken or dropped — so nothing else has
  // to decide whether this row is the kind that shows one.
  const importSuggestion = useMemo(
    () => describePendingImport(task.pendingImport),
    [task.pendingImport]
  );

  const handleApplyImport = () => {
    haptics.success();
    // The task is about to gain a date or a repeat, which is exactly what stops
    // it satisfying isInboxTask — so this row is leaving the list it's in.
    animateLayout();
    onApplyImport?.(task.id);
  };

  const handleDismissImport = () => {
    haptics.tap();
    // The row stays put and only loses its chip, but that still changes its
    // height, so the rows below it should slide rather than jump.
    animateLayout();
    onDismissImport?.(task.id);
  };

  /**
   * The completion itself, once there's nothing left to ask.
   *
   * `deliverableValue` is threaded through rather than written first because
   * the store's completion is what stamps it onto the row, and a separate
   * write would leave a window where the task is answered but not done.
   */
  const runCompletion = async (deliverableValue?: string | null) => {
    if (completingRef.current || pacingOutRef.current) return;
    if (isNew) markTaskSeen(task.id);
    // A quota row completes through its meter — the last unit tops the fill
    // out to the brim first, since that's what the row has been doing all
    // along — but it still ends on the same checkmark every other completion
    // does; see the delayed checkScale spring below. Any completion of a row
    // that's currently showing a meter takes this path, the widget's included.
    const viaMeter = isQuota;
    // The unit that meets the target can land inside a linger window (log the
    // seventh, then the eighth). The completion owns the row from here, so the
    // send-off queued behind that seventh unit must not fire over it — the hold
    // itself is given back at the end, once completeTask has taken over.
    if (quotaSendOffRef.current) {
      clearTimeout(quotaSendOffRef.current);
      quotaSendOffRef.current = null;
    }
    completingRef.current = true;
    // Told up front, not at the end: the batched collapse holds for a row that
    // is still animating, so tapping the next task keeps the previous one's gap
    // open even though it finished a moment ago.
    beginCompletionAnimation(task.id);
    await (isChainFinish(task) ? haptics.chainFinish() : haptics.success());
    setCompleting(true);
    setQuotaCompleting(viaMeter);
    // Checkmark springs in while the circle pops, then the row fades to
    // invisible but keeps its place in the list — completeTask holds it
    // there (see useTaskStore's completionHoldIds) so completing several
    // tasks in a row doesn't reflow the list after every tap. The row only
    // collapses once the whole burst has landed, alongside every other row in
    // it (completionCollapseIds). The task isn't actually marked complete in
    // the store until this sequence finishes, so a tap during the window
    // (handleUndoComplete) can cancel it outright.
    if (viaMeter) {
      // Runs alongside the sequence below rather than inside it, because the
      // ring can only go green once the fill has covered it — and a mid-
      // sequence animation has no callback of its own to hang that on. The
      // sequence waits the same span out with a matching delay.
      Animated.parallel([
        Animated.timing(quotaFill, { toValue: 1, duration: QUOTA_TOPPING_MS, useNativeDriver: false }),
        // Held back so most of the rise is still the meter's own colour and the
        // green arrives with the brim — washing it in from the start just makes
        // the level look muddy on the way up.
        Animated.timing(quotaDone, { toValue: 1, duration: QUOTA_TOPPING_MS * 0.45, delay: QUOTA_TOPPING_MS * 0.55, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (finished) setQuotaToppedOut(true);
      });
    }
    // The checkmark itself always plays, on every completion — a target that
    // reaches its count is a completion like any other and should look like
    // one. For a meter row it's delayed until the fill has finished rising,
    // so it pops in at the same moment the circle does (see the sequence
    // below, which delays its own pop by the same span) rather than
    // appearing on top of a still-rising level.
    checkScale.setValue(0);
    Animated.spring(checkScale, {
      toValue: 1,
      delay: viaMeter ? QUOTA_TOPPING_MS : 0,
      ...animation.spring.bouncy,
      useNativeDriver: true,
    }).start();
    const sequence = Animated.sequence([
      ...(viaMeter ? [Animated.delay(QUOTA_TOPPING_MS)] : []),
      Animated.spring(circleScale, { toValue: CIRCLE_POP_SCALE, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.spring(circleScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.delay(120),
    ]);
    completeAnimRef.current = sequence;
    sequence.start(({ finished }) => {
      completeAnimRef.current = null;
      if (!finished) return;
      completingRef.current = false;
      // Leaves the row checked and fully visible, holding its slot: the send-off
      // is the batched collapse (see the collapseSignal effect above), which
      // fades and closes every row of the burst at once. The completed look has
      // to be held for that whole wait — dropping it here would show a green
      // tick flicking back to an empty circle on a row that is on its way out,
      // since the store masks a held completion as incomplete (see
      // withHeldCompletions) and the row would render as ordinary work again.
      setAwaitingCollapse(true);
      completeTask(task.id, deliverableValue !== undefined ? { deliverableValue } : undefined);
      endQuotaHold();
    });
  };

  const handleComplete = async () => {
    if (completingRef.current || pacingOutRef.current) return;
    if (completionLocked) {
      await haptics.error();
      return;
    }
    // The question comes before the animation, not after it: the row has to
    // still be there to cancel back to. Answering (or explicitly skipping)
    // then runs the ordinary completion, so nothing downstream — the hold, the
    // batched collapse, the recurrence — learns about deliverables at all.
    if (asksOnComplete) {
      await haptics.tap();
      setShowDeliverablePrompt(true);
      return;
    }
    await runCompletion();
  };

  // Every change to the count — a tap here, the long-press undo, the shake
  // undo, a fresh occurrence at zero — slides the fill to its new level from
  // this one place, so nothing has to remember to animate it. The completion
  // run-up owns the value while it's playing and is left alone.
  useEffect(() => {
    if (!isQuota || completingRef.current || pacingOutRef.current) return;
    const level = quotaFraction(task);
    if (reduceMotion) { quotaFill.setValue(level); return; }
    Animated.timing(quotaFill, {
      toValue: level,
      duration: animation.duration.fast,
      useNativeDriver: false,
    }).start();
  }, [isQuota, task.progressCount, task.targetCount, reduceMotion]);

  // One tap on the meter logs one unit. The unit that reaches the target runs
  // the normal completion path instead, so the last glass of the day gets the
  // same pop-hold-and-fade every other completion gets — with the fill running
  // up to the brim in place of the checkmark (and the store hands off to
  // completeTask for the recurrence/streak bookkeeping).
  const handleQuotaTap = async () => {
    if (completingRef.current || pacingOutRef.current) return;
    if (completionLocked) {
      await haptics.error();
      return;
    }
    // allowOvershoot tasks skip the auto-complete at target: logging past it
    // just keeps incrementing progressCount like any unit below target, and
    // the task rides out the day for the rollover sweep to complete (see
    // sweepOvershootQuotas in useTaskStore.ts).
    if (!task.allowOvershoot && task.progressCount + 1 >= task.targetCount!) {
      handleComplete();
      return;
    }
    if (isNew) markTaskSeen(task.id);
    await haptics.impactLight();
    circleScale.setValue(1);
    Animated.sequence([
      Animated.spring(circleScale, { toValue: 1.25, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.spring(circleScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
    ]).start();
    // Most units leave the row where it is (it was already behind pace, and one
    // unit didn't catch it up), and those are just the pop — the effect above
    // slides the fill as the count lands.
    //
    // This one puts the task back on pace, so Today is done with it. Letting it
    // go on this tap is what capped a burst at one unit: four glasses drunk at
    // once meant logging one here and the other three from Later, because the
    // row was gone before the second tap. So the store is asked to keep it
    // (holdQuotaOnToday), the chip says when it's due back, and the send-off
    // waits for the tapping to stop — every further tap pushes it out again.
    if (hidesWhenOnPace && (quotaHeldRef.current || quotaLeavesTodayAfterLog(task))) {
      if (!quotaHeldRef.current) {
        quotaHeldRef.current = true;
        setQuotaSettled(true);
        // Before the log, so the row is pinned by the time the pace gate closes
        // on it and it never drops out of visibleTasks between the two.
        holdQuotaOnToday(task.id);
      }
      scheduleQuotaSendOff();
    }
    logQuotaUnit(task.id);
  };

  // Pushed out by every tap; when it finally lapses the row plays the beats a
  // completion gets — hold, fade, collapse — minus the green, because nothing
  // was finished.
  const scheduleQuotaSendOff = () => {
    if (quotaSendOffRef.current) clearTimeout(quotaSendOffRef.current);
    quotaSendOffRef.current = setTimeout(() => runQuotaSendOff(), QUOTA_LINGER_MS);
  };

  // Giving the hold back is what actually takes the row off Today, so nothing
  // else may call it while the send-off is still playing.
  const endQuotaHold = () => {
    if (quotaSendOffRef.current) {
      clearTimeout(quotaSendOffRef.current);
      quotaSendOffRef.current = null;
    }
    if (!quotaHeldRef.current) return;
    quotaHeldRef.current = false;
    setQuotaSettled(false);
    releaseQuotaHold(task.id);
  };

  const runQuotaSendOff = () => {
    quotaSendOffRef.current = null;
    // Read through the store rather than the render's `task`: the whole point
    // of the window is that the count changed during it. A row that's due again
    // by now — the long-press undo took a unit back, or enough of the day
    // passed that the next one fell due — isn't going anywhere, so it just
    // gives the hold back and stays put instead of fading in place.
    const current = useTaskStore.getState().tasks.find(t => t.id === task.id);
    if (!current || current.completed || isTaskVisible(current)) {
      endQuotaHold();
      return;
    }
    pacingOutRef.current = true;
    setPacingOut(true);
    Animated.sequence([
      Animated.delay(90),
      Animated.timing(rowOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) return;
      collapseStartedRef.current = true;
      collapseProgress.value = withTiming(
        0,
        { duration: animation.duration.normal, easing: Easing.inOut(Easing.cubic) },
        done => {
          if (done) runOnJS(finishPacingOut)();
        },
      );
    });
  };

  // Releases the hold, then puts the row back on the next frame in case it's
  // still here — releasing only removes it if it's still on pace, and the check
  // above ran a beat earlier. The restore is a no-op when the row does leave
  // (it's unmounted by then); without it, that one row would sit invisible and
  // zero-height until the screen remounted.
  const finishPacingOut = () => {
    endQuotaHold();
    requestAnimationFrame(() => {
      pacingOutRef.current = false;
      setPacingOut(false);
      rowOpacity.setValue(1);
      // Same reason the completion recovery remounts: this collapse committed a
      // height, and winding collapseProgress back doesn't take it off again.
      if (collapseStartedRef.current) setCollapseGeneration(g => g + 1);
      collapseStartedRef.current = false;
      collapseProgress.value = 1;
    });
  };

  // The long-press undo takes a unit back off, which puts the task behind pace
  // and makes it Today's again — so the row isn't leaving any more. Drop the
  // hold on the spot rather than letting the chip keep promising to be back at
  // a time that has stopped meaning anything until the timer catches up.
  useEffect(() => {
    if (!quotaHeldRef.current || pacingOutRef.current || completingRef.current) return;
    if (isTaskVisible(task)) endQuotaHold();
  }, [task]);

  // A row that goes away mid-window — screen change, filter, a bulk action —
  // has to hand the hold back itself, since the release it was going to get is
  // wired to an animation that will never run now.
  useEffect(() => () => {
    if (quotaSendOffRef.current) clearTimeout(quotaSendOffRef.current);
    if (quotaHeldRef.current) useTaskStore.getState().releaseQuotaHold(task.id);
  }, [task.id]);

  // Long-press takes one back off, for the mis-tap — the shake-to-undo path
  // covers it too, but the meter is tapped often enough to want a local undo.
  const handleQuotaUndo = async () => {
    if (task.progressCount === 0) return;
    await haptics.tap();
    unlogQuotaUnit(task.id);
  };

  // Widget checkbox taps queue a completion and open the app (see
  // useWidgetCompletionStore) rather than completing the task directly, so
  // that when Today mounts with this task still incomplete, the user sees
  // the same pop-checkmark-and-fade animation a real tap gets instead of the
  // row just silently vanishing.
  useEffect(() => {
    if (autoComplete) handleComplete();
  }, [autoComplete]);

  // Takes back the beats handleComplete played, and nothing else — no store
  // calls — so both the in-flight cancel below and the after-the-fact recovery
  // above can put the row back the same way.
  const restoreFromCompletion = (current: Task) => {
    completeAnimRef.current?.stop();
    completeAnimRef.current = null;
    completingRef.current = false;
    checkScale.setValue(0);
    circleScale.setValue(1);
    rowOpacity.setValue(1);
    // setValue stops the run-up mid-rise, so the meter drops back to the level
    // the store still has it at — the last unit was never logged.
    quotaFill.setValue(quotaFraction(current));
    quotaDone.setValue(0);
    setQuotaCompleting(false);
    setQuotaToppedOut(false);
    setCompleting(false);
    setAwaitingCollapse(false);
    // Only when a collapse actually committed a height and an opacity —
    // cancelling in flight (the path below), or an undo that beats the batch to
    // the row, never gets that far and shouldn't pay for a remount.
    if (collapseStartedRef.current) setCollapseGeneration(g => g + 1);
    collapseStartedRef.current = false;
    collapseProgress.value = 1;
  };

  const handleUndoComplete = async () => {
    // Stopped before the await, not inside restoreFromCompletion: the
    // sequence's own callback is otherwise free to land during it and complete
    // the task after all.
    completeAnimRef.current?.stop();
    completeAnimRef.current = null;
    completingRef.current = false;
    // Nothing was completed, so the batch shouldn't keep waiting on this row.
    cancelCompletionAnimation(task.id);
    await haptics.tap();
    restoreFromCompletion(task);
  };

  // The counterpart for a row that mounted already completed (or whose
  // completion animation already handed off to the store — see the
  // `completingRef` check at the tap site): there's no local animation left
  // to cancel, so the only way back is the real store undo, the same one
  // Logbook's checkbox uses.
  const handleUncompletePersisted = async () => {
    await haptics.tap();
    uncompleteTask(task.id);
  };

  const handleTitleTap = () => {
    if (selectionMode) { onSelect?.(task.id); return; }
    setTitleEdit(task.title);
    setIsEditingTitle(true);
  };

  const saveTitle = () => {
    setIsEditingTitle(false);
    const trimmed = titleEdit.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask(task.id, { title: trimmed });
    }
  };

  const handleSubtaskTitleTap = (sub: Task) => {
    setSubtaskTitleEdit(sub.title);
    setEditingSubtaskId(sub.id);
  };

  const saveSubtaskTitle = (sub: Task) => {
    setEditingSubtaskId(null);
    const trimmed = subtaskTitleEdit.trim();
    if (trimmed && trimmed !== sub.title) {
      updateTask(sub.id, { title: trimmed });
    }
  };

  const rowBody = (
    <View style={[styles.row, isActive && styles.rowActive]}>
      {task.priority > 0 && (
        <View style={[styles.priorityBar, { backgroundColor: priorityColor }]} />
      )}

      <TouchableOpacity
        onPress={
          selectionMode ? () => onSelect?.(task.id)
          : completing ? (completingRef.current ? handleUndoComplete : handleUncompletePersisted)
          : showQuotaMeter ? handleQuotaTap
          : handleComplete
        }
        onLongPress={meterInteractive ? handleQuotaUndo : undefined}
        delayLongPress={interaction.delayLongPress}
        // The circle is 20pt in a 24pt box, so it needs most of this to reach a
        // 44pt target. Left covers the whole leading gutter out to the card edge
        // (marginLeft is spacing.md, and the row clips hit-testing at its own
        // bounds, so more than 16 is wasted); right covers the flex gap to the
        // content column — which only works because `content` below drops its own
        // left slop. It's the later sibling, so hit-testing reaches it first and
        // whatever it claims on this side is taken out of the checkbox.
        hitSlop={{ top: 12, bottom: 12, left: spacing.md, right: 12 }}
        style={styles.circleWrapper}
        // A meter isn't binary, so it's a button rather than a checkbox — until
        // it tops out, at which point the row is completing and the control is
        // the same "tap to undo" every other completing row offers.
        accessibilityRole={meterInteractive ? 'button' : 'checkbox'}
        accessibilityState={
          meterInteractive
            ? { disabled: completionLocked }
            : {
                checked: selectionMode ? selected : completing,
                disabled: !selectionMode && completionLocked,
              }
        }
        accessibilityLabel={
          selectionMode
            ? (selected ? `Deselect ${task.title}` : `Select ${task.title}`)
            : locked
              ? `${task.title}, waiting for the step before it`
            : recurrenceNotYetDue
              ? `${task.title}, not due yet`
              : completing
                ? `Undo complete ${task.title}`
                : meterInteractive
                  ? `Log one of ${task.targetCount}${task.targetUnit ? ` ${task.targetUnit}` : ''}, ${quotaProgress} done, ${task.title}`
                  : timerReady
                    ? `${task.title}, timer done, complete`
                    : mealPlanReady
                      ? `${task.title}, all ${MEAL_PLAN_NUDGE_SLOT_COUNT} meals planned, complete`
                    : asksOnComplete
                      ? `Complete ${task.title}, asks for an answer`
                      : `Complete ${task.title}`
        }
        accessibilityHint={meterInteractive && task.progressCount > 0 ? 'Double tap and hold to take one back' : undefined}
      >
        {/* Bulk selection deliberately changes nothing about this circle: it's
            the completion checkbox in both modes, and a row that's been picked
            for a bulk edit shouldn't read as a row that's been ticked off. The
            selection state lives on SelectionDot at the row's other end. */}
        <Animated.View style={[
          styles.circle,
          completing && !quotaCompleting && !quotaPartial && styles.circleCompleting,
          completionLocked && styles.circleLocked,
          // Ready is a nudge, not a lock — the checkbox stays tappable either way.
          // The meal-plan nudge's full day borrows the same treatment on purpose:
          // green already means done-or-ready on this row, and a second colour
          // for a second kind of "you can tick this now" would be teaching the
          // reader two vocabularies for one idea.
          !completing && !completionLocked && (timerReady || mealPlanReady) && styles.circleReady,
          (showQuotaMeter || quotaPartial) && styles.circleQuota,
          // The ring can only follow the fill once the fill has reached it —
          // swapped rather than animated because this node's transform is on
          // the native driver, and a JS-driven colour on the same node throws.
          quotaToppedOut && styles.circleQuotaDone,
          { transform: [{ scale: circleScale }] },
        ]}>
          {showQuotaMeter && (
            <Animated.View
              style={[
                styles.quotaFill,
                {
                  height: quotaFill.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                    extrapolate: 'clamp',
                  }),
                  backgroundColor: quotaDone.interpolate({
                    inputRange: [0, 1],
                    outputRange: [colors.accent, colors.green],
                  }),
                },
              ]}
              pointerEvents="none"
            />
          )}
          {/* Same partial-fill treatment as Logbook/Search's rows, painted at
              rest rather than animated — this is a row that mounted already
              completed (Calendar's day list), not a live meter run. */}
          {!showQuotaMeter && quotaPartial && (
            <View
              style={[styles.quotaFill, { height: `${Math.round(quotaFraction(task) * 100)}%`, backgroundColor: colors.accent }]}
              pointerEvents="none"
            />
          )}
          {/* Absolutely positioned over the circle (which centers its children)
              so the glyph sits on top of the quota fill rather than being laid
              out beside it. */}
          <View pointerEvents="none" style={styles.circleContentLayer}>
            {completing && !quotaPartial && (
              // The spring (animation.spring.bouncy) overshoots past 1 for the pop
              // feel, but animating a native-driven `scale` transform on an Ionicons
              // glyph scales the already-rasterized bitmap up rather than
              // re-rendering it, so an uncapped overshoot is visibly pixelated.
              // Clamping the *visual* scale at 1 keeps the glyph rendered at its
              // native 12pt size — crisp at rest — while the transform only ever
              // shrinks it on the way in, never enlarges it. This view sits inside
              // the circle's own pop (circleScale, up to CIRCLE_POP_SCALE), which
              // would otherwise stretch the same rasterized glyph further still —
              // checkGlyphCounterScale cancels exactly that.
              <Animated.View style={{
                transform: [
                  { scale: checkScale.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) },
                  { scale: checkGlyphCounterScale },
                ],
              }}>
                <Ionicons name="checkmark" size={12} color={colors.onAccent} />
              </Animated.View>
            )}
            {!completing && recurrenceNotYetDue && (
              <Ionicons name="repeat" size={iconSize.sm} color={colors.textTertiary} />
            )}
            {!completing && !recurrenceNotYetDue && locked && (
              <Ionicons name="lock-closed" size={iconSize.xs} color={colors.textTertiary} />
            )}
            {!completing && !completionLocked && asksOnComplete && (
              // xs like the lock, not sm like the repeat: a "?" is tall where
              // the repeat glyph is wide and short, so the same nominal size
              // fills far more of a 20pt box and reads as crowded.
              <Ionicons name="help" size={iconSize.xs} color={colors.textTertiary} />
            )}
          </View>
        </Animated.View>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.content}
        onPress={handleContentPress}
        onLongPress={drag}
        delayLongPress={interaction.delayLongPress}
        activeOpacity={interaction.activeOpacity}
        // Content only hugs its text height, leaving the row's own vertical
        // padding and the trailing flex gap untappable — this slop extends the
        // hit target out to cover that dead space so the whole card row
        // responds, not just the text itself. Deliberately 0 on the left: the
        // gap on that side belongs to the checkbox, and any slop here silently
        // wins it back (later sibling, so hit-testing reaches this first).
        hitSlop={{ top: 14, bottom: 14, left: 0, right: 10 }}
        accessibilityRole={selectionMode ? 'checkbox' : 'button'}
        accessibilityState={selectionMode ? { checked: selected } : { expanded }}
        accessibilityLabel={displayTitle}
        accessibilityHint={
          selectionMode
            ? undefined
            : expanded
              ? 'Double tap to collapse details'
              : 'Double tap to expand details'
        }
      >
        {isEditingTitle ? (
          <TextInput
            ref={titleInputRef}
            style={styles.titleInput}
            value={titleEdit}
            onChangeText={setTitleEdit}
            onBlur={saveTitle}
            onSubmitEditing={saveTitle}
            returnKeyType="done"
            maxLength={TITLE_MAX_LENGTH}
            blurOnSubmit
            autoFocus
          />
        ) : (
          <View style={styles.titleRow}>
            {isNew && <View style={styles.newDot} />}
            {stepNumber !== null && (
              // The order *is* the instruction in a sequential project, so it's
              // written down rather than left implied by row position — and the
              // step that's actually open is the one tinted.
              <Text style={[styles.stepNumber, !locked && styles.stepNumberOpen]}>
                {stepNumber}
              </Text>
            )}
            {expanded ? (
              // Only tappable for edit when already expanded — avoids intercepting expand taps.
              // Editing always edits the task's own title, not the chain step's
              // (handleTitleTap/saveTitle), even though the displayed text here
              // is the step's while one is active — matching the collapsed row.
              <TouchableOpacity style={styles.titleFlex} onPress={handleTitleTap} activeOpacity={interaction.activeOpacity} hitSlop={8}>
                <Text style={styles.title} numberOfLines={2}>{displayTitle}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.title, styles.titleFlex, locked && styles.titleLocked]} numberOfLines={2} ellipsizeMode="tail">
                {displayTitle}
              </Text>
            )}
            {chainStep && (
              <View style={styles.chainBadge}>
                <Ionicons name="git-commit" size={9} color={colors.accent} />
                <Text style={styles.chainBadgeText}>{chainPosition}</Text>
              </View>
            )}
            {deadlineDays !== null && (
              <View
                style={styles.deadlineBadge}
                accessibilityLabel={
                  deadlineDays < 0
                    ? `Deadline was ${formatDeadlineDate(task.deadline!)}`
                    : `Deadline ${formatDeadlineDate(task.deadline!)}`
                }
              >
                <Ionicons name="flag" size={9} color={deadlineColor} />
                <Text style={[styles.deadlineBadgeText, { color: deadlineColor }]} numberOfLines={1}>
                  {formatDeadlineDate(task.deadline!)}
                </Text>
              </View>
            )}
          </View>
        )}
        {(isQuota || timed || plannedMeals !== undefined || quietDays !== null || windowActive || windowExpired || showStreakChip || waitingCount > 0 || !!blockerTitle || autoScheduled || scheduledIso !== null || (showGroup && groupTitle) || (showProject && projectTitle) || (showCategory && task.category) || subtaskCount > 0 || task.notes.length > 0) && (
          <View style={styles.metaRow}>
            {/* Leads the meta line: on the screens that ask for it, "when" is
                what the row is being read for, and every other chip here
                describes the task rather than placing it. */}
            {scheduledIso !== null && (
              <View
                style={styles.metaChip}
                accessibilityLabel={
                  scheduledHidden
                    ? `Hidden until ${formatScheduledDate(scheduledIso)}`
                    : `Scheduled for ${formatScheduledDate(scheduledIso)}`
                }
              >
                <Ionicons
                  name={scheduledHidden ? 'eye-off-outline' : 'calendar-outline'}
                  size={iconSize.xs}
                  color={colors.textTertiary}
                />
                <Text style={styles.scheduledLabel} numberOfLines={1}>
                  {formatScheduledDate(scheduledIso)}
                </Text>
              </View>
            )}
            {/* What this task is holding back — the only place the queue is
                visible from a list, since the waiters themselves are hidden. */}
            {waitingCount > 0 && (
              <View
                style={styles.metaChip}
                accessibilityLabel={`${waitingCount} ${waitingCount === 1 ? 'task is' : 'tasks are'} waiting on this`}
              >
                <Ionicons name="hourglass-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.blockingLabel} numberOfLines={1}>
                  {waitingCount} waiting
                </Text>
              </View>
            )}
            {/* The other side of the same relationship. Only reachable where a
                blocked task is still listed — Search, and a project's own screen. */}
            {!!blockerTitle && (
              <View style={styles.metaChip} accessibilityLabel={`Waiting on ${blockerTitle}`}>
                <Ionicons name="hourglass" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.blockingLabel} numberOfLines={1}>
                  After {blockerTitle}
                </Text>
              </View>
            )}
            {showStreakChip && (
              <View
                style={[styles.metaChip, styles.streakChip]}
                accessibilityLabel={
                  task.streakCount > 0
                    ? `${task.streakCount} day streak`
                    : 'No streak yet'
                }
              >
                <Ionicons
                  name={task.streakCount > 0 ? 'flame' : 'flame-outline'}
                  size={iconSize.xs}
                  color={task.streakCount > 0 ? colors.orange : colors.textTertiary}
                />
                <Text style={[styles.streakChipText, task.streakCount > 0 && styles.streakChipTextActive]} numberOfLines={1}>
                  {task.streakCount}
                </Text>
              </View>
            )}
            {isQuota && (
              <View style={styles.metaChip}>
                <Ionicons name="speedometer-outline" size={iconSize.xs} color={colors.accent} />
                <Text style={styles.quotaLabel} numberOfLines={1}>
                  {quotaProgress}{quotaReturnAt ? ` · next at ${quotaReturnAt}` : ''}
                </Text>
              </View>
            )}
            {timed && (
              <View
                style={styles.metaChip}
                accessibilityLabel={
                  timerReady
                    ? 'Timer done, ready to complete'
                    : timerRunning
                      ? `${formatStopwatch(remainingSeconds)} left${liveSegment ? `, on ${liveSegment.title}` : ''}`
                      : timerPaused
                        ? `Timer paused, ${formatStopwatch(remainingSeconds)} left${liveSegment ? `, on ${liveSegment.title}` : ''}`
                        : `Timed, ${formatDuration(task.timedMinutes!)}${liveSegment ? `, starting with ${liveSegment.title}` : ''}`
                }
              >
                <Ionicons
                  name={timerReady ? 'checkmark-circle' : timerPaused ? 'pause' : timerRunning ? 'timer' : 'timer-outline'}
                  size={iconSize.xs}
                  color={timerReady ? colors.green : timerRunning ? colors.accent : colors.textTertiary}
                />
                <Text
                  style={[
                    styles.countdownLabel,
                    timerReady && styles.countdownLabelReady,
                    !timerReady && timerRunning && styles.countdownLabelRunning,
                  ]}
                  numberOfLines={1}
                >
                  {timerReady
                    ? 'Ready'
                    : timerRunning || timerPaused
                      ? formatStopwatch(remainingSeconds)
                      : formatDuration(task.timedMinutes!)}
                </Text>
                {/* Which stretch of the run you're on. It's on the collapsed row
                    rather than only in the panel below because that's the whole
                    use for apportioning one — knowing to move on to the new
                    piece is no help if it takes a tap to find out. */}
                {liveSegment && !timerReady && (
                  <Text style={styles.countdownSegment} numberOfLines={1}>
                    · {liveSegment.title}
                  </Text>
                )}
              </View>
            )}
            {/* One day of the weekly meal-plan nudge: how much of that day is
                planned. Sits with the other counters rather than replacing the
                title, because the day itself is the title and this is its
                state. Green at 3/3 is the same "ready" the timer's chip uses. */}
            {plannedMeals !== undefined && (
              <View
                style={styles.metaChip}
                accessibilityLabel={
                  mealPlanReady
                    ? `All ${MEAL_PLAN_NUDGE_SLOT_COUNT} meals planned, ready to complete`
                    : `${plannedMeals} of ${MEAL_PLAN_NUDGE_SLOT_COUNT} meals planned`
                }
              >
                <Ionicons
                  name={mealPlanReady ? 'checkmark-circle' : 'restaurant-outline'}
                  size={iconSize.xs}
                  color={mealPlanReady ? colors.green : colors.textTertiary}
                />
                <Text
                  style={[styles.plannedMealsLabel, mealPlanReady && styles.plannedMealsLabelReady]}
                  numberOfLines={1}
                >
                  {plannedMeals}/{MEAL_PLAN_NUDGE_SLOT_COUNT} planned
                </Text>
              </View>
            )}
            {/* How long this project has been silent — the one thing the
                quiet-projects banner said that the row's own title doesn't.
                Tertiary and unhurried on purpose: it's the reason the offer
                exists, not an alarm about it, and the whole point of moving
                this into the list was to stop it demanding attention. */}
            {quietDays !== null && (
              <View style={styles.metaChip}>
                <Ionicons name="hourglass-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.quietLabel} numberOfLines={1}>
                  {describeProjectQuiet(quietDays)}
                </Text>
              </View>
            )}
            {windowActive && windowEnd && (
              <View style={styles.metaChip}>
                <Ionicons name="time" size={iconSize.xs} color={colors.red} />
                <Text style={styles.windowLabel} numberOfLines={1}>
                  {formatWindowRemaining(windowEnd)}
                </Text>
              </View>
            )}
            {!windowActive && windowExpired && (
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.windowLabelExpired} numberOfLines={1}>
                  Expired at {formatHHMM(task.windowEnd!)}
                </Text>
              </View>
            )}
            {showGroup && groupTitle && (
              <View style={styles.metaChip}>
                <Ionicons name="layers-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.groupLabel} numberOfLines={1}>{groupTitle}</Text>
              </View>
            )}
            {/* The app dated this one, not the user (see Task.autoScheduledAt).
                Its own chip rather than a variant of the project chip beside
                it: that one answers "which project", this one answers "who put
                this on my day", and folding them together made a row that had
                been filed under a project by hand look auto-scheduled too.
                Same icon as the project's "Keep it moving" toggle, so the row
                points at the setting that caused it. */}
            {autoScheduled && (
              <View
                style={styles.metaChip}
                accessibilityLabel={
                  projectTitle
                    ? `Scheduled for you, because ${projectTitle} had gone quiet`
                    : 'Scheduled for you, because this project had gone quiet'
                }
              >
                <Ionicons name="play-forward-outline" size={iconSize.xs} color={colors.accent} />
                <Text style={styles.autoScheduledLabel} numberOfLines={1}>Scheduled for you</Text>
              </View>
            )}
            {showProject && projectTitle && (
              <View style={styles.metaChip}>
                <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.projectLabel} numberOfLines={1}>{projectTitle}</Text>
              </View>
            )}
            {showCategory && task.category && (
              <View style={styles.metaChip}>
                <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.categoryLabel} numberOfLines={1}>
                  {categoryEmoji ? `${categoryEmoji} ${task.category}` : task.category}
                </Text>
              </View>
            )}
            {subtaskCount > 0 && (
              <View
                style={styles.metaChip}
                accessibilityLabel={`${subtaskDoneCount} of ${subtaskCount} subtasks done`}
              >
                <Ionicons name="list-outline" size={9} color={colors.textTertiary} />
                <Text style={styles.subtaskBadgeText} numberOfLines={1}>{subtaskDoneCount}/{subtaskCount}</Text>
              </View>
            )}
            {/* Notes only render once a row is expanded, so the collapsed row
                otherwise gives no hint they exist. Icon-only, no text: this is
                the quiet option (vs. a truncated preview line), matching how
                little it needs to say — "there's something here" — against
                the row-height cost a preview would add to every task with a
                note. */}
            {task.notes.length > 0 && (
              <View style={styles.metaChip} accessibilityLabel="Has notes">
                <Ionicons name="document-text-outline" size={iconSize.xs} color={colors.textTertiary} />
              </View>
            )}
          </View>
        )}
        {/* What an Apple Reminders import read off the reminder but hasn't
            applied. It's an offer, not a state: the row is still bare
            underneath, which is the only reason the task is sitting in the
            Inbox to be looked at rather than already filed onto Today.

            Deliberately the same bargain quick add's parse tooltip strikes —
            here is what I think you meant, tap to take it — because it is the
            same act, and the phrase came from the same parser. Hidden while
            selecting: a bulk selection is about the rows, and a stray tap on
            an inline control mid-drag would schedule something. */}
        {!selectionMode && importSuggestion && (
          <View style={styles.importRow}>
            <PressableScale
              style={styles.importChip}
              onPress={handleApplyImport}
              accessibilityLabel={`Set ${importSuggestion} for ${displayTitle}`}
              accessibilityHint="Applies what the reminder said and files this task"
            >
              <Ionicons name="sparkles-outline" size={iconSize.xs} color={colors.accent} />
              {/* No "tap to set" hint beside this, deliberately. The two
                  together overflow a 390pt row on any real recurrence label
                  ("Every Mon, Wed & Fri · reminder"), and what gets truncated
                  is the schedule — the one thing the user has to be able to
                  read before agreeing to it. The tinted pill and the × next to
                  it already read as an offer with two answers; the wording
                  lives in accessibilityHint, where it costs no width. */}
              <Text style={styles.importChipText} numberOfLines={1}>{importSuggestion}</Text>
            </PressableScale>
            <PressableScale
              style={styles.importDismiss}
              onPress={handleDismissImport}
              hitSlop={8}
              accessibilityLabel={`Dismiss the suggested ${importSuggestion} for ${displayTitle}`}
            >
              <Ionicons name="close" size={iconSize.xs} color={colors.textTertiary} />
            </PressableScale>
          </View>
        )}
      </TouchableOpacity>

      {/* Starting the countdown is the whole point of a timed task, so the
          control sits on the row rather than only inside the expanded panel —
          the chip in the meta line reports the time, this starts and pauses it.
          It's gone once the countdown has run out: there is nothing left to run
          and the next tap is the checkbox. Reset/discard stay in the panel;
          they're the rarer, more destructive half. */}
      {!selectionMode && showActions && timed && !completing && !task.completed && !(timerReady && !timerRunning) && (
        <TouchableOpacity
          onPress={handleTimerToggle}
          hitSlop={8}
          style={[styles.rowTimerBtn, timerRunning && styles.rowTimerBtnRunning]}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={
            timerRunning ? `Pause timer for ${task.title}` : `Start timer for ${task.title}`
          }
          accessibilityValue={{ text: formatStopwatch(remainingSeconds) }}
        >
          <Ionicons
            name={timerRunning ? 'pause' : 'play'}
            size={iconSize.sm}
            // The play triangle's bounding box is wider than its ink, so it
            // reads left-of-centre in a circle without this.
            style={!timerRunning && styles.rowTimerGlyphPlay}
            color={timerRunning ? colors.onAccent : colors.accent}
          />
        </TouchableOpacity>
      )}

      {!selectionMode && showActions && task.linkUrl && (
        <TouchableOpacity
          onPress={handleOpenLink}
          hitSlop={8}
          style={styles.linkBtn}
          accessibilityRole="button"
          accessibilityLabel={`Open link for ${task.title}`}
        >
          <Ionicons name="link" size={iconSize.sm} color={colors.accent} />
        </TouchableOpacity>
      )}

      {/* One button for both, because they're one fact about the task — a
          number you can reach someone on — and the row was spending two of its
          few action slots on the same phone number. Which of call or text you
          want is a per-tap decision, so it's asked per tap. */}
      {!selectionMode && showActions && callUrl && (
        <TouchableOpacity
          onPress={handleContact}
          hitSlop={8}
          style={styles.callBtn}
          accessibilityRole="button"
          accessibilityLabel={`Call or text ${task.phoneNumber} for ${task.title}`}
        >
          {/* Accent, not the iOS phone-app green: in this row green already
              means done (the checkbox) or ready (the timer), and the link and
              timer buttons beside it are what "a control on this row" looks
              like here. The handset glyph is what separates it from the link. */}
          <Ionicons name="call" size={iconSize.sm} color={colors.accent} />
        </TouchableOpacity>
      )}

      {!selectionMode && showActions && emailUrl && (
        <TouchableOpacity
          onPress={handleEmail}
          hitSlop={8}
          style={styles.emailBtn}
          accessibilityRole="button"
          accessibilityLabel={`Email ${task.emailAddress} for ${task.title}`}
        >
          <Ionicons name="mail" size={iconSize.sm} color={colors.accent} />
        </TouchableOpacity>
      )}

      {!selectionMode && showActions && showPin && (
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            togglePin(task.id);
          }}
          hitSlop={8}
          style={styles.pinBtn}
          accessibilityRole="button"
          accessibilityState={{ selected: task.pinned }}
          accessibilityLabel={
            task.pinned ? `Unpin ${task.title}` : `Pin ${task.title}`
          }
        >
          <PinIcon
            filled={task.pinned}
            size={iconSize.sm}
            color={task.pinned ? colors.orange : colors.textTertiary}
          />
        </TouchableOpacity>
      )}

      {/* Takes the slot the row's action buttons vacate on entering selection
          mode, so nothing else has to move aside for it — and it mounts and
          unmounts in the same commit they do, which is what gives it its fade
          (animateLayout in enterSelectionMode/exitSelection). */}
      {selectionMode && (
        <SelectionDot selected={selected} onPress={() => onSelect?.(task.id)} />
      )}

    </View>
  );

  const expandedPanel = (
    <Reanimated.View style={[expandedPanelStyle, styles.expandedPanelClip]}>
      {/* Absolutely positioned so it always lays out at natural height for
          measurement, independent of the animated clipping height above.
          Top-anchored: the growing card uncovers the content in place, and
          cardClip keeps the slice edge's corners rounded. */}
      <View
        style={styles.panelMeasure}
        // Guarded like AnimatedCollapsible's: this feeds the animated height
        // above it, so an accepted measurement costs a React commit — and a
        // pixel-grid rounding difference is not a content change. Unguarded,
        // an expanded row inside a stack commits on every layout pass of the
        // section animating around it.
        onLayout={e => {
          if (!e.nativeEvent?.layout) return;
          // See handleItemLayout above: read now, close over the number, not `e`.
          const height = e.nativeEvent.layout.height;
          setPanelHeight(prev => nextMeasuredHeight(prev, height));
        }}
      >
      <View style={styles.expandedPanel}>
        {!selectionMode && (
          <>
            {task.notes.length > 0 && (
              <Text style={styles.expandNotes}>{task.notes}</Text>
            )}

            {subtasks.length > 0 && (
              <View style={[
                styles.expandSection,
                styles.subtaskSection,
                task.notes.length > 0 && styles.sectionDivider,
              ]}>
                <SortableList
                  onDragStateChange={onSubtaskDragStateChange}
                  data={subtasks}
                  onReorder={(newData) => reorderSubtasks(task.id, newData.map(s => s.id))}
                  renderItem={(sub, i, drag) => {
                    // This subtask's stretch of the countdown, if it was given
                    // one. The clock decides how it reads — the tick box beside
                    // it stays a separate answer to a separate question.
                    const segment = segments.find(s => s.id === sub.id) ?? null;
                    const phase = segment ? segmentPhase(segment, timerElapsedNow) : null;
                    return (
                    <View style={[
                      styles.subtaskRow,
                      i === subtasks.length - 1 && styles.subtaskRowLast,
                    ]}>
                      <TouchableOpacity
                        onPress={() => {
                          haptics.tap();
                          toggleSubtask(sub.id);
                        }}
                        // Same split as the row checkbox above — the gap to the
                        // title is this box's, so the title wrapper runs at 0 on
                        // its left. Vertical stays at 8: the subtask row is only
                        // ~32pt tall and hit-testing clips at its bounds.
                        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: sub.completed }}
                        accessibilityLabel={sub.title}
                      >
                        <View style={[styles.subtaskCheck, sub.completed && styles.subtaskCheckDone]}>
                          {sub.completed && (
                            <Ionicons name="checkmark" size={8} color={colors.onAccent} />
                          )}
                        </View>
                      </TouchableOpacity>
                      {editingSubtaskId === sub.id ? (
                        <TextInput
                          ref={subtaskTitleInputRef}
                          style={styles.subtaskTitleInput}
                          value={subtaskTitleEdit}
                          onChangeText={setSubtaskTitleEdit}
                          onBlur={() => saveSubtaskTitle(sub)}
                          onSubmitEditing={() => saveSubtaskTitle(sub)}
                          returnKeyType="done"
                          maxLength={TITLE_MAX_LENGTH}
                          blurOnSubmit
                          autoFocus
                        />
                      ) : (
                        <TouchableOpacity
                          style={styles.subtaskTitleWrapper}
                          onPress={() => handleSubtaskTitleTap(sub)}
                          activeOpacity={interaction.activeOpacity}
                          hitSlop={{ top: 8, bottom: 8, left: 0, right: 8 }}
                        >
                          <Text style={[
                            styles.subtaskTitle,
                            sub.completed && styles.subtaskTitleDone,
                          ]} numberOfLines={2}>
                            {sub.title}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {segment && (
                        <Text
                          style={[
                            styles.subtaskSegment,
                            phase === 'active' && styles.subtaskSegmentActive,
                            phase === 'done' && styles.subtaskSegmentDone,
                          ]}
                          numberOfLines={1}
                          accessibilityLabel={
                            phase === 'active'
                              ? `${formatStopwatch(segmentRemaining(segment, timerElapsedNow))} left of ${formatDuration(segment.minutes)}`
                              : phase === 'done'
                                ? `${formatDuration(segment.minutes)}, timer past this`
                                : `${formatDuration(segment.minutes)} of the timer`
                          }
                        >
                          {phase === 'active'
                            ? formatStopwatch(segmentRemaining(segment, timerElapsedNow))
                            : formatDuration(segment.minutes)}
                        </Text>
                      )}
                      <TouchableOpacity
                        onLongPress={drag}
                        delayLongPress={interaction.delayLongPress}
                        hitSlop={8}
                        style={styles.subtaskDragHandle}
                        accessibilityLabel={`Reorder ${sub.title}`}
                      >
                        <Ionicons name="reorder-three" size={16} color={colors.textTertiary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          haptics.tap();
                          deleteSubtask(sub.id);
                        }}
                        hitSlop={8}
                        style={styles.subtaskDeleteBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${sub.title}`}
                      >
                        <Ionicons name="close" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                    );
                  }}
                />
              </View>
            )}

            {task.recurrenceType !== 'none' && (
              <View style={[
                styles.recurrenceRow,
                (task.notes.length > 0 || subtasks.length > 0) && styles.sectionDivider,
              ]}>
                <Ionicons name="repeat" size={12} color={colors.textTertiary} />
                <Text style={styles.expandMeta}>{describeTaskRecurrence(task)}</Text>
                {task.streakCount > 0 && (
                  <>
                    <Text style={styles.expandMeta}> · </Text>
                    <View style={styles.streakBadge}>
                      <Ionicons name="flame" size={12} color={colors.orange} />
                      <Text style={styles.expandMeta}>{task.streakCount}</Text>
                    </View>
                  </>
                )}
              </View>
            )}

            {otherSeriesDates !== '' && (
              <View style={[
                styles.recurrenceRow,
                (task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none') && styles.sectionDivider,
              ]}>
                <Ionicons name="calendar-number-outline" size={12} color={colors.textTertiary} />
                <Text style={styles.expandMeta}>Also on {otherSeriesDates}</Text>
              </View>
            )}

            {chainStepPreview && (
              <TouchableOpacity
                style={[
                  styles.recurrenceRow,
                  (task.notes.length > 0 || subtasks.length > 0 || task.recurrenceType !== 'none') && styles.sectionDivider,
                ]}
                onPress={() => { haptics.tap(); setChainStepsExpanded(v => !v); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ expanded: chainStepsExpanded }}
                accessibilityLabel={
                  chainStepsExpanded
                    ? `Collapse the ${chainStepPreview.total}-step chain`
                    : `Show all ${chainStepPreview.total} steps of the chain, currently on ${chainStepPreview.currentTitle}`
                }
              >
                <Ionicons name="git-commit" size={12} color={colors.textTertiary} />
                {chainStepsExpanded ? (
                  <Text style={styles.expandMeta}>
                    Chain · {chainStepPreview.total} steps
                  </Text>
                ) : (
                  <Text style={styles.expandMeta} numberOfLines={1}>
                    Chain {chainStepPreview.currentIdx + 1}/{chainStepPreview.total}:{' '}
                    <Text style={styles.expandMetaActive}>On: {chainStepPreview.currentTitle}</Text>
                    {chainStepPreview.nextTitle ? ` → Next: ${chainStepPreview.nextTitle}` : ''}
                  </Text>
                )}
                <View style={styles.chainExpandSpacer} />
                <Ionicons
                  name={chainStepsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            )}

            {chainStepsExpanded && chainStepPreview && (
              <View style={styles.chainStepsList}>
                {task.chainItems.map((item, i) => {
                  const isDone = i < chainStepIndex;
                  const isCurrent = i === chainStepIndex;
                  return (
                    <View key={item.id} style={styles.chainStepListRow}>
                      <View style={[
                        styles.chainStepListDot,
                        isDone && styles.chainStepListDotDone,
                        isCurrent && styles.chainStepListDotActive,
                      ]}>
                        {isDone ? (
                          <Ionicons name="checkmark" size={9} color={colors.onAccent} />
                        ) : (
                          <Text style={[
                            styles.chainStepListDotText,
                            isCurrent && styles.chainStepListDotTextActive,
                          ]}>
                            {i + 1}
                          </Text>
                        )}
                      </View>
                      <Text style={[
                        styles.chainStepListTitle,
                        isDone && styles.chainStepListTitleDone,
                        isCurrent && styles.chainStepListTitleActive,
                      ]} numberOfLines={2}>
                        {item.title}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {timed && (
              <View style={[
                styles.countdownRow,
                hasExpandContent && styles.sectionDivider,
              ]}>
                <View style={styles.countdownHeader}>
                  <Ionicons
                    name={timerReady ? 'checkmark-circle' : 'timer-outline'}
                    size={12}
                    color={timerReady ? colors.green : colors.textTertiary}
                  />
                  <Text style={styles.expandMeta}>
                    {timerReady
                      ? `Ready to complete · ${formatDuration(task.timedMinutes!)} done`
                      : `${formatStopwatch(remainingSeconds)} left of ${formatDuration(task.timedMinutes!)}`}
                  </Text>
                </View>
                <ProgressBar progress={countdownProgress} height={4} />
              </View>
            )}

            {/* The stopwatch is the only writer of `actualMinutes`, so this
                readout is also the only place a mistimed run can be put right
                — stop it ten minutes late and the number is wrong for good
                otherwise, estimate included (`applyMeasuredTime`). Editing in
                place rather than back in the editor because this is where you
                are when you notice. */}
            {task.actualMinutes != null && (
              <View style={[
                styles.recurrenceRow,
                (hasExpandContent || timed) && styles.sectionDivider,
              ]}>
                <Ionicons name="timer-outline" size={12} color={colors.textTertiary} />
                {editingTimed ? (
                  <>
                    <Text style={styles.expandMeta}>Timed ·</Text>
                    <StepMinutes
                      value={timedDraft}
                      label={task.title}
                      what="Time spent"
                      onChange={setTimedDraft}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        if (timedDraft == null) return;
                        haptics.tap();
                        setMeasuredTime(task.id, timedDraft);
                        setEditingTimed(false);
                      }}
                      disabled={timedDraft == null}
                      hitSlop={8}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`Save time spent on ${task.title}`}
                    >
                      <Text style={[
                        styles.timedEditAction,
                        timedDraft == null && styles.timedEditActionDisabled,
                      ]}>
                        Save
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { haptics.tap(); setEditingTimed(false); }}
                      hitSlop={8}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel editing time spent on ${task.title}`}
                    >
                      <Text style={styles.timedEditCancel}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      haptics.tap();
                      setTimedDraft(task.actualMinutes);
                      setEditingTimed(true);
                    }}
                    hitSlop={8}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Time spent on ${task.title}: ${formatDuration(task.actualMinutes)}. Tap to correct.`}
                  >
                    <Text style={styles.expandMeta}>
                      Timed · {formatDuration(task.actualMinutes)}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {onEdit && (
              <View style={[
                styles.editSection,
                (hasExpandContent || timed || task.actualMinutes != null) && styles.sectionDivider,
              ]}>
                <View style={styles.editSectionLeft}>
                  {showActions && timed && (
                    <View style={styles.timerRunningGroup}>
                      <TouchableOpacity
                        onPress={handleTimerToggle}
                        hitSlop={8}
                        style={[styles.timerPill, timerReady && styles.timerPillReady]}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={
                          timerRunning ? `Pause timer for ${task.title}` : `Start timer for ${task.title}`
                        }
                        accessibilityValue={{ text: formatStopwatch(remainingSeconds) }}
                      >
                        <Ionicons
                          name={timerRunning ? 'pause' : 'play'}
                          size={10}
                          color={colors.onAccent}
                        />
                        <Text style={styles.timerPillText}>{formatStopwatch(remainingSeconds)}</Text>
                      </TouchableOpacity>
                      {(timerRunning || task.timerElapsedSeconds > 0) && (
                        <TouchableOpacity
                          onPress={handleResetTimer}
                          hitSlop={8}
                          style={styles.timerDeleteBtn}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="button"
                          accessibilityLabel={`Reset timer for ${task.title}`}
                        >
                          <Ionicons name="trash-outline" size={iconSize.xs} color={colors.textTertiary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  {showActions && !timed && (
                    timerRunning ? (
                    <View style={styles.timerRunningGroup}>
                      <TouchableOpacity
                        onPress={handleTimerToggle}
                        hitSlop={8}
                        style={styles.timerPill}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Stop timer for ${task.title}`}
                        accessibilityValue={{ text: formatStopwatch(elapsedSeconds) }}
                      >
                        <Ionicons name="stop" size={10} color={colors.onAccent} />
                        <Text style={styles.timerPillText}>{formatStopwatch(elapsedSeconds)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDiscardTimer}
                        hitSlop={8}
                        style={styles.timerDeleteBtn}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Discard timer for ${task.title}`}
                      >
                        <Ionicons name="trash-outline" size={iconSize.xs} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                    ) : (
                    <PressableScale
                      style={styles.iconActionBtn}
                      onPress={handleTimerToggle}
                      hitSlop={8}
                      accessibilityLabel={`Start timer for ${task.title}`}
                    >
                      <Ionicons name="timer-outline" size={iconSize.sm} color={colors.textSecondary} />
                    </PressableScale>
                    )
                  )}
                  {task.recurrenceType !== 'none' && (
                    <PressableScale
                      style={styles.iconActionBtn}
                      onPress={async () => {
                        await haptics.impactMedium();
                        markMissed(task.id);
                        // The task disappears from the list immediately, but nothing
                        // else clears the parent's expanded-row state — collapse it
                        // ourselves so the spotlight overlay doesn't get stuck.
                        if (expanded) onPress(task.id);
                      }}
                      hitSlop={8}
                      // The same control does two things depending on where the
                      // row is showing, and says which: on a row whose day has
                      // come it records a miss, but on one sitting in Later
                      // ahead of its day markMissed degrades to a silent roll
                      // forward, because there is nothing to have missed yet.
                      accessibilityLabel={
                        recurrenceNotYetDue
                          ? `Skip this occurrence of ${task.title}`
                          : `Mark ${task.title} missed and move to the next occurrence`
                      }
                    >
                      <Ionicons name="close-circle-outline" size={iconSize.sm} color={colors.textSecondary} />
                    </PressableScale>
                  )}
                  {chainStep && (
                    <>
                      {/* Chain-position-only moves — no schedule/date math and no
                          completion/streak bookkeeping, unlike markMissed above.
                          Deliberately not routed through skipNextRecurrence: that
                          action is documented as no longer user-facing (see its
                          doc comment in useTaskStore.ts), so this reaches
                          updateTask directly, the same way TaskEditor's own
                          tap-a-dot control does. */}
                      {chainStepIndex > 0 && (
                        <PressableScale
                          style={styles.iconActionBtn}
                          onPress={() => {
                            haptics.tap();
                            updateTask(task.id, { chainIndex: chainStepIndex - 1 });
                          }}
                          hitSlop={8}
                          accessibilityLabel={`Back a step in ${task.title}'s chain`}
                        >
                          <Ionicons name="play-back-outline" size={iconSize.sm} color={colors.textSecondary} />
                        </PressableScale>
                      )}
                      {chainStepIndex < task.chainItems.length - 1 && (
                        <PressableScale
                          style={styles.iconActionBtn}
                          onPress={() => {
                            haptics.tap();
                            updateTask(task.id, { chainIndex: chainStepIndex + 1 });
                          }}
                          hitSlop={8}
                          accessibilityLabel={`Skip to the next step of ${task.title}'s chain, without completing ${chainStepPreview?.currentTitle ?? 'this step'}`}
                        >
                          <Ionicons name="play-forward-outline" size={iconSize.sm} color={colors.textSecondary} />
                        </PressableScale>
                      )}
                    </>
                  )}
                </View>
                <View style={styles.editSectionRight}>
                  <TouchableOpacity
                    style={[styles.editBtn, !task.dueDate && styles.editBtnIconOnly]}
                    onPress={() => setShowWhenPicker(true)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityLabel={task.dueDate ? `Change date, currently ${formatTaskDate(task)}` : 'Set date'}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={iconSize.sm}
                      color={task.dueDate ? colors.accent : colors.textSecondary}
                    />
                    {task.dueDate && (
                      <Text style={styles.editBtnText}>{formatTaskDate(task)}</Text>
                    )}
                  </TouchableOpacity>
                  <PressableScale
                    style={styles.iconActionBtn}
                    onPress={async () => {
                      await haptics.tap();
                      duplicateTask(task.id);
                    }}
                    hitSlop={8}
                    accessibilityLabel="Duplicate task"
                  >
                    <Ionicons name="duplicate-outline" size={iconSize.sm} color={colors.textSecondary} />
                  </PressableScale>
                  <PressableScale
                    style={[styles.iconActionBtn, styles.iconActionBtnAccent]}
                    onPress={() => onEdit(task.id)}
                    hitSlop={8}
                    accessibilityLabel="Edit task"
                  >
                    <Ionicons name="pencil-outline" size={iconSize.sm} color={colors.accent} />
                  </PressableScale>
                </View>
              </View>
            )}
          </>
        )}
      </View>
      </View>
      {/* Continues the urgency bar from the row down through the expanded
          panel, so it reads as one strip along the whole card's left edge
          instead of stopping at the collapsed row's height. Sized against
          this view's own animated height, so it grows/shrinks in lockstep.
          Rendered last so it draws on top of the panel's opaque background. */}
      {task.priority > 0 && (
        <View style={[styles.priorityBarPanel, { backgroundColor: priorityColor }]} />
      )}
    </Reanimated.View>
  );

  return (
    <>
      <Reanimated.View
        // Changes only to force a fresh view when a collapsed row has to come
        // back — see collapseGeneration.
        key={collapseGeneration}
        style={collapseStyle}
        onLayout={handleItemLayout}
        // Checked and holding its slot open for the rest of the burst. The
        // completion is committed by now, so the row's own tap handler would
        // uncheck something it can no longer take back (handleUndoComplete only
        // stands down the animation) — it stops taking touches instead, and
        // shake-to-undo remains the way back.
        pointerEvents={awaitingCollapse ? 'none' : 'auto'}
      >
        <Animated.View
          // The card itself, not the collapse wrapper above it — its frame is
          // exactly the band a finger painting down the list should hit, with
          // the inter-row margins left out.
          ref={paintRowRef}
          style={[
            styles.itemWrapper,
            shadows.card,
            { opacity: isActive ? 1 : rowOpacity },
            isActive && styles.itemWrapperActive,
            expanded && styles.itemWrapperElevated,
            indented && styles.itemWrapperIndented,
          ]}
          // Screens collapse the spotlight on any touch in the list area;
          // touches inside the expanded card must not bubble up to that.
          onTouchEnd={expanded ? e => e.stopPropagation() : undefined}
        >
          {/* Clips the row + panel together as one card. Because this view is
              never shorter than the row, its corner radius never clamps, so
              the card silhouette stays rounded at every animation frame.
              (Separate from itemWrapper: overflow hidden there would clip the
              card shadow on iOS.) */}
          <View style={styles.cardClip}>
          {/* The row is wrapped bare, with no corner radius of its own. It
              slides sideways over the swipe panels, so its leading and
              trailing edges are *interior seams* against a panel whenever one
              is open — not card corners. This wrapper used to carry radius.md
              + overflow:hidden, which rounded them regardless, and the whole
              of the defer button's ragged look came from that: the revealed
              panel met the card across a 12pt notch, and the priority bar
              riding that edge was clipped to a lens that read as a spike torn
              out of the panel rather than as an urgency marker. On a 48pt row
              the notch ate half the bar's height. The same clip pinched the
              bar to nothing where an expanded row meets its panel, breaking
              the strip the two halves are meant to form. cardClip above
              rounds the card at the one place its corners are real.
              SwipeableRow's own clip defaulted to the same radius and kept
              that break alive after this wrapper gave its up; it's
              overflow-only now, and its radius comes from `style`. */}
          {selectionMode ? (
            <View>
              {rowBody}
            </View>
          ) : (
            // SwipeableRow stays mounted regardless of spotlightDisabled —
            // toggling between it and a plain View/Pressable here used to
            // remount rowBody (a different element type at this tree position)
            // every time any other task got tapped, which read as the whole row
            // flashing. Disabling the gesture and overlaying a dismiss-tap
            // Pressable keeps the same tree shape across that toggle.
            //
            // No select panel unless the screen can actually bulk-select: a
            // list without a bulk bar (Demo, say) would otherwise reveal an
            // accent panel whose handler is a no-op.
            <SwipeableRow
              enabled={!spotlightDisabled}
              selectAction={onSwipeSelect ? {
                onSelect: () => onSwipeSelect(task.id),
                accessibilityLabel: `Select ${task.title}`,
              } : undefined}
              whenAction={{
                onAction: () => setShowWhenPicker(true),
                accessibilityLabel: `Reschedule ${task.title}`,
              }}
            >
              <View>
                <View pointerEvents={spotlightDisabled ? 'none' : 'auto'}>
                  {rowBody}
                </View>
                {spotlightDisabled && (
                  // While another task is spotlighted this row must not react
                  // to touches itself — any tap on it just dismisses the spotlight.
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => onPress(task.id)} />
                )}
              </View>
            </SwipeableRow>
          )}
          {expandedPanel}
          {/* A scrim drawn on top of the row rather than fading the row's own
              opacity — fading the whole card washes out low-contrast text
              (e.g. category labels) far less than high-contrast text, since
              both just blend toward the same light background in light mode.
              A flat scrim darkens every pixel underneath by the same amount
              regardless of its original color. The spotlighted card is the one
              row that skips it. */}
          {!isSpotlighted && <SpotlightScrim />}
          {highlighted && !reduceMotion && (
            <Animated.View
              style={[styles.highlightScrim, { opacity: highlightOpacity }]}
              pointerEvents="none"
            />
          )}
          </View>
        </Animated.View>
      </Reanimated.View>

      {/* Mounted only while open. `Modal` renders nothing when it isn't
          visible, so this costs no extra work on the way in — but an unopened
          WhenPicker still ran its hooks, and one of them subscribes to the
          whole task list for the Suggest button. A screenful of rows meant a
          screenful of those re-rendering on every store write. */}
      {!selectionMode && showWhenPicker && (
        <WhenPicker
          visible
          value={task.dueDate ? new Date(task.dueDate) : null}
          timeSegments={task.timeSegments}
          // The row's reschedule is the main way a task gets pushed, so this is
          // the picker the postpone check most needs to be on.
          postponeTaskId={task.id}
          onBreakUp={canBreakUp ? handleBreakUp : undefined}
          taskTitle={task.title}
          taskNotes={task.notes}
          taskEffort={task.effort}
          taskEstimatedMinutes={task.estimatedMinutes}
          onConfirm={(date, segs) => {
            const snapshot = { ...task };
            updateTask(task.id, {
              dueDate: date ? date.toISOString() : null,
              timeSegments: segs,
            });
            setLastAction({
              label: 'Task rescheduled',
              undo: () => updateTask(snapshot.id, snapshot),
            });
            setShowWhenPicker(false);
          }}
          onClear={() => {
            const snapshot = { ...task };
            updateTask(task.id, { dueDate: null, timeSegments: [] });
            setLastAction({
              label: 'Task rescheduled',
              undo: () => updateTask(snapshot.id, snapshot),
            });
            setShowWhenPicker(false);
          }}
          onCancel={() => setShowWhenPicker(false)}
        />
      )}
      {showBreakdown && (
        <TaskBreakdownSheet
          visible
          taskId={task.id}
          onClose={() => setShowBreakdown(false)}
        />
      )}
      {showDeliverablePrompt && (
        <DeliverablePromptSheet
          visible
          task={task}
          onConfirm={value => {
            setShowDeliverablePrompt(false);
            runCompletion(value);
          }}
          // Cancel leaves the task exactly as it was — the tap is taken back,
          // not turned into an unanswered completion.
          onCancel={() => setShowDeliverablePrompt(false)}
        />
      )}
    </>
  );
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  itemWrapper: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  // A group's children are inside TaskGroupTray, which already insets them by
  // its own padding — these rows drop their card margins entirely rather than
  // stacking a second inset on top of it. Nothing here indents them: the tray
  // is what says they belong to the stack, so they can keep their full width.
  itemWrapperIndented: {
    marginLeft: 0,
    marginRight: 0,
  },
  // Lifted look while being dragged: elevated background so the floating card
  // reads as clearly distinct from the resting rows.
  itemWrapperActive: {
    backgroundColor: colors.bgTertiary,
  },
  rowActive: {
    backgroundColor: colors.bgTertiary,
  },
  itemWrapperElevated: {
    zIndex: 10,
    elevation: 10,
  },
  cardClip: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  highlightScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.accent,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    paddingVertical: 10,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  // Flush to the row's full height with no radius of its own: cardClip's
  // overflow:hidden + borderRadius round it off wherever it meets a true
  // card corner, so it never needs manual insets to avoid overflowing —
  // and it matches the full-height defer button revealed behind it on swipe.
  // Nothing between here and cardClip may round its corners; the bar is 3pt
  // against a 12pt radius, so any clip it doesn't share with the card slices
  // it into a taper. See the note by the row wrapper.
  priorityBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  // Same treatment as priorityBar above, and deliberately identical: the two
  // halves only read as one strip if they end the same way. It used to inset
  // itself (bottom: 4 + a 2pt corner) to stay clear of the card's rounded
  // bottom, which left the strip stopping short of the corner the row's half
  // runs straight into. cardClip rounds this end off exactly like it rounds a
  // collapsed row's, so the inset was solving a problem the shared clip
  // already solves.
  priorityBarPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  circleWrapper: {
    marginLeft: spacing.md,
    padding: 2,
  },
  circle: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleCompleting: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  // The circle's glyph, lifted out of its own flow so it draws over the quota
  // fill rather than being laid out alongside it.
  circleContentLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleLocked: {
    borderWidth: 0,
  },
  // A timed task whose countdown has run out. Tinted to pull the eye to the tap
  // that completes it, without filling the circle — it isn't done yet.
  circleReady: {
    borderColor: colors.green,
    backgroundColor: colors.bgTertiary,
  },
  circleQuota: {
    borderColor: colors.accent,
    overflow: 'hidden', // clips the fill to the circle
  },
  // The brim. Matches circleCompleting so a met target ends on the same green a
  // ticked checkbox does, with the fill already that colour underneath it.
  circleQuotaDone: {
    borderColor: colors.green,
  },
  // Height and colour both come from Animated values at the call site — see
  // quotaFill / quotaDone. It's a level in a container, so it's a plain
  // rectangle: the top edge is the water line and must be straight and the
  // full width of the circle, and the corners it needs at the bottom are the
  // circle's own, which the parent's overflow:hidden already gives it. Rounding
  // the fill's top corners was the bug — at a 5.5pt radius in a 17pt-wide box
  // the water line was a 6pt bump in the middle, so a half-full meter read as a
  // white blob floating inside a blue circle rather than as a level. The
  // negative side insets put the fill under the ring rather than inside it, so
  // the filled part is solid to the circle's edge and the ring is left
  // outlining only the empty part above the line. `bottom` stays 0 because the
  // height is a percentage of the *inner* box: pulling the fill below it too
  // would leave a hairline of unfilled circle at the top at 100%, and the ring
  // it sits on is the fill's own colour anyway.
  quotaFill: {
    position: 'absolute',
    left: -border.md,
    right: -border.md,
    bottom: 0,
    borderRadius: 0,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.regular,
  },
  titleInput: {
    color: colors.text,
    fontSize: font.md,
    // Height, not lineHeight — iOS lays a TextInput's glyphs out one full
    // line height below the top of the line box, so any lineHeight here
    // drops the text off-centre. minHeight keeps the row from resizing when
    // the title swaps between `title` (a Text with lineHeight.md) and edit mode.
    minHeight: lineHeight.md,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
  titleLocked: {
    color: colors.textSecondary,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Tabular-ish by hand: a fixed minimum so the titles of steps 9 and 10 still
  // start at the same x.
  stepNumber: {
    minWidth: 14,
    color: colors.textTertiary,
    fontSize: font.sm,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.semibold,
  },
  stepNumberOpen: {
    color: colors.accent,
  },
  titleFlex: {
    flexShrink: 1,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  // The streak flame + count read as one glyph, not an icon-label pair, so it
  // wants tighter spacing than every other metaChip (project, category, etc.)
  // — override just this chip rather than tightening the shared gap.
  streakChip: {
    gap: spacing.xs / 2,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // Sits a touch clear of the meta line above it: this is a control, not one
    // more thing the row is reporting about itself.
    marginTop: 2,
  },
  importChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    // Tinted rather than bare accent text, per the InlineAction note in
    // CLAUDE.md: accent text on a card reads as a link, and this is a button.
    backgroundColor: colors.accentSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  importChipText: {
    color: colors.accent,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  importDismiss: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
  },
  projectLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  // The one meta chip that isn't textTertiary. The rest describe the task and
  // sit back accordingly; this one says the row is on the day because the app
  // put it there, which is the only thing in the meta line the user might want
  // to act on — and at tertiary it read as one more attribute and got skipped.
  autoScheduledLabel: {
    color: colors.accent,
    fontSize: font.xs,
  },
  groupLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  scheduledLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  blockingLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  quotaLabel: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  streakChipText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  streakChipTextActive: {
    color: colors.orange,
  },
  windowLabel: {
    color: colors.red,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  windowLabelExpired: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  linkBtn: {
    padding: 4,
  },
  callBtn: {
    padding: 4,
  },
  emailBtn: {
    padding: 4,
  },
  pinBtn: {
    padding: 4,
  },
  // Tinted while idle, filled while running — the same accent-fill/onAccent
  // pairing the expanded panel's timer pill uses for "this is going".
  rowTimerBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTimerBtnRunning: {
    backgroundColor: colors.accent,
  },
  rowTimerGlyphPlay: {
    marginLeft: 2,
  },
  timerRunningGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timerDeleteBtn: {
    padding: 4,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  timerPillReady: {
    backgroundColor: colors.green,
  },
  countdownRow: {
    gap: 5,
    paddingVertical: spacing.xs,
  },
  countdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timerPillText: {
    color: colors.onAccent,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  expandedPanelClip: {
    overflow: 'hidden',
  },
  panelMeasure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  expandedPanel: {
    backgroundColor: colors.bgSecondary,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  expandNotes: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    paddingVertical: spacing.xs,
  },
  expandSection: {
    gap: 6,
    paddingVertical: spacing.xs,
  },
  // Indents the subtask list a little to the right of the task's own content,
  // so it visually nests under the task it belongs to.
  subtaskSection: {
    gap: 0,
    paddingLeft: spacing.sm,
    paddingTop: 0,
  },
  sectionDivider: {
    borderTopWidth: border.hairline,
    borderTopColor: colors.separator,
    marginTop: 2,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  subtaskRowLast: {
    borderBottomWidth: 0,
  },
  subtaskCheck: {
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
  subtaskCheckDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  subtaskTitleWrapper: {
    flex: 1,
  },
  subtaskTitle: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  subtaskTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  subtaskTitleInput: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.sm,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
  // The subtask's stretch of a timed task's countdown. Right-aligned against
  // the drag handle so the column of times lines up however long the titles
  // are, and quiet by default — most subtasks of most tasks carry no stretch,
  // and the ones that do are only worth reading while the timer is going.
  subtaskSegment: {
    color: colors.textTertiary,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  subtaskSegmentActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  // Passed, so it reads as spent rather than as the next thing to do. The row's
  // own tick box is untouched by this — the clock moving on isn't the user
  // saying they're done.
  subtaskSegmentDone: {
    color: colors.textTertiary,
    opacity: 0.5,
  },
  subtaskDragHandle: {
    padding: 2,
  },
  subtaskDeleteBtn: {
    padding: 2,
  },
  recurrenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.xs,
  },
  expandMeta: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  timedEditAction: { color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.semibold },
  timedEditActionDisabled: { color: colors.textTertiary },
  timedEditCancel: { color: colors.textSecondary, fontSize: font.xs },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  expandMetaActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  chainExpandSpacer: {
    flex: 1,
  },
  chainStepsList: {
    gap: 2,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
  },
  chainStepListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 3,
  },
  chainStepListDot: {
    width: 16,
    height: 16,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  chainStepListDotDone: {
    backgroundColor: colors.green,
  },
  chainStepListDotActive: {
    backgroundColor: colors.accent,
  },
  chainStepListDotText: {
    color: colors.textTertiary,
    fontSize: 9,
    fontWeight: fontWeight.semibold,
  },
  chainStepListDotTextActive: {
    color: colors.onAccent,
  },
  chainStepListTitle: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  chainStepListTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  chainStepListTitleActive: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  chainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chainBadgeText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  subtaskBadgeText: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  countdownLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    // The digits change every second — without tabular figures the chip's
    // width twitches on each tick.
    fontVariant: ['tabular-nums'],
  },
  countdownLabelRunning: {
    color: colors.accent,
  },
  countdownLabelReady: {
    color: colors.green,
  },
  // "2/3 planned" on a meal-plan nudge day. Matches the countdown's weight and
  // size rather than the subtask badge's, because it reads as this row's state
  // rather than as one more count hung off it — and it takes the same green
  // when the day is full, which is the only colour this row lets a chip use to
  // mean ready.
  plannedMealsLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  plannedMealsLabelReady: {
    color: colors.green,
  },
  // "Quiet 21 days" on a quiet project's review task. Same size and weight as
  // the meal-plan counter beside it, because it's the same kind of thing: this
  // row's own state, rather than one more count hung off it. No ready colour —
  // there is no threshold a project crosses into being handled, only the task
  // being ticked.
  quietLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },
  // Trails the countdown in the chip, so the number stays the thing the eye
  // lands on and a long subtask title truncates instead of pushing it out.
  countdownSegment: {
    color: colors.textTertiary,
    fontSize: 11,
    flexShrink: 1,
  },
  deadlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 1,
    maxWidth: 110,
  },
  deadlineBadgeText: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  editSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  editSectionLeft: { flexDirection: 'row', gap: spacing.xs },
  editSectionRight: { flexDirection: 'row', gap: spacing.xs, flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bgTertiary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  editBtnIconOnly: {
    paddingHorizontal: 9,
  },
  editBtnText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  iconActionBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionBtnAccent: {
    backgroundColor: colors.accentSubtle,
  },
});
