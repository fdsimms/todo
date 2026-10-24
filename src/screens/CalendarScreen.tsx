import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWithoutLockedTasks } from '../hooks/useWithoutLockedTasks';
import { useStableCallback } from '../hooks/useStableCallback';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, TouchableOpacity } from 'react-native';
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
import { buildCalendarGrid, weekdayHeaders } from '../utils/calendarGrid';
import { dateToHHMM, dayKeyOf, dayKeyToDate, formatTimeOfDay, getDayStart, getLogicalToday, hhmmToDate } from '../utils/dateUtils';
import { buildDayBuckets, dayDetail, dayRows } from '../utils/calendarMonth';
import {
  buildDayAgenda,
  dayEventColors,
  describeUntimed,
  scheduleBlocks,
  SCHEDULE_DAYS,
  summarizeAgenda,
  untimedTargetFor,
  type DayAgenda,
} from '../utils/calendarAgenda';
import { completionTapFor } from '../utils/completionTap';
import { useCalendarStore } from '../store/useCalendarStore';
import { useHiddenEventsStore } from '../store/useHiddenEventsStore';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { alertFailedWithSettings } from '../utils/permissionAlert';
import { hiddenEventKey } from '../utils/hiddenEvents';
import { sameMealPlanEntries, useMealPlanStore } from '../store/useMealPlanStore';
import { useFocusRefreshedRead } from '../hooks/useFocusRefreshedRead';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { DayTimeline } from '../components/DayTimeline';
import { MultiDayTimeline, type MultiDayColumn } from '../components/MultiDayTimeline';
import { buildDayTimeline } from '../utils/dayTimeline';
import { sunLocationOn } from '../utils/visibilityUtils';
import { eventsIn, type BusyEvent } from '../utils/calendarBusy';
import { isDemoModeActive } from '../utils/demoState';
import { QuickEventSheet, type QuickEventSeed } from '../components/QuickEventSheet';
import { TimeSlotMenu } from '../components/TimeSlotMenu';
import type { CardAnchor } from '../components/CardSheet';
import { useProjectStore } from '../store/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
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

type CalendarViewMode = 'day' | 'threeDay' | 'month' | 'schedule';
const VIEW_MODES: { value: CalendarViewMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'threeDay', label: '3 Day' },
  { value: 'month', label: 'Month' },
  { value: 'schedule', label: 'Schedule' },
];
/** How many days the 3 Day view draws side by side, from the selected one. */
const MULTI_DAY_COLUMNS = 3;

/** Every day from `from` to `to`, both included. */
function daysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const last = dayKeyOf(to);
  for (let day = from; dayKeyOf(day) <= last; day = addDays(day, 1)) out.push(day);
  return out;
}

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
 * The person's calendar: a day, three days, a month, or the two weeks ahead.
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
 * Tasks are still bucketed once over the days read (`rangeDays`: the month's
 * grid and a little past it), since each cell filtering the task list is
 * O(days × tasks) a render, and only to find each day's rows, from which the
 * agenda keeps the timed ones. Events come from three reads: the store's two
 * weeks, the grid read over the same days, and the multi-day read 90 days out
 * (`eventsForDay`).
 *
 * Four ways to read it, switched by the pill row: one day on a clock (where
 * an event can be made, moved or stretched by dragging), three days side by
 * side on one clock, the month grid over the selected day's agenda, and
 * Schedule, the two weeks from today as one list. All four read the same
 * buckets and events.
 *
 * The component is one function; `grep -n '// ===='` is its table of contents:
 * stores and screen state, the month (grid, buckets, events, the selected
 * day's agenda), the Day view's drags, 3 Day, Schedule, moving between days
 * and months, tasks and the
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
  /**
   * The days tasks and events are read over: the month's grid, two days past
   * its last cell (the 3 Day view starting there has the rest of its columns),
   * and in Schedule the two weeks from today. Schedule always opens on today's
   * month (`switchViewMode`), so the range only stretches by the days the
   * month's grid stops short of.
   */
  const scheduleDays = useMemo(
    () => Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(dayKeyToDate(logicalTodayKey), i)),
    [logicalTodayKey],
  );
  const rangeDays = useMemo(() => {
    let from = days[0];
    let to = addDays(days[days.length - 1], MULTI_DAY_COLUMNS - 1);
    if (viewMode === 'schedule') {
      if (scheduleDays[0] < from) from = scheduleDays[0];
      const last = scheduleDays[scheduleDays.length - 1];
      if (last > to) to = last;
    }
    return daysBetween(from, to);
  }, [days, viewMode, scheduleDays]);
  // Only to find each day's task rows; the agenda keeps the ones with a time.
  // Never projected: a repeat that has no row yet has no time to place it by.
  const buckets = useMemo(
    () => buildDayBuckets(allTasks, {
      from: rangeDays[0],
      to: rangeDays[rangeDays.length - 1],
      dayResetTime,
      projecting: false,
      projectFrom: dayKeyToDate(logicalTodayKey),
    }),
    [allTasks, rangeDays, dayResetTime, logicalTodayKey],
  );

  const taskById = useMemo(() => new Map(allTasks.map(t => [t.id, t])), [allTasks]);

  /**
   * Everything else the app knows about the grid's days: trips, meals,
   * birthdays and project deadlines (`calendarExtras.ts`).
   *
   * Built one day wider on each side than the days read, so the grid's first
   * and last rows can tell whether a trip band carries on past them. The meals come
   * through the range read, never the loaded window alone, which is only the
   * week Meal Plan last opened.
   */
  const wideDays = useMemo(
    () => [addDays(rangeDays[0], -1), ...rangeDays, addDays(rangeDays[rangeDays.length - 1], 1)],
    [rangeDays],
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
   * The grid read: every event over the days read (`rangeDays`), so a day
   * past the store's two weeks still has its meetings. Taken again on focus, when the
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
  const gridRangeKey = `${dayKeyOf(rangeDays[0])}:${dayKeyOf(rangeDays[rangeDays.length - 1])}`;
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

  /**
   * An event the Day view just moved, drawn where it was put until the
   * calendar read comes back with it there. Without it the block jumps back to
   * its old time for the moment the write and the re-read take. Cleared by the
   * next read (the effect below), or on a failed write.
   */
  const [pendingMove, setPendingMove] = useState<{ eventId: string; start: string; end: string } | null>(null);
  useEffect(() => { setPendingMove(null); }, [calendarEvents, gridEvents]);
  const timelineEvents = useMemo(
    () => (pendingMove
      ? selectedDay.shown.map(e => (e.id === pendingMove.eventId ? { ...e, start: pendingMove.start, end: pendingMove.end } : e))
      : selectedDay.shown),
    [selectedDay, pendingMove],
  );
  const dayTimeline = useMemo(
    () => buildDayTimeline({
      dayStart: selectedDayStart,
      tasks: dayRows(dayDetail(buckets.get(selectedKey), taskById)),
      events: timelineEvents,
      sunLocation: sunLocationOn(selectedDayStart),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buckets, taskById, selectedKey, selectedDayStart, timelineEvents, sunLocation, projects],
  );

  // ==== the Day view's drags: making, moving and stretching events ====
  // True while a drag on the timeline holds the finger; the scroll view is off
  // for that long (see DayTimeline's onDragStateChange).
  const [timelineDragging, setTimelineDragging] = useState(false);
  const timelineEventColor = useCallback((eventId: string) => {
    const event = selectedDay.shown.find(e => e.id === eventId);
    return event ? colorFor(event.calendarId) : undefined;
  }, [selectedDay, colorFor]);
  // Only an event wholly on this day: a block the day clipped is part of an
  // event, and dragging the part would move or shorten the whole.
  const canMoveTimelineEvent = useCallback((eventId: string) => {
    if (isDemoModeActive()) return false;
    const event = selectedDay.shown.find(e => e.id === eventId);
    if (!event || event.allDay) return false;
    const end = addDays(selectedDayStart, 1).getTime();
    return Date.parse(event.start) >= selectedDayStart.getTime() && Date.parse(event.end) <= end;
  }, [selectedDay, selectedDayStart]);
  const atMinutes = (minutes: number) => new Date(selectedDayStart.getTime() + minutes * 60000);
  const handleCreateRange = (startMinutes: number, endMinutes: number) => {
    setNewEventSeed({ start: atMinutes(startMinutes), end: atMinutes(endMinutes) });
    setNewEventVisible(true);
  };
  const handleRescheduleEvent = async (eventId: string, startMinutes: number, endMinutes: number) => {
    const event = selectedDay.shown.find(e => e.id === eventId);
    if (!event) return;
    const start = atMinutes(startMinutes);
    const end = atMinutes(endMinutes);
    setPendingMove({ eventId, start: start.toISOString(), end: end.toISOString() });
    const id = await useEventPeopleStore.getState().moveEvent(event, start, end);
    if (!id) {
      setPendingMove(null);
      alertFailedWithSettings(
        'Couldn’t move the event',
        'Check that calendar access is on in Settings and that this calendar can be changed, then try again.',
      );
      return;
    }
    readGrid();
  };
  const dayMeals = selectedExtras?.meals ?? NO_MEALS;

  // Only drawn on the day you are actually in.
  const nowMinutesOn = (key: string, start: Date) => (key === todayKey
    ? Math.round((Date.now() - start.getTime()) / 60000)
    : null);
  const nowMinutes = nowMinutesOn(selectedKey, selectedDayStart);
  const reading = calendarReadEnabled && !isDemoModeActive();

  // ==== 3 Day: the selected day and the two after it, on one clock ====
  const multiDayColumns = useMemo((): MultiDayColumn[] => {
    if (viewMode !== 'threeDay') return [];
    return Array.from({ length: MULTI_DAY_COLUMNS }, (_, i) => {
      const date = addDays(dayKeyToDate(selectedKey), i);
      const key = dayKeyOf(date);
      const dayEvents = eventsForDay(key);
      const timeline = buildDayTimeline({
        dayStart: dayEvents.start,
        tasks: dayRows(dayDetail(buckets.get(key), taskById)),
        events: dayEvents.shown,
        sunLocation: sunLocationOn(dayEvents.start),
      });
      return {
        key,
        date,
        dayStart: dayEvents.start,
        timeline,
        isToday: key === todayKey,
        nowMinutes: key === todayKey ? Math.round((Date.now() - dayEvents.start.getTime()) / 60000) : null,
        untimed: timeline.unplaced.filter(t => !t.completed).length,
      };
    });
    // `sunLocation` and `projects` are deps because sunLocationOn reads both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedKey, eventsForDay, buckets, taskById, todayKey, sunLocation, projects]);
  // A column's event color, by event id, over all three columns' events.
  const multiDayEventColor = useCallback((eventId: string) => {
    for (const column of multiDayColumns) {
      const event = eventsForDay(column.key).shown.find(e => e.id === eventId);
      if (event) return colorFor(event.calendarId);
    }
    return undefined;
  }, [multiDayColumns, eventsForDay, colorFor]);

  // ==== Schedule: two weeks from today, empty runs folded ====
  const scheduleItems = useMemo(() => {
    if (viewMode !== 'schedule') return [];
    return scheduleDays.map(day => {
      const key = dayKeyOf(day);
      const dayEvents = eventsForDay(key);
      const agenda = agendaFor(key, dayEvents);
      const isEmpty = agenda.items.length === 0 && agenda.allDay.length === 0
        && agenda.untimed.length === 0 && !hasDayNotes(extras.get(key), true) && dayEvents.known;
      return { day, key, dayEvents, agenda, isEmpty };
    });
  }, [viewMode, scheduleDays, eventsForDay, agendaFor, extras]);
  const scheduleList = useMemo(
    () => scheduleBlocks(scheduleItems.map(({ key, isEmpty }) => ({ key, isEmpty })), todayKey),
    [scheduleItems, todayKey],
  );
  const detailScrollRef = useRef<ScrollView>(null);

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
  }, []);

  const switchViewMode = (mode: CalendarViewMode) => {
    haptics.tap();
    // Schedule always starts at today, so the month and the selection follow
    // it there, which also keeps the days read to today's month.
    if (mode === 'schedule') {
      const today = getLogicalToday();
      setDisplayMonth(startOfMonth(today));
      setSelectedKey(dayKeyOf(today));
    }
    detailScrollRef.current?.scrollTo({ y: 0, animated: false });
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

  // The event sheet opens on the event tapped, narrowed to it (`focus`); with
  // no event it lists the day.
  const [focusEvent, setFocusEvent] = useState<BusyEvent | null>(null);
  const openEvent = useCallback((key: string, event: BusyEvent | null = null) => {
    haptics.tap();
    setSelectedKey(key);
    setFocusEvent(event);
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
  const onQuickAddClose = useStableCallback(() => { setQuickAddVisible(false); setQuickAddTime(null); setSlotDayKey(null); });
  const onQuickAddOpenFull = useStableCallback(handleQuickAddOpenFull);
  // A tapped time on the day view adds a start time (`windowStart`, which is
  // what places a task on the axis) to the day the seed already carries.
  const [quickAddTime, setQuickAddTime] = useState<string | null>(null);
  // The day a time was tapped on, which in the 3 Day view need not be the
  // selected one; quick add dates its task from it.
  const [slotDayKey, setSlotDayKey] = useState<string | null>(null);
  const quickAddDate = dayKeyToDate(slotDayKey ?? selectedKey);
  const quickAddSeed = useMemo(
    () => ({ dueDate: dayKeyToDate(slotDayKey ?? selectedKey).toISOString(), ...(quickAddTime ? { windowStart: quickAddTime } : {}) }),
    [slotDayKey, selectedKey, quickAddTime],
  );
  // The empty-slot menu on the day view, and the event it may seed.
  const [slotMenu, setSlotMenu] = useState<{ at: Date; anchor: CardAnchor } | null>(null);
  const [slotMenuOpen, setSlotMenuOpen] = useState(false);
  const [newEventSeed, setNewEventSeed] = useState<QuickEventSeed | null>(null);
  const handlePressSlotOn = useCallback((dayKey: string, minutes: number, pageX: number, pageY: number) => {
    haptics.tap();
    setSlotDayKey(dayKey);
    setSlotMenu({ at: new Date(dayStartOf(dayKey).getTime() + minutes * 60000), anchor: { x: pageX, y: pageY } });
    setSlotMenuOpen(true);
  }, [dayStartOf]);
  const handlePressSlot = useCallback(
    (minutes: number, pageX: number, pageY: number) => handlePressSlotOn(selectedKey, minutes, pageX, pageY),
    [handlePressSlotOn, selectedKey],
  );
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
          onPressEvent={event => openEvent(key, event)}
          onPressTask={openTask}
          onToggleTask={toggleTask}
          untimed={untimedLinkFor(key, agenda.untimed.length)}
          emptyText={note ?? 'Nothing scheduled.'}
        />
        {note !== null && agenda.items.length > 0 && <Text style={styles.unreadNote}>{note}</Text>}
      </View>
    );
  };

  /** "Today", "Tomorrow", or the weekday: a Schedule section's heading. */
  const scheduleDayName = (key: string, day: Date) => {
    if (key === todayKey) return 'Today';
    if (key === dayKeyOf(addDays(dayKeyToDate(todayKey), 1))) return 'Tomorrow';
    return format(day, 'EEEE');
  };

  /**
   * Two weeks from today as one list: each day with something on it as its
   * own section, and every run of days with nothing as a single dim line.
   */
  const renderSchedule = () => scheduleList.map(block => {
    if (block.kind === 'quiet') {
      const from = dayKeyToDate(block.from);
      const to = dayKeyToDate(block.to);
      const span = block.count === 1
        ? format(from, 'EEE, MMM d')
        : `${format(from, 'EEE, MMM d')} – ${format(to, 'EEE, MMM d')}`;
      return (
        <Text key={`quiet-${block.from}`} style={styles.quietRun}>{span} · Nothing scheduled</Text>
      );
    }
    const item = scheduleItems.find(it => it.key === block.key);
    if (!item) return null;
    const summary = summarizeAgenda(item.agenda);
    return (
      <View key={item.key} style={styles.scheduleDay}>
        <View style={styles.detailHeading}>
          <Text style={[styles.scheduleDayName, item.key === todayKey && styles.scheduleDayNameToday]}>
            {scheduleDayName(item.key, item.day)}
            <Text style={styles.scheduleDayDate}>  {format(item.day, 'MMM d')}</Text>
          </Text>
          {summary !== '' && <Text style={styles.detailSummary}>{summary}</Text>}
        </View>
        {renderAgendaDay(item.key, item.dayEvents, item.agenda, true)}
      </View>
    );
  });

  const threeDayLabel = (() => {
    const first = dayKeyToDate(selectedKey);
    const last = addDays(first, MULTI_DAY_COLUMNS - 1);
    return isSameMonth(first, last)
      ? `${format(first, 'MMM d')} – ${format(last, 'd')}`
      : `${format(first, 'MMM d')} – ${format(last, 'MMM d')}`;
  })();
  const scheduleLabel = `${format(scheduleDays[0], 'MMM d')} – ${format(scheduleDays[scheduleDays.length - 1], 'MMM d')}`;

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
      ) : viewMode === 'threeDay' ? (
        <PeriodNav
          label={threeDayLabel}
          sublabel={multiDayColumns.some(c => c.isToday) ? 'Includes today' : undefined}
          onPrev={() => stepDay(-MULTI_DAY_COLUMNS)}
          onNext={() => stepDay(MULTI_DAY_COLUMNS)}
          prevAccessibilityLabel="Previous three days"
          nextAccessibilityLabel="Next three days"
        />
      ) : viewMode === 'schedule' ? (
        // Schedule doesn't page: it is always the two weeks from today.
        <View style={styles.scheduleRange}>
          <Text style={styles.scheduleRangeText}>{scheduleLabel}</Text>
        </View>
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
        scrollEnabled={!timelineDragging}
        style={styles.detail}
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {viewMode === 'schedule' ? renderSchedule() : viewMode === 'month' ? (
          renderAgendaDay(selectedKey, selectedDay, selectedAgenda, true)
        ) : viewMode === 'threeDay' ? (
          <MultiDayTimeline
            columns={multiDayColumns}
            use24Hour={use24Hour}
            eventColor={multiDayEventColor}
            onPressDay={key => { haptics.tap(); setSelectedKey(key); setViewMode('day'); }}
            onPressEvent={(key, eventId) => openEvent(key, eventsForDay(key).events.find(e => e.id === eventId) ?? null)}
            onPressAllDay={(key, event) => openEvent(key, event)}
            onPressTask={taskId => handlePressTimelineTask(taskId)}
            onPressUntimed={key => {
              const column = multiDayColumns.find(c => c.key === key);
              untimedLinkFor(key, column?.untimed ?? 0)?.onPress();
            }}
            onPressSlot={handlePressSlotOn}
          />
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
              onPressEvent={eventId => openEvent(selectedKey, selectedDay.events.find(e => e.id === eventId) ?? null)}
              onPressSlot={handlePressSlot}
              placeholderMinutes={slotMenuOpen && slotMenu && (slotDayKey ?? selectedKey) === selectedKey
                ? Math.round((slotMenu.at.getTime() - selectedDayStart.getTime()) / 60000)
                : null}
              eventColor={timelineEventColor}
              canMoveEvent={canMoveTimelineEvent}
              onCreateRange={isDemoModeActive() ? undefined : handleCreateRange}
              onRescheduleEvent={handleRescheduleEvent}
              onDragStateChange={setTimelineDragging}
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
            ? `${format(quickAddDate, 'MMM d')}, ${formatTimeOfDay(hhmmToDate(quickAddTime, quickAddDate), use24Hour)}`
            : format(quickAddDate, 'MMM d')}
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
          focus={focusEvent}
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
    // Schedule's line where the other views have their pager.
    scheduleRange: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    scheduleRangeText: {
      color: colors.text,
      fontSize: font.lg,
      fontWeight: fontWeight.semibold,
    },
    scheduleDay: {
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    scheduleDayName: {
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    scheduleDayNameToday: {
      color: colors.accentText,
    },
    scheduleDayDate: {
      color: colors.textSecondary,
      fontWeight: fontWeight.regular,
    },
    // Dim on purpose: a run of empty days is the absence of anything to read.
    quietRun: {
      color: colors.textSecondary,
      fontSize: font.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
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
