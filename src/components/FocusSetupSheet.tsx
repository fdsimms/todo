import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { formatClockDuration, formatDuration } from '../utils/effort';
import { formatTimeOfDay } from '../utils/dateUtils';
import { isQuotaTask } from '../utils/visibilityUtils';
import { formatQuotaProgress } from '../utils/quotaUnit';
import { buildFocusPlan, focusPlanTotals, plannedTaskMinutes, type FocusPlanOptions } from '../utils/focusPlan';
import { focusPlanOptionsFrom, focusRestsDisabled } from '../utils/focusSettings';
import {
  buildFocusContext,
  focusQueueFromPinned,
  focusReason,
  nextFocusSuggestion,
  suggestFocusTasks,
  MAX_SUGGESTED_FOCUS,
} from '../utils/focusSuggest';
import {
  FOCUS_WINDOW_MAX,
  FOCUS_WINDOW_MIN,
  FOCUS_WINDOW_STEP,
} from '../utils/focusSettings';
import { CountStepper } from './CountStepper';
import { SheetScrim } from './SheetScrim';
import { calendarWindow } from '../utils/focusWindow';
import { useCalendarStore } from '../store/useCalendarStore';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import type { Task } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  /** The pool to suggest from — Today's visible list. */
  tasks: readonly Task[];
  /** Every task, so blockers that aren't in the pool still resolve. */
  allTasks: readonly Task[];
  /**
   * When set, the sheet starts from these tasks in this order instead of
   * running the suggester — the "start a focus session from what's pinned"
   * shortcut. Eligibility and the time window still apply (see
   * `focusQueueFromPinned`); only the picking is different. Swapping a row
   * still offers the ordinary scored pool, since a pinned task that no
   * longer fits still deserves a replacement.
   */
  pinnedSeed?: readonly Task[];
  /**
   * The same shortcut, seeded from the live reach-out tasks instead — "batch
   * the reach-outs" (#2091). Mutually exclusive with `pinnedSeed` in practice
   * (nothing opens both at once); if a caller somehow passed both, pinned
   * wins, on no principle stronger than it was here first.
   */
  reachOutSeed?: readonly Task[];
  onClose: () => void;
  /**
   * The queue, in run order, and the plan options to build it with. Empty
   * selections can't get here. Options come from this sheet rather than
   * being re-read from settings by the caller, so a session-only override
   * (see `breaksEnabled` below) actually reaches the plan the session runs.
   */
  onStart: (tasks: Task[], options: FocusPlanOptions) => void;
}

/**
 * The step before a focus session: the tasks the scorer thinks are worth an
 * hour of attention, what the session would look like, and a start button.
 *
 * Built on the same bones as `SuggestedPinsSheet` — a snapshot taken at open,
 * rows that can be unticked or swapped for the next best candidate, and the
 * kept rows passed back as company so a replacement is scored against the
 * queue being assembled rather than the one being rejected. The two sheets
 * answer the same kind of question and it would be strange for them to behave
 * differently; `focusSuggest.ts` holds what's different about the *scoring*.
 *
 * What this one adds is the plan preview. A focus session is a commitment to a
 * shape of the next hour, and the tasks alone don't show that shape: the same
 * three rows are 55 minutes or 80 depending on the break rules and on whether
 * anything got split. So the summary under the list is built by running the
 * real `buildFocusPlan` over the current selection, not by adding up estimates
 * (which would quietly omit every break). It re-runs as rows are ticked, which
 * is the point: unticking the 90-minute task should visibly buy back the hour.
 *
 * The window at the top is what makes the sheet a question rather than a list:
 * say you have forty minutes and only a queue that fits in forty minutes is
 * offered. Changing it re-picks from scratch rather than trimming what's on
 * screen, because a different amount of time is a different question and the
 * best answer to it is rarely a prefix of the answer to the old one. That does
 * discard rows the user had already ticked or swapped, which is the trade: the
 * alternative is a list that half-remembers a window it no longer fits.
 *
 * `pinnedSeed` reuses all of the above for a second entry point — "start a
 * focus session from what's pinned" — with only the initial pick swapped out.
 * `focusQueueFromPinned` takes the pinned order as-is instead of scoring for
 * one, since pinning already is the ranking; everything past that point (the
 * window, the plan preview, ticking, swapping) is the same sheet.
 *
 * `reachOutSeed` is a third entry point on the same mechanism — "batch the
 * reach-outs" (#2091). The live reach-out tasks are already the whole
 * shortlist (`MAX_REACH_OUT_TASKS` is the ranking, the way pinning is for the
 * seed above), so it needed no new picking logic, only a second caller of
 * `focusQueueFromPinned` and its own copy. See `docs/arch/people.md`.
 *
 * The Breaks toggle is a per-session override, not a shortcut to Settings: it
 * only ever turns breaks *off* for the run about to start, never on past what
 * Settings already does, and it's dropped from the sheet entirely once
 * Settings already has none configured (see `docs/arch/focus-sessions.md`,
 * "with both triggers off the plan is a straight run of work, which is a
 * legitimate thing to ask for"). The plan preview and `onStart` both read the
 * same `effectivePlanOptions`, so what's shown is exactly what runs.
 */
export function FocusSetupSheet({ visible, tasks, allTasks, pinnedSeed, reachOutSeed, onClose, onStart }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  // useShallow, not a bare selector: focusPlanOptionsFrom builds a fresh
  // object every call, and an unmemoized snapshot is what useSyncExternalStore
  // refuses to work with. Compared field by field, it changes only when a
  // focus setting actually does.
  const planOptions = useSettingsStore(useShallow(s => focusPlanOptionsFrom(s)));

  /**
   * Minutes the user says they have, or null for no limit.
   *
   * Deliberately *not* reset when the sheet opens, unlike everything below it:
   * how long you tend to have is a fact about your day rather than about this
   * particular sheet, and someone who works in 45-minute blocks should not have
   * to say so every time. It resets when the app does, which is about right.
   */
  const [windowMinutes, setWindowMinutes] = useState<number | null>(null);

  /**
   * Whether this session takes breaks, separate from the Settings toggle.
   * Reset on every open (unlike `windowMinutes`): this is a decision about
   * the run about to start, not a standing habit like how much time you tend
   * to have. Only offered when Settings would otherwise insert breaks — with
   * both triggers already off there's nothing left for it to turn off, and a
   * switch that can't do anything is worse than no switch.
   */
  const [breaksEnabled, setBreaksEnabled] = useState(true);
  const settingsHaveBreaks = !focusRestsDisabled({
    focusRestAfterTasks: planOptions.restAfterTasks,
    focusRestAfterMinutes: planOptions.restAfterMinutes,
  });

  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);

  // Snapshotted at open, like the pins sheet and the deload sheet: this is a
  // proposal being decided on, not a live derivation that should reshuffle
  // under the user while they read it.
  const [pool, setPool] = useState<Task[]>([]);
  const [ctx, setCtx] = useState<ReturnType<typeof buildFocusContext> | null>(null);
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Swapped-away ids, never offered again while the sheet is open. */
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  /**
   * Take a fresh shortlist for the given window.
   *
   * `tasks` (and `pinnedSeed`) are snapshotted here rather than read live, so
   * a task completed on the list behind the sheet doesn't reshuffle a
   * proposal mid-read.
   */
  // Drives the four copy sites below, so none of them re-derives which seed
  // is active on its own — see the note on `reachOutSeed`, pinned wins if
  // both are somehow set.
  const seedLabel: 'pinned' | 'reachOut' | null =
    pinnedSeed && pinnedSeed.length > 0 ? 'pinned'
    : reachOutSeed && reachOutSeed.length > 0 ? 'reachOut'
    : null;

  const repick = (window: number | null) => {
    const nextCtx = buildFocusContext(allTasks, { windowMinutes: window, planOptions });

    const seed = pinnedSeed && pinnedSeed.length > 0
      ? pinnedSeed
      : reachOutSeed && reachOutSeed.length > 0 ? reachOutSeed : null;
    if (seed) {
      // Union with the ordinary pool: a pinned task can be hidden from
      // `tasks` (pinnedTasks() ignores visibility on purpose) and still needs
      // to resolve here, and a swap still needs somewhere to draw a
      // replacement from. A reach-out task doesn't have that visibility gap,
      // but unioning it the same way costs nothing and keeps one code path.
      const seen = new Set<string>();
      const snapshot: Task[] = [];
      for (const t of [...seed, ...tasks]) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        snapshot.push(t);
      }
      const picked = focusQueueFromPinned(seed, nextCtx);
      setPool(snapshot);
      setCtx(nextCtx);
      setSlotIds(picked);
      setSelectedIds(new Set(picked));
      setRejectedIds([]);
      return;
    }

    const snapshot = tasks.map(t => t);
    const picked = suggestFocusTasks(snapshot, nextCtx);
    setPool(snapshot);
    setCtx(nextCtx);
    setSlotIds(picked);
    setSelectedIds(new Set(picked));
    setRejectedIds([]);
  };

  useEffect(() => {
    if (!visible) return;
    repick(windowMinutes);
    setBreaksEnabled(true);
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Keyed on `visible` alone — the shortlist is taken once, at open, and
    // after that only a window change re-takes it.
  }, [visible]);

  const changeWindow = (next: number | null) => {
    setWindowMinutes(next);
    repick(next);
  };

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  const openSettings = () => {
    haptics.tap();
    // Lands on the group these settings actually live in ("Focus sessions"
    // inside Tasks & projects), not the Settings index. The sheet's own
    // dismiss animation runs same as Cancel; the pushed screen is behind it
    // and shows once the sheet is gone.
    (navigation as never as { navigate: (n: string, p: object) => void })
      .navigate('SettingsGroup', { groupId: 'tasksProjects' });
    dismiss();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  const byId = useMemo(() => new Map(pool.map(t => [t.id, t])), [pool]);
  const slots = useMemo(
    () => slotIds.map(id => byId.get(id)).filter((t): t is Task => t !== undefined),
    [slotIds, byId]
  );

  /**
   * The company a candidate is scored against: the rows the user is keeping. A
   * row they've unticked isn't part of the queue they're building, so it
   * doesn't get to pull its neighbours in.
   */
  const companyFor = (excludeId: string | null): Task[] =>
    slots.filter(t => t.id !== excludeId && selectedIds.has(t.id));

  const canSwap = ctx !== null && nextFocusSuggestion(pool, [], [...slotIds, ...rejectedIds], ctx) !== null;

  const swap = (task: Task) => {
    if (!ctx) return;
    const replacement = nextFocusSuggestion(pool, companyFor(task.id), [...slotIds, ...rejectedIds], ctx);
    if (!replacement) {
      haptics.warning();
      return;
    }
    haptics.tap();
    const wasSelected = selectedIds.has(task.id);
    setSlotIds(prev => prev.map(id => (id === task.id ? replacement : id)));
    setRejectedIds(prev => [...prev, task.id]);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(task.id);
      // A swap is a request for this slot, so the replacement arrives ticked
      // unless the user had deliberately switched the slot off.
      if (wasSelected) next.add(replacement);
      return next;
    });
  };

  const toggle = (task: Task) => {
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  };

  /** The queue in run order: the slot order, minus whatever was unticked. */
  const selected = useMemo(
    () => slots.filter(t => selectedIds.has(t.id)),
    [slots, selectedIds]
  );

  // Same options the session will actually start with, so the preview never
  // shows a shape the run itself won't match.
  const effectivePlanOptions: FocusPlanOptions = useMemo(
    () => (breaksEnabled ? planOptions : { ...planOptions, restAfterTasks: null, restAfterMinutes: null }),
    [planOptions, breaksEnabled]
  );

  // The real plan, so the summary counts the breaks and any split stretches
  // rather than just adding up estimates.
  const totals = useMemo(
    () => focusPlanTotals(buildFocusPlan(selected, effectivePlanOptions)),
    [selected, effectivePlanOptions]
  );

  /**
   * "Until my 3pm", when there is one. Gated on `loaded` as well as on the
   * setting, per that flag's own note: an empty event list and a calendar the
   * app couldn't open look identical, and only one of them means the afternoon
   * is actually free. Recomputed per render rather than memoized, since it has
   * to be right relative to *now* and the sheet is only open for a moment.
   */
  const suggestedWindow = calendarReadEnabled && calendarLoaded
    ? calendarWindow(calendarEvents, new Date(), { minMinutes: FOCUS_WINDOW_MIN })
    : null;

  // Floored at zero: the suggester can't produce an overrunning queue, and a
  // negative "left over" would be a state with no way to reach it.
  const spare = windowMinutes === null ? 0 : Math.max(0, windowMinutes - totals.totalMinutes);

  const endsAt = totals.totalMinutes > 0
    ? formatTimeOfDay(new Date(Date.now() + totals.totalMinutes * 60_000))
    : null;

  const handleStart = () => {
    if (selected.length === 0) return;
    haptics.success();
    onStart(selected, effectivePlanOptions);
    dismiss();
  };

  const renderRow = (task: Task) => {
    const checked = selectedIds.has(task.id);
    const reason = ctx ? focusReason(task, companyFor(task.id), ctx) : null;
    // A daily target is logged a unit at a time rather than ticked off once, so
    // its count leads the line: it's the difference between a stretch that
    // finishes the task and one that gets you two glasses closer.
    const count = isQuotaTask(task) && !task.completed
      ? formatQuotaProgress(task.progressCount, task.targetCount!, task.targetUnit)
      : null;
    // Through the plan's own read, never `task.estimatedMinutes`: the summary
    // below charges an unestimated task the default stretch, so a row that
    // showed nothing for it left the "1.5h of work" under three blank rows
    // unaccounted for. `~` marks the ones the settings answered rather than
    // the task, the same way a day's assumed total is written.
    const planned = plannedTaskMinutes(task, planOptions);
    const time = `${planned.assumed ? '~' : ''}${formatDuration(planned.minutes)}`;
    const spokenTime = planned.assumed ? `about ${formatDuration(planned.minutes)}` : time;

    return (
      <View key={task.id} style={styles.row}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => toggle(task)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={`${task.title}${count ? `, ${count} logged` : ''}${reason ? `, ${reason}` : ''}, ${spokenTime}`}
        >
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? colors.accent : colors.textTertiary}
          />
          <View style={styles.rowContent}>
            <Text style={[styles.rowTitle, !checked && styles.rowTitleUnchecked]} numberOfLines={1}>
              {task.title}
            </Text>
            {/* Separate Texts rather than one joined string: the reason can be
                as long as a task title ("Goes with Draft the quarterly memo")
                and on one line it's the duration that gets ellipsized away,
                which is the one part of this line that is a fact rather than a
                gloss. The reason shrinks; the minutes don't, and neither does a
                target's count, which is a fact of the same kind. */}
            <View style={styles.rowSubLine}>
              {count !== null && (
                <Text style={styles.rowSub} numberOfLines={1}>{count}</Text>
              )}
              {reason !== null && (
                <Text style={[styles.rowSub, styles.rowReason]} numberOfLines={1}>
                  {count !== null ? ` · ${reason}` : reason}
                </Text>
              )}
              <Text style={styles.rowSub} numberOfLines={1}>
                {count !== null || reason !== null ? ` · ${time}` : time}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.swapBtn}
          onPress={() => swap(task)}
          disabled={!canSwap}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Swap out ${task.title}`}
          accessibilityHint="Replaces this suggestion with the next best task"
        >
          <Ionicons name="refresh" size={iconSize.sm} color={canSwap ? colors.textSecondary : colors.bgQuaternary} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={dismiss} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.sheetTitle}>
              {seedLabel === 'pinned' ? 'Focus session · Pinned'
                : seedLabel === 'reachOut' ? 'Focus session · Reach out'
                : 'Focus session'}
            </Text>
            <View style={styles.headerRight}>
              <View style={styles.countRow}>
                <Ionicons name="hourglass-outline" size={13} color={colors.textTertiary} />
                <Text style={styles.countText}>
                  <Text style={styles.countValue}>{selected.length}</Text>
                  {seedLabel === 'pinned' ? ` of ${slots.length} pinned`
                    // No trailing noun, unlike the pinned count beside it: the
                    // title already says "Reach out" and repeating it as
                    // "N of N reach-outs" is what pushed the header onto two
                    // lines at 390pt — caught in the mock, not guessed at.
                    : seedLabel === 'reachOut' ? ` of ${slots.length}`
                    : ` of ${MAX_SUGGESTED_FOCUS}`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={openSettings}
                style={styles.settingsBtn}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Focus session settings"
              >
                <Ionicons name="settings-outline" size={iconSize.sm} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.windowRow}>
            <View style={styles.windowLabelWrap}>
              <Text style={styles.windowLabel}>Time available</Text>
              {/* Kept to one line each: the stepper sits beside this, and a
                  hint that wraps leaves the two optically unaligned. */}
              <Text style={styles.windowHint}>
                {windowMinutes === null ? 'No time limit' : 'Breaks count toward it'}
              </Text>
            </View>
            <CountStepper
              value={windowMinutes}
              onChange={changeWindow}
              min={FOCUS_WINDOW_MIN}
              max={FOCUS_WINDOW_MAX}
              step={FOCUS_WINDOW_STEP}
              allowNull
              emptyLabel="Any"
              format={formatClockDuration}
              label="Time available"
              describeValue={n => (n === null ? 'No limit' : `${n} minutes`)}
            />
          </View>

          {/* A preset beside a free input, so a pill rather than a segment
              (see the carve-out list in SegmentedControl's doc): the set on
              screen isn't the set of possible values, it's one shortcut to a
              value the stepper can also reach. */}
          {suggestedWindow !== null && (
            <View style={styles.suggestedRow}>
              <TouchableOpacity
                style={[
                  styles.windowPill,
                  windowMinutes === suggestedWindow.minutes && styles.windowPillOn,
                ]}
                onPress={() => changeWindow(suggestedWindow.minutes)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ selected: windowMinutes === suggestedWindow.minutes }}
                accessibilityLabel={`Use the time until ${suggestedWindow.title} at ${formatTimeOfDay(suggestedWindow.startsAt)}, ${formatClockDuration(suggestedWindow.minutes)}`}
              >
                <Ionicons
                  name="calendar-outline"
                  size={iconSize.xs}
                  color={windowMinutes === suggestedWindow.minutes ? colors.onAccent : colors.accent}
                />
                <Text
                  style={[
                    styles.windowPillText,
                    windowMinutes === suggestedWindow.minutes && styles.windowPillTextOn,
                  ]}
                >
                  {`Until ${formatTimeOfDay(suggestedWindow.startsAt)}`}
                </Text>
              </TouchableOpacity>
              <Text style={styles.suggestedCaption} numberOfLines={1}>
                {suggestedWindow.title}
              </Text>
            </View>
          )}

          {settingsHaveBreaks && (
            <TouchableOpacity
              style={styles.breaksRow}
              onPress={() => { haptics.tap(); setBreaksEnabled(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityLabel="Take breaks"
              accessibilityState={{ checked: breaksEnabled }}
            >
              <View style={styles.windowLabelWrap}>
                <Text style={styles.windowLabel}>Breaks</Text>
                <Text style={styles.windowHint}>
                  {breaksEnabled ? 'Break rules from Settings apply' : 'No breaks for this session'}
                </Text>
              </View>
              <View style={[styles.toggle, breaksEnabled && styles.toggleOn]}>
                <View style={[styles.toggleKnob, breaksEnabled && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          )}

          {slots.length === 0 ? (
            <Text style={styles.emptyHint}>
              {seedLabel === 'pinned'
                ? windowMinutes === null
                  ? 'Nothing to work with. Your pinned tasks are done, or waiting on another task.'
                  : `None of your pinned tasks fit in ${formatClockDuration(windowMinutes)}. Allow more time, or unpin one.`
                : seedLabel === 'reachOut'
                  ? windowMinutes === null
                    ? 'Nothing to work with. Nobody is due for a reach-out right now.'
                    : `None of your reach-outs fit in ${formatClockDuration(windowMinutes)}. Allow more time.`
                : windowMinutes === null
                  ? 'Nothing to suggest. Everything on today is done, or waiting on another task.'
                  : `Nothing on today fits in ${formatClockDuration(windowMinutes)}. Allow more time, or shorten a task’s estimate.`}
            </Text>
          ) : (
            <Text style={styles.hint}>
              {seedLabel === 'pinned'
                ? 'These run one at a time, in pinned order. Tap to include or skip, or swap a row for the next best task.'
                : seedLabel === 'reachOut'
                  ? 'These run one at a time. Tap to include or skip, or swap a row for the next best task.'
                : 'These run one at a time, in this order. Tap to include or skip, or swap a row for the next best task.'}
            </Text>
          )}

          <ScrollView style={styles.list} bounces={false}>
            {slots.map((task, i) => (
              <React.Fragment key={task.id}>
                {i > 0 && <View style={styles.sep} />}
                {renderRow(task)}
              </React.Fragment>
            ))}
          </ScrollView>

          {selected.length > 0 && (
            <View style={styles.summary}>
              <Text style={styles.summaryLine}>
                <Text style={styles.summaryValue}>{formatDuration(totals.workMinutes)}</Text>
                {/* The break figure is the total across the run, not the
                    length of one, so it has to be phrased as a second amount
                    rather than as "N breaks of X" — which reads as each. */}
                {` of work${totals.restCount > 0
                  ? ` and ${formatDuration(totals.restMinutes)} of breaks, ${totals.restCount} of them`
                  : ', no breaks'}`}
              </Text>
              {endsAt !== null && (
                <Text style={styles.summarySub}>
                  {windowMinutes === null
                    ? `Ends around ${endsAt} if it all runs to time`
                    : spare === 0
                      ? `Fills your ${formatClockDuration(windowMinutes)}. Ends around ${endsAt}`
                      : `${formatClockDuration(spare)} of your ${formatClockDuration(windowMinutes)} left over. Ends around ${endsAt}`}
                </Text>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.confirmBtn, selected.length === 0 && styles.confirmBtnDisabled]}
            onPress={handleStart}
            disabled={selected.length === 0}
            activeOpacity={interaction.activeOpacity}
          >
            <Text style={[styles.confirmBtnText, selected.length === 0 && styles.confirmBtnTextDisabled]}>
              {selected.length === 0
                ? 'Nothing selected'
                : `Start ${selected.length} task${selected.length === 1 ? '' : 's'} · ${formatDuration(totals.totalMinutes)}`}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.bgQuaternary },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  settingsBtn: { padding: 2 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  countText: { color: colors.textTertiary, fontSize: font.sm },
  countValue: { color: colors.accent, fontWeight: fontWeight.semibold },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  suggestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    marginTop: -spacing.sm,
  },
  windowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  windowPillOn: { backgroundColor: colors.accentFill },
  windowPillText: { color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.semibold },
  windowPillTextOn: { color: colors.onAccent },
  suggestedCaption: { flex: 1, color: colors.textTertiary, fontSize: font.xs },
  windowLabelWrap: { flex: 1, gap: 1 },
  windowLabel: { color: colors.text, fontSize: font.md },
  windowHint: { color: colors.textTertiary, fontSize: font.xs },
  breaksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
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
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  emptyHint: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  list: { maxHeight: 300 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
    paddingVertical: 12,
  },
  rowContent: { flex: 1, gap: 1 },
  rowTitle: { color: colors.text, fontSize: font.md, lineHeight: lineHeight.md },
  rowTitleUnchecked: { color: colors.textSecondary },
  rowSubLine: { flexDirection: 'row', alignItems: 'center' },
  rowSub: { color: colors.textTertiary, fontSize: font.xs },
  rowReason: { flexShrink: 1 },
  swapBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
  summary: {
    borderTopWidth: border.hairline,
    borderTopColor: colors.separator,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: 2,
  },
  summaryLine: { color: colors.textSecondary, fontSize: font.sm },
  summaryValue: { color: colors.text, fontWeight: fontWeight.semibold },
  summarySub: { color: colors.textTertiary, fontSize: font.xs },
  confirmBtn: {
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    margin: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: colors.bgTertiary },
  confirmBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  confirmBtnTextDisabled: { color: colors.textTertiary },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
});
