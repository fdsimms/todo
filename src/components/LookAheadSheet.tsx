import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays } from 'date-fns/addDays';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';
import { SheetScrim } from './SheetScrim';
import { useColors, useTheme } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  lineHeight,
  border,
  animation,
  interaction,
  type Colors,
} from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { estimatedMinutesFor, formatDuration } from '../utils/effort';
import {
  formatDeadlineDate,
  formatGroupHeader,
  formatScheduledDate,
  getLogicalToday,
} from '../utils/dateUtils';
import { describeDayLoad } from '../utils/dayLoad';
import {
  buildLookAhead,
  buildPushPlan,
  describeAwayEntry,
  describeCrowding,
  describeLookAheadEvents,
  describeLookAheadLead,
  describeLookAheadLoad,
  type LookAhead,
  type PushProposal,
} from '../utils/lookAhead';
import { deloadUpdates } from '../utils/taskMoves';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCalendarStore } from '../store/useCalendarStore';
import type { Task } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * "Look ahead" — everything that lands before a date, and whether it fits.
 *
 * The reading `lookAhead.ts` produces, rendered in the order the reader needs
 * it: what they are already carrying, what falls while they are away, which
 * deadlines have run out of room, then the days themselves. That order is the
 * feature. A single sorted list of everything before the cutoff is the obvious
 * build and the wrong one — see the module's own note.
 *
 * **Two modes, one sheet.** The read is the surface; the footer swaps the body
 * for a proposal list and swaps back. A second modal was the alternative and
 * would have meant the DeloadSheet→WhenPicker slide-away choreography twice
 * over, for a list that is already this sheet's own content.
 *
 * The rows here are read-only summaries rather than real `TaskItem`s. A
 * `TaskItem` brings swipes, expansion, subtask drag and the paint-select
 * registry, all of which want a list that owns its scroll view, and none of
 * which this surface is asking for: the decision on offer is *move it or leave
 * it*, and that decision is the second mode. Same reason `DeloadSheet` draws
 * its own rows.
 */
type Mode = 'read' | 'move';

/** How many rows a bucket shows before it collapses behind a count. */
const BUCKET_LIMIT = 4;

export function LookAheadSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allTasks = useTaskStore(s => s.tasks);
  const deloadTasks = useTaskStore(s => s.deloadTasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const vacationEnd = useSettingsStore(s => s.vacationEnd);
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);
  const calendarWindowStart = useCalendarStore(s => s.windowStart);
  const calendarWindowEnd = useCalendarStore(s => s.windowEnd);

  const [cutoff, setCutoff] = useState<Date | null>(null);
  /**
   * When the reader gets back, and so the far edge of the "due while you are
   * away" range. Optional, and null is a real answer: without it the sheet
   * knows a boundary but not a trip, and says nothing about the far side.
   *
   * It has to be asked for rather than read off vacation mode, because
   * `vacationStart` is stamped `new Date()` the moment the mode is switched on
   * — it records when someone went away, not when they are going to. Only
   * `vacationEnd` is ever a future date, so only it can prefill anything here.
   */
  const [backOn, setBackOn] = useState<Date | null>(null);
  /** True while `backOn` is still the one vacation mode supplied. */
  const [backFromVacation, setBackFromVacation] = useState(false);
  /** Which row the date picker is currently answering for. */
  const [picking, setPicking] = useState<'cutoff' | 'backOn' | null>(null);
  const [mode, setMode] = useState<Mode>('read');
  const [plan, setPlan] = useState<PushProposal[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  /** What a fresh opening starts on. */
  useEffect(() => {
    if (!visible) return;
    const today = getLogicalToday(dayResetTime);
    // A fortnight: the span this was built for, and long enough to hold a
    // recurrence or two where "next Monday" would open on a window too short
    // to say anything.
    setCutoff(addDays(today, 14));
    const scheduledEnd = vacationEnd ? new Date(vacationEnd) : null;
    const usable = scheduledEnd !== null && scheduledEnd > today;
    setBackOn(usable ? scheduledEnd : null);
    setBackFromVacation(usable);
    setMode('read');
    setPicking(null);
    setExpanded(new Set());
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: animation.duration.normal,
        useNativeDriver: true,
      }),
    ]).start();
    // Keyed on `visible` alone: the window is a snapshot the reader is deciding
    // on, the same rule DeloadSheet's plan follows.
  }, [visible]);

  const busyWindow = useMemo(
    () =>
      calendarWindowStart && calendarWindowEnd
        ? { start: new Date(calendarWindowStart), end: new Date(calendarWindowEnd) }
        : null,
    [calendarWindowStart, calendarWindowEnd],
  );

  const la: LookAhead | null = useMemo(() => {
    if (!cutoff) return null;
    const useCalendar = calendarReadEnabled && calendarLoaded;
    return buildLookAhead(allTasks, {
      cutoff,
      awayEnd: backOn,
      busyEvents: useCalendar ? calendarEvents : undefined,
      busyWindow: useCalendar ? busyWindow : null,
      dayResetTime,
    });
  }, [
    allTasks, cutoff, backOn, calendarReadEnabled,
    calendarLoaded, calendarEvents, busyWindow, dayResetTime,
  ]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: hiddenY,
        ...animation.spring.sheetDismiss,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: animation.duration.fast,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  /** Everything the window is holding, in one list, deduped. */
  const windowTasks = useMemo(() => {
    if (!la) return [];
    const byId = new Map<string, Task>();
    for (const task of la.carriedOver) byId.set(task.id, task);
    for (const day of la.days) for (const task of day.tasks) byId.set(task.id, task);
    return Array.from(byId.values());
  }, [la]);

  /** The far side of the window — after the trip when there is one, else the cutoff. */
  const returnDay = la?.window.awayEnd ?? la?.window.cutoff ?? null;

  const enterMoveMode = () => {
    if (!returnDay) return;
    haptics.tap();
    const next = buildPushPlan(windowTasks, returnDay, dayResetTime);
    setPlan(next);
    setSelectedIds(new Set(next.filter(p => p.selected).map(p => p.task.id)));
    animateLayout();
    setMode('move');
  };

  const leaveMoveMode = () => {
    haptics.tap();
    animateLayout();
    setMode('read');
  };

  const toggle = (p: PushProposal) => {
    if (!p.destination) return;
    haptics.tap();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(p.task.id)) next.delete(p.task.id);
      else next.add(p.task.id);
      return next;
    });
  };

  const selected = plan.filter(p => selectedIds.has(p.task.id) && p.destination);

  const handleApply = () => {
    if (selected.length === 0) return;
    haptics.success();
    const moves = selected
      .map(p => {
        const updates = deloadUpdates(p, p.destination);
        return updates ? { id: p.task.id, updates } : null;
      })
      .filter((m): m is { id: string; updates: Partial<Task> } => m !== null);
    animateLayout();
    deloadTasks(moves);
    dismiss();
  };

  const toggleBucket = (key: string) => {
    animateLayout();
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!la || !cutoff) return null;

  const dayLabel = (d: Date) =>
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // ==== render. Everything below is JSX ====

  const renderSectionHeader = (label: string, count: number) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );

  /** A bucket's rows, capped, with the remainder behind one tappable line. */
  const renderCapped = (key: string, rows: React.ReactNode[]) => {
    const open = expanded.has(key);
    const shown = open ? rows : rows.slice(0, BUCKET_LIMIT);
    const hidden = rows.length - shown.length;
    return (
      <>
        {shown}
        {hidden > 0 && (
          <TouchableOpacity
            onPress={() => toggleBucket(key)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Show ${hidden} more`}
          >
            <Text style={styles.moreLine}>{hidden} more</Text>
          </TouchableOpacity>
        )}
        {open && rows.length > BUCKET_LIMIT && (
          <TouchableOpacity
            onPress={() => toggleBucket(key)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Show fewer"
          >
            <Text style={styles.moreLine}>Show fewer</Text>
          </TouchableOpacity>
        )}
      </>
    );
  };

  const renderTaskRow = (task: Task, meta: string, tint?: 'red' | 'orange') => (
    <View key={task.id} style={styles.taskRow}>
      <View style={styles.checkbox} />
      <View style={styles.taskContent}>
        <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
        {meta ? (
          <Text
            style={[
              styles.taskMeta,
              tint === 'red' && styles.taskMetaRed,
              tint === 'orange' && styles.taskMetaOrange,
            ]}
            numberOfLines={1}
          >
            {meta}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const loadLine = describeLookAheadLoad(la);
  const eventsLine = describeLookAheadEvents(la);
  const crowding = describeCrowding(la);
  const maxWeight = Math.max(1, ...la.days.map(d => d.load.rankedMinutes));

  const readBody = (
    <>
      <View style={styles.dateGroup}>
        <TouchableOpacity
          style={styles.dateRow}
          onPress={() => {
            haptics.tap();
            setPicking('cutoff');
          }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Show everything before ${dayLabel(cutoff)}. Tap to change`}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.dateLabel}>Show everything before</Text>
          <Text style={styles.dateValue}>{dayLabel(cutoff)}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
        <View style={styles.dateSep} />
        <TouchableOpacity
          style={styles.dateRow}
          onPress={() => {
            haptics.tap();
            setPicking('backOn');
          }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={
            backOn ? `Back on ${dayLabel(backOn)}. Tap to change` : 'Back on, not set. Tap to set'
          }
        >
          <Ionicons name="airplane-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.dateLabel}>Back on</Text>
          <Text style={[styles.dateValue, !backOn && styles.dateValueEmpty]}>
            {backOn ? dayLabel(backOn) : 'Not set'}
          </Text>
          {backOn ? (
            <TouchableOpacity
              onPress={() => {
                haptics.tap();
                animateLayout();
                setBackOn(null);
                setBackFromVacation(false);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Clear the return date"
            >
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : (
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          )}
        </TouchableOpacity>
      </View>
      <Text style={styles.dateHint}>
        {backFromVacation
          ? 'Taken from the end date on vacation mode.'
          : backOn
            ? 'Anything falling before then is listed separately below.'
            : 'Set this to see what falls due while you are gone.'}
      </Text>

      <View style={styles.summaryCard}>
        <Text style={styles.lead}>{describeLookAheadLead(la)}</Text>
        {loadLine ? <Text style={styles.sub}>{loadLine}</Text> : null}
        {eventsLine ? <Text style={styles.sub}>{eventsLine}</Text> : null}

        {/* Bar heights come off `rankedMinutes`, which folds in a stand-in for
            unestimated rows — so the strip carries no numbers and no axis. It
            is the same claim the month grid's shaded cells already make, at
            finer resolution: a rank, never a total. The sentence above it is
            where the stated figures live, and those are only what was typed. */}
        {la.days.length > 0 && (
          <View style={styles.strip} accessible accessibilityLabel={crowding ?? 'Day by day load'}>
            {la.days.map(day => (
              <View key={day.key} style={styles.stripDay}>
                <View style={styles.stripBar}>
                  <View
                    style={[
                      styles.stripFill,
                      { height: `${Math.round((day.load.rankedMinutes / maxWeight) * 100)}%` },
                      day.weight === 'busy' && styles.stripFillBusy,
                      day.weight === 'full' && styles.stripFillFull,
                    ]}
                  />
                </View>
                <Text style={styles.stripLetter}>
                  {day.date.toLocaleDateString('en-US', { weekday: 'narrow' })}
                </Text>
              </View>
            ))}
          </View>
        )}
        {crowding ? <Text style={styles.crowding}>{crowding}</Text> : null}
      </View>

      {la.carriedOver.length > 0 && (
        <View>
          {renderSectionHeader('Carried over', la.carriedOver.length)}
          {renderCapped(
            'carried',
            la.carriedOver.map(task =>
              renderTaskRow(
                task,
                formatScheduledDate(task.dueDate as string, dayResetTime),
              ),
            ),
          )}
        </View>
      )}

      {la.away.length > 0 && (
        <View>
          {renderSectionHeader('Due while you are away', la.away.length)}
          <Text style={styles.band}>
            Vacation mode hides these and holds their reminders, so nothing will raise them
            while you are gone.
          </Text>
          {renderCapped(
            'away',
            la.away.map(entry =>
              renderTaskRow(
                entry.task,
                describeAwayEntry(entry),
                entry.kind === 'deadline' ? 'orange' : undefined,
              ),
            ),
          )}
        </View>
      )}

      {la.tight.length > 0 && (
        <View>
          {renderSectionHeader('Deadlines running out of room', la.tight.length)}
          {renderCapped(
            'tight',
            la.tight.map(t =>
              renderTaskRow(
                t.task,
                `${formatDeadlineDate(t.task.deadline as string, dayResetTime)} · ${formatDuration(t.minutes)} · the days before it are already full`,
                'orange',
              ),
            ),
          )}
        </View>
      )}

      <View>
        {renderSectionHeader('Before you go', la.totals.taskCount)}
        {la.days.every(d => d.tasks.length === 0 && d.expected.length === 0) ? (
          <Text style={styles.emptyHint}>Nothing is scheduled between now and then.</Text>
        ) : (
          la.days
            .filter(d => d.tasks.length > 0 || d.expected.length > 0)
            .map(day => {
              const load = describeDayLoad(day.load);
              return (
                <View key={day.key} style={styles.daySection}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayLabel}>
                      {formatGroupHeader(day.date.toISOString(), dayResetTime)}
                    </Text>
                    {load ? (
                      <Text
                        style={[
                          styles.dayValue,
                          day.weight === 'busy' && styles.dayValueBusy,
                          day.weight === 'full' && styles.dayValueFull,
                        ]}
                      >
                        {load}
                      </Text>
                    ) : null}
                  </View>
                  {day.tasks.map(task => {
                    // estimatedMinutesFor, not task.estimatedMinutes: mid-chain
                    // only the live step is on the day, and the task-level
                    // estimate covers the whole chain. And a task with no
                    // estimate gets no clause at all — formatDuration(0) is
                    // "0m", which would price an unpriced row at nothing.
                    const minutes = estimatedMinutesFor(task);
                    return renderTaskRow(task, minutes == null ? '' : formatDuration(minutes));
                  })}
                  {day.expected.length > 0 && (
                    <Text style={styles.ghostLine}>
                      + {day.expected.length} recurring{' '}
                      {day.expected.length === 1 ? 'occurrence' : 'occurrences'}
                    </Text>
                  )}
                </View>
              );
            })
        )}
      </View>
    </>
  );

  const movable = plan.filter(p => p.destination !== null);
  const blocked = plan.filter(p => p.destination === null);

  const renderProposal = (p: PushProposal) => {
    const checked = selectedIds.has(p.task.id);
    if (!p.destination) {
      return (
        <View key={p.task.id} style={styles.proposalRow}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.textTertiary} />
          <View style={styles.taskContent}>
            <Text style={[styles.taskTitle, styles.taskTitleBlocked]} numberOfLines={1}>
              {p.task.title}
            </Text>
            <Text style={styles.taskMeta} numberOfLines={1}>{p.blockerLabel}</Text>
          </View>
        </View>
      );
    }
    return (
      <TouchableOpacity
        key={p.task.id}
        style={styles.proposalRow}
        onPress={() => toggle(p)}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${p.task.title}, move to ${dayLabel(p.destination)}`}
      >
        <Ionicons
          name={checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={checked ? colors.accent : colors.textTertiary}
        />
        <View style={styles.taskContent}>
          <Text style={[styles.taskTitle, !checked && styles.taskTitleUnchecked]} numberOfLines={1}>
            {p.task.title}
          </Text>
          <Text style={styles.taskMeta} numberOfLines={1}>
            {dayLabel(p.destination)}
            {p.blockerLabel ? ` · ${p.blockerLabel}` : ''}
          </Text>
        </View>
        {p.minutes > 0 && <Text style={styles.taskMeta}>{formatDuration(p.minutes)}</Text>}
      </TouchableOpacity>
    );
  };

  const moveBody = (
    <>
      <Text style={styles.hint}>Tap to include or skip.</Text>
      {movable.map(renderProposal)}
      {blocked.length > 0 && (
        <>
          {renderSectionHeader('Staying put', blocked.length)}
          {blocked.map(renderProposal)}
        </>
      )}
    </>
  );

  const canMove = windowTasks.length > 0 && returnDay !== null;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}
        pointerEvents="none"
      >
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={dismiss} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { paddingTop: insets.top + spacing.lg, transform: [{ translateY }] },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <SheetHeaderButton
              label={mode === 'move' ? 'Back' : 'Close'}
              role="cancel"
              onPress={mode === 'move' ? leaveMoveMode : dismiss}
              minWidth={64}
            />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {mode === 'move' ? 'Move out of the way' : 'Look ahead'}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {mode === 'read' ? readBody : moveBody}
          </ScrollView>

          {mode === 'read'
            ? canMove && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={enterMoveMode}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Move work to after ${dayLabel(returnDay!)}`}
                >
                  <Text style={styles.actionBtnText}>
                    Move work to after {dayLabel(returnDay!)}
                  </Text>
                </TouchableOpacity>
              )
            : (
              <TouchableOpacity
                style={[styles.actionBtn, selected.length === 0 && styles.actionBtnDisabled]}
                onPress={handleApply}
                disabled={selected.length === 0}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.actionBtnText,
                    selected.length === 0 && styles.actionBtnTextDisabled,
                  ]}
                >
                  {selected.length === 0
                    ? 'Nothing selected'
                    : `Move ${selected.length} task${selected.length === 1 ? '' : 's'}`}
                </Text>
              </TouchableOpacity>
            )}
        </View>
      </Animated.View>

      <WhenPicker
        visible={picking !== null}
        value={picking === 'backOn' ? backOn : cutoff}
        title={picking === 'backOn' ? 'Back on' : 'Show everything before'}
        // Neither date is a task's own schedule: there is no row to suggest a
        // day for and no time of day to give one. See WhenPicker's own note.
        showTimeOfDay={false}
        showSuggest={false}
        onConfirm={date => {
          if (date) {
            const noon = new Date(date);
            noon.setHours(12, 0, 0, 0);
            animateLayout();
            if (picking === 'backOn') {
              setBackOn(noon);
              // Picked by hand, so the hint stops crediting vacation mode for it.
              setBackFromVacation(false);
            } else {
              setCutoff(noon);
            }
          }
          setPicking(null);
        }}
        onCancel={() => setPicking(null)}
      />
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  card: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  summaryCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  headerSpacer: { width: 64 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md },

  dateGroup: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  dateRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  dateSep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: 46 },
  dateLabel: { color: colors.text, fontSize: font.md, flex: 1 },
  dateValue: { color: colors.textSecondary, fontSize: font.md },
  dateValueEmpty: { color: colors.textTertiary },
  dateHint: {
    color: colors.textTertiary,
    fontSize: font.sm,
    marginTop: -spacing.sm,
    paddingHorizontal: spacing.xs,
  },

  lead: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.xl,
  },
  sub: { color: colors.textSecondary, fontSize: font.sm, lineHeight: lineHeight.sm, marginTop: 5 },
  strip: { flexDirection: 'row', gap: 3, marginTop: 14 },
  stripDay: { flex: 1, alignItems: 'center', gap: spacing.xs },
  stripBar: {
    width: '100%',
    height: 34,
    backgroundColor: colors.bgTertiary,
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  stripFill: { backgroundColor: colors.textTertiary, width: '100%' },
  stripFillBusy: { backgroundColor: colors.orange },
  stripFillFull: { backgroundColor: colors.red },
  stripLetter: { color: colors.textTertiary, fontSize: 9 },
  crowding: { color: colors.textSecondary, fontSize: font.xs, marginTop: 9 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionCount: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  band: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: 12,
    color: colors.text,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    marginBottom: spacing.sm,
  },

  taskRow: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: border.md,
    borderColor: colors.textTertiary,
  },
  taskContent: { flex: 1, gap: 2 },
  taskTitle: { color: colors.text, fontSize: font.md, lineHeight: lineHeight.md },
  taskTitleUnchecked: { color: colors.textSecondary },
  taskTitleBlocked: { color: colors.textTertiary },
  taskMeta: { color: colors.textSecondary, fontSize: font.xs },
  taskMetaRed: { color: colors.red },
  taskMetaOrange: { color: colors.orange },
  moreLine: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: 14,
    paddingBottom: spacing.sm,
  },

  daySection: { marginBottom: spacing.sm },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingBottom: 7,
  },
  dayLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  dayValue: { color: colors.textTertiary, fontSize: font.xs },
  dayValueBusy: { color: colors.orange },
  dayValueFull: { color: colors.red },
  ghostLine: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: 14,
    paddingBottom: spacing.xs,
  },
  emptyHint: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  hint: { color: colors.textTertiary, fontSize: font.xs, paddingHorizontal: spacing.xs },

  proposalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },

  actionBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    margin: spacing.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionBtnDisabled: { backgroundColor: colors.bgTertiary },
  actionBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  actionBtnTextDisabled: { color: colors.textTertiary },
});
