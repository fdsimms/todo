import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addMonths } from 'date-fns/addMonths';
import { format } from 'date-fns/format';
import { isSameMonth } from 'date-fns/isSameMonth';
import { startOfMonth } from 'date-fns/startOfMonth';
import type { Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { PeriodNav } from '../components/PeriodNav';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { buildCalendarGrid, weekdayHeaders } from '../utils/calendarGrid';
import { dayKeyOf, dayKeyToDate } from '../utils/dateUtils';
import {
  buildDayBuckets,
  dayDetail,
  summarizeDay,
  type DayBucket,
  type DayMarkKind,
  type DotState,
} from '../utils/calendarMonth';
import {
  buildDayLoads,
  describeDayLoad,
  describeDayWeight,
  weightFor,
  type DayWeight,
} from '../utils/dayLoad';
import { useCalendarStore } from '../store/useCalendarStore';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CELL_SIZE = Math.floor((SCREEN_WIDTH - spacing.md * 2) / 7);
// Shorter than CELL_SIZE on purpose (#1746) — width still has to hold seven
// columns across the screen, but with the dots beside the circle instead of
// in their own row below it, the cell's content no longer needs a square box
// to fit in.
const CELL_HEIGHT = CELL_SIZE - 12;
const DOT_SIZE = 6;
// The weight bar's line under a day's circle, reserved on every cell. Small
// enough to sit inside the slack a 33pt circle leaves in a 39pt cell, so the
// grid keeps the height #1746 gave it.
const WEIGHT_SLOT_HEIGHT = 3;
const WEIGHT_SLOT_GAP = 2;

// One shared empty array for a task with no subtasks — a fresh `[]` per row per
// render is exactly the identity churn the grouping below exists to avoid.
const NO_SUBTASKS: Task[] = [];

/**
 * A month at a time.
 *
 * The app puts dates on tasks everywhere and had nowhere to look at them
 * together: `CalendarPicker` is a picker, so a month grid existed only for as
 * long as it took to tap a day and dismiss it. This is the read (#946).
 *
 * Its own route rather than a fifth Today lens. Today/Later/Unscheduled/Inbox
 * are `viewMode` sub-views sharing one set of screen state — selection mode,
 * the expanded row, quick-add, the editor — and a month grid shares none of
 * it. See the Navigation note in CLAUDE.md for why a segmented control
 * shouldn't navigate.
 *
 * Everything the cells know is bucketed once per month in `calendarMonth.ts`,
 * because 42 cells each filtering the task list is O(days × tasks) a render.
 * That module also owns the one genuinely new idea here: a recurring task's
 * future occurrences aren't rows, so the grid *projects* them — and a
 * projection may be a dot, never a row. See `dayDetail`.
 */
export function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const allTasks = useTaskStore(s => s.tasks);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);
  const calendarWindowStart = useCalendarStore(s => s.windowStart);
  const calendarWindowEnd = useCalendarStore(s => s.windowEnd);

  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState(() => dayKeyOf(new Date()));
  // Session-only, like the pinned block's `othersHidden`: which occurrences the
  // grid draws is a way of reading this month, not a preference about the app.
  const [projecting, setProjecting] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [draggingSubtask, setDraggingSubtask] = useState(false);

  // Collapse an expanded row on the way out, so it isn't still open on return.
  useFocusEffect(useCallback(() => () => setExpandedTaskId(null), []));

  const days = useMemo(() => buildCalendarGrid(displayMonth, weekStartsOn), [displayMonth, weekStartsOn]);
  const dayHeaders = useMemo(() => weekdayHeaders(weekStartsOn), [weekStartsOn]);

  const buckets = useMemo(
    () => buildDayBuckets(allTasks, {
      from: days[0],
      to: days[days.length - 1],
      dayResetTime,
      projecting,
    }),
    [allTasks, days, dayResetTime, projecting],
  );

  const taskById = useMemo(() => new Map(allTasks.map(t => [t.id, t])), [allTasks]);
  const detail = useMemo(() => dayDetail(buckets.get(selectedKey), taskById), [buckets, selectedKey, taskById]);
  const summary = summarizeDay(detail);

  /**
   * How much each day holds, over the buckets the grid already built (#1791).
   *
   * The dots say what lands on a day and have never said how much — a Tuesday
   * with one email and a Thursday with six hours of chores draw the same one.
   * This is the other half, and it reuses the buckets rather than walking the
   * task list again so the two can't disagree about what a day contains —
   * including under the projections toggle, where a cue counting occurrences
   * the grid has stopped drawing would be answering about a different month
   * than the one on screen.
   */
  const dayLoads = useMemo(() => buildDayLoads(days, buckets, {
    taskById,
    busyEvents: calendarReadEnabled && calendarLoaded ? calendarEvents : [],
    busyWindow: calendarWindowStart && calendarWindowEnd
      ? { start: new Date(calendarWindowStart), end: new Date(calendarWindowEnd) }
      : null,
    dayResetTime,
  }), [days, buckets, taskById, calendarReadEnabled, calendarLoaded, calendarEvents,
       calendarWindowStart, calendarWindowEnd, dayResetTime]);
  const selectedLoad = describeDayLoad(dayLoads.get(selectedKey));

  // Outstanding across the displayed month only — the grid's leading and
  // trailing cells belong to the neighbours, and counting them would make the
  // number disagree with the month named right above it.
  const monthOutstanding = useMemo(
    () => days.reduce(
      (total, day) => isSameMonth(day, displayMonth) ? total + (buckets.get(dayKeyOf(day))?.outstanding ?? 0) : total,
      0,
    ),
    [days, displayMonth, buckets],
  );

  const todayKey = dayKeyOf(new Date());
  const selectedDate = dayKeyToDate(selectedKey);

  /**
   * Paging carries the selection with it, because a detail pane naming a day
   * that's no longer on screen is worse than an arbitrary one: the heading
   * would still read "Monday, August 10" under a September grid, with
   * "Nothing on this day" beneath it — the day having no marks in a range it
   * isn't in. Landing on today when you page back into this month, and on the
   * 1st otherwise, keeps the two halves of the screen talking about the same
   * month at all times.
   */
  const stepMonth = (delta: number) => {
    haptics.tap();
    const next = addMonths(displayMonth, delta);
    const now = new Date();
    setExpandedTaskId(null);
    setDisplayMonth(next);
    setSelectedKey(dayKeyOf(isSameMonth(next, now) ? now : startOfMonth(next)));
  };

  const goToToday = () => {
    haptics.tap();
    const now = new Date();
    setDisplayMonth(startOfMonth(now));
    setSelectedKey(dayKeyOf(now));
  };

  // Every subtask on this screen, grouped once. Each row used to filter the
  // whole task list for its own children inline, which is O(tasks) per row and
  // — worse — handed the memoized row a fresh array on every render.
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.parentId) continue;
      const list = map.get(t.parentId);
      if (list) list.push(t);
      else map.set(t.parentId, [t]);
    }
    return map;
  }, [allTasks]);
  const subtasksOf = (id: string): Task[] => subtasksByParent.get(id) ?? NO_SUBTASKS;

  // The row handlers take the row's own id rather than closing over it, so one
  // callback serves every row — TaskItem is memoized and a fresh arrow per row
  // per render defeats its shallow compare silently, putting every mounted row
  // back to re-rendering on each store write. Empty deps: the expand toggle
  // reaches state only through the functional form of setState, and the editor
  // resolves its task from the store at call time rather than capturing it, so
  // neither can read a stale value from its frozen closure.
  const handleRowPress = useCallback((id: string) => {
    setExpandedTaskId(prev => {
      // A tap landing while a *different* row is spotlighted just dismisses
      // that one, rather than expanding the row that was tapped.
      if (prev !== null && prev !== id) return null;
      return prev === id ? null : id;
    });
  }, []);

  const handleRowEdit = useCallback((id: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === id);
    if (!task) return;
    setEditingTask(task);
    setEditorVisible(true);
  }, []);

  const renderRows = (label: string, tasks: Task[]) => {
    if (tasks.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {tasks.map(task => {
          const subs = subtasksOf(task.id);
          // Rows here are plain ScrollView siblings, not a virtualized list, so
          // — like ReorderableList's own rowElevated — the wrapper's zIndex
          // alone is enough to lift an expanded row's overflow above the row
          // painted after it. See useElevatedCellRenderer for the FlatList
          // equivalent this screen doesn't need.
          const elevated = expandedTaskId === task.id;
          return (
            <View key={task.id} style={elevated && styles.rowElevated}>
              <TaskItem
                task={task}
                onPress={handleRowPress}
                expanded={elevated}
                onEdit={handleRowEdit}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
                // Without this the subtask drag is silently dead on this screen:
                // a native scroll view only stands down for a responder that's
                // one of its ancestors, and SortableList's is a descendant.
                onSubtaskDragStateChange={setDraggingSubtask}
                // A day cell already says which day this is; repeating "Today" on
                // every row of the 13th is noise.
                showCategory
              />
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Calendar"
        subtitle={monthOutstanding > 0 ? `${monthOutstanding} outstanding in ${format(displayMonth, 'MMMM')}` : undefined}
        actions={[
          {
            icon: 'repeat-outline',
            onPress: () => { haptics.tap(); setProjecting(p => !p); },
            active: projecting,
            accessibilityLabel: projecting ? 'Hide repeats that have no task yet' : 'Show repeats that have no task yet',
          },
          {
            icon: 'today-outline',
            onPress: goToToday,
            accessibilityLabel: 'Go to today',
          },
        ]}
      />

      <PeriodNav
        label={format(displayMonth, 'MMMM yyyy')}
        onPrev={() => stepMonth(-1)}
        onNext={() => stepMonth(1)}
        prevAccessibilityLabel="Previous month"
        nextAccessibilityLabel="Next month"
      />

      <View style={styles.calendar}>
        <View style={styles.dayHeaders}>
          {dayHeaders.map((d, i) => (
            <View key={i} style={styles.dayHeaderCell}>
              <Text style={styles.dayHeaderText}>{d}</Text>
            </View>
          ))}
        </View>

        <View style={styles.grid}>
          {days.map(day => {
            const key = dayKeyOf(day);
            const bucket = buckets.get(key);
            return (
              <DayCell
                key={key}
                day={day}
                bucket={bucket}
                weight={weightFor(dayLoads.get(key))}
                inMonth={isSameMonth(day, displayMonth)}
                isToday={key === todayKey}
                isSelected={key === selectedKey}
                colors={colors}
                styles={styles}
                onPress={() => {
                  haptics.tap();
                  setExpandedTaskId(null);
                  setSelectedKey(key);
                }}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.detailHeader}>
        <View style={styles.detailHeading}>
          <Text style={styles.detailDate}>{format(selectedDate, 'EEEE, MMMM d')}</Text>
          {summary !== '' && <Text style={styles.detailSummary}>{summary}</Text>}
        </View>
        {/* How many, then how much. Its own line rather than a third clause on
            the summary above, because counts and durations answer different
            questions and only one of them is estimated. */}
        {selectedLoad !== '' && <Text style={styles.detailLoad}>{selectedLoad}</Text>}
      </View>

      <ScrollView
        style={styles.detail}
        scrollEnabled={!draggingSubtask}
        contentContainerStyle={
          detail.isEmpty
            ? { flexGrow: 1, paddingBottom: tabBarHeight + spacing.xl }
            : { paddingBottom: tabBarHeight + spacing.xl }
        }
        showsVerticalScrollIndicator={false}
      >
        {detail.isEmpty ? (
          <EmptyState
            icon="calendar-clear-outline"
            title="Nothing on this day"
            subtitle="Tasks land here from a due date, a deadline, or the day a task moved to Later comes back."
            bottomOffset={tabBarHeight}
          />
        ) : (
          <>
            {renderRows('Due', detail.due)}
            {renderRows('Deadline', detail.deadline)}
            {renderRows('Returning', detail.defer)}
            {detail.expected.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Expected</Text>
                {/* Deliberately not TaskItems. These occurrences have no row —
                    no id to tick, swipe or open — so they get a caption that
                    doesn't look like something you can act on. */}
                <View style={styles.expectedCard}>
                  {detail.expected.map(item => (
                    <View key={item.taskId} style={styles.expectedRow}>
                      <Ionicons name="repeat" size={14} color={colors.textTertiary} />
                      <Text style={styles.expectedTitle} numberOfLines={1}>{item.title}</Text>
                    </View>
                  ))}
                  <Text style={styles.expectedHint}>
                    These repeat onto this day. Each one is created when the occurrence before it is completed.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => {
          setEditorVisible(false);
          setExpandedTaskId(null);
        }}
      />
    </View>
  );
}

/**
 * One hue per kind, and the same three everywhere they're named: due takes the
 * accent every date control in the app already uses, a deadline takes the red
 * the countdown chip does, and a deferred task's return takes purple — the one
 * of the three that isn't work landing on you, so it shouldn't borrow either
 * of the other two's meanings.
 */
function dotColor(kind: DayMarkKind, colors: Colors): string {
  if (kind === 'due') return colors.accent;
  if (kind === 'deadline') return colors.red;
  return colors.purple;
}

function DayCell({
  day, bucket, weight, inMonth, isToday, isSelected, colors, styles, onPress,
}: {
  day: Date;
  bucket: DayBucket | undefined;
  weight: DayWeight | null;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  const dots = bucket?.dots ?? [];
  return (
    <TouchableOpacity
      style={styles.dayCell}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={cellLabel(day, bucket, weight)}
    >
      <View style={styles.inlineWrap}>
        <View style={styles.dayStack}>
          <View style={[
            styles.dayCircle,
            isSelected && styles.dayCircleSelected,
            !isSelected && isToday && styles.dayCircleToday,
          ]}>
            <Text style={[
              styles.dayText,
              !inMonth && styles.dayTextOtherMonth,
              isSelected && styles.dayTextSelected,
              !isSelected && isToday && styles.dayTextToday,
            ]}>
              {day.getDate()}
            </Text>
          </View>
          {/* Reserved on every cell, marked or not: a bar that only some cells
              carried would sit their circles a couple of points higher than
              their neighbours', and a grid is read by its rows. */}
          <View style={styles.weightSlot}>
            {weight && (
              <View style={[
                styles.weightBar,
                weight === 'full' ? styles.weightBarFull : styles.weightBarBusy,
              ]} />
            )}
          </View>
        </View>
        {dots.length > 0 && (
          <View style={styles.dotColumn}>
            {dots.map(dot => (
              <View
                key={dot.kind}
                style={[
                  styles.dot,
                  dotStyle(dot.state, dotColor(dot.kind, colors)),
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/**
 * Filled for real work, faded once it's all ticked, hollow for a projection.
 *
 * Written as a style rather than three tokens because the *colour* is the
 * kind — filling and outlining the same hue is what keeps the legend to three
 * entries instead of nine.
 */
function dotStyle(state: DotState, color: string) {
  if (state === 'solid') return { backgroundColor: color };
  // 0.45 rather than the third or so a "faded" dot wants on paper: a 6pt dot
  // is small enough that against the pure-black theme background anything
  // dimmer stops being a dot you can find and becomes one you only see once
  // you know it's there.
  if (state === 'done') return { backgroundColor: color, opacity: 0.45 };
  return { borderWidth: 1, borderColor: color };
}

function cellLabel(day: Date, bucket: DayBucket | undefined, weight: DayWeight | null): string {
  const date = format(day, 'MMMM d');
  // The cue is drawn, so it has to be spoken — and it can be the only thing a
  // cell carries, since a day made heavy by meetings alone has no dots.
  const suffix = weight ? `, ${describeDayWeight(weight)}` : '';
  if (!bucket || bucket.marks.length === 0) return `${date}${suffix}`;
  const parts = bucket.dots.map(dot => {
    const noun = dot.kind === 'due' ? 'due' : dot.kind === 'deadline' ? 'deadline' : 'returning';
    if (dot.state === 'projected') {
      const count = bucket.marks.filter(m => m.kind === dot.kind).length;
      return `${count} expected ${noun}`;
    }
    if (dot.state === 'done') return `${noun} done`;
    const count = bucket.marks.filter(m => m.kind === dot.kind && !m.projected && !m.completed).length;
    return `${count} ${noun}`;
  });
  return `${date}, ${parts.join(', ')}${suffix}`;
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    calendar: {
      paddingHorizontal: spacing.md,
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
      color: colors.text,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      height: CELL_HEIGHT * 6,
    },
    dayCell: {
      width: CELL_SIZE,
      height: CELL_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Dots stack beside the circle rather than sitting under it (#1746), so
    // this row's own height never has to grow the cell — up to three stacked
    // dots (~19pt) stay well under the circle's own height (33pt) either way.
    inlineWrap: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // The weight bar goes under the circle, not under the circle-and-dots
    // pair: centred on the pair it reads as an underline for both, and which
    // way it slid would depend on how many dots the day happened to have.
    dayStack: {
      alignItems: 'center',
    },
    dayCircle: {
      width: CELL_SIZE - 18,
      height: CELL_SIZE - 18,
      borderRadius: (CELL_SIZE - 18) / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Weight, not alarm: a full day is often exactly the day you meant to
    // pick, so the cue takes the app's greys rather than red or orange. The
    // slot fits inside the cell's existing slack (33pt circle in a 39pt cell),
    // so nothing here grows the grid — #1746 shortened it on purpose.
    weightSlot: {
      height: WEIGHT_SLOT_HEIGHT,
      marginTop: WEIGHT_SLOT_GAP,
      justifyContent: 'center',
    },
    weightBar: {
      height: 2.5,
      borderRadius: 1.5,
    },
    weightBarBusy: {
      width: 11,
      backgroundColor: colors.textTertiary,
    },
    weightBarFull: {
      width: 21,
      height: 3,
      backgroundColor: colors.textSecondary,
    },
    dayCircleSelected: {
      backgroundColor: colors.accentFill,
    },
    dayCircleToday: {
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    dayText: {
      color: colors.text,
      fontSize: font.sm,
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
    dotColumn: {
      flexDirection: 'column',
      gap: 2,
      marginLeft: 3,
      // Offsets the weight slot the circle now stands on, so the dots stay
      // centred on the circle rather than on the taller stack beside them.
      marginBottom: WEIGHT_SLOT_HEIGHT + WEIGHT_SLOT_GAP,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
    // Both sides: the grid sits directly above and the scrolling detail
    // directly below, and neither carries a margin of its own. The margins
    // live on the block rather than the date row so the load line under it
    // sits with the date instead of being spaced off it.
    detailHeader: {
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    detailHeading: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
    },
    detailDate: {
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    detailSummary: {
      color: colors.textSecondary,
      fontSize: font.sm,
    },
    detailLoad: {
      color: colors.textTertiary,
      fontSize: font.sm,
      paddingHorizontal: spacing.md,
      marginTop: 2,
    },
    detail: {
      flex: 1,
    },
    section: {
      marginBottom: spacing.md,
    },
    // Same zIndex/elevation pair ReorderableList's own rowElevated style
    // reaches for, so an expanded row's shadow isn't clipped by the plain
    // sibling row painted after it.
    rowElevated: {
      zIndex: 10,
      elevation: 10,
    },
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: spacing.xs,
      marginHorizontal: spacing.md,
    },
    expectedCard: {
      marginHorizontal: spacing.md,
      backgroundColor: colors.bgSunken,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    expectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    expectedTitle: {
      color: colors.textSecondary,
      fontSize: font.sm,
      flex: 1,
    },
    expectedHint: {
      color: colors.textTertiary,
      fontSize: font.xs,
      lineHeight: font.xs + 5,
    },
  });
}
