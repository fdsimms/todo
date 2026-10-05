import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useStableCallback } from '../hooks/useStableCallback';
import { Animated, View, Text, ScrollView, StyleSheet, Dimensions, TouchableOpacity, PanResponder } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays } from 'date-fns/addDays';
import { addMonths } from 'date-fns/addMonths';
import { format } from 'date-fns/format';
import { isSameMonth } from 'date-fns/isSameMonth';
import { startOfMonth } from 'date-fns/startOfMonth';
import { MEAL_SLOT_LABELS, type MealPlanEntry, type Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { EmptyState } from '../components/EmptyState';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { PeriodNav } from '../components/PeriodNav';
import { Fab } from '../components/Fab';
import { QuickAddModal } from '../components/QuickAddModal';
import { TodayEventsSheet } from '../components/TodayEventsSheet';
import { useColors, useTheme } from '../theme/ThemeContext';
import { useDropTargetAimed, useDropTargetChannel, type DropTargetChannel } from '../components/DropTargetChannel';
import { cellAt, isMoveDrop, type CellRect } from '../utils/calendarDrag';
import { confirmBulkSetWhen } from '../utils/scheduleMovePrompt';
import { spacing, font, fontWeight, radius, interaction, flattenOverlay, type Colors, textScale } from '../theme';
import { useTextScale } from '../hooks/useTextScale';
import { haptics } from '../utils/haptics';
import { resetToMealPlan } from '../navigation/navigationRef';
import { buildCalendarGrid, buildWeekDays, weekdayHeaders } from '../utils/calendarGrid';
import { dateToHHMM, dayKeyOf, dayKeyToDate, formatTimeOfDay, getDayStart, getLogicalToday, hhmmToDate } from '../utils/dateUtils';
import {
  buildDayBuckets,
  dayDetail,
  dayRows,
  summarizeDay,
  type DayBucket,
  type DayMarkKind,
  type DotState,
} from '../utils/calendarMonth';
import {
  assumedMinutesFor,
  buildDayLoads,
  describeDayLoad,
  describeDayWeight,
  weightFor,
  type DayWeight,
} from '../utils/dayLoad';
import { useCalendarStore } from '../store/useCalendarStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { DayTimeline } from '../components/DayTimeline';
import { buildDayTimeline } from '../utils/dayTimeline';
import { eventsIn, type BusyEvent } from '../utils/calendarBusy';
import { isDemoModeActive } from '../utils/demoState';
import { QuickEventSheet, type QuickEventSeed } from '../components/QuickEventSheet';
import { TimeSlotMenu } from '../components/TimeSlotMenu';
import type { CardAnchor } from '../components/CardSheet';
import { useProjectStore } from '../store/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import { describeWeekRange } from '../utils/mealPlan';
import { usePersonStore } from '../store/usePersonStore';
import {
  buildDayExtras,
  calendarTrips,
  completedRows,
  hasDayNotes,
  tripBandLanes,
  type DayExtras,
} from '../utils/calendarExtras';

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
const NO_MEALS: MealPlanEntry[] = [];
// The card that follows the finger while a task is dragged onto a day, and how
// far above the touch it rides so the finger doesn't cover it.
const DRAG_CARD_WIDTH = 220;
const DRAG_CARD_LIFT = 56;
// A trip band's height, and the gap above it. One lane per overlapping trip.
const TRIP_BAND_HEIGHT = 16;
const TRIP_BAND_GAP = 2;

type CalendarViewMode = 'month' | 'week' | 'day';
const VIEW_MODES: { value: CalendarViewMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

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
 *
 * Three ways to read it, switched by the pill row: the month grid over the
 * selected day's list, the week (one row of the same cells over every day of
 * that week as its own section), and one day on a clock. All three read the
 * same buckets, which are always built over the selected day's month grid —
 * a week containing any day of a month is inside that month's 42 cells.
 *
 * The component is one function; `grep -n '// ===='` is its table of contents:
 * stores and screen state, the month (grid, buckets, the selected day's
 * detail), the week, the selected day's empty state and the month's totals,
 * moving between days and months, the rows and the editor, dragging a task onto
 * a day, then the JSX. The header's "+" opens the quick-add
 * event card (`QuickEventSheet`) on the selected day.
 */
export function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  // This screen's own settings, from a gear in its header. See SCREEN_SETTINGS.
  const screenSettings = useScreenSettings('Calendar', 'Calendar settings');
  const { shadows } = useTheme();
  const textScaleFactor = useTextScale();
  const styles = useMemo(() => makeStyles(colors, textScaleFactor), [colors, textScaleFactor]);

  // ==== stores and screen state ====
  const allTasks = useTaskStore(s => s.tasks);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const people = usePersonStore(s => s.people);
  const navigation = useNavigation<any>();
  // A task row's category chip opens that category's page. Stable, because
  // TaskItem is memoized.
  const handleOpenCategory = useCallback((category: string) => {
    (navigation as any).navigate('CategoryDetail', { category });
  }, [navigation]);
  // Same rule as Today's: which calendar an event came from is only worth a
  // tag once more than one is being read.
  const calendarIds = useSettingsStore(s => s.calendarIds);
  const calendarsById = useCalendarStore(s => s.calendarsById);
  const eventCalendarTags = calendarIds.length > 1 ? calendarsById : undefined;
  // Tapping an event on the day view opens the same sheet Today's event row
  // does, for this day: who it's with, a reminder, a task from it, hiding it.
  const [eventsSheetVisible, setEventsSheetVisible] = useState(false);
  const [newEventVisible, setNewEventVisible] = useState(false);
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);
  const calendarWindowStart = useCalendarStore(s => s.windowStart);
  const calendarWindowEnd = useCalendarStore(s => s.windowEnd);
  // The trip read: events spanning days, ninety days out, so a far day can
  // still show the trip it falls in and the event sheet can offer to make it
  // one. Read on focus, the way PersonDetail reads its past window.
  const aheadEvents = useCalendarStore(s => s.aheadEvents);
  const aheadLoaded = useCalendarStore(s => s.aheadLoaded);
  const aheadWindowEnd = useCalendarStore(s => s.aheadWindowEnd);
  useFocusEffect(useCallback(() => {
    if (useSettingsStore.getState().calendarReadEnabled) void useCalendarStore.getState().refreshAhead();
  }, []));

  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(getLogicalToday()));
  const [selectedKey, setSelectedKey] = useState(() => dayKeyOf(getLogicalToday()));
  // Session-only, like the pinned block's `othersHidden`: which occurrences the
  // grid draws is a way of reading this month, not a preference about the app.
  const [projecting, setProjecting] = useState(true);
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  const syncCalendar = useCallback(async () => {
    setSyncingCalendar(true);
    try {
      const cal = useCalendarStore.getState();
      await Promise.all([cal.refresh(), cal.refreshAhead()]);
    } finally {
      setSyncingCalendar(false);
    }
  }, []);
  // Month or one day on a clock. Session-only for the same reason `projecting`
  // is: which way you are reading this month is not a preference about the app.
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [draggingSubtask, setDraggingSubtask] = useState(false);

  // Collapse an expanded row on the way out, so it isn't still open on return.
  useFocusEffect(useCallback(() => () => setExpandedTaskId(null), []));
  // Bumped on every focus, so a read that goes past a store to SQLite (the
  // day's meals, below) is taken again after another screen may have written.
  const [focusCount, setFocusCount] = useState(0);
  useFocusEffect(useCallback(() => { setFocusCount(n => n + 1); }, []));

  const use24Hour = useSettingsStore(s => s.use24HourTime);
  // Subscribed only so a meal edited in the loaded window redraws; the grid's
  // own meals come through entriesInRangeLive.
  const mealEntries = useMealPlanStore(useShallow(s => s.entries));
  const entriesInRangeLive = useMealPlanStore(s => s.entriesInRangeLive);


  const projects = useProjectStore(useShallow(s => s.projects));
  // ==== the month: grid, buckets and the selected day's detail ====
  const days = useMemo(() => buildCalendarGrid(displayMonth, weekStartsOn), [displayMonth, weekStartsOn]);
  /**
   * Every live away span, so a month holding a trip says so.
   *
   * All of them rather than the nearest one, since the grid pages through
   * months and can reach past whichever trip is next. A span already over is
   * kept: a month view of last month is entitled to say you were away.
   */
  const trips = useMemo(() => calendarTrips(projects, dayResetTime), [projects, dayResetTime]);
  const awaySpans = useMemo(() => trips.map(t => t.span), [trips]);
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

  /**
   * Everything else the app knows about the grid's days: trips, meals,
   * birthdays, project deadlines and completions (`calendarExtras.ts`).
   *
   * Built one day wider on each side than the grid, so the first and last
   * rows can tell whether a trip band carries on past them. The meals come
   * through the range read, never the loaded window alone, which is only the
   * week Meal Plan last opened; `mealEntries` and `focusCount` aren't read,
   * they're what tells the memo to read again.
   */
  const extras = useMemo(() => {
    const wide = [addDays(days[0], -1), ...days, addDays(days[days.length - 1], 1)];
    const meals = kitchenEnabled
      ? entriesInRangeLive(dayKeyOf(wide[0]), dayKeyOf(wide[wide.length - 1]))
      : [];
    return buildDayExtras(wide, { trips, meals, people, projects, tasks: allTasks, dayResetTime });
  }, [days, kitchenEnabled, entriesInRangeLive, mealEntries, focusCount, trips, people, projects, allTasks, dayResetTime]);
  const selectedExtras = extras.get(selectedKey);
  const detail = useMemo(() => dayDetail(buckets.get(selectedKey), taskById), [buckets, selectedKey, taskById]);
  const summary = summarizeDay(detail);
  /**
   * One day's calendar events, and how much is known about it. Shared by the
   * day view (the selected day) and the week view (each of its seven).
   *
   * - The day starts noon-anchored, never at the key's midnight: under a
   *   non-midnight reset the day's start is the reset time on that date, and
   *   anchoring from midnight lands on the day before. Same derivation
   *   buildDayLoads makes.
   * - `known`: "couldn't read" and "nothing on" are different answers, and the
   *   store's window is only a fortnight wide, so a day past it is unknown
   *   rather than confidently empty.
   * - `tripOnly`: past the fortnight only the trip read reaches, multi-day
   *   events, and the day still reads as not known for anything else, since
   *   one long event says nothing about the meetings around it.
   */
  const eventsForDay = useCallback((key: string) => {
    const noon = dayKeyToDate(key);
    noon.setHours(12, 0, 0, 0);
    const start = getDayStart(noon, dayResetTime);
    const end = addDays(start, 1);
    const reading = calendarReadEnabled && !isDemoModeActive();
    const known = reading && calendarLoaded && !!calendarWindowStart && !!calendarWindowEnd
      && start >= new Date(calendarWindowStart) && start < new Date(calendarWindowEnd);
    const tripOnly = !known && reading && aheadLoaded && aheadWindowEnd !== null && end <= new Date(aheadWindowEnd);
    const events = known
      ? eventsIn(calendarEvents, start, end)
      : tripOnly ? eventsIn(aheadEvents, start, end) : [];
    return { start, known, tripOnly, events };
  }, [dayResetTime, calendarReadEnabled, calendarLoaded, calendarWindowStart, calendarWindowEnd,
      aheadLoaded, aheadWindowEnd, calendarEvents, aheadEvents]);

  const selectedDay = useMemo(() => eventsForDay(selectedKey), [eventsForDay, selectedKey]);
  const selectedDayStart = selectedDay.start;
  const dayBusyKnown = selectedDay.known;
  const dayTripOnly = selectedDay.tripOnly;
  const dayEvents = selectedDay.events;

  const dayTimeline = useMemo(() => {
    // A task can be in more than one of the three lists (due today with a
    // deadline today), and it is still one row on the axis.
    return buildDayTimeline({ dayStart: selectedDayStart, tasks: dayRows(detail), events: dayEvents });
  }, [detail, selectedDayStart, dayEvents]);

  const dayMeals = selectedExtras?.meals ?? NO_MEALS;



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
  const assumedTaskMinutes = useMemo(() => assumedMinutesFor(allTasks), [allTasks]);
  const dayLoads = useMemo(() => buildDayLoads(days, buckets, {
    taskById,
    busyEvents: calendarReadEnabled && calendarLoaded ? calendarEvents : [],
    busyWindow: calendarWindowStart && calendarWindowEnd
      ? { start: new Date(calendarWindowStart), end: new Date(calendarWindowEnd) }
      : null,
    awaySpans,
    dayResetTime,
    assumedTaskMinutes,
  }), [days, buckets, taskById, awaySpans, calendarReadEnabled, calendarLoaded, calendarEvents,
       calendarWindowStart, calendarWindowEnd, dayResetTime, assumedTaskMinutes]);
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

  // The logical day, so the cell ringed as "today" is the day the rest of the
  // app is showing. Before a 02:00 day reset the calendar has already rolled
  // over and Today has not.
  const todayKey = dayKeyOf(getLogicalToday());
  // Only drawn on the day you are actually in.
  const nowMinutes = selectedKey === todayKey
    ? Math.round((Date.now() - selectedDayStart.getTime()) / 60000)
    : null;

  // ==== the week: the selected day's week, one section per day ====
  // Every day of it resolves against the month grid's buckets: the selected
  // day is always in the displayed month, so its whole week is in the grid.
  const weekDays = useMemo(
    () => buildWeekDays(dayKeyToDate(selectedKey), weekStartsOn),
    [selectedKey, weekStartsOn],
  );
  const weekDetails = useMemo(
    () => weekDays.map(day => {
      const key = dayKeyOf(day);
      return { day, key, detail: dayDetail(buckets.get(key), taskById) };
    }),
    [weekDays, buckets, taskById],
  );
  const weekOutstanding = weekDetails.reduce(
    (total, { key }) => total + (buckets.get(key)?.outstanding ?? 0),
    0,
  );
  const weekHasToday = weekDetails.some(({ key }) => key === todayKey);
  // Where each day's section starts in the scrolling list, so tapping a day in
  // the strip can bring its section up. Written from onLayout, read on tap.
  const detailScrollRef = useRef<ScrollView>(null);
  const weekSectionY = useRef(new Map<string, number>());
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  // A day whose section should be brought up as soon as it is laid out: set on
  // arriving at a week (switching to it, or paging), so the list opens on the
  // day you had selected rather than on the week's first day.
  const pendingWeekScroll = useRef<string | null>(null);

  // ==== the selected day's empty state and the month's totals ====
  // A day holding an event or a meal is not an empty day, even with no task on
  // it, and one the calendar could not be read for has something to say too.
  // Completed rows already on the day's lists (a task due and ticked today)
  // aren't listed again.
  const dayCompleted = completedRows(selectedExtras, dayRows(detail), taskById);
  const monthEmpty = detail.isEmpty && !hasDayNotes(selectedExtras, true) && dayCompleted.length === 0;
  const dayEmpty = detail.isEmpty
    && dayTimeline.entries.length === 0
    && dayTimeline.allDay.length === 0
    && dayMeals.length === 0
    && !hasDayNotes(selectedExtras, false)
    && dayCompleted.length === 0
    && dayBusyKnown;
  const selectedDate = dayKeyToDate(selectedKey);

  // ==== moving between days and months ====
  /**
   * Paging carries the selection with it, because a detail pane naming a day
   * that's no longer on screen is worse than an arbitrary one: the heading
   * would still read "Monday, August 10" under a September grid, with
   * "Nothing on this day" beneath it — the day having no marks in a range it
   * isn't in. Landing on today when you page back into this month, and on the
   * 1st otherwise, keeps the two halves of the screen talking about the same
   * month at all times.
   */
  // Stepping a day carries the month with it: the buckets are built over the
  // displayed month's grid, so a day outside it would resolve to nothing.
  const stepDay = (delta: number) => {
    haptics.tap();
    const next = addDays(dayKeyToDate(selectedKey), delta);
    setSelectedKey(dayKeyOf(next));
    if (!isSameMonth(next, displayMonth)) setDisplayMonth(startOfMonth(next));
  };

  // A week at a time, keeping the weekday you had selected. stepDay already
  // carries the displayed month along when the week crosses into another.
  const stepWeek = (delta: number) => {
    setExpandedTaskId(null);
    pendingWeekScroll.current = dayKeyOf(addDays(dayKeyToDate(selectedKey), delta * 7));
    stepDay(delta * 7);
  };

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
    // Lands on the same day the "today" ring is drawn on, above.
    const today = getLogicalToday();
    setDisplayMonth(startOfMonth(today));
    setSelectedKey(dayKeyOf(today));
  };

  // One callback for all forty-two cells, so `DayCell`'s memo holds — see its
  // own note. The cell hands its key back rather than each cell closing over
  // its own.
  const selectDay = useCallback((key: string) => {
    haptics.tap();
    setExpandedTaskId(null);
    setSelectedKey(key);
    // The week's strip doesn't change the list under it, only where you are
    // in it. Read through refs so this stays one stable callback.
    if (viewModeRef.current === 'week') {
      const y = weekSectionY.current.get(key);
      if (y !== undefined) detailScrollRef.current?.scrollTo({ y, animated: true });
    }
  }, []);

  const switchViewMode = (mode: CalendarViewMode) => {
    haptics.tap();
    // The expanded row is keyed per view (the week keys it by day as well as
    // task), so one carried across would either expand nothing or the wrong row.
    setExpandedTaskId(null);
    if (mode === 'week') pendingWeekScroll.current = selectedKey;
    setViewMode(mode);
  };

  // ==== rows: subtasks, expansion, the editor and quick add ====
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

  // ==== dragging a task onto a day ====
  // Long-press a Due or Returning row in the month or week view and drop it on
  // a day of the grid. The drop goes through the bulk bar's When
  // (`confirmBulkSetWhen`), so it moves a task exactly as the date picker
  // does, asking the repeating-task question first. A deadline row doesn't
  // lift: moving a deadline is a different question from moving the work.
  //
  // What the finger is over is never screen state (CLAUDE.md, "What a drag is
  // aimed at"): it goes on a channel each cell subscribes to, so a crossing
  // re-renders two cells rather than the screen. The card follows the finger
  // on an Animated value for the same reason.
  const dropChannel = useDropTargetChannel();
  const cellViews = useRef(new Map<string, View>());
  const registerCell = useCallback((key: string, view: View | null) => {
    if (view) cellViews.current.set(key, view);
    else cellViews.current.delete(key);
  }, []);
  const cellRects = useRef(new Map<string, CellRect>());
  const dragRef = useRef<{ task: Task; sourceKey: string; moved: boolean } | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const rootRef = useRef<View>(null);
  const rootOffset = useRef({ x: 0, y: 0 });
  const dragXY = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragOpacity = useRef(new Animated.Value(0)).current;

  // Measured once, at lift: nothing on screen moves while the list can't scroll.
  const startTaskDrag = useCallback((taskId: string, sourceKey: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    dragRef.current = { task, sourceKey, moved: false };
    setDraggingTask(task);
    setExpandedTaskId(null);
    dragOpacity.setValue(0);
    haptics.impactMedium();
    rootRef.current?.measureInWindow((x, y) => { rootOffset.current = { x, y }; });
    const rects = new Map<string, CellRect>();
    cellRects.current = rects;
    for (const [key, view] of cellViews.current) {
      view.measureInWindow((x, y, width, height) => { rects.set(key, { x, y, width, height }); });
    }
  }, [dragOpacity]);

  const endTaskDrag = useCallback((dropped: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const target = dropChannel.get();
    dropChannel.publish(null);
    setDraggingTask(null);
    dragOpacity.setValue(0);
    if (!drag || !dropped || !isMoveDrop(drag.sourceKey, target)) return;
    haptics.success();
    confirmBulkSetWhen([drag.task.id], dayKeyToDate(target), drag.task.timeSegments ?? [], () => {});
  }, [dropChannel, dragOpacity]);

  // Cached per row, for the reason ReorderableList caches its own: TaskItem is
  // memoized, and a fresh callback per render re-renders every row.
  const dragHandlers = useRef(new Map<string, () => void>());
  const dragHandlerFor = (taskId: string, sourceKey: string): (() => void) => {
    const key = `${sourceKey}:${taskId}`;
    let handler = dragHandlers.current.get(key);
    if (!handler) {
      handler = () => startTaskDrag(taskId, sourceKey);
      dragHandlers.current.set(key, handler);
    }
    return handler;
  };

  // Claims the touch on its first move after a lift. It sits on the screen's
  // root, an ancestor of the scroll view, which is what lets the native scroll
  // stand down for it (see the SortableList note in CLAUDE.md).
  const dragResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: () => dragRef.current !== null,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        drag.moved = true;
        dragOpacity.setValue(1);
      }
      dragXY.setValue({
        x: g.moveX - rootOffset.current.x - DRAG_CARD_WIDTH / 2,
        y: g.moveY - rootOffset.current.y - DRAG_CARD_LIFT,
      });
      const over = cellAt(cellRects.current, g.moveX, g.moveY);
      if (over !== dropChannel.get() && over !== null) haptics.tap();
      dropChannel.publish(over);
    },
    onPanResponderRelease: () => endTaskDrag(true),
    onPanResponderTerminate: () => endTaskDrag(false),
  }), [dropChannel, dragOpacity, dragXY, endTaskDrag]);
  // A lift let go without moving never reaches the responder above.
  const handleRootTouchEnd = () => {
    if (dragRef.current && !dragRef.current.moved) endTaskDrag(false);
  };

  // Quick add already seeds the selected day onto the draft's own date field
  // (see the seed prop below) — "More details" just carries the same draft
  // into the full editor instead of dropping it.
  const handleQuickAddOpenFull = (draft: TaskDraft) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialDraft(draft);
    setEditorVisible(true);
  };
  // Stable, because QuickAddModal is memoized and stays mounted while hidden:
  // a fresh prop each render would re-render the hidden sheet with this screen.
  const onQuickAddClose = useStableCallback(() => { setQuickAddVisible(false); setQuickAddTime(null); });
  const onQuickAddOpenFull = useStableCallback(handleQuickAddOpenFull);
  // A tapped time on the day view adds a start time (`windowStart`, which is
  // what places a task on the axis) to the day the seed already carries.
  const [quickAddTime, setQuickAddTime] = useState<string | null>(null);
  const quickAddSeed = useMemo(
    () => ({ dueDate: dayKeyToDate(selectedKey).toISOString(), ...(quickAddTime ? { windowStart: quickAddTime } : {}) }),
    [selectedKey, quickAddTime],
  );
  // The empty-slot menu on the day view, and the event it may seed.
  const [slotMenu, setSlotMenu] = useState<{ at: Date; anchor: CardAnchor } | null>(null);
  const [slotMenuOpen, setSlotMenuOpen] = useState(false);
  const [newEventSeed, setNewEventSeed] = useState<QuickEventSeed | null>(null);
  const handlePressSlot = useCallback((minutes: number, pageX: number, pageY: number) => {
    haptics.tap();
    setSlotMenu({ at: new Date(selectedDayStart.getTime() + minutes * 60000), anchor: { x: pageX, y: pageY } });
    setSlotMenuOpen(true);
  }, [selectedDayStart]);

  /** `dragFrom`: the day these rows are listed under, when they can be dragged off it. */
  const renderRows = (label: string, tasks: Task[], dragFrom?: string) => {
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
                drag={dragFrom && !task.completed ? dragHandlerFor(task.id, dragFrom) : undefined}
                isActive={draggingTask?.id === task.id}
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
                onOpenCategory={handleOpenCategory}
              />
            </View>
          );
        })}
      </View>
    );
  };

  // The month as six rows of seven, so each row can carry its own trip band.
  const gridRows = useMemo(
    () => Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7)),
    [days],
  );

  /**
   * The trips under one row of cells, a band per run of days with the trip's
   * name on it, the way a multi-day event draws in a calendar app. Ends that
   * carry on into the next or previous row are left square, so a trip across
   * a weekend reads as one band broken by the row rather than two trips.
   *
   * Not tappable: the cells above it are what a tap is for, and the day's list
   * names the trip with a link to its project.
   */
  const renderTripBands = (row: readonly Date[]) => {
    const keys = row.map(dayKeyOf);
    const lanes = tripBandLanes(
      keys,
      extras,
      dayKeyOf(addDays(row[0], -1)),
      dayKeyOf(addDays(row[row.length - 1], 1)),
    );
    if (lanes.length === 0) return null;
    return (
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {lanes.map((lane, i) => (
          <View key={i} style={styles.tripLane}>
            {lane.map(segment => (
              <View
                key={segment.projectId}
                style={[
                  styles.tripBand,
                  {
                    left: segment.startCol * CELL_SIZE + (segment.continuesBefore ? 0 : 3),
                    width: segment.span * CELL_SIZE - (segment.continuesBefore ? 0 : 3) - (segment.continuesAfter ? 0 : 3),
                  },
                  segment.continuesBefore && styles.tripBandOpenStart,
                  segment.continuesAfter && styles.tripBandOpenEnd,
                ]}
              >
                <Ionicons name="airplane" size={10} color={colors.text} />
                {/* One cell can't hold a name, only its first letters, so a
                    one-day piece (usually a trip's tail spilling into the
                    next row) is the plane alone. */}
                {segment.span > 1 && (
                  <Text maxFontSizeMultiplier={textScale.fixed} style={styles.tripBandText} numberOfLines={1}>{segment.name}</Text>
                )}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  /**
   * The day's "On this day" card: the trip you're on, the meals planned,
   * whose birthday it is and which project is due. Facts about the day rather
   * than work on it, so a card of plain lines rather than task rows. A line
   * with somewhere to go (a project, a person) opens it.
   *
   * The day view passes `includeMeals: false`, since its timeline band already
   * draws them.
   */
  const renderNotes = (dayExtras: DayExtras | undefined, includeMeals: boolean) => {
    if (!dayExtras || !hasDayNotes(dayExtras, includeMeals)) return null;
    const lines: { key: string; icon: React.ComponentProps<typeof Ionicons>['name']; text: string; onPress?: () => void; label?: string }[] = [
      ...dayExtras.trips.map(t => ({
        key: `trip-${t.projectId}`,
        icon: 'airplane-outline' as const,
        text: `Away: ${t.name}`,
        onPress: () => navigation.navigate('ProjectDetail', { projectId: t.projectId }),
        label: `Away: ${t.name}. Opens the project.`,
      })),
      // A meal made from a recipe opens the recipe; one typed in by name has
      // nothing to open but its day on the meal plan.
      ...(includeMeals ? dayExtras.meals : []).map(m => ({
        key: `meal-${m.id}`,
        icon: 'restaurant-outline' as const,
        text: `${MEAL_SLOT_LABELS[m.slot]}: ${m.title}`,
        onPress: m.recipeId
          ? () => navigation.navigate('RecipeDetail', { recipeId: m.recipeId! })
          : () => resetToMealPlan(m.date),
        label: `${MEAL_SLOT_LABELS[m.slot]}: ${m.title}. ${m.recipeId ? 'Opens the recipe.' : 'Opens the meal plan.'}`,
      })),
      ...dayExtras.birthdays.map(b => ({
        key: `bday-${b.personId}`,
        icon: 'gift-outline' as const,
        text: b.title,
        onPress: () => navigation.navigate('PersonDetail', { personId: b.personId }),
        label: `${b.title}. Opens their page.`,
      })),
      ...dayExtras.projectDeadlines.map(d => ({
        key: `deadline-${d.projectId}`,
        icon: 'flag-outline' as const,
        text: `${d.name} deadline`,
        onPress: () => navigation.navigate('ProjectDetail', { projectId: d.projectId }),
        label: `${d.name} deadline. Opens the project.`,
      })),
    ];
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>On this day</Text>
        <View style={styles.notesCard}>
          {lines.map((line, i) => {
            const body = (
              <>
                <Ionicons name={line.icon} size={16} color={colors.textSecondary} />
                <Text style={styles.noteText} numberOfLines={1}>{line.text}</Text>
                {line.onPress && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
              </>
            );
            const rowStyle = [styles.noteRow, i > 0 && styles.noteRowDivided];
            return line.onPress ? (
              <TouchableOpacity
                key={line.key}
                style={rowStyle}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); line.onPress!(); }}
                accessibilityRole="button"
                accessibilityLabel={line.label}
              >
                {body}
              </TouchableOpacity>
            ) : (
              <View key={line.key} style={rowStyle}>{body}</View>
            );
          })}
        </View>
      </View>
    );
  };

  /**
   * A week day's calendar events: time (or "All day") and title, one card.
   * Tapping one selects its day and opens the same event sheet the day view's
   * timeline opens, so everything an event can do is one tap from the week too.
   */
  const renderEvents = (key: string, events: readonly BusyEvent[]) => {
    if (events.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Events</Text>
        <View style={styles.notesCard}>
          {events.map((event, i) => (
            <TouchableOpacity
              key={`${event.id}:${event.start}`}
              style={[styles.noteRow, i > 0 && styles.noteRowDivided]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setSelectedKey(key); setEventsSheetVisible(true); }}
              accessibilityRole="button"
              accessibilityLabel={`${event.title || 'Event'}, ${event.allDay ? 'all day' : formatTimeOfDay(new Date(event.start), use24Hour)}`}
            >
              <Text style={styles.eventTime}>
                {event.allDay ? 'All day' : formatTimeOfDay(new Date(event.start), use24Hour)}
              </Text>
              <Text style={styles.noteText} numberOfLines={1}>{event.title || 'Event'}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderExpected = (expected: { taskId: string; title: string }[]) => {
    if (expected.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Expected</Text>
        {/* Deliberately not TaskItems. These occurrences have no row —
            no id to tick, swipe or open — so they get a caption that
            doesn't look like something you can act on. */}
        <View style={styles.expectedCard}>
          {expected.map(item => (
            <View key={item.taskId} style={styles.expectedRow}>
              <Ionicons name="repeat" size={14} color={colors.textTertiary} />
              <Text style={styles.expectedTitle} numberOfLines={1}>{item.title}</Text>
            </View>
          ))}
          <Text style={styles.expectedHint}>
            These repeat onto this day. Each one is created when you complete the one before it.
          </Text>
        </View>
      </View>
    );
  };

  /**
   * The week as seven sections, every day drawn whether or not it holds
   * anything: a week with a gap in it is read as a week, and a missing
   * Wednesday would read as the list having skipped it.
   *
   * A task can land on two days of one week (due Monday, deadline Friday), so
   * each row is keyed by its day as well as its task. That keeps expansion to
   * the row you tapped, the way the pinned copy on Today does it, and the
   * second appearance passes `duplicateRow` like that copy too.
   */
  const renderWeek = () => {
    const shown = new Set<string>();
    return weekDetails.map(({ day, key, detail: dayInfo }) => {
      const rows = dayRows(dayInfo);
      const dayExtras = extras.get(key);
      const completed = completedRows(dayExtras, rows, taskById);
      const weekDayEvents = eventsForDay(key).events;
      const renderWeekRow = (task: Task) => {
        const subs = subtasksOf(task.id);
        const rowKey = `${key}:${task.id}`;
        const elevated = expandedTaskId === rowKey;
        const duplicate = shown.has(task.id);
        shown.add(task.id);
        return (
          <View key={rowKey} style={elevated && styles.rowElevated}>
            <TaskItem
              task={task}
              rowKey={rowKey}
              duplicateRow={duplicate}
              onPress={handleRowPress}
              expanded={elevated}
              onEdit={handleRowEdit}
              drag={!task.completed && (dayInfo.due.includes(task) || dayInfo.defer.includes(task))
                ? dragHandlerFor(task.id, key)
                : undefined}
              isActive={draggingTask?.id === task.id}
              subtaskCount={subs.length}
              subtaskDoneCount={subs.filter(t => t.completed).length}
              subtasks={subs}
              onSubtaskDragStateChange={setDraggingSubtask}
              showCategory
              onOpenCategory={handleOpenCategory}
            />
          </View>
        );
      };
      const daySummary = summarizeDay(dayInfo);
      const dayLoad = describeDayLoad(dayLoads.get(key));
      const isToday = key === todayKey;
      return (
        <View
          key={key}
          style={styles.weekDay}
          onLayout={e => {
            const y = e.nativeEvent.layout.y;
            weekSectionY.current.set(key, y);
            if (pendingWeekScroll.current === key) {
              pendingWeekScroll.current = null;
              detailScrollRef.current?.scrollTo({ y, animated: false });
            }
          }}
        >
          <View style={styles.detailHeading}>
            <Text style={[styles.weekDayDate, isToday && styles.weekDayDateToday]}>
              {format(day, 'EEEE, MMM d')}{isToday ? ' · Today' : ''}
            </Text>
            {daySummary !== '' && <Text style={styles.detailSummary}>{daySummary}</Text>}
          </View>
          {dayLoad !== '' && <Text style={styles.detailLoad}>{dayLoad}</Text>}
          {dayInfo.isEmpty && !hasDayNotes(dayExtras, true) && completed.length === 0 && weekDayEvents.length === 0 ? (
            <Text style={styles.weekDayEmpty}>Nothing on this day.</Text>
          ) : (
            <View style={styles.weekDayRows}>
              {renderNotes(dayExtras, true)}
              {renderEvents(key, weekDayEvents)}
              {rows.map(renderWeekRow)}
              {renderExpected(dayInfo.expected)}
              {completed.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, styles.weekCompletedLabel]}>Completed</Text>
                  {completed.map(renderWeekRow)}
                </>
              )}
            </View>
          )}
        </View>
      );
    });
  };

  // ==== render. Everything below is JSX ====
  return (
    <View
      ref={rootRef}
      style={[styles.container, { paddingTop: insets.top }]}
      {...dragResponder.panHandlers}
      onTouchEnd={handleRootTouchEnd}
      onTouchCancel={handleRootTouchEnd}
    >
      <ScreenHeader
        title="Calendar"
        subtitle={viewMode === 'week'
          ? (weekOutstanding > 0 ? `${weekOutstanding} outstanding${weekHasToday ? ' this week' : ''}` : undefined)
          : (monthOutstanding > 0 ? `${monthOutstanding} outstanding in ${format(displayMonth, 'MMMM')}` : undefined)}
        actions={withScreenSettings([
          // Re-reads the system calendar now, for an event just changed in
          // another app. Absent when nothing is being read (or in a demo).
          ...(calendarReadEnabled && !isDemoModeActive() ? [{
            icon: 'sync-outline' as const,
            onPress: () => { haptics.tap(); void syncCalendar(); },
            loading: syncingCalendar,
            disabled: syncingCalendar,
            accessibilityLabel: 'Sync calendar events',
          }] : []),
          {
            icon: 'today-outline',
            onPress: goToToday,
            accessibilityLabel: 'Go to today',
          },
          // Opens the quick-add event card on the selected day; its calendar
          // chip picks where it's saved (Google included). Absent in a demo,
          // where it would write to the real calendar.
          ...(isDemoModeActive() ? [] : [{
            icon: 'add' as const,
            onPress: () => {
              haptics.tap();
              setNewEventSeed(null);
              setNewEventVisible(true);
            },
            accessibilityLabel: `New event on ${format(dayKeyToDate(selectedKey), 'MMMM d')}`,
          }]),
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />

      {/* Same shape as Today's own lens pills. Deliberately not HubPills:
          these switch a sub-view rather than navigating. */}
      <View style={styles.viewModePills}>
        {VIEW_MODES.map(mode => {
          const active = viewMode === mode.value;
          return (
            <TouchableOpacity
              key={mode.value}
              style={[styles.viewModePill, active && styles.viewModePillActive]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => switchViewMode(mode.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${mode.label} view`}
            >
              <Text style={[styles.viewModePillText, active && styles.viewModePillTextActive]}>
                {mode.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        {/* A labeled switch rather than a header icon: a bare repeat glyph
            read as a sync button, and this is a way of reading the grid, not
            an action. */}
        <TouchableOpacity
          style={styles.repeatsToggle}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); setProjecting(p => !p); }}
          accessibilityRole="switch"
          accessibilityState={{ checked: projecting }}
          accessibilityLabel="Show repeats that have no task yet"
        >
          <Ionicons
            name={projecting ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={projecting ? colors.accentText : colors.textTertiary}
          />
          <Text style={[styles.repeatsToggleText, projecting && styles.repeatsToggleTextOn]}>
            Repeats
          </Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'month' ? (
        <PeriodNav
          label={format(displayMonth, 'MMMM yyyy')}
          onPrev={() => stepMonth(-1)}
          onNext={() => stepMonth(1)}
          prevAccessibilityLabel="Previous month"
          nextAccessibilityLabel="Next month"
        />
      ) : viewMode === 'week' ? (
        <PeriodNav
          label={describeWeekRange(weekDays)}
          sublabel={weekHasToday ? 'This week' : undefined}
          onPrev={() => stepWeek(-1)}
          onNext={() => stepWeek(1)}
          prevAccessibilityLabel="Previous week"
          nextAccessibilityLabel="Next week"
        />
      ) : (
        <PeriodNav
          label={format(selectedDate, 'EEEE, MMMM d')}
          sublabel={selectedKey === todayKey ? 'Today' : undefined}
          onPrev={() => stepDay(-1)}
          onNext={() => stepDay(1)}
          prevAccessibilityLabel="Previous day"
          nextAccessibilityLabel="Next day"
        />
      )}

      {viewMode === 'month' && (
      <View style={styles.calendar}>
        <View style={styles.dayHeaders}>
          {dayHeaders.map((d, i) => (
            <View key={i} style={styles.dayHeaderCell}>
              <Text maxFontSizeMultiplier={textScale.badge} style={styles.dayHeaderText}>{d}</Text>
            </View>
          ))}
        </View>

        <View>
          {gridRows.map(row => (
            <View key={dayKeyOf(row[0])}>
              <View style={styles.gridRow}>
                {row.map(day => {
                  const key = dayKeyOf(day);
                  return (
                    <DayCell
                      key={key}
                      dayKey={key}
                      day={day}
                      bucket={buckets.get(key)}
                      weight={weightFor(dayLoads.get(key))}
                      hasMeal={(extras.get(key)?.meals.length ?? 0) > 0}
                      registerRef={registerCell}
                      dropChannel={dropChannel}
                      inMonth={isSameMonth(day, displayMonth)}
                      isToday={key === todayKey}
                      isSelected={key === selectedKey}
                      colors={colors}
                      styles={styles}
                      onSelect={selectDay}
                    />
                  );
                })}
              </View>
              {renderTripBands(row)}
            </View>
          ))}
        </View>
      </View>
      )}

      {viewMode === 'week' && (
      <View style={styles.calendar}>
        <View style={styles.dayHeaders}>
          {dayHeaders.map((d, i) => (
            <View key={i} style={styles.dayHeaderCell}>
              <Text maxFontSizeMultiplier={textScale.badge} style={styles.dayHeaderText}>{d}</Text>
            </View>
          ))}
        </View>
        <View style={styles.weekStrip}>
          {weekDays.map(day => {
            const key = dayKeyOf(day);
            return (
              <DayCell
                key={key}
                dayKey={key}
                day={day}
                bucket={buckets.get(key)}
                weight={weightFor(dayLoads.get(key))}
                hasMeal={(extras.get(key)?.meals.length ?? 0) > 0}
                registerRef={registerCell}
                dropChannel={dropChannel}
                // A week is read whole: a day across the month line is not a
                // neighbour's day here the way it is on the month grid.
                inMonth
                isToday={key === todayKey}
                isSelected={key === selectedKey}
                colors={colors}
                styles={styles}
                onSelect={selectDay}
              />
            );
          })}
        </View>
        {renderTripBands(weekDays)}
      </View>
      )}

      {viewMode !== 'week' && (
      <View style={styles.detailHeader}>
        <View style={styles.detailHeading}>
          {viewMode === 'month' && (
            <Text style={styles.detailDate}>{format(selectedDate, 'EEEE, MMMM d')}</Text>
          )}
          {summary !== '' && <Text style={styles.detailSummary}>{summary}</Text>}
        </View>
        {/* How many, then how much. Its own line rather than a third clause on
            the summary above, because counts and durations answer different
            questions and only one of them is estimated. */}
        {selectedLoad !== '' && <Text style={styles.detailLoad}>{selectedLoad}</Text>}
      </View>
      )}

      <ScrollView
        ref={detailScrollRef}
        style={[styles.detail, viewMode === 'week' && styles.weekList]}
        scrollEnabled={!draggingSubtask && draggingTask === null}
        contentContainerStyle={
          viewMode !== 'week' && (viewMode === 'day' ? dayEmpty : monthEmpty)
            ? { flexGrow: 1, paddingBottom: tabBarHeight + spacing.xl }
            : { paddingBottom: tabBarHeight + spacing.xl }
        }
        showsVerticalScrollIndicator={false}
      >
        {viewMode === 'week' ? renderWeek() : (viewMode === 'day' ? dayEmpty : monthEmpty) ? (
          <EmptyState
            icon="calendar-clear-outline"
            title="Nothing on this day"
            subtitle="Tasks land here from a due date, a deadline, or the day a task moved to Later comes back."
            bottomOffset={tabBarHeight}
            actionLabel="Add a task"
            onAction={() => setQuickAddVisible(true)}
          />
        ) : (
          <>
            {renderNotes(selectedExtras, viewMode !== 'day')}
            {viewMode === 'day' && (
              <>
                <DayTimeline
                  dayStart={selectedDayStart}
                  timeline={dayTimeline}
                  meals={dayMeals}
                  busyKnown={dayBusyKnown}
                  tripOnly={dayTripOnly}
                  use24Hour={use24Hour}
                  nowMinutes={nowMinutes}
                  onPressTask={handleRowPress}
                  onPressEvent={() => { haptics.tap(); setEventsSheetVisible(true); }}
                  onPressSlot={handlePressSlot}
                />
                {/* Everything the axis refused to place, as real rows. */}
                {renderRows('No time set', dayTimeline.unplaced)}
              </>
            )}
            {viewMode === 'month' && renderRows('Due', detail.due, selectedKey)}
            {viewMode === 'month' && renderRows('Deadline', detail.deadline)}
            {viewMode === 'month' && renderRows('Returning', detail.defer, selectedKey)}
            {renderExpected(detail.expected)}
            {renderRows('Completed', dayCompleted)}
          </>
        )}
      </ScrollView>

      <Fab
        onPress={() => setQuickAddVisible(true)}
        accessibilityLabel="Add task"
        bottom={insets.bottom + tabBarHeight + spacing.md}
      />

      {draggingTask && (
        <Animated.View
          pointerEvents="none"
          style={[styles.dragCard, shadows.card, { opacity: dragOpacity, transform: dragXY.getTranslateTransform() }]}
        >
          <Text style={styles.dragCardText} numberOfLines={1}>{draggingTask.title}</Text>
        </Animated.View>
      )}

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        initialDraft={editorInitialDraft}
        onClose={() => {
          setEditorVisible(false);
          setExpandedTaskId(null);
          setEditorInitialDraft(null);
        }}
      />

      <QuickAddModal
        visible={quickAddVisible}
        onClose={onQuickAddClose}
        onOpenFull={onQuickAddOpenFull}
        seed={quickAddSeed}
        seedLabel={quickAddTime
          ? `${format(selectedDate, 'MMM d')}, ${formatTimeOfDay(hhmmToDate(quickAddTime, selectedDate), use24Hour)}`
          : format(selectedDate, 'MMM d')}
      />

      <QuickEventSheet
        visible={newEventVisible}
        onClose={() => setNewEventVisible(false)}
        seed={newEventSeed ?? { day: dayKeyToDate(selectedKey) }}
      />
      <TimeSlotMenu
        visible={slotMenuOpen}
        at={slotMenu?.at ?? null}
        anchor={slotMenu?.anchor ?? null}
        use24Hour={use24Hour}
        canAddEvent={!isDemoModeActive()}
        onClose={() => setSlotMenuOpen(false)}
        onNewTask={at => { setQuickAddTime(dateToHHMM(at)); setQuickAddVisible(true); }}
        onNewEvent={at => {
          // An hour, the length a calendar app gives a new event by default;
          // the card's own fields change it.
          setNewEventSeed({ start: at, end: new Date(at.getTime() + 60 * 60000) });
          setNewEventVisible(true);
        }}
      />
      <TodayEventsSheet
        visible={eventsSheetVisible}
        onClose={() => setEventsSheetVisible(false)}
        events={dayEvents}
        calendarsById={eventCalendarTags}
        title={format(dayKeyToDate(selectedKey), 'EEEE, MMM d')}
        day={dayKeyToDate(selectedKey)}
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

/**
 * Memoized, and it takes its day key rather than a closure over it.
 *
 * Forty-two of these are mounted at once and the grid re-renders on every
 * selection tap, so without the memo one tap re-rendered the whole month. The
 * memo only pays off if the props are stable, which is why `onSelect` is one
 * callback for every cell and the cell passes its own key back up — an inline
 * `onPress` arrow is a fresh identity per cell per render and defeats it
 * outright. Same rule, and the same failure, as `renderTaskRow`'s `rowKey` on
 * Today.
 */
const DayCell = React.memo(function DayCell({
  dayKey, day, bucket, weight, hasMeal, inMonth, isToday, isSelected, colors, styles, onSelect, registerRef, dropChannel,
}: {
  dayKey: string;
  day: Date;
  bucket: DayBucket | undefined;
  weight: DayWeight | null;
  /** A planned meal on the day: one more dot, after the task kinds. */
  hasMeal: boolean;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onSelect: (dayKey: string) => void;
  /** Hands the cell's view up for measuring when a task drag starts. */
  registerRef: (dayKey: string, view: View | null) => void;
  /** Lights the cell while a dragged task is over it. */
  dropChannel: DropTargetChannel;
}) {
  const onPress = () => onSelect(dayKey);
  const aimed = useDropTargetAimed(dropChannel, dayKey);
  const dots = bucket?.dots ?? [];
  return (
    <TouchableOpacity
      ref={view => registerRef(dayKey, view as unknown as View | null)}
      style={[styles.dayCell, aimed && styles.dayCellAimed]}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={cellLabel(day, bucket, weight, hasMeal)}
    >
      <View style={styles.inlineWrap}>
        <View style={styles.dayStack}>
          <View style={[
            styles.dayCircle,
            isSelected && styles.dayCircleSelected,
            !isSelected && isToday && styles.dayCircleToday,
          ]}>
            <Text maxFontSizeMultiplier={textScale.badge} style={[
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
            {/* An away day draws nothing here: the trip's named band under
                the row says it, where WhenPicker's cell (no room for a band)
                still uses its two dashes. */}
            {weight && weight !== 'away' && (
              <View style={[
                styles.weightBar,
                weight === 'full' ? styles.weightBarFull : styles.weightBarBusy,
              ]} />
            )}
          </View>
        </View>
        {(dots.length > 0 || hasMeal) && (
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
            {/* Green, the kitchen's colour, and always solid: a meal isn't
                work, so it has no done or projected state to show. */}
            {hasMeal && <View style={[styles.dot, { backgroundColor: colors.green }]} />}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

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

function cellLabel(day: Date, bucket: DayBucket | undefined, weight: DayWeight | null, hasMeal: boolean): string {
  const date = format(day, 'MMMM d');
  // The cue is drawn, so it has to be spoken — and it can be the only thing a
  // cell carries, since a day made heavy by meetings alone has no dots.
  const suffix = (hasMeal ? ', meal planned' : '') + (weight ? `, ${describeDayWeight(weight)}` : '');
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

function makeStyles(colors: Colors, textScaleFactor = 1) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    calendar: {
      paddingHorizontal: spacing.md,
    },
    // Matches Today's own lens pills rather than inventing a second treatment.
    viewModePills: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xsm,
      paddingBottom: 4,
    },
    viewModePill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.bgSecondary,
    },
    viewModePillActive: {
      backgroundColor: colors.accentFill,
    },
    viewModePillText: {
      color: colors.textSecondary,
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
    },
    viewModePillTextActive: {
      color: colors.onAccent,
      fontWeight: fontWeight.semibold,
    },
    repeatsToggle: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
    },
    repeatsToggleText: {
      color: colors.textSecondary,
      fontSize: font.sm,
      fontWeight: fontWeight.medium,
    },
    repeatsToggleTextOn: {
      color: colors.accentText,
    },
    dayHeaders: {
      flexDirection: 'row',
      marginBottom: spacing.xxs,
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
    gridRow: {
      flexDirection: 'row',
      height: CELL_HEIGHT,
    },
    // A lane is positioned by its segments, which sit at their columns'
    // offsets; the lane only reserves the height.
    tripLane: {
      height: TRIP_BAND_HEIGHT,
      marginTop: TRIP_BAND_GAP,
    },
    // Neutral grey: being away is context for the day, not a kind of work, so
    // it borrows none of the dots' hues. bgQuaternary rather than bgTertiary,
    // which all but vanishes against the light theme's background.
    tripBand: {
      position: 'absolute',
      top: 0,
      height: TRIP_BAND_HEIGHT,
      borderRadius: TRIP_BAND_HEIGHT / 2,
      backgroundColor: colors.bgQuaternary,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.xsm,
    },
    tripBandOpenStart: {
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
    },
    tripBandOpenEnd: {
      borderTopRightRadius: 0,
      borderBottomRightRadius: 0,
    },
    tripBandText: {
      flex: 1,
      color: colors.text,
      fontSize: font.xxs,
      fontWeight: fontWeight.medium,
    },
    // One row of the month's cells, so the week reads as a slice of the grid.
    weekStrip: {
      flexDirection: 'row',
      height: CELL_HEIGHT,
    },
    dayCell: {
      width: CELL_SIZE,
      height: CELL_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The day a dragged task would land on. Opaque, from flattenOverlay, for
    // the drag-overlay rule in CLAUDE.md.
    dayCellAimed: {
      backgroundColor: flattenOverlay(colors.accentSubtle, colors.bg),
      borderRadius: radius.md,
    },
    dragCard: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: DRAG_CARD_WIDTH,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.bgTertiary,
    },
    dragCardText: {
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.medium,
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
      gap: spacing.xxs,
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
      marginTop: spacing.xxs,
    },
    detail: {
      flex: 1,
    },
    // The strip sits right above the list, and the list's first day heading
    // carries no margin of its own.
    weekList: {
      marginTop: spacing.md,
    },
    weekDay: {
      marginBottom: spacing.lg,
    },
    weekDayDate: {
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    weekDayDateToday: {
      color: colors.accent,
    },
    weekDayRows: {
      marginTop: spacing.sm,
    },
    // Dim on purpose: on a day with nothing, the dimness is what says so.
    weekDayEmpty: {
      color: colors.textTertiary,
      fontSize: font.sm,
      paddingHorizontal: spacing.md,
      marginTop: spacing.xs,
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
    notesCard: {
      marginHorizontal: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.smd,
    },
    noteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.smd,
    },
    noteRowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    // Fixed width so every title in the card starts at the same x, whatever
    // the time's length ("9:00 AM" against "12:30 PM", or "All day").
    eventTime: {
      width: Math.round(64 * textScaleFactor),
      color: colors.textSecondary,
      fontSize: font.sm,
      fontVariant: ['tabular-nums'],
    },
    noteText: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
    },
    weekCompletedLabel: {
      marginTop: spacing.sm,
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
