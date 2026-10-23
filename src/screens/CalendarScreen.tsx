import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWithoutLockedTasks } from '../hooks/useWithoutLockedTasks';
import { useStableCallback } from '../hooks/useStableCallback';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, TouchableOpacity, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
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
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { PeriodNav } from '../components/PeriodNav';
import { QuickAddModal } from '../components/QuickAddModal';
import { TodayEventsSheet } from '../components/TodayEventsSheet';
import { CalendarAgenda, UntimedRow, type UntimedLink } from '../components/CalendarAgenda';
import { EmptyNote } from '../components/EmptyNote';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors, textScale } from '../theme';
import { useTextScale } from '../hooks/useTextScale';
import { monthCellSizeFor } from '../utils/frameWidth';
import { haptics } from '../utils/haptics';
import { resetToLocateTask, resetToMealPlan, showTodayViewMode } from '../navigation/navigationRef';
import { openSettingsEntryById } from '../navigation/openScreen';
import { buildCalendarGrid, buildWeekDays, weekdayHeaders } from '../utils/calendarGrid';
import { activeWeekDay, type WeekSection } from '../utils/weekScrollSpy';
import { dateToHHMM, dayKeyOf, dayKeyToDate, formatTimeOfDay, getDayStart, getLogicalToday, hhmmToDate } from '../utils/dateUtils';
import { buildDayBuckets, dayDetail, dayRows } from '../utils/calendarMonth';
import {
  buildDayAgenda,
  dayEventColors,
  describeUntimed,
  summarizeAgenda,
  untimedTargetFor,
  type DayAgenda,
} from '../utils/calendarAgenda';
import { completionTapFor } from '../utils/completionTap';
import { useCalendarStore } from '../store/useCalendarStore';
import { useHiddenEventsStore } from '../store/useHiddenEventsStore';
import { hiddenEventKey } from '../utils/hiddenEvents';
import { sameMealPlanEntries, useMealPlanStore } from '../store/useMealPlanStore';
import { useFocusRefreshedRead } from '../hooks/useFocusRefreshedRead';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { DayTimeline } from '../components/DayTimeline';
import { buildDayTimeline } from '../utils/dayTimeline';
import { sunLocationOn } from '../utils/visibilityUtils';
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
  hasDayNotes,
  tripBandLanes,
  type DayExtras,
} from '../utils/calendarExtras';
import { LazySheet } from '../components/LazySheet';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';

// A cell is a seventh of the column, read from the window as it is now: a Mac
// window or an iPad in Split View is resized after launch, so this can't be a
// module-level constant. Shorter than it is wide (#1746), with just enough
// room under the date's circle for a row of event dots.
const cellHeightFor = (cellSize: number) => cellSize - 4;
// One dot per event, up to three: enough to tell a quiet day from a full one
// without turning a cell into a legend.
const EVENT_DOT = 5;
const MAX_EVENT_DOTS = 3;

const NO_MEALS: MealPlanEntry[] = [];
const NO_DOTS: readonly string[] = [];
// A trip band's height, and the gap above it. One lane per overlapping trip.
const TRIP_BAND_HEIGHT = 16;
const TRIP_BAND_GAP = 2;

type CalendarViewMode = 'month' | 'week' | 'day';
const VIEW_MODES: { value: CalendarViewMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

/** What the screen knows about one day's events. See `eventsForDay`. */
interface DayEvents {
  start: Date;
  /** The day's calendar was read, so an empty list means an empty day. */
  known: boolean;
  /** Only the multi-day read reaches this day. */
  tripOnly: boolean;
  /** Everything read for the day, hidden events included (the event sheet unhides them). */
  events: BusyEvent[];
  /** What the grid and the agenda draw: `events` less the hidden ones. */
  shown: BusyEvent[];
}

/**
 * The person's calendar, a month, a week or a day at a time.
 *
 * **A view of calendar events first.** The grid marks a day with its events'
 * colors, and a day's list is an agenda: its events and the tasks that have a
 * clock time, in start order (`calendarAgenda.ts`). Every other task on the
 * day is one line saying how many there are, leading to the list that owns
 * them: Today for today or a day gone by, Later (scrolled to the day) for one
 * still to come. Task rows used to fill the day's list, which made the
 * calendar read as one more task list rather than as the calendar.
 *
 * Its own route rather than a fifth Today lens; see the Navigation note in
 * CLAUDE.md for why a segmented control shouldn't navigate.
 *
 * Tasks are still bucketed once per month in `calendarMonth.ts` (42 cells each
 * filtering the task list is O(days × tasks) a render), and only to find each
 * day's rows, from which the agenda keeps the timed ones. Events come from
 * three reads: the store's fortnight, the grid read over the 42 days on show,
 * and the multi-day read 90 days out (`eventsForDay`).
 *
 * Three ways to read it, switched by the pill row: the month grid over the
 * selected day's agenda, the week (one row of the same cells over every day of
 * that week as its own agenda), and one day on a clock. All three read the
 * same buckets, which are always built over the selected day's month grid —
 * a week containing any day of a month is inside that month's 42 cells.
 *
 * The component is one function; `grep -n '// ===='` is its table of contents:
 * stores and screen state, the month (grid, buckets, events, the selected
 * day's agenda), the week, moving between days and months, tasks and the
 * editor, then the JSX. The header's "+" opens the quick-add event card
 * (`QuickEventSheet`) on the selected day.
 */
export function CalendarScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  // This screen's own settings, from a gear in its header. See SCREEN_SETTINGS.
  const screenSettings = useScreenSettings('Calendar', 'Calendar settings');
  const textScaleFactor = useTextScale();
  const { width: windowWidth } = useWindowDimensions();
  const cellSize = monthCellSizeFor(windowWidth, spacing.md);
  const styles = useMemo(
    () => makeStyles(colors, textScaleFactor, cellSize),
    [colors, textScaleFactor, cellSize],
  );

  // ==== stores and screen state ====
  const allTasks = useWithoutLockedTasks(useTaskStore(s => s.tasks));
  const completeTask = useTaskStore(s => s.completeTask);
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const sunLocation = useSettingsStore(s => s.sunLocation);
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const calendarIds = useSettingsStore(s => s.calendarIds);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const people = usePersonStore(s => s.people);
  const navigation = useNavigation<any>();
  // Same rule as Today's: which calendar an event came from is only worth a
  // tag in the event sheet once more than one is being read.
  const calendarsById = useCalendarStore(s => s.calendarsById);
  const gridCalendarsById = useCalendarStore(s => s.gridCalendarsById);
  const eventCalendarTags = calendarIds.length > 1 ? calendarsById : undefined;
  // Tapping an event opens the same sheet Today's event row does, for its
  // day: who it's with, a reminder, a task from it, hiding it.
  const [eventsSheetVisible, setEventsSheetVisible] = useState(false);
  const [newEventVisible, setNewEventVisible] = useState(false);
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarLoaded = useCalendarStore(s => s.loaded);
  const calendarWindowStart = useCalendarStore(s => s.windowStart);
  const calendarWindowEnd = useCalendarStore(s => s.windowEnd);
  const gridEvents = useCalendarStore(s => s.gridEvents);
  const gridLoaded = useCalendarStore(s => s.gridLoaded);
  const gridStart = useCalendarStore(s => s.gridStart);
  const gridEnd = useCalendarStore(s => s.gridEnd);
  // The trip read: events spanning days, ninety days out, so a far day can
  // still show the trip it falls in and the event sheet can offer to make it
  // one. Read on focus, the way PersonDetail reads its past window.
  const aheadEvents = useCalendarStore(s => s.aheadEvents);
  const aheadLoaded = useCalendarStore(s => s.aheadLoaded);
  const aheadWindowEnd = useCalendarStore(s => s.aheadWindowEnd);
  useFocusEffect(useCallback(() => {
    if (useSettingsStore.getState().calendarReadEnabled) void useCalendarStore.getState().refreshAhead();
  }, []));
  // Read raw rather than through `isHidden`, which closes over the store and
  // wouldn't re-render this screen when an event is hidden from its sheet.
  const hiddenByKey = useHiddenEventsStore(s => s.hiddenByKey);

  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(getLogicalToday()));
  const [selectedKey, setSelectedKey] = useState(() => dayKeyOf(getLogicalToday()));
  // A link naming a day (the Calendar widget's taps, `resetToCalendar`) lands
  // on it. Stamped rather than watched for change, the same idiom Meal Plan's
  // `focusDay` uses: the day is the payload and the stamp is the event.
  const route = useRoute<any>();
  const focusDay: string | undefined = route.params?.focusDay;
  const focusStamp: number | undefined = route.params?.focusStamp;
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  useEffect(() => {
    if (focusStamp === undefined || focusStamp === handledFocus || !focusDay) return;
    setHandledFocus(focusStamp);
    const day = dayKeyToDate(focusDay);
    setDisplayMonth(startOfMonth(day));
    setSelectedKey(focusDay);
  }, [focusDay, focusStamp, handledFocus]);
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  // Month, week or one day on a clock. Session-only: which way you are reading
  // this month is not a preference about the app.
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  // Stable, so the memoized editor isn't re-rendered by every render here.
  const closeEditor = useCallback(() => {
    setEditorVisible(false);
    setEditorInitialDraft(null);
  }, []);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  // A completion that asks a question asks it here, as the task's own row would.
  const { enqueue, queueProps } = useAnswerFirstCompletion();
  // Subscribed only so a meal edited in the loaded window redraws; the grid's
  // own meals come through entriesInRangeLive.
  const mealEntries = useMealPlanStore(useShallow(s => s.entries));
  const entriesInRangeLive = useMealPlanStore(s => s.entriesInRangeLive);
  const projects = useProjectStore(useShallow(s => s.projects));

  // ==== the month: grid, buckets, events and the selected day's agenda ====
  const days = useMemo(() => buildCalendarGrid(displayMonth, weekStartsOn), [displayMonth, weekStartsOn]);
  /**
   * Every live away span, so a month holding a trip says so.
   *
   * All of them rather than the nearest one, since the grid pages through
   * months and can reach past whichever trip is next. A span already over is
   * kept: a month view of last month is entitled to say you were away.
   */
  const trips = useMemo(() => calendarTrips(projects, dayResetTime), [projects, dayResetTime]);
  const dayHeaders = useMemo(() => weekdayHeaders(weekStartsOn), [weekStartsOn]);

  // Keyed rather than a Date, so the memo below only rebuilds when the day turns.
  const logicalTodayKey = dayKeyOf(getLogicalToday());
  // Only to find each day's task rows; the agenda keeps the ones with a time.
  // Never projected: a repeat that has no row yet has no time to place it by.
  const buckets = useMemo(
    () => buildDayBuckets(allTasks, {
      from: days[0],
      to: days[days.length - 1],
      dayResetTime,
      projecting: false,
      projectFrom: dayKeyToDate(logicalTodayKey),
    }),
    [allTasks, days, dayResetTime, logicalTodayKey],
  );

  const taskById = useMemo(() => new Map(allTasks.map(t => [t.id, t])), [allTasks]);

  /**
   * Everything else the app knows about the grid's days: trips, meals,
   * birthdays and project deadlines (`calendarExtras.ts`).
   *
   * Built one day wider on each side than the grid, so the first and last
   * rows can tell whether a trip band carries on past them. The meals come
   * through the range read, never the loaded window alone, which is only the
   * week Meal Plan last opened.
   */
  const wideDays = useMemo(
    () => [addDays(days[0], -1), ...days, addDays(days[days.length - 1], 1)],
    [days],
  );
  // A read that goes past a store to SQLite, so it is taken again on each
  // focus, after another screen may have written; it stays the same array
  // while it finds the same rows, so the extras below aren't rebuilt over
  // every task for meals that didn't change (see useFocusRefreshedRead).
  // `mealEntries` isn't read: it is what tells the read to run again when a
  // meal in the meal plan's loaded week is edited.
  const gridMeals = useFocusRefreshedRead(
    () => (kitchenEnabled
      ? entriesInRangeLive(dayKeyOf(wideDays[0]), dayKeyOf(wideDays[wideDays.length - 1]))
      : NO_MEALS),
    [wideDays, kitchenEnabled, entriesInRangeLive, mealEntries],
    sameMealPlanEntries,
  );
  const extras = useMemo(
    () => buildDayExtras(wideDays, { trips, meals: gridMeals, people, projects, dayResetTime }),
    [wideDays, gridMeals, trips, people, projects, dayResetTime],
  );
  const selectedExtras = extras.get(selectedKey);

  /**
   * The grid read: every event over the 42 days on show, so a day past the
   * store's fortnight still has its meetings. Taken again on focus, when the
   * month changes, and whenever the fortnight read changes, which is the
   * store's own signal that the calendar database moved.
   */
  const dayStartOf = useCallback((key: string) => {
    // Noon-anchored, never the key's midnight: under a non-midnight reset the
    // day's start is the reset time on that date, and anchoring from midnight
    // lands on the day before. Same derivation buildDayLoads makes.
    const noon = dayKeyToDate(key);
    noon.setHours(12, 0, 0, 0);
    return getDayStart(noon, dayResetTime);
  }, [dayResetTime]);
  const gridRangeKey = `${dayKeyOf(days[0])}:${dayKeyOf(days[days.length - 1])}`;
  const readGrid = useCallback(() => {
    if (!useSettingsStore.getState().calendarReadEnabled) return;
    const [firstKey, lastKey] = gridRangeKey.split(':');
    void useCalendarStore.getState().refreshGrid(dayStartOf(firstKey), addDays(dayStartOf(lastKey), 1));
  }, [gridRangeKey, dayStartOf]);
  useFocusEffect(readGrid);
  useEffect(() => { readGrid(); }, [readGrid, calendarEvents, calendarIds, calendarReadEnabled]);

  /**
   * One day's calendar events, and how much is known about it. Shared by
   * every view.
   *
   * - `known`: "couldn't read" and "nothing on" are different answers. The
   *   fortnight read answers first, then the grid read; a day neither covers
   *   is unknown rather than confidently empty.
   * - `tripOnly`: past both, only the trip read reaches, multi-day events,
   *   and the day still reads as not known for anything else, since one long
   *   event says nothing about the meetings around it.
   */
  const eventsForDay = useCallback((key: string): DayEvents => {
    const start = dayStartOf(key);
    const end = addDays(start, 1);
    const reading = calendarReadEnabled && !isDemoModeActive();
    const inWindow = (from: string | null, to: string | null) =>
      !!from && !!to && start >= new Date(from) && end <= new Date(to);
    const inFortnight = reading && calendarLoaded && inWindow(calendarWindowStart, calendarWindowEnd);
    const inGrid = !inFortnight && reading && gridLoaded && inWindow(gridStart, gridEnd);
    const known = inFortnight || inGrid;
    const tripOnly = !known && reading && aheadLoaded && aheadWindowEnd !== null && end <= new Date(aheadWindowEnd);
    const events = inFortnight
      ? eventsIn(calendarEvents, start, end)
      : inGrid ? eventsIn(gridEvents, start, end)
        : tripOnly ? eventsIn(aheadEvents, start, end) : [];
    const shown = events.filter(e => !(hiddenEventKey(e) in hiddenByKey));
    return { start, known, tripOnly, events, shown };
  }, [dayStartOf, calendarReadEnabled, calendarLoaded, calendarWindowStart, calendarWindowEnd, gridLoaded,
      gridStart, gridEnd, aheadLoaded, aheadWindowEnd, calendarEvents, gridEvents, aheadEvents, hiddenByKey]);

  // A calendar's color from whichever read last named it. EventKit can hand
  // back an empty string, which counts as none.
  const colorFor = useCallback(
    (calendarId: string) => calendarsById[calendarId]?.color || gridCalendarsById[calendarId]?.color || undefined,
    [calendarsById, gridCalendarsById],
  );

  // Each cell's dots, built once per change to the events rather than per
  // cell per render, so `DayCell`'s memo holds across a selection tap.
  const dotsByDay = useMemo(() => {
    const map = new Map<string, { colors: readonly string[]; count: number }>();
    for (const day of days) {
      const key = dayKeyOf(day);
      const { shown } = eventsForDay(key);
      if (shown.length === 0) continue;
      map.set(key, { colors: dayEventColors(shown, colorFor, MAX_EVENT_DOTS), count: shown.length });
    }
    return map;
  }, [days, eventsForDay, colorFor]);

  // The logical day, so the cell ringed as "today" is the day the rest of the
  // app is showing. Before a 02:00 day reset the calendar has already rolled
  // over and Today has not.
  const todayKey = logicalTodayKey;

  /** A day's agenda: its events and timed tasks, and the tasks with no time. */
  const agendaFor = useCallback((key: string, dayEvents: DayEvents): DayAgenda => {
    const tasks = dayRows(dayDetail(buckets.get(key), taskById));
    return buildDayAgenda({
      dayStart: dayEvents.start,
      tasks,
      events: dayEvents.shown,
      // The day's own sun: a trip's destination on a day it covers, else home.
      sunLocation: sunLocationOn(dayEvents.start),
      now: key === todayKey ? new Date() : null,
    });
    // `sunLocation` and `projects` are deps because sunLocationOn reads both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, taskById, todayKey, sunLocation, projects]);

  const selectedDay = useMemo(() => eventsForDay(selectedKey), [eventsForDay, selectedKey]);
  const selectedDayStart = selectedDay.start;
  const selectedAgenda = useMemo(() => agendaFor(selectedKey, selectedDay), [agendaFor, selectedKey, selectedDay]);

  const dayTimeline = useMemo(
    () => buildDayTimeline({
      dayStart: selectedDayStart,
      tasks: dayRows(dayDetail(buckets.get(selectedKey), taskById)),
      events: selectedDay.shown,
      sunLocation: sunLocationOn(selectedDayStart),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, taskById, selectedKey, selectedDayStart, selectedDay, sunLocation, projects],
  );
  const dayMeals = selectedExtras?.meals ?? NO_MEALS;

  // Only drawn on the day you are actually in.
  const nowMinutesOn = (key: string, start: Date) => (key === todayKey
    ? Math.round((Date.now() - start.getTime()) / 60000)
    : null);
  const nowMinutes = nowMinutesOn(selectedKey, selectedDayStart);
  const reading = calendarReadEnabled && !isDemoModeActive();

  // ==== the week: the selected day's week, one agenda per day ====
  // Every day of it resolves against the month grid's buckets: the selected
  // day is always in the displayed month, so its whole week is in the grid.
  // Keyed on the week rather than the selected day, so marking another day of
  // the same week (a tap, or scrolling the list) doesn't rebuild the seven.
  const weekStartKey = dayKeyOf(buildWeekDays(dayKeyToDate(selectedKey), weekStartsOn)[0]);
  const weekDays = useMemo(
    () => buildWeekDays(dayKeyToDate(weekStartKey), weekStartsOn),
    [weekStartKey, weekStartsOn],
  );
  const weekAgendas = useMemo(
    () => weekDays.map(day => {
      const key = dayKeyOf(day);
      const dayEvents = eventsForDay(key);
      return { day, key, dayEvents, agenda: agendaFor(key, dayEvents) };
    }),
    [weekDays, eventsForDay, agendaFor],
  );
  const weekHasToday = weekAgendas.some(({ key }) => key === todayKey);
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
  // Scrolling the list marks the day you've scrolled to (activeWeekDay). Only
  // a scroll the reader started counts: the list's own scrollTo, to a day
  // tapped in the strip, passes over the days between and may stop short of
  // the tapped one at the end of the list, and neither should move the mark.
  const weekSpyLive = useRef(false);
  const weekViewportHeight = useRef(0);
  const weekContentHeight = useRef(0);
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  // The section map keeps the weeks paged past, so the spy reads only this one.
  const weekKeysRef = useRef<string[]>([]);
  weekKeysRef.current = weekDays.map(dayKeyOf);
  const onWeekScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!weekSpyLive.current || viewModeRef.current !== 'week') return;
    const sections: WeekSection[] = [];
    for (const key of weekKeysRef.current) {
      const y = weekSectionY.current.get(key);
      if (y !== undefined) sections.push({ key, y });
    }
    const key = activeWeekDay(
      sections,
      e.nativeEvent.contentOffset.y,
      weekViewportHeight.current,
      weekContentHeight.current,
    );
    if (key !== null && key !== selectedKeyRef.current) {
      selectedKeyRef.current = key;
      setSelectedKey(key);
    }
  }, []);

  const selectedDate = dayKeyToDate(selectedKey);

  // ==== moving between days and months ====
  /**
   * Paging carries the selection with it, because a detail pane naming a day
   * that's no longer on screen is worse than an arbitrary one: the heading
   * would still read "Monday, August 10" under a September grid. Landing on
   * today when you page back into this month, and on the 1st otherwise, keeps
   * the two halves of the screen talking about the same month at all times.
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
    weekSpyLive.current = false;
    pendingWeekScroll.current = dayKeyOf(addDays(dayKeyToDate(selectedKey), delta * 7));
    stepDay(delta * 7);
  };

  const stepMonth = (delta: number) => {
    haptics.tap();
    const next = addMonths(displayMonth, delta);
    // The logical today, as goToToday and the initial state use: in the grace
    // window before dayResetTime the calendar date is already tomorrow.
    const today = getLogicalToday();
    setDisplayMonth(next);
    setSelectedKey(dayKeyOf(isSameMonth(next, today) ? today : startOfMonth(next)));
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
    setSelectedKey(key);
    // The week's strip doesn't change the list under it, only where you are
    // in it. Read through refs so this stays one stable callback.
    if (viewModeRef.current === 'week') {
      weekSpyLive.current = false;
      const y = weekSectionY.current.get(key);
      if (y !== undefined) detailScrollRef.current?.scrollTo({ y, animated: true });
    }
  }, []);

  const switchViewMode = (mode: CalendarViewMode) => {
    haptics.tap();
    if (mode === 'week') {
      pendingWeekScroll.current = selectedKey;
      weekSpyLive.current = false;
    }
    setViewMode(mode);
  };

  // ==== tasks: the timed ones' taps, the untimed link, the editor and quick add ====
  const openTask = useCallback((task: Task) => {
    haptics.tap();
    setEditorInitialDraft(null);
    setEditingTask(task);
    setEditorVisible(true);
  }, []);

  /**
   * A timed task's box does what its own row's would for the plain cases: a
   * tick, an untick, or the question it asks first. Everything else a row's
   * box can mean (logging one unit of a target, a slip, picking a meal) is
   * the row's to handle, so the box takes you to it on Today rather than
   * restating that switch here.
   */
  const toggleTask = useCallback((task: Task) => {
    const tap = completionTapFor(task);
    if (tap === 'uncomplete') {
      haptics.tap();
      uncompleteTask(task.id);
    } else if (tap === 'complete') {
      haptics.success();
      completeTask(task.id);
    } else if (tap === 'ask') {
      haptics.tap();
      enqueue([task.id]);
    } else {
      haptics.tap();
      resetToLocateTask(task.id);
    }
  }, [completeTask, uncompleteTask, enqueue]);

  const openEvent = useCallback((key: string) => {
    haptics.tap();
    setSelectedKey(key);
    setEventsSheetVisible(true);
  }, []);

  /** The line under a day's agenda leading to its other tasks, or null with none. */
  const untimedLinkFor = (key: string, count: number): UntimedLink | null => {
    if (count === 0) return null;
    const target = untimedTargetFor(key, todayKey);
    return {
      label: describeUntimed(count),
      action: target === 'later' ? 'Open in Later' : 'Open Today',
      onPress: () => {
        haptics.tap();
        if (target === 'later') showTodayViewMode('later', key);
        else showTodayViewMode('today');
      },
    };
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
  const handlePressTimelineTask = useCallback((taskId: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (task) openTask(task);
  }, [openTask]);

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
                    left: segment.startCol * cellSize + (segment.continuesBefore ? 0 : 3),
                    width: segment.span * cellSize - (segment.continuesBefore ? 0 : 3) - (segment.continuesAfter ? 0 : 3),
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
   * whose birthday it is and which project is due. Facts about the day the
   * app knows on its own rather than events on the calendar, so plain lines
   * above the agenda. A line with somewhere to go (a project, a person) opens it.
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
    );
  };

  /**
   * Why a day's events can't be shown, when they can't. "Nothing scheduled"
   * under a day nobody read would be a confident lie.
   */
  const unreadNote = (dayEvents: DayEvents): string | null => {
    if (!reading) return isDemoModeActive() ? null : 'Turn on Read my calendar in Settings to see your events here.';
    if (dayEvents.known) return null;
    return dayEvents.tripOnly
      ? 'Only events lasting several days are read this far ahead.'
      : 'Calendar not read for this day yet.';
  };

  /** One day as notes, then its agenda, then the way to its other tasks. */
  const renderAgendaDay = (key: string, dayEvents: DayEvents, agenda: DayAgenda, includeMeals: boolean) => {
    const note = unreadNote(dayEvents);
    return (
      <View style={styles.dayBody}>
        {renderNotes(extras.get(key), includeMeals)}
        <CalendarAgenda
          agenda={agenda}
          dayStart={dayEvents.start}
          colorFor={colorFor}
          use24Hour={use24Hour}
          nowMinutes={nowMinutesOn(key, dayEvents.start)}
          onPressEvent={() => openEvent(key)}
          onPressTask={openTask}
          onToggleTask={toggleTask}
          untimed={untimedLinkFor(key, agenda.untimed.length)}
          emptyText={note ?? 'Nothing scheduled.'}
        />
        {note !== null && agenda.items.length > 0 && <Text style={styles.unreadNote}>{note}</Text>}
      </View>
    );
  };

  /**
   * The week as seven sections, every day drawn whether or not it holds
   * anything: a week with a gap in it is read as a week, and a missing
   * Wednesday would read as the list having skipped it.
   */
  const renderWeek = () => weekAgendas.map(({ day, key, dayEvents, agenda }) => {
    const isToday = key === todayKey;
    const summary = summarizeAgenda(agenda);
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
          {summary !== '' && <Text style={styles.detailSummary}>{summary}</Text>}
        </View>
        {renderAgendaDay(key, dayEvents, agenda, true)}
      </View>
    );
  });

  const selectedSummary = summarizeAgenda(selectedAgenda);
  const selectedUntimed = untimedLinkFor(selectedKey, dayTimeline.unplaced.filter(t => !t.completed).length);

  // ==== render. Everything below is JSX ====
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Calendar"
        actions={withScreenSettings([
          // Re-reads the system calendar now, for an event just changed in
          // another app. Absent when nothing is being read (or in a demo).
          ...(reading ? [{
            icon: 'sync-outline' as const,
            onPress: async () => {
              haptics.tap();
              setSyncingCalendar(true);
              try {
                const cal = useCalendarStore.getState();
                await Promise.all([cal.refresh(), cal.refreshAhead()]);
                readGrid();
              } finally {
                setSyncingCalendar(false);
              }
            },
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
                  const dots = dotsByDay.get(key);
                  return (
                    <DayCell
                      key={key}
                      dayKey={key}
                      day={day}
                      dots={dots?.colors ?? NO_DOTS}
                      eventCount={dots?.count ?? 0}
                      inMonth={isSameMonth(day, displayMonth)}
                      isToday={key === todayKey}
                      isSelected={key === selectedKey}
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
            const dots = dotsByDay.get(key);
            return (
              <DayCell
                key={key}
                dayKey={key}
                day={day}
                dots={dots?.colors ?? NO_DOTS}
                eventCount={dots?.count ?? 0}
                // A week is read whole: a day across the month line is not a
                // neighbour's day here the way it is on the month grid.
                inMonth
                isToday={key === todayKey}
                isSelected={key === selectedKey}
                styles={styles}
                onSelect={selectDay}
              />
            );
          })}
        </View>
        {renderTripBands(weekDays)}
      </View>
      )}

      {viewMode === 'month' && (
      <View style={styles.detailHeader}>
        <View style={styles.detailHeading}>
          <Text style={styles.detailDate}>
            {format(selectedDate, 'EEEE, MMMM d')}{selectedKey === todayKey ? ' · Today' : ''}
          </Text>
          {selectedSummary !== '' && <Text style={styles.detailSummary}>{selectedSummary}</Text>}
        </View>
      </View>
      )}

      <ScrollView
        refreshControl={pullSearch.refreshControl}
        ref={detailScrollRef}
        style={[styles.detail, viewMode === 'week' && styles.weekList]}
        onScroll={viewMode === 'week' ? onWeekScroll : undefined}
        scrollEventThrottle={viewMode === 'week' ? 32 : undefined}
        onScrollBeginDrag={() => { weekSpyLive.current = true; }}
        onLayout={e => { weekViewportHeight.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_, h) => { weekContentHeight.current = h; }}
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {viewMode === 'week' ? renderWeek() : viewMode === 'month' ? (
          renderAgendaDay(selectedKey, selectedDay, selectedAgenda, true)
        ) : (
          <>
            {renderNotes(selectedExtras, false)}
            {!reading && !isDemoModeActive() && (
              <View style={styles.dayBody}>
                <EmptyNote icon="calendar-outline">Turn on Read my calendar in Settings to see your events here.</EmptyNote>
              </View>
            )}
            <DayTimeline
              dayStart={selectedDayStart}
              timeline={dayTimeline}
              meals={dayMeals}
              busyKnown={selectedDay.known}
              tripOnly={selectedDay.tripOnly}
              use24Hour={use24Hour}
              nowMinutes={nowMinutes}
              onPressTask={handlePressTimelineTask}
              onPressEvent={() => openEvent(selectedKey)}
              onPressSlot={handlePressSlot}
              placeholderMinutes={slotMenuOpen && slotMenu
                ? Math.round((slotMenu.at.getTime() - selectedDayStart.getTime()) / 60000)
                : null}
            />
            {selectedUntimed && (
              <View style={styles.dayBody}>
                <UntimedRow link={selectedUntimed} />
              </View>
            )}
          </>
        )}
        {!reading && !isDemoModeActive() && viewMode !== 'day' && (
          <TouchableOpacity
            style={styles.settingsLink}
            activeOpacity={interaction.activeOpacity}
            onPress={() => openSettingsEntryById('calendarRead')}
            accessibilityRole="button"
          >
            <Text style={styles.settingsLinkText}>Open calendar settings</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <DeliverablePromptQueue {...queueProps} />

      <LazySheet open={editorVisible} warm>
        <TaskEditor
          visible={editorVisible}
          task={editingTask}
          initialDraft={editorInitialDraft}
          onClose={closeEditor}
        />
      </LazySheet>

      <LazySheet open={quickAddVisible}>
        <QuickAddModal
          visible={quickAddVisible}
          onClose={onQuickAddClose}
          onOpenFull={onQuickAddOpenFull}
          seed={quickAddSeed}
          seedLabel={quickAddTime
            ? `${format(selectedDate, 'MMM d')}, ${formatTimeOfDay(hhmmToDate(quickAddTime, selectedDate), use24Hour)}`
            : format(selectedDate, 'MMM d')}
        />
      </LazySheet>

      <LazySheet open={newEventVisible}>
        <QuickEventSheet
          visible={newEventVisible}
          onClose={() => setNewEventVisible(false)}
          seed={newEventSeed ?? { day: dayKeyToDate(selectedKey) }}
        />
      </LazySheet>
      <LazySheet open={slotMenuOpen}>
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
      </LazySheet>
      <LazySheet open={eventsSheetVisible}>
        <TodayEventsSheet
          visible={eventsSheetVisible}
          onClose={() => setEventsSheetVisible(false)}
          events={selectedDay.events}
          calendarsById={eventCalendarTags}
          title={format(dayKeyToDate(selectedKey), 'EEEE, MMM d')}
          day={dayKeyToDate(selectedKey)}
        />
      </LazySheet>
      {pullSearch.sheet}
    </View>
  );
}

/**
 * Memoized, and it takes its day key rather than a closure over it.
 *
 * Forty-two of these are mounted at once and the grid re-renders on every
 * selection tap, so without the memo one tap re-rendered the whole month. The
 * memo only pays off if the props are stable, which is why `onSelect` is one
 * callback for every cell and the cell passes its own key back up — an inline
 * `onPress` arrow is a fresh identity per cell per render and defeats it
 * outright. `dots` comes from one map built per change to the events for the
 * same reason. Same rule, and the same failure, as `renderTaskRow`'s `rowKey`
 * on Today.
 */
const DayCell = React.memo(function DayCell({
  dayKey, day, dots, eventCount, inMonth, isToday, isSelected, styles, onSelect,
}: {
  dayKey: string;
  day: Date;
  /** One color per event, in start order, up to `MAX_EVENT_DOTS`. */
  dots: readonly string[];
  eventCount: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  styles: ReturnType<typeof makeStyles>;
  onSelect: (dayKey: string) => void;
}) {
  const onPress = () => onSelect(dayKey);
  return (
    <TouchableOpacity
      style={styles.dayCell}
      activeOpacity={interaction.activeOpacity}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={cellLabel(day, eventCount)}
    >
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
      <View style={styles.dots}>
        {dots.map((color, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: color }, !inMonth && styles.dotOtherMonth]} />
        ))}
      </View>
    </TouchableOpacity>
  );
});

function cellLabel(day: Date, eventCount: number): string {
  const date = format(day, 'MMMM d');
  if (eventCount === 0) return date;
  return `${date}, ${eventCount} ${eventCount === 1 ? 'event' : 'events'}`;
}

function makeStyles(colors: Colors, textScaleFactor = 1, cellSize = 0) {
  const cellHeight = cellHeightFor(cellSize);
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
    dayHeaders: {
      flexDirection: 'row',
      marginBottom: spacing.xxs,
    },
    dayHeaderCell: {
      width: cellSize,
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
      height: cellHeight,
    },
    // A lane is positioned by its segments, which sit at their columns'
    // offsets; the lane only reserves the height.
    tripLane: {
      height: TRIP_BAND_HEIGHT,
      marginTop: TRIP_BAND_GAP,
    },
    // Neutral grey: being away is context for the day, not an event on a
    // calendar, so it borrows none of the calendars' colors. bgQuaternary
    // rather than bgTertiary, which all but vanishes against the light
    // theme's background.
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
      height: cellHeight,
    },
    dayCell: {
      width: cellSize,
      height: cellHeight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCircle: {
      width: cellSize - 18,
      height: cellSize - 18,
      borderRadius: (cellSize - 18) / 2,
      alignItems: 'center',
      justifyContent: 'center',
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
      color: colors.accentText,
      fontWeight: fontWeight.semibold,
    },
    // Under the circle, in the room the cell keeps for it; always laid out,
    // so a day with no events doesn't sit higher than one with some.
    dots: {
      flexDirection: 'row',
      gap: 3,
      height: EVENT_DOT,
      marginTop: 2,
    },
    dot: {
      width: EVENT_DOT,
      height: EVENT_DOT,
      borderRadius: EVENT_DOT / 2,
    },
    dotOtherMonth: {
      opacity: 0.5,
    },
    // Both sides: the grid sits directly above and the scrolling detail
    // directly below, and neither carries a margin of its own.
    detailHeader: {
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    detailHeading: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.sm,
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
      color: colors.accentText,
    },
    // A day's notes, agenda and task link, a block's gap apart.
    dayBody: {
      gap: spacing.sm,
      marginTop: spacing.sm,
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
    noteText: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
    },
    unreadNote: {
      color: colors.textSecondary,
      fontSize: font.sm,
      marginHorizontal: spacing.md,
    },
    settingsLink: {
      alignSelf: 'flex-start',
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      minHeight: 44,
      justifyContent: 'center',
    },
    settingsLinkText: {
      color: colors.accentText,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
  });
}
