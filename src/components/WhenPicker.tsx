import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { startOfMonth } from 'date-fns/startOfMonth';
import { addMonths } from 'date-fns/addMonths';
import { subMonths } from 'date-fns/subMonths';
import { isSameMonth } from 'date-fns/isSameMonth';
import { isSameDay } from 'date-fns/isSameDay';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { buildCalendarGrid, weekdayHeaders } from '../utils/calendarGrid';
import { dayKeyOf, getLogicalToday, getLogicalTomorrow } from '../utils/dateUtils';
import { generateId } from '../utils/id';
import type { TimeOfDay, Effort, Priority, Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { computeSnoozeSuggestion } from '../utils/snoozeEngine';
import { shouldNudgePostpone } from '../utils/postpone';
import { PostponeCheckBanner, type PostponeCheckAction } from './PostponeCheckBanner';
import { SheetHeaderButton } from './SheetHeaderButton';

// Placeholder fields the snooze engine doesn't consider — only the ones it
// actually reads (title/notes/tags/category/priority/effort) get overridden
// with the in-progress edits below.
const BLANK_SNOOZE_TASK: Task = {
  id: '', title: '', notes: '', completed: false, completedAt: null, missedAt: null,
  autoScheduledAt: null,
  createdAt: '', seenAt: null, dueDate: null, deadline: null,
  deadlineOffsetDays: null, deadlineMonthDay: null, deferUntil: null,
  timeSegments: [], windowStart: null, windowEnd: null,
  recurrenceType: 'none', recurrenceInterval: 1, recurrenceDays: [],
  recurrenceMonthDay: null, recurrenceWeekOrdinal: null, recurrenceEndDate: null,
  recurrenceCount: null, recurrenceFromCompletion: false,
  targetCount: null, progressCount: 0, targetUnit: null, allowOvershoot: false,
  tags: [], category: null, sortOrder: 0, pinned: false, pinnedOrder: 0, priority: 0, effort: 0,
  estimatedMinutes: null, reminderTime: null, reminderKind: 'notification', linkUrl: null, phoneNumber: null, emailAddress: null, blockedById: null, deliverableKind: null, deliverableValue: null, mealEntryId: null, groceryItemId: null,
  deadlineOnCalendar: false, calendarEventId: null,
  pendingImport: null,
  streakCount: 0, streakDate: null, previousStreakCount: 0, previousStreakDate: null, showStreak: false,
  parentId: null, groupId: null, projectId: null,
  chainEnabled: false, chainIndex: 0, chainItems: [], chainStepOnSchedule: false, vacationPause: false,
  extraTaskEveryN: null, extraTaskTitle: null, extraTaskTally: 0, previousExtraTaskTally: 0,
  archived: false, archivedAt: null, timerStartedAt: null, actualMinutes: null,
  timedMinutes: null, timerElapsedSeconds: 0,
  previousOccurrenceId: null,
  seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1, seriesDefaults: null,
  postponeCount: 0, postponeMuted: false, driftingSince: null,
};

interface Props {
  visible: boolean;
  value?: Date | null;
  timeSegments?: TimeOfDay[];
  // Context for the "Suggest" date feature.
  taskId?: string;
  taskTitle?: string;
  taskNotes?: string;
  taskTags?: string[];
  taskCategory?: string | null;
  taskPriority?: Priority;
  taskEffort?: Effort;
  taskEstimatedMinutes?: number | null;
  onConfirm: (date: Date | null, timeSegments: TimeOfDay[]) => void;
  onClear?: () => void;
  onCancel: () => void;
  title?: string;
  // Hides the "Time of day" section and the "Suggest" button — used when
  // there's no single task to anchor them to, e.g. rescheduling a whole group.
  showTimeOfDay?: boolean;
  showSuggest?: boolean;
  /**
   * Opts this picker in to the postpone check (see PostponeCheckBanner).
   *
   * Deliberately its own prop rather than a gate on `taskId`, which would get
   * the feature exactly backwards: the row's own reschedule — the main push
   * path — passes no taskId today, while DeloadSheet and ProjectPullSheet both
   * do and are the two places the prompt would be pure noise, since each
   * already explains every move it's proposing. Only the two due-date pickers
   * opt in.
   */
  postponeTaskId?: string;
  /**
   * "Break it up" — closes the picker and hands over to the host, which opens
   * the AI breakdown sheet or the editor. The pill is hidden when this is
   * absent, so a host with nowhere to send the user doesn't offer it.
   */
  onBreakUp?: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 380);
const CAL_PADDING = 10;
const CELL_SIZE = Math.floor((CARD_WIDTH - CAL_PADDING * 2) / 7);

// How long the selection "pop" plays before the modal commits and closes.
const CONFIRM_DELAY_MS = 320;


const SEGMENTS: { key: TimeOfDay; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'morning', label: 'Morning', icon: 'sunny-outline' },
  { key: 'afternoon', label: 'Afternoon', icon: 'partly-sunny-outline' },
  { key: 'evening', label: 'Evening', icon: 'moon-outline' },
  { key: 'night', label: 'Night', icon: 'moon' },
];

const noonOf = (d: Date) => {
  const n = new Date(d);
  n.setHours(12, 0, 0, 0);
  return n;
};

export function WhenPicker({
  visible, value, timeSegments: initialSegments,
  taskId, taskTitle, taskNotes, taskTags, taskCategory, taskPriority, taskEffort, taskEstimatedMinutes,
  onConfirm, onClear, onCancel,
  title = 'When?', showTimeOfDay = true, showSuggest = true,
  postponeTaskId, onBreakUp,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tasks = useTaskStore(s => s.tasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);

  const [displayMonth, setDisplayMonth] = useState(() => new Date());
  const [segments, setSegments] = useState<TimeOfDay[]>([]);
  // Day currently being confirmed — drives the brief "you picked it" feedback.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ key: string; reason: string } | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const popAnim = useRef(new Animated.Value(1)).current;
  // The entrance. This used to be a spring layered on top of the Modal's own
  // `animationType="fade"`, which is a UIKit cross-dissolve — ~350ms during
  // which the card is present but not yet readable, on top of however long it
  // took to get here. Every other sheet in the app animates itself over
  // `animationType="none"` for exactly this reason; this one now does too, at
  // duration.fast.
  const cardScale = useRef(new Animated.Value(0.92)).current;
  const enterAnim = useRef(new Animated.Value(0)).current;
  const pendingRef = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = useMemo(() => getLogicalToday(dayResetTime), [visible, dayResetTime]);
  const tomorrow = useMemo(() => getLogicalTomorrow(dayResetTime), [visible, dayResetTime]);
  const tomorrowKey = dayKeyOf(tomorrow);

  useEffect(() => {
    if (visible) {
      setDisplayMonth(startOfMonth(value ?? new Date()));
      setSegments(initialSegments ?? []);
      setPendingKey(null);
      setSuggestion(null);
      setSuggestError(null);
      setCheckDismissed(false);
      pendingRef.current = false;
      popAnim.setValue(1);
      cardScale.setValue(0.92);
      enterAnim.setValue(0);
      Animated.parallel([
        Animated.timing(enterAnim, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
        Animated.spring(cardScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
      ]).start();
    } else {
      // Park the entrance at its first frame on the way out. Without the
      // native cross-dissolve there's nothing to hide a re-open rendering one
      // frame at the values the last dismissal left behind — a full-size,
      // fully-opaque card that then snaps back to 0.92 to animate in.
      cardScale.setValue(0.92);
      enterAnim.setValue(0);
    }
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [visible]);

  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const calendarDays = useMemo(
    () => buildCalendarGrid(displayMonth, weekStartsOn),
    [displayMonth, weekStartsOn]
  );
  const dayHeaders = useMemo(() => weekdayHeaders(weekStartsOn), [weekStartsOn]);

  const toggleSegment = (seg: TimeOfDay) => {
    setSegments(prev =>
      prev.includes(seg) ? [] : [seg]
    );
  };

  // Play a quick pop + haptic on the chosen target, then commit & close.
  const confirmWithFeedback = (date: Date | null, key: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingKey(key);
    if (date) setDisplayMonth(startOfMonth(date));
    haptics.success();
    popAnim.setValue(0.7);
    Animated.spring(popAnim, {
      toValue: 1.16,
      useNativeDriver: true,
      ...animation.spring.bouncy,
    }).start();
    confirmTimer.current = setTimeout(() => onConfirm(date, segments), CONFIRM_DELAY_MS);
  };

  const handleDayPress = (day: Date) => {
    confirmWithFeedback(noonOf(day), isSameDay(day, today) ? 'today' : dayKeyOf(day));
  };

  const handleToday = () => confirmWithFeedback(noonOf(today), 'today');
  const handleTomorrow = () => confirmWithFeedback(noonOf(tomorrow), tomorrowKey);

  // Lets the time-of-day segment be changed on its own, without also
  // having to tap a calendar day just to commit the change.
  const handleSave = () => {
    if (pendingRef.current) return;
    haptics.tap();
    onConfirm(value ?? null, segments);
  };

  const handleSuggest = () => {
    if (pendingRef.current) return;
    setSuggestion(null);
    setSuggestError(null);
    haptics.impactLight();
    try {
      const draftTask: Task = {
        ...BLANK_SNOOZE_TASK,
        id: taskId ?? generateId(),
        title: taskTitle ?? '',
        notes: taskNotes ?? '',
        tags: taskTags ?? [],
        category: taskCategory ?? null,
        priority: taskPriority ?? 0,
        effort: taskEffort ?? 0,
        estimatedMinutes: taskEstimatedMinutes ?? null,
      };
      const busyEvents = calendarReadEnabled && calendarLoaded ? calendarEvents : [];
      const res = computeSnoozeSuggestion(draftTask, tasks, busyEvents);
      setSuggestion({ key: dayKeyOf(res.date), reason: res.reason });
      setDisplayMonth(startOfMonth(res.date));
      haptics.success();
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : 'Could not suggest a date.');
      haptics.error();
    }
  };

  // ── Postpone check ──────────────────────────────────────────────────────
  const postponeCheckEnabled = useSettingsStore(s => s.postponeCheckEnabled);
  const postponeCheckThreshold = useSettingsStore(s => s.postponeCheckThreshold);
  const updateTask = useTaskStore(s => s.updateTask);
  const archiveTask = useTaskStore(s => s.archiveTask);
  // Session-only: silencing the banner for the rest of *this* visit is what the
  // three non-mute actions want (the task is being dealt with, so the prompt
  // has done its job and shouldn't sit there restating the count).
  const [checkDismissed, setCheckDismissed] = useState(false);

  const postponeTask = postponeTaskId ? tasks.find(t => t.id === postponeTaskId) : undefined;
  const showPostponeCheck =
    !!postponeTask &&
    !checkDismissed &&
    shouldNudgePostpone(postponeTask, postponeCheckEnabled, postponeCheckThreshold);

  const postponeActions = useMemo<PostponeCheckAction[]>(() => {
    if (!postponeTask) return [];
    const actions: PostponeCheckAction[] = [];
    if (onBreakUp) {
      actions.push({
        key: 'break',
        // The ellipsis is honest: this opens somewhere else to finish the job,
        // the same promise the "Split into N…" pill on a recipe row makes.
        label: 'Break it up…',
        onPress: () => { haptics.tap(); setCheckDismissed(true); onBreakUp(); },
      });
    }
    actions.push({
      key: 'drop',
      label: 'Drop it',
      onPress: () => {
        haptics.warning();
        Alert.alert(
          'Archive this task?',
          `"${postponeTask.title}" moves to Archived. Nothing is deleted — you can restore it from there whenever you like.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Archive',
              // Not destructive styling: archiving keeps the task, and dressing
              // a filing away up as a deletion is how a real one stops being
              // read (same call RemindersCaptureSettings makes).
              onPress: () => { archiveTask(postponeTask.id); onCancel(); },
            },
          ],
        );
      },
    });
    actions.push({
      key: 'mute',
      label: 'Stop asking',
      onPress: () => {
        haptics.tap();
        // Commits straight away in both hosts: a mute isn't a scheduling field,
        // so it has no reason to wait for the editor's Save.
        updateTask(postponeTask.id, { postponeMuted: true });
        setCheckDismissed(true);
      },
    });
    return actions;
  }, [postponeTask, onBreakUp, archiveTask, updateTask, onCancel]);

  const suggestionLabel = suggestion
    ? `${format(new Date(`${suggestion.key}T12:00:00`), 'EEE, MMM d')} — ${suggestion.reason}`
    : null;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.dim, { opacity: enterAnim }]}
          pointerEvents="none"
        />
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <Animated.View style={[styles.card, { opacity: enterAnim, transform: [{ scale: cardScale }] }]}>
          {/* Header */}
          <View style={styles.header}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={onCancel} minWidth={28} />
            <Text style={styles.headerTitle}>{title}</Text>
            <SheetHeaderButton label="Save" onPress={handleSave} style={styles.headerSaveText} />
          </View>

          {/* Time of day — its own section, distinct from the date shortcuts */}
          {showTimeOfDay && (
            <>
              <View style={styles.timeSection}>
                <Text style={styles.sectionLabel}>Time of day</Text>
                <View style={styles.segmentRow}>
                  {SEGMENTS.map(seg => {
                    const active = segments.includes(seg.key);
                    const segColor = {
                      morning: colors.timeMorning,
                      afternoon: colors.timeAfternoon,
                      evening: colors.timeEvening,
                      night: colors.timeNight,
                    }[seg.key];
                    return (
                      <TouchableOpacity
                        key={seg.key}
                        style={[styles.segmentPill, active && { backgroundColor: segColor + '33' }]}
                        onPress={() => {
                          haptics.tap();
                          toggleSegment(seg.key);
                        }}
                        activeOpacity={interaction.activeOpacity}
                      >
                        <Ionicons
                          name={seg.icon}
                          size={14}
                          color={active ? segColor : colors.textSecondary}
                        />
                        <Text style={[styles.segmentLabel, active && { color: segColor, fontWeight: fontWeight.semibold }]}>
                          {seg.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.sectionGap} />
            </>
          )}

          {/* Date shortcuts — separate section: choosing a day is its own thing */}
          <View style={styles.quickSection}>
            <Text style={styles.sectionLabel}>Pick a day</Text>
            <View style={styles.quickRow}>
              <QuickButton
                styles={styles}
                colors={colors}
                icon="star"
                iconColor="#FFD60A"
                label="Today"
                pending={pendingKey === 'today'}
                popAnim={popAnim}
                onPress={handleToday}
              />
              <QuickButton
                styles={styles}
                colors={colors}
                icon="sunny"
                iconColor={colors.timeMorning}
                label="Tomorrow"
                pending={pendingKey === tomorrowKey}
                popAnim={popAnim}
                onPress={handleTomorrow}
              />
              {showSuggest && (
                <TouchableOpacity
                  style={[styles.quickButton, styles.suggestButton]}
                  onPress={handleSuggest}
                  activeOpacity={interaction.activeOpacity}
                >
                  <Ionicons name="sparkles" size={15} color={colors.purple} />
                  <Text style={[styles.quickButtonLabel, { color: colors.purple, fontWeight: fontWeight.semibold }]}>
                    Suggest
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {showPostponeCheck && postponeTask && (
              <PostponeCheckBanner
                count={postponeTask.postponeCount}
                primary={{
                  key: 'today',
                  label: 'Do it today',
                  // The existing quick button, so this commits through exactly
                  // the same path the Today chip does — including the reset the
                  // rule applies to a task pulled back to today.
                  onPress: handleToday,
                }}
                secondary={postponeActions}
              />
            )}

            {(suggestionLabel || suggestError) && (
              <View style={styles.suggestBanner}>
                <Ionicons
                  name={suggestError ? 'alert-circle' : 'sparkles'}
                  size={13}
                  color={suggestError ? colors.red : colors.purple}
                />
                <Text style={[styles.suggestBannerText, suggestError && { color: colors.red }]} numberOfLines={2}>
                  {suggestError ?? suggestionLabel}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.sectionGap} />

          {/* Calendar section */}
          <View style={styles.calSection}>
            <View style={styles.monthNav}>
              <TouchableOpacity
                onPress={() => setDisplayMonth(m => subMonths(m, 1))}
                hitSlop={8}
                style={styles.navBtn}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <Ionicons name="chevron-back" size={16} color={colors.accent} />
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{format(displayMonth, 'MMMM yyyy')}</Text>
              <TouchableOpacity
                onPress={() => setDisplayMonth(m => addMonths(m, 1))}
                hitSlop={8}
                style={styles.navBtn}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </TouchableOpacity>
            </View>

            <View style={styles.dayHeaders}>
              {dayHeaders.map((d, i) => (
                <View key={i} style={styles.dayHeaderCell}>
                  <Text style={styles.dayHeaderText}>{d}</Text>
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {calendarDays.map((day, idx) => {
                const inMonth = isSameMonth(day, displayMonth);
                const isSelected = value ? isSameDay(day, value) : false;
                const todayDay = isSameDay(day, today);
                const key = todayDay ? 'today' : dayKeyOf(day);
                const isPending = pendingKey === key && pendingRef.current;
                const isSuggested = suggestion?.key === dayKeyOf(day);

                return (
                  <TouchableOpacity
                    key={idx}
                    style={styles.dayCell}
                    onPress={() => handleDayPress(day)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={todayDay ? `Today, ${format(day, 'EEEE, MMMM d')}` : format(day, 'EEEE, MMMM d')}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Animated.View style={[
                      styles.dayCircle,
                      isSelected && !isPending && styles.dayCircleSelected,
                      !isSelected && !isPending && todayDay && styles.dayCircleToday,
                      !isPending && isSuggested && styles.dayCircleSuggested,
                      isPending && styles.dayCirclePending,
                      isPending && { transform: [{ scale: popAnim }] },
                    ]}>
                      {isPending ? (
                        <Ionicons name="checkmark-sharp" size={CELL_SIZE * 0.46} color={colors.onAccent} />
                      ) : (
                        <Text style={[
                          styles.dayText,
                          !inMonth && styles.dayTextOtherMonth,
                          isSelected && styles.dayTextSelected,
                          !isSelected && todayDay && styles.dayTextToday,
                          isSuggested && styles.dayTextSuggested,
                        ]}>
                          {format(day, 'd')}
                        </Text>
                      )}
                    </Animated.View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Clear button */}
          {onClear && (
            <>
              <View style={styles.sectionGap} />
              <TouchableOpacity style={styles.clearBtn} onPress={onClear} activeOpacity={interaction.activeOpacity}>
                <Text style={styles.clearLabel}>Clear</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function QuickButton({
  styles, colors, icon, iconColor, label, pending, popAnim, onPress,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  label: string;
  pending: boolean;
  popAnim: Animated.Value;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.quickButton}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
    >
      <Animated.View style={[styles.quickButtonInner, pending && { transform: [{ scale: popAnim }] }]}>
        <Ionicons
          name={pending ? 'checkmark-circle' : icon}
          size={15}
          color={pending ? colors.accent : iconColor}
        />
        <Text style={[styles.quickButtonLabel, pending && styles.quickButtonLabelActive]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  // The dim is its own layer rather than the container's background so it can
  // fade in with the card.
  dim: {
    backgroundColor: colors.backdrop,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  // Right-aligned inside its own min width so the title stays centered when
  // "Save" is wider than "Cancel".
  headerSaveText: {
    minWidth: 28,
    textAlign: 'right',
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs + 2,
  },
  timeSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  segmentPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.bgQuaternary,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  quickSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.bgQuaternary,
  },
  quickButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quickButtonLabel: {
    color: colors.text,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  quickButtonLabelActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  suggestButton: {
    backgroundColor: colors.purple + '22',
  },
  suggestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: 2,
  },
  suggestBannerText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: 16,
  },
  sectionGap: {
    height: spacing.sm,
  },
  calSection: {
    paddingHorizontal: CAL_PADDING,
    paddingBottom: spacing.xs,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  navBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  dayHeaders: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  dayHeaderCell: {
    width: CELL_SIZE,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dayHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: CELL_SIZE * 6,
  },
  dayCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: CELL_SIZE - 6,
    height: CELL_SIZE - 6,
    borderRadius: (CELL_SIZE - 6) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: colors.accent,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  dayCircleSuggested: {
    borderWidth: 1.5,
    borderColor: colors.purple,
    backgroundColor: colors.purple + '22',
  },
  dayCirclePending: {
    backgroundColor: colors.accent,
  },
  dayText: {
    color: colors.text,
    fontSize: font.xs + 1,
    fontWeight: fontWeight.regular,
  },
  dayTextOtherMonth: {
    color: colors.textTertiary,
  },
  dayTextSelected: {
    color: colors.onAccent,
    fontWeight: fontWeight.semibold,
  },
  dayTextToday: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  dayTextSuggested: {
    color: colors.purple,
    fontWeight: fontWeight.semibold,
  },
  clearBtn: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  clearLabel: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
