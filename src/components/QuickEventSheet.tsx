import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  ScrollView,
  StyleSheet,
  Alert,
  Keyboard,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { startOfDay } from 'date-fns/startOfDay';
import { addDays } from 'date-fns/addDays';
import { addMinutes } from 'date-fns/addMinutes';
import { SheetModal } from './SheetModal';
import { SheetScrim } from './SheetScrim';
import { SafeBlurView } from './SafeBlurView';
import { PressableScale } from './PressableScale';
import { HighlightedText } from './HighlightedText';
import { TitleTokenAccessory } from './TitleTokenAccessory';
import { CalendarPicker } from './CalendarPicker';
import { EventOptionSheet, type EventOption } from './EventOptionSheet';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, animation, type Colors } from '../theme';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  TRAVEL_ARRIVE_CHOICES,
  TRAVEL_MODES,
  TRAVEL_ORIGIN_PHONE,
  describeArrival,
  originCandidates,
  travelOriginFor,
  type TravelMode,
} from '../utils/travelTasks';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { useEventCreatedToastStore } from '../store/useEventCreatedToastStore';
import { useTitleSelection } from '../hooks/useTitleSelection';
import { groupMentionTokens } from '../utils/peopleRegistry';
import {
  DEFAULT_EVENT_MINUTES,
  EVENT_REPEAT_PRESETS,
  describeEventRepeatShort,
  eventRepeatPresetKey,
  parseQuickEvent,
  type EventRecurrence,
} from '../utils/quickEvent';
import { calendarCovers, firstFreeSlot, overlappingEvents } from '../utils/eventConflicts';
import { eventMemoryKey, readEventMemory, rememberEvent, writeEventMemory, type EventMemory } from '../utils/eventMemory';
import {
  describeSavedEvent,
  findSavedEvent,
  readSavedEvents,
  recordSavedEventUse,
  removeSavedEvent,
  savedEventRecall,
  sortedSavedEvents,
  suggestSavedEvents,
  writeSavedEvents,
  type SavedEvent,
  type SavedEventFields,
} from '../utils/savedEvents';
import { useCalendarStore } from '../store/useCalendarStore';
import { useTaskStore } from '../store/useTaskStore';
import { defaultNewEventSpan } from '../utils/eventPeople';
import {
  readQuickEventDefaults,
  writeQuickEventDefaults,
  type EventAvailability,
} from '../utils/quickEventDefaults';
import { ALERT_CHOICES, alertMinutesFromOffset, describeAlert, quickEventSaveFields } from '../utils/quickEventSave';
import {
  getCalendarPermission,
  listWritableCalendars,
  requestCalendarPermission,
  readEventForEdit,
  resolveEventCalendar,
  type EventForEdit,
} from '../utils/calendarSync';
import type { Calendar as DeviceCalendar } from 'expo-calendar/legacy';
import { searchPlaces } from '../services/placeSearch';
import {
  addSavedPlace,
  findSavedPlace,
  readSavedPlaces,
  savedPlaceKey,
  savedPlaceWithText,
  suggestSavedPlaces,
  writeSavedPlaces,
  type SavedPlace,
} from '../utils/savedPlaces';
import {
  PLACE_QUERY_MIN_LENGTH,
  placeLocationText,
  placeSubtitle,
  placeRowTitle,
  PLACE_SUGGESTION_LIMIT,
  type PlaceResult,
} from '../utils/places';
import {
  findAmbiguousMention,
  getMentionSuggestions,
  withTrailingSpace,
  type MentionSuggestionCandidate,
} from '../utils/parseTaskInput';
import { mergeRanges } from '../utils/ranges';
import { aimTooltip } from '../utils/tooltipAim';
import { formatTimeOfDay, getCurrentDayStart, getLogicalNow } from '../utils/dateUtils';
import { animateLayout } from '../utils/layoutAnimation';
import { haptics } from '../utils/haptics';
import { alertFailedWithSettings } from '../utils/permissionAlert';
import { RotatingChevron } from './RotatingChevron';
import { isDemoModeActive } from '../utils/demoState';
import { TITLE_MAX_LENGTH } from '../types';
import { TextField } from './TextField';
import { BUTTON_LABEL } from '../copy/shared';

const EVENT_TOKEN_ACCESSORY_ID = 'quickEventTitleTokenAccessory';
/** Long enough that a word being typed is one request, not one per letter. */
const PLACE_SEARCH_DEBOUNCE_MS = 350;
/** "#" and "!" name a category and a priority, which an event doesn't have. */
const EVENT_TOKENS = ['@'] as const;

/**
 * What a caller that already knows something about the event starts the card
 * with: the day the screen it was opened from is on, a title, and the people
 * it is with (a person's "Plan something"). All optional, and all editable.
 */
export interface QuickEventSeed {
  day?: Date;
  /** An exact span, for a task's time block proposed in a free gap. Wins over `day`. */
  start?: Date;
  end?: Date;
  title?: string;
  personIds?: readonly string[];
  /** An all-day event; `start` is its day. Used by an imported event with no clock time. */
  allDay?: boolean;
  location?: string;
  /** Notes, or a lone link, for the "Notes or link" field. */
  notes?: string;
  /** Minutes before the start for the alert chip; omitted keeps the chip's default. */
  alertMinutes?: number | null;
}

/** An existing event to open the card on, instead of a new one. */
export interface QuickEventEditTarget {
  eventId: string;
  /** The occurrence tapped, for a repeating event: the edit applies to it alone. */
  occurrenceStart?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  seed?: QuickEventSeed | null;
  /** Opens the card on an existing event: its fields filled in, Save writes them back, and Delete is offered. */
  editing?: QuickEventEditTarget | null;
  /** Called with the event's id once it is saved (a new event or an edited one). */
  onSaved?: (eventId: string) => void;
  /** Called once the user has deleted the event from the card. */
  onDeleted?: () => void;
}

/**
 * Quick add for a calendar event: one line ("lunch w/ @gideon sat 12pm") in
 * the same floating card as task quick add (`QuickAddModal`), with the same
 * reading aids: the schedule phrase and each "@name" highlighted as you type,
 * a tooltip under the phrase to set it or say "not that", the pick-one pills
 * for an "@name" that is ambiguous or still being typed, and the keyboard bar
 * cut down to the one sigil an event reads ("@"). The check saves the event
 * straight into the calendar, with no system sheet (`saveEventDirect`); the
 * people named are linked once it is (`useEventPeopleStore.saveEvent`).
 *
 * **The rows Apple's form used to ask for are chips here** (calendar, alert,
 * repeat, and All day and Busy/Free as switches) and start as the last saved event left them
 * (`quickEventDefaults.ts`), so a usual event is a title and a day. A trailing
 * "at Joe's" and "alert 30m" in the line fill the place and the alert as you
 * type, and they win over a chip's earlier pick the way a typed day wins over
 * the date chip's. The trip, calendar and Busy/Free chips read the same way
 * ("walking", "10 min early", "from home", "in Work calendar", "show as free", "note: bring a guitar"). What can't be set from here at all is invitees and travel
 * time: EventKit exposes neither to a write.
 *
 * Its own component rather than a mode of `QuickAddModal`: that one builds a
 * task, and nearly all of it (category, tags, priority, chain steps, the
 * editor hand-off) means nothing for an event. The two share the parsers and
 * the tooltip's placement (`aimTooltip`), which is the part that has to agree.
 *
 * **Unlike a task, a phrase nobody tapped still counts.** Task quick add only
 * sets a date once its tooltip is accepted; an event always has a start, and
 * this line has always been read live, so pressing the arrow with the tooltip
 * still up uses what it says. Tapping it commits the date to the chip and
 * takes the words out of the title; its ✕ keeps them as title text.
 *
 * This one closes only once the event is saved. A failed save (calendar
 * access refused, no writable calendar) says so and leaves the line intact.
 *
 * **`editing` opens it on an event already on the calendar** (Today's events
 * sheet, a task's time block): the same fields, read in by
 * `readEventForEdit`, saved by `updateEventDirect`, with a Delete. The title
 * is read plain until it changes, and a repeating event is changed one
 * occurrence at a time. `docs/arch/people.md` has the rules.
 *
 * **A new event is three steps** (When, Where, Details) so each screen holds
 * one question, while the title stays on top and the header's check adds from
 * any step with what is filled in. Every field is still mounted state: a step
 * only decides which rows are drawn (`onStep`), so nothing about how a value
 * resolves depends on the step. The recap chips on the later steps read back
 * the earlier answers and jump to them. Where can be skipped with no place, and
 * its trip rows show greyed out until one is set. An edit has no steps and shows
 * every field at once.
 *
 * One component; `grep -n '// ===='` is its table of contents: sheet state,
 * the draft, editing an existing event, calendars, the reset on open, parsing the line, what the event
 * resolves to (remembered values, length, the free slot, conflicts), place
 * suggestions, applying what was read, the write, the steps, then the JSX.
 */
export function QuickEventSheet({ visible, onClose, seed, editing, onSaved, onDeleted }: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollFade = useScrollEdgeFade();
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));
  const groups = usePersonGroupStore(useShallow(s => s.groups));
  const groupTokens = useMemo(() => groupMentionTokens(), [people, groups]);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const saveEvent = useEventPeopleStore(s => s.saveEvent);
  const updateEvent = useEventPeopleStore(s => s.updateEvent);
  const deleteEvent = useEventPeopleStore(s => s.deleteEvent);
  const peopleForEvent = useEventPeopleStore(s => s.peopleFor);
  const placeSuggestionsEnabled = useSettingsStore(s => s.placeSuggestionsEnabled);
  const setPlaceSuggestionsEnabled = useSettingsStore(s => s.setPlaceSuggestionsEnabled);

  // ==== sheet-level state (keyboard, open/close animation) ====
  const inputRef = useRef<TextInput>(null);
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const translateYAnim = useRef(new Animated.Value(16)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;
  const tooltipAnim = useRef(new Animated.Value(0)).current;
  const hadMatch = useRef(false);
  // Backs the sliver the keyboard's rounded corners expose, and sizes the
  // sheet to the room left above it. Same as QuickAddModal.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const updateHeight = (e: { endCoordinates?: { height: number } }) => {
      const height = e.endCoordinates?.height ?? 0;
      if (height <= 0) return;
      setKeyboardHeight(height);
      Animated.spring(keyboardOffsetAnim, { toValue: -height / 2, ...animation.spring.smooth, useNativeDriver: true }).start();
    };
    const showSub = Keyboard.addListener(showEvent, updateHeight);
    // The accessory bar can attach a frame after first focus, and iOS reports
    // the corrected height only through this event. See QuickAddModal.
    const changeFrameSub = Platform.OS === 'ios' ? Keyboard.addListener('keyboardWillChangeFrame', updateHeight) : null;
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      Animated.spring(keyboardOffsetAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }).start();
    });
    return () => { showSub.remove(); changeFrameSub?.remove(); hideSub.remove(); };
  }, []);

  const sheetMaxHeight = windowHeight - keyboardHeight - insets.top - insets.bottom - spacing.xl * 2;
  const styles = useMemo(() => makeStyles(colors, sheetMaxHeight), [colors, sheetMaxHeight]);

  const dismiss = () => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: animation.duration.dismiss, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: animation.duration.dismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.95);
      sheetOpacity.setValue(0);
      onClose();
    });
  };

  // ==== the draft ====
  const [text, setText] = useState('');
  // Passed to the system sheet as typed. Nothing reads or geocodes it here;
  // it only saves retyping an address into Apple's form.
  const [location, setLocation] = useState('');
  const [notesOrLink, setNotesOrLink] = useState('');
  // The chips' own picks. An alert typed in the line wins over `alertPick`,
  // which wins over the remembered default (see `effectiveAlert`).
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [alertPick, setAlertPick] = useState<number | null | undefined>(undefined);
  const [alertDefault, setAlertDefault] = useState<number | null>(null);
  const [availability, setAvailability] = useState<EventAvailability>('busy');
  // The chips' own picks, kept apart from the defaults above so a remembered
  // event (`eventMemory.ts`) can sit between the two: a pick beats what was
  // remembered, and what was remembered beats the default.
  const [calendarPick, setCalendarPick] = useState<string | null>(null);
  const [availabilityPick, setAvailabilityPick] = useState<EventAvailability | null>(null);
  // A length read from the line and kept once its words leave it (the
  // tooltip, or a date picked by hand), the way repeatPick keeps a repeat.
  const [durationPick, setDurationPick] = useState<number | null>(null);
  const [eventMemory, setEventMemory] = useState<EventMemory>({});
  // Events kept for re-adding (`savedEvents.ts`), read on open since a sync can change them.
  const [savedEventList, setSavedEventList] = useState<SavedEvent[]>([]);
  // The Saved list starts folded: most events are typed fresh, so it shouldn't take the room by default.
  const [savedOpen, setSavedOpen] = useState(false);
  // The title whose remembered values the user waved off for this event.
  const [memoryDismissedKey, setMemoryDismissedKey] = useState<string | null>(null);
  // The overlap row shows one event and a count; a tap lists every one.
  const [conflictsOpen, setConflictsOpen] = useState(false);
  // ==== editing an existing event ====
  // The event as it was read when the card opened on it, null while it loads
  // (or for a new event). Save compares against it, and the people links move
  // from its start to the new one.
  const [original, setOriginal] = useState<EventForEdit | null>(null);
  const [originalNotesField, setOriginalNotesField] = useState('');
  const [originalPeople, setOriginalPeople] = useState<string[]>([]);
  const isEditing = !!editing;
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [targetCalendar, setTargetCalendar] = useState<DeviceCalendar | null>(null);
  // The repeat a schedule phrase read, kept once the phrase's words leave the
  // line (tapping the tooltip, or picking the date by hand). A live phrase wins.
  const [repeatPick, setRepeatPick] = useState<EventRecurrence | null>(null);
  // Apple Maps' answers for the location being typed, and the one picked. A
  // pick holds only while the location still reads exactly as it was written,
  // so an edit afterward saves the edited text without the old coordinate.
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [pickedPlace, setPickedPlace] = useState<(PlaceResult & { text: string }) | null>(null);
  const placeQueryRef = useRef('');
  // The user's named places ("Home"), read on open. A name typed exactly
  // resolves to its address and pin; the typed text the user waved off for
  // this event ("Use what I typed") is remembered by key so it stays off.
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedConfirmedKey, setSavedConfirmedKey] = useState<string | null>(null);
  // What was typed in the location when a place was picked, to offer as the
  // name if that pick is then saved ("home" before picking an address).
  const [typedBeforePick, setTypedBeforePick] = useState('');
  const [calendarPickerVisible, setCalendarPickerVisible] = useState(false);
  const [alertPickerVisible, setAlertPickerVisible] = useState(false);
  // How this event is travelled to, how early to arrive and where the trip
  // starts: app-only, written to travelEventPrefs once the event saves. A null
  // mode or origin follows Settings.
  const travelTasksOn = useSettingsStore(s => s.travelTasks);
  const travelEstimatesOn = useSettingsStore(s => s.travelEstimates);
  const defaultTravelMode = useSettingsStore(s => s.travelMode);
  const defaultArriveEarly = useSettingsStore(s => s.travelArriveEarlyMinutes);
  const walkUnderMinutes = useSettingsStore(s => s.travelWalkUnderMinutes);
  const defaultOriginPlaceId = useSettingsStore(s => s.travelOriginPlaceId);
  const setTravelEventPref = useSettingsStore(s => s.setTravelEventPref);
  const [travelModePick, setTravelModePick] = useState<TravelMode | null>(null);
  const [arriveEarlyPick, setArriveEarlyPick] = useState<number | null>(null);
  const [travelOriginPick, setTravelOriginPick] = useState<string | null>(null);
  const [travelSkipPick, setTravelSkipPick] = useState(false);
  const [originPickerVisible, setOriginPickerVisible] = useState(false);
  const [travelModePickerVisible, setTravelModePickerVisible] = useState(false);
  const [arrivePickerVisible, setArrivePickerVisible] = useState(false);
  const titleCaret = useTitleSelection(text);
  const [busy, setBusy] = useState(false);
  // A start set by hand (the chip's picker) or by tapping the tooltip. A
  // schedule phrase typed afterward wins back, so a stale pick can't stick
  // silently: see `rawStart` below.
  const [startOverride, setStartOverride] = useState<Date | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [endPickerVisible, setEndPickerVisible] = useState(false);
  const [repeatPickerVisible, setRepeatPickerVisible] = useState(false);
  // The "+ Notes" chip was tapped. Notes already in the field (a seed, an event
  // being edited) show it without this, which is also why only a tap focuses it.
  const [notesOpen, setNotesOpen] = useState(false);
  // Which of the three steps a new event is on (When, Where, Details). An edit shows every field at once.
  const [step, setStep] = useState(0);
  // The phrase the tooltip's ✕ was pressed on, by position and text, so a
  // different phrase brings the tooltip back. Same mechanism as quick add.
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  // Picks for an "@name" several people answer to (applyMentionOverrides).
  const [personOverrides, setPersonOverrides] = useState<Record<string, string>>({});
  // Mirror-text widths that locate the phrase for the tooltip (aimTooltip).
  const [inputW, setInputW] = useState(0);
  const [prefixW, setPrefixW] = useState<number | null>(null);
  const [matchW, setMatchW] = useState<number | null>(null);
  const [tooltipRowW, setTooltipRowW] = useState(0);
  const [bubbleW, setBubbleW] = useState(0);
  const [candidateLayouts, setCandidateLayouts] = useState<{ x: number; width: number }[]>([]);
  const setCandidateLayoutAt = (i: number, layout: { x: number; width: number }) => {
    setCandidateLayouts(prev => { const next = prev.slice(); next[i] = layout; return next; });
  };

  // ==== calendars: which one the event will go into ====
  // `ask` is false on open, which only reads when access is already granted: a
  // sheet opening must not raise a permission prompt. The chip's tap asks.
  const loadCalendars = async (preferredId: string | null, ask: boolean): Promise<boolean> => {
    const granted = (await getCalendarPermission()) === 'granted' || (ask && (await requestCalendarPermission()));
    if (!granted) return false;
    const writable = await listWritableCalendars();
    setCalendars(writable);
    setTargetCalendar((await resolveEventCalendar(writable, preferredId)) ?? null);
    return true;
  };

  // Fills the card from the event being edited. A read that finds nothing
  // (deleted elsewhere since the list was drawn) says so and closes.
  const loadForEdit = async (target: QuickEventEditTarget) => {
    const event = await readEventForEdit(target.eventId, target.occurrenceStart);
    if (!event) {
      Alert.alert("This event isn’t on your calendar anymore", 'It may have been deleted in another app.');
      dismiss();
      return;
    }
    if (!event.editable) {
      Alert.alert("This event can’t be changed here", "Its calendar is read-only. Edit it in the app it came from.");
      dismiss();
      return;
    }
    const notesField = event.notes ?? event.url ?? '';
    setOriginal(event);
    setOriginalNotesField(notesField);
    setText(event.title);
    titleCaret.resetCaret(event.title);
    setStartOverride(event.start);
    setAllDay(event.allDay);
    if (!event.allDay) setDurationPick(Math.max(1, Math.round((event.end.getTime() - event.start.getTime()) / 60000)));
    setLocation(event.location ?? '');
    setNotesOrLink(notesField);
    setCalendarPick(event.calendarId);
    setAlertPick(alertMinutesFromOffset(event.alertOffset, event.allDay));
    const travelPref = useSettingsStore.getState().travelEventPrefs[target.eventId];
    setTravelModePick(travelPref?.mode ?? null);
    setArriveEarlyPick(travelPref?.arriveEarlyMinutes ?? null);
    setTravelOriginPick(travelPref?.originPlaceId ?? null);
    setTravelSkipPick(travelPref?.skip ?? false);
    setAvailabilityPick(event.availability);
    const people = peopleForEvent({ id: target.eventId, start: event.start.toISOString() });
    setOriginalPeople(people);
  };

  // ==== effects: resetting on open ====
  useEffect(() => {
    if (!visible) return;
    const seededText = seed?.title ?? '';
    setText(seededText);
    setLocation(seed?.location ?? '');
    setNotesOrLink(seed?.notes ?? '');
    setRepeatPick(null);
    setPlaceResults([]);
    setPickedPlace(null);
    setSavedPlaces(readSavedPlaces());
    setSavedConfirmedKey(null);
    setTypedBeforePick('');
    const defaults = readQuickEventDefaults();
    setCalendarId(defaults.calendarId);
    setAlertDefault(defaults.alertMinutes);
    setAlertPick(seed?.alertMinutes);
    setAvailability(defaults.availability);
    setCalendarPick(null);
    setAvailabilityPick(null);
    setDurationPick(null);
    setEventMemory(readEventMemory());
    setSavedEventList(readSavedEvents());
    setSavedOpen(false);
    setMemoryDismissedKey(null);
    setCalendarPickerVisible(false);
    setAlertPickerVisible(false);
    setTravelModePick(null);
    setArriveEarlyPick(null);
    setTravelOriginPick(null);
    setTravelSkipPick(false);
    setOriginPickerVisible(false);
    setTravelModePickerVisible(false);
    setArrivePickerVisible(false);
    void loadCalendars(defaults.calendarId, false);
    titleCaret.resetCaret(seededText);
    setBusy(false);
    setStartOverride(
      seed?.start ?? (seed?.day ? defaultNewEventSpan(seed.day, getCurrentDayStart(), new Date()).start : null)
    );
    if (seed?.start && seed.end && seed.end > seed.start) {
      setDurationPick(Math.round((seed.end.getTime() - seed.start.getTime()) / 60000));
    }
    setAllDay(seed?.allDay === true);
    setOriginal(null);
    setOriginalNotesField('');
    setOriginalPeople([]);
    if (editing) void loadForEdit(editing);
    setPickerVisible(false);
    setEndPickerVisible(false);
    setRepeatPickerVisible(false);
    setNotesOpen(false);
    setStep(0);
    setDismissedSignature(null);
    setPersonOverrides({});
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
    // Focus waits for SheetModal's onShow, for the reason QuickAddModal gives.
  }, [visible]);

  // ==== parsing the typed line ====
  const draft = useMemo(() => {
    const byId = new Map(people.map(p => [p.id, p]));
    const base = {
      people,
      groups: groupTokens,
      nameOf: (id: string) => { const p = byId.get(id); return p ? displayNameOf(p) : null; },
      now: getLogicalNow(dayResetTime),
      today: getCurrentDayStart(),
      wallClock: new Date(),
      dayResetTime,
      mentionOverrides: personOverrides,
      travel: travelTasksOn,
      originPlaces: originCandidates(savedPlaces).map(p => ({ id: p.id, name: p.name })),
      calendars: calendars.map(c => ({ id: c.id, title: c.title })),
      availability: true,
      notes: true,
    };
    // An edit opens on the event's own title, and a time block on its task's,
    // read as plain text until changed: a title isn't an instruction to parse.
    const openedTitle = original?.title ?? (seed?.start ? seed.title : undefined);
    if (openedTitle !== undefined && text === openedTitle) return parseQuickEvent(text, { ...base, plain: true });
    const read = parseQuickEvent(text, base);
    const dismissed = read.phrase !== null && `${read.phrase.start}|${read.phrase.text}` === dismissedSignature;
    return dismissed ? parseQuickEvent(text, { ...base, ignoreSchedule: true }) : read;
  }, [text, people, groupTokens, dayResetTime, personOverrides, dismissedSignature, original, seed, travelTasksOn, savedPlaces, calendars]);

  const phrase = draft.phrase;
  // A trip clause typed in the line is live, like a typed alert: it wins over
  // the chip's pick, and a chip pick takes it out of the line (`cutFromLine`).
  const effectiveTravelMode = draft.travelMode ?? travelModePick;
  // Null follows the Settings default, so the sheet never writes the default
  // back as the event's own pick.
  const effectiveArriveEarly = draft.arriveEarlyMinutes ?? arriveEarlyPick;
  const shownArriveEarly = effectiveArriveEarly ?? defaultArriveEarly;
  const effectiveTravelOrigin = draft.travelOriginId ?? travelOriginPick;
  // "Don't add a leave-by task". Typing a trip clause means a trip is wanted
  // after all, so it wins over the pick the way it does for the other three.
  const effectiveTravelSkip = travelSkipPick
    && draft.travelMode === undefined && draft.arriveEarlyMinutes === undefined && draft.travelOriginId === undefined;
  // A typed "note: …" fills the Notes field; editing the field takes it out of the line.
  const effectiveNotes = draft.notes ?? notesOrLink;
  // The two "@name" states that need a pick, checked only when no schedule
  // phrase holds the tooltip, the same order quick add uses.
  const ambiguousMention = useMemo(
    () => (!phrase && text.trim() ? findAmbiguousMention(text, people, personOverrides) : null),
    [text, phrase, people, personOverrides]
  );
  const mentionSuggestion = useMemo(
    () => (!phrase && !ambiguousMention && text.trim() ? getMentionSuggestions(text, people, groupTokens) : null),
    [text, phrase, ambiguousMention, people, groupTokens]
  );
  const candidates = ambiguousMention?.candidates ?? mentionSuggestion?.candidates ?? null;
  const candidateRowKey = ambiguousMention
    ? `amb:${ambiguousMention.start}:${ambiguousMention.candidates.map(c => c.id).join(',')}`
    : mentionSuggestion
      ? `sug:${mentionSuggestion.start}:${mentionSuggestion.candidates.map(c => c.id).join(',')}`
      : null;
  useEffect(() => { setCandidateLayouts([]); }, [candidateRowKey]);

  const activeMatch = phrase
    ? { matchStart: phrase.start, matchEnd: phrase.start + phrase.text.length }
    : ambiguousMention
      ? { matchStart: ambiguousMention.start, matchEnd: ambiguousMention.end }
      : mentionSuggestion
        ? { matchStart: mentionSuggestion.start, matchEnd: mentionSuggestion.end }
        : null;

  const highlightRanges = useMemo(() => {
    const ranges = [...draft.mentionSpans, ...draft.clauseSpans];
    if (activeMatch) ranges.push([activeMatch.matchStart, activeMatch.matchEnd]);
    return mergeRanges(ranges);
  }, [draft.mentionSpans, draft.clauseSpans, activeMatch?.matchStart, activeMatch?.matchEnd]);
  const hasOverlay = highlightRanges.length > 0;

  useEffect(() => {
    if (activeMatch && !hadMatch.current) {
      tooltipAnim.setValue(0);
      Animated.spring(tooltipAnim, { toValue: 1, ...animation.spring.bouncy, useNativeDriver: true }).start();
    }
    hadMatch.current = activeMatch != null;
  }, [activeMatch]);

  const { bubbleLeft, caretLeft } = activeMatch
    ? aimTooltip({ prefixW, matchW, inputW, bubbleW, rowW: tooltipRowW, candidateLayouts })
    : { bubbleLeft: 0, caretLeft: 14 };

  // ==== what the event resolves to: memory, length, free slot, conflicts ====
  // The last event saved with this title, unless waved off for this one.
  const memoryKey = eventMemoryKey(draft.title);
  // A saved event with this title outranks the memory: it is the one the
  // person kept, and can edit. Its calendar is matched by name on this device.
  const savedEventMatch = !isEditing ? findSavedEvent(savedEventList, draft.title) : null;
  const remembered = memoryKey ? eventMemory[memoryKey] ?? null : null;
  const recalled = !isEditing && memoryKey && memoryKey !== memoryDismissedKey
    ? (savedEventMatch ? savedEventRecall(savedEventMatch, calendars, remembered?.calendarId ?? null) : remembered)
    : null;
  // Typed length, then one kept from the line, then last time's, then an hour.
  const effectiveDuration =
    draft.durationMinutes ?? durationPick ?? recalled?.durationMinutes ?? DEFAULT_EVENT_MINUTES;
  const calendarEvents = useCalendarStore(s => s.events);
  const calendarWindowStart = useCalendarStore(s => s.windowStart);
  const calendarWindowEnd = useCalendarStore(s => s.windowEnd);
  // With a day but no time ("lunch fri"), the start is the first free slot
  // that day rather than a fixed default, shown on the date chip where it can
  // be changed. Only where the calendar has actually been read.
  const freeSlot = useMemo(() => {
    if (draft.timed || allDay || (!phrase && startOverride !== null)) return null;
    const day = draft.start;
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    if (!calendarCovers(calendarWindowStart, calendarWindowEnd, dayStart, addDays(dayStart, 1))) return null;
    return firstFreeSlot(day, effectiveDuration, calendarEvents, new Date());
  }, [draft.timed, draft.start, allDay, phrase, startOverride, effectiveDuration, calendarEvents, calendarWindowStart, calendarWindowEnd]);
  // A live phrase wins over an earlier pick; with none, the pick holds.
  const rawStart = phrase ? (freeSlot ?? draft.start) : (startOverride ?? freeSlot ?? draft.start);
  const effectiveStart = allDay ? startOfDay(rawStart) : rawStart;
  // A new event has no start until the line names one or the chip's picker
  // sets one (or the opener seeded a day or time). `rawStart` still resolves
  // to a default so the pickers have somewhere to open, but it never saves.
  const startChosen = isEditing || phrase !== null || startOverride !== null;
  // All-day events are exclusive on the end date in EventKit: one full day
  // is [date, date + 1), same convention as createAllDayEvent.
  const effectiveEnd = allDay ? addDays(effectiveStart, 1) : addMinutes(effectiveStart, effectiveDuration);
  const conflicts = useMemo(
    () => (allDay || !startChosen || !calendarCovers(calendarWindowStart, calendarWindowEnd, effectiveStart, effectiveEnd)
      ? []
      : overlappingEvents(effectiveStart, effectiveEnd, calendarEvents)),
    [allDay, startChosen, effectiveStart.getTime(),effectiveEnd.getTime(), calendarEvents, calendarWindowStart, calendarWindowEnd],
  );
  const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const describeStart = (d: Date) => (allDay ? dayLabel(d) : `${dayLabel(d)}, ${formatTimeOfDay(d, use24Hour)}`);
  // "12:00–12:30 PM" for a conflicting event, on the card's own clock setting.
  const describeSpan = (event: { start: string; end: string }) =>
    `${formatTimeOfDay(new Date(event.start), use24Hour)}–${formatTimeOfDay(new Date(event.end), use24Hour)}`;
  const effectiveRepeat = phrase ? draft.repeat : repeatPick;
  // The people the line names plus any the opener already knew (a person's page).
  const allPersonIds = [...new Set([...draft.personIds, ...(seed?.personIds ?? []), ...originalPeople])];
  const namedPeople = people.filter(p => allPersonIds.includes(p.id)).map(displayNameOf);
  // A place or alert typed in the line is live, the same as a typed day: it
  // wins over an earlier pick without anyone tapping it.
  // Last time's place fills an empty field; typing in it or in the line wins.
  const memoryLocation = !draft.location && !location.trim() ? recalled?.location ?? null : null;
  const typedLocation = draft.location ?? (location.trim() || memoryLocation);
  const placeQuery = typedLocation ?? '';
  const placePicked = pickedPlace !== null && pickedPlace.text === placeQuery;
  // A saved place named exactly ("home") is only offered, never applied on its
  // own: the event is saved with it once the suggestion is tapped. A place
  // picked from Apple Maps outranks it: that pick is more specific.
  const savedMatch = !placePicked ? findSavedPlace(savedPlaces, placeQuery) : null;
  const savedInUse = savedMatch !== null && savedPlaceKey(savedMatch.name) === savedConfirmedKey ? savedMatch : null;
  const effectiveLocation = savedInUse ? savedInUse.text : typedLocation;
  // A remembered place was already picked once; it isn't looked up again.
  // Neither is a saved one: it already says where it is.
  const wantsPlaces = placeQuery.length >= PLACE_QUERY_MIN_LENGTH && !placePicked && memoryLocation === null && savedInUse === null;
  const savedPin = savedInUse && savedInUse.latitude !== null && savedInUse.longitude !== null
    ? { latitude: savedInUse.latitude, longitude: savedInUse.longitude }
    : null;
  const effectivePlace = placePicked
    ? pickedPlace
    : savedInUse ? savedPin
    : memoryLocation !== null ? recalled?.place ?? null : null;
  const savedSuggestions = !placePicked && savedInUse === null
    ? suggestSavedPlaces(savedPlaces, placeQuery)
    : [];
  // Offered on any location that isn't a saved name or already saved as text.
  const canSavePlace = effectiveLocation !== null && effectiveLocation.trim().length >= PLACE_QUERY_MIN_LENGTH
    && savedInUse === null && savedMatch === null && savedPlaceWithText(savedPlaces, effectiveLocation) === null;
  const effectiveAlert =
    draft.alertMinutes !== undefined ? draft.alertMinutes
      : alertPick !== undefined ? alertPick
      : recalled ? recalled.alertMinutes
      : alertDefault;
  const effectiveAvailability = draft.availability ?? availabilityPick ?? recalled?.availability ?? availability;
  const chosenCalendarId = draft.calendarId ?? calendarPick ?? recalled?.calendarId ?? null;
  const effectiveCalendar = (chosenCalendarId ? calendars.find(c => c.id === chosenCalendarId) : undefined) ?? targetCalendar;
  // Whether last time's values are filling in anything at all, for the caption.
  const usingMemory = recalled !== null && (
    memoryLocation !== null
    || (draft.durationMinutes === null && durationPick === null && recalled.durationMinutes !== null)
    || calendarPick === null || availabilityPick === null || alertPick === undefined
  );
  const isBusy = effectiveAvailability === 'busy';
  const alertSet = effectiveAlert !== null;
  const showNotes = notesOpen || effectiveNotes.trim() !== '';
  const canAdd = draft.title.trim().length > 0 && startChosen && !busy && (!isEditing || original !== null);

  // ==== place suggestions ====
  // Debounced, and checked against the query once the answer is back: a slow
  // answer for an older query must not replace the list for the current one.
  useEffect(() => {
    placeQueryRef.current = placeQuery;
    if (!visible || !placeSuggestionsEnabled || !wantsPlaces) {
      setPlaceResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchPlaces(placeQuery).then(results => {
        if (placeQueryRef.current === placeQuery) setPlaceResults(results.slice(0, PLACE_SUGGESTION_LIMIT));
      });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visible, placeSuggestionsEnabled, placeQuery, wantsPlaces]);

  // ==== saved events ====
  // Listed while the line is empty, so a regular is a tap and then a day.
  const savedList = useMemo(() => sortedSavedEvents(savedEventList), [savedEventList]);
  const showSaved = !isEditing && text.trim() === '' && savedList.length > 0;
  // Typing a few letters of one offers it, while the line is still only a
  // title: once a day or a person is in it, swapping the line would drop them.
  const savedEventSuggestions = useMemo(
    () => (!isEditing && text.trim() === draft.title.trim() ? suggestSavedEvents(savedEventList, draft.title) : []),
    [isEditing, text, draft.title, savedEventList],
  );

  const pickSaved = (event: SavedEvent) => {
    haptics.tap();
    animateLayout();
    const next = withTrailingSpace(event.title);
    setText(next);
    titleCaret.moveCaret(next);
    setMemoryDismissedKey(null);
  };

  const confirmUnsave = (event: SavedEvent) => {
    haptics.warning();
    Alert.alert(
      `Remove “${event.title}” from saved?`,
      'It is removed on all your devices. Typing the title on this phone still fills in what it had last time.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const next = removeSavedEvent(readSavedEvents(), event.title);
            writeSavedEvents(next);
            animateLayout();
            setSavedEventList(next);
          },
        },
      ],
    );
  };

  // Takes one typed clause out of the line, wherever it sits, when a pick
  // replaces what it said.
  const cutFromLine = ([from, to]: [number, number]) => {
    const next = withTrailingSpace((text.slice(0, from).trimEnd() + text.slice(to)).replace(/\s+/g, ' ').trim());
    setText(next);
    titleCaret.moveCaret(next);
  };

  const pickPlace = (place: PlaceResult) => {
    haptics.tap();
    animateLayout();
    const placeText = placeLocationText(place);
    setTypedBeforePick(placeQuery);
    // A place read from the line ("at joe's") comes out of the line, the way an
    // alert picked from its chip does, or the typed words would outrank it.
    if (draft.location !== null && draft.locationSpan) cutFromLine(draft.locationSpan);
    setLocation(placeText);
    setPickedPlace({ ...place, text: placeText });
    setPlaceResults([]);
  };

  // A saved name picked from the suggestions, which is what confirms it. Like a picked place it
  // comes out of the line, so the typed words don't outrank it.
  const pickSavedPlace = (saved: SavedPlace) => {
    haptics.tap();
    animateLayout();
    if (draft.location !== null && draft.locationSpan) cutFromLine(draft.locationSpan);
    setLocation(saved.name);
    setSavedConfirmedKey(savedPlaceKey(saved.name));
  };

  // Names the location this event is going to, so the name can be typed next
  // time. The prompt starts with what was typed before the pick when that was
  // a short name rather than the address itself.
  const savePlace = () => {
    if (effectiveLocation === null) return;
    const text = effectiveLocation;
    const pin = effectivePlace ? { latitude: effectivePlace.latitude, longitude: effectivePlace.longitude } : null;
    const typed = typedBeforePick.trim();
    const suggested = typed && typed.length <= 24 && typed.toLowerCase() !== text.toLowerCase() ? typed : '';
    Alert.prompt(
      'Save place',
      'Give it a name you can type instead of the address, like “home” or “gym”.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: BUTTON_LABEL.save,
          onPress: (name?: string) => {
            const trimmed = (name ?? '').trim();
            if (!trimmed) return;
            const next = addSavedPlace(savedPlaces, { name: trimmed, text, place: pin });
            // Past the limit the list comes back without the new name.
            if (!next.some(p => savedPlaceKey(p.name) === savedPlaceKey(trimmed))) {
              Alert.alert('Too many saved places', 'Remove one in Settings, under Calendar, to save another.');
              return;
            }
            haptics.success();
            animateLayout();
            writeSavedPlaces(next);
            setSavedPlaces(next);
            // The location now reads as the new name, which resolves to the
            // saved text and pin. A place typed in the line comes out of it.
            if (draft.location !== null && draft.locationSpan) cutFromLine(draft.locationSpan);
            setLocation(trimmed);
            setSavedConfirmedKey(savedPlaceKey(trimmed));
          },
        },
      ],
      'plain-text',
      suggested,
    );
  };

  // ==== applying what was read ====
  const insertToken = (token: string) => {
    haptics.tap();
    setText(titleCaret.insertToken(token));
  };

  // Commit the phrase's start to the chip and take its words out of the line.
  const applyPhrase = () => {
    if (!phrase) return;
    haptics.success();
    animateLayout();
    const next = withTrailingSpace(phrase.lineWithout);
    setText(next);
    titleCaret.moveCaret(next);
    setStartOverride(rawStart);
    setRepeatPick(draft.repeat);
    if (draft.durationMinutes !== null) setDurationPick(draft.durationMinutes);
  };

  const dismissPhrase = () => {
    if (!phrase) return;
    haptics.tap();
    animateLayout();
    setDismissedSignature(`${phrase.start}|${phrase.text}`);
  };

  const applyAmbiguousCandidate = (personId: string) => {
    if (!ambiguousMention) return;
    haptics.success();
    animateLayout();
    setPersonOverrides(prev => ({ ...prev, [ambiguousMention.token]: personId }));
  };

  const applyMentionSuggestion = (candidate: MentionSuggestionCandidate) => {
    if (!mentionSuggestion) return;
    haptics.success();
    animateLayout();
    const next = `${text.slice(0, mentionSuggestion.start)}@${candidate.resolveKey} `;
    setText(next);
    titleCaret.moveCaret(next);
  };

  // A date picked by hand replaces the one the line reads, so the words that
  // read it go too rather than being left in the title saying something else.
  const pickStart = (date: Date, lengthMinutes?: number) => {
    if (phrase) {
      const next = withTrailingSpace(phrase.lineWithout);
      setText(next);
      titleCaret.moveCaret(next);
    }
    setStartOverride(date);
    if (phrase) setRepeatPick(draft.repeat);
    if (phrase && draft.durationMinutes !== null) setDurationPick(draft.durationMinutes);
    // A length chosen in the picker replaces one typed in the line, like a picked end.
    if (lengthMinutes !== undefined) {
      if (!phrase && draft.durationSpan) cutFromLine(draft.durationSpan);
      setDurationPick(lengthMinutes);
    }
    setPickerVisible(false);
  };

  // "Other…" in the start picker: keep what it holds and go straight to the end.
  const pickStartThenEnd = (date: Date, lengthMinutes: number | undefined) => {
    pickStart(date, lengthMinutes);
    setEndPickerVisible(true);
  };

  // Takes a live phrase's words out of the line and keeps what it read, for a
  // pick that replaces one part of it and mustn't leave the rest behind.
  const commitPhrase = () => {
    if (!phrase) return;
    const next = withTrailingSpace(phrase.lineWithout);
    setText(next);
    titleCaret.moveCaret(next);
    setStartOverride(rawStart);
    setRepeatPick(draft.repeat);
    if (draft.durationMinutes !== null) setDurationPick(draft.durationMinutes);
  };

  // The end is stored as a length from the start, so a picked end is one. A
  // typed "for 2h" would outrank it, so it comes out of the line like a typed alert.
  const pickEnd = (date: Date) => {
    setEndPickerVisible(false);
    const minutes = Math.round((date.getTime() - effectiveStart.getTime()) / 60000);
    if (minutes < 1) {
      Alert.alert('The end has to be after the start', 'Pick a later time.');
      return;
    }
    if (phrase) commitPhrase();
    else if (draft.durationSpan) cutFromLine(draft.durationSpan);
    setDurationPick(minutes);
  };

  const pickRepeat = (key: string) => {
    if (phrase) commitPhrase();
    setRepeatPick(EVENT_REPEAT_PRESETS.find(p => p.key === key)?.rule ?? null);
  };

  // ==== the exit: write the event ====
  const next = async () => {
    // Return on a titled event with no start asks for the start rather than doing nothing.
    if (!startChosen && !isEditing && draft.title.trim().length > 0 && !busy) {
      haptics.tap();
      Keyboard.dismiss();
      setPickerVisible(true);
      return;
    }
    if (!canAdd) return;
    haptics.tap();
    if (editing && original) {
      await saveEdit(editing, original);
      return;
    }
    setBusy(true);
    const saved = await saveEvent(
      quickEventSaveFields({
        title: draft.title,
        start: effectiveStart,
        end: effectiveEnd,
        allDay,
        location: effectiveLocation,
        place: effectivePlace,
        notesOrLink: effectiveNotes,
        repeat: effectiveRepeat,
        alertMinutes: effectiveAlert,
        availability: effectiveAvailability,
        calendarId: effectiveCalendar?.id ?? calendarId,
      }),
      allPersonIds
    );
    setBusy(false);
    // A demo's event is refused on purpose (it would reach the real calendar),
    // which isn't a failure to explain.
    if (!saved && isDemoModeActive()) return;
    if (!saved) {
      alertFailedWithSettings(
        "Couldn’t add the event",
        'Check that calendar access is on in Settings, then try again. The event is still here.'
      );
      return;
    }
    writeQuickEventDefaults({ calendarId: saved.calendarId, alertMinutes: effectiveAlert, availability: effectiveAvailability });
    writeEventMemory(rememberEvent(eventMemory, draft.title, {
      location: effectiveLocation,
      place: effectivePlace ? { latitude: effectivePlace.latitude, longitude: effectivePlace.longitude } : null,
      durationMinutes: allDay ? null : effectiveDuration,
      calendarId: saved.calendarId,
      alertMinutes: effectiveAlert,
      availability: effectiveAvailability,
      at: Date.now(),
    }));
    // A saved event is refreshed with what this one was added with; anything
    // else is offered for saving on the toast. Read fresh, not from state, so
    // a sync that landed while the card was open isn't written back over.
    const savedFields: SavedEventFields = {
      location: effectiveLocation,
      place: effectivePlace ? { latitude: effectivePlace.latitude, longitude: effectivePlace.longitude } : null,
      durationMinutes: allDay ? null : effectiveDuration,
      alertMinutes: effectiveAlert,
      availability: effectiveAvailability,
      calendarTitle: calendars.find(c => c.id === saved.calendarId)?.title ?? effectiveCalendar?.title ?? null,
    };
    const savedBefore = readSavedEvents();
    const savedAfter = recordSavedEventUse(savedBefore, draft.title, savedFields, effectiveStart, Date.now());
    if (savedAfter !== savedBefore) {
      writeSavedEvents(savedAfter);
      // A new appointment starts a new booking cycle, so the old "Book …" goes now.
      useTaskStore.getState().checkBookEventTasks();
    }
    setTravelEventPref(saved.id, { mode: effectiveTravelMode, arriveEarlyMinutes: effectiveArriveEarly, originPlaceId: effectiveTravelOrigin, skip: effectiveTravelSkip });
    useEventCreatedToastStore.getState().announce(
      saved.id,
      effectiveStart,
      savedAfter !== savedBefore ? undefined : { title: draft.title.trim(), fields: savedFields, start: effectiveStart },
    );
    onSaved?.(saved.id);
    dismiss();
  };

  // Writes the card back over the event it opened on. The notes field is
  // written only if it was touched, so a note and a link the card shows one of
  // aren't merged or dropped by a save that changed something else.
  const saveEdit = async (target: QuickEventEditTarget, before: EventForEdit) => {
    setBusy(true);
    const fields = quickEventSaveFields({
      title: draft.title,
      start: effectiveStart,
      end: effectiveEnd,
      allDay,
      location: effectiveLocation,
      place: effectivePlace,
      notesOrLink: effectiveNotes,
      alertMinutes: effectiveAlert,
      availability: effectiveAvailability,
      calendarId: effectiveCalendar?.id ?? before.calendarId,
    });
    if (effectiveNotes.trim() === originalNotesField.trim()) {
      delete fields.notes;
      delete fields.url;
    } else {
      fields.notes = fields.notes ?? '';
      fields.url = fields.url ?? '';
    }
    const id = await updateEvent(
      target.eventId,
      { start: before.start.toISOString(), end: before.end.toISOString(), title: before.title },
      fields,
      allPersonIds,
      before.recurring ? target.occurrenceStart ?? before.start.toISOString() : null,
    );
    setBusy(false);
    if (!id) {
      if (isDemoModeActive()) return;
      alertFailedWithSettings(
        "Couldn’t save the event",
        'Check that calendar access is on in Settings, then try again. Your changes are still here.'
      );
      return;
    }
    setTravelEventPref(id, { mode: effectiveTravelMode, arriveEarlyMinutes: effectiveArriveEarly, originPlaceId: effectiveTravelOrigin, skip: effectiveTravelSkip });
    onSaved?.(id);
    dismiss();
  };

  const confirmDelete = () => {
    if (!editing || !original) return;
    haptics.warning();
    Keyboard.dismiss();
    Alert.alert(
      'Delete this event?',
      original.recurring
        ? 'Only this occurrence is deleted. The rest of the series stays on your calendar.'
        : 'It is removed from your calendar.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: BUTTON_LABEL.delete,
          style: 'destructive',
          onPress: async () => {
            const deleted = await deleteEvent(editing.eventId, {
              start: (original.recurring && editing.occurrenceStart) || original.start.toISOString(),
              end: original.end.toISOString(),
              title: original.title,
            });
            if (!deleted) {
              alertFailedWithSettings("Couldn’t delete the event", 'Check that calendar access is on in Settings, then try again.');
              return;
            }
            onDeleted?.();
            dismiss();
          },
        },
      ],
    );
  };

  const openCalendarPicker = async () => {
    haptics.tap();
    Keyboard.dismiss();
    if (calendars.length === 0) await loadCalendars(calendarId, true);
    setCalendarPickerVisible(true);
  };

  const calendarOptions: EventOption[] = calendars.map(c => ({ key: c.id, label: c.title, color: c.color }));
  const alertOptions: EventOption[] = [
    { key: 'none', label: describeAlert(null) },
    ...ALERT_CHOICES.map(m => ({ key: String(m), label: describeAlert(m, allDay) })),
  ];

  const repeatOptions: EventOption[] = [
    { key: 'none', label: 'Never' },
    ...EVENT_REPEAT_PRESETS.map(p => ({ key: p.key, label: p.label })),
  ];
  const travelModeOptions: EventOption[] = [
    { key: 'default', label: walkUnderMinutes > 0 && defaultTravelMode !== 'walking'
      ? `Settings default (Walk if ${walkUnderMinutes} min or less, else ${TRAVEL_MODE_LABELS[defaultTravelMode]})`
      : `Settings default (${TRAVEL_MODE_LABELS[defaultTravelMode]})` },
    ...TRAVEL_MODES.map(m => ({ key: m, label: TRAVEL_MODE_LABELS[m] })),
    { key: TRAVEL_SKIP_KEY, label: 'Don’t add a leave-by task' },
  ];
  const travelChipLabel = effectiveTravelSkip ? 'No leave-by task' : TRAVEL_MODE_LABELS[effectiveTravelMode ?? defaultTravelMode];
  const arriveOptions: EventOption[] = [
    { key: 'default', label: `Settings default (${describeArrival(defaultArriveEarly)})` },
    ...TRAVEL_ARRIVE_CHOICES.map(m => ({ key: String(m), label: describeArrival(m) })),
  ];
  // Only for an event with a place and a time, the only kind a "Leave for" task is written for.
  // A trip clause typed in the line shows its chip even before a place is named.
  const typedTrip = draft.travelMode !== undefined || draft.arriveEarlyMinutes !== undefined || draft.travelOriginId !== undefined;
  const showTravelChips = travelTasksOn && !allDay && (!!effectiveLocation || typedTrip);
  // Where the trip starts only matters to an Apple Maps estimate, so the chip
  // appears with that switch. A pick of a place since removed reads as the
  // Settings default, the same fallback `travelOriginForEvent` applies.
  const originPlaces = originCandidates(savedPlaces);
  const settingsOriginName = travelOriginFor(defaultOriginPlaceId, savedPlaces)?.name ?? 'Where I am';
  const pickedOriginName =
    effectiveTravelOrigin === TRAVEL_ORIGIN_PHONE ? 'Where I am'
    : originPlaces.find(p => p.id === effectiveTravelOrigin)?.name ?? null;
  const originChipLabel = pickedOriginName ?? settingsOriginName;
  const originOptions: EventOption[] = [
    { key: 'default', label: `Settings default (${settingsOriginName})` },
    { key: TRAVEL_ORIGIN_PHONE, label: 'Where I am' },
    ...originPlaces.map(p => ({ key: p.id, label: p.name })),
  ];
  const showOriginChip = showTravelChips && travelEstimatesOn && !effectiveTravelSkip;

  // ==== steps ====
  // A new event walks through When, Where and Details so each screen holds one
  // question. The check in the header still adds from any step with what is
  // filled in, and an edit shows every field at once (`onStep` is always true).
  const stepped = !isEditing;
  const lastStep = STEP_NAMES.length - 1;
  const onStep = (n: number) => !stepped || step === n;
  const goToStep = (n: number) => {
    haptics.tap();
    animateLayout();
    setStep(n);
    if (n === 0) inputRef.current?.focus();
    // The place step focuses its own field as it mounts.
    else if (n === lastStep) Keyboard.dismiss();
  };
  // Return and the footer's button: on to the next step, or add on the last.
  const advance = () => {
    if (!stepped || step === lastStep) { void next(); return; }
    // A date is the one thing an event can't be added without, so ask for it here.
    if (step === 0 && !startChosen) {
      if (draft.title.trim().length === 0) return;
      haptics.tap();
      Keyboard.dismiss();
      setPickerVisible(true);
      return;
    }
    if (step === 0 && draft.title.trim().length === 0) return;
    goToStep(step + 1);
  };
  // With no place yet the trip rows show but can't be used: a "Leave for" task needs one.
  const travelRowsShown = stepped ? travelTasksOn && !allDay : showTravelChips;
  const travelRowsLocked = stepped && !showTravelChips;
  const stepAdvanceLabel = step === lastStep ? 'Add event' : step === 1 && !effectiveLocation ? 'Skip' : 'Next';

  // The notes field, shown under the chips on the Details step and in its old place for an edit.
  const notesField = showNotes ? (
    <View style={styles.locationRow}>
      <Ionicons name="document-text-outline" size={iconSize.sm} color={colors.textSecondary} />
      <TextField
        style={styles.locationInput}
        placeholder="Notes or link"
        placeholderTextColor={colors.textTertiary}
        value={effectiveNotes}
        onChangeText={value => {
          if (draft.notesSpan) cutFromLine(draft.notesSpan);
          setNotesOrLink(value);
        }}
        onSubmitEditing={advance}
        returnKeyType="done"
        blurOnSubmit={false}
        autoCapitalize="none"
        keyboardAppearance={isDark ? 'dark' : 'light'}
        autoFocus={notesOpen}
        accessibilityLabel="Notes or link"
      />
    </View>
  ) : null;

  const allDayChip = (
    <TouchableOpacity
      style={[styles.toolChip, styles.toolChipWide]}
      onPress={() => { haptics.tap(); setAllDay(v => !v); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="switch"
      accessibilityLabel="All day"
      accessibilityState={{ checked: allDay }}
    >
      <Ionicons name="sunny-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={[styles.toolChipText, styles.switchLabel]} numberOfLines={1}>All day</Text>
      <View style={[styles.switchTrack, allDay && styles.switchTrackOn]}>
        <View style={[styles.switchKnob, allDay && styles.switchKnobOn]} />
      </View>
    </TouchableOpacity>
  );
  const busyChip = (
    <TouchableOpacity
      style={[styles.toolChip, styles.toolChipWide]}
      onPress={() => { haptics.tap(); if (draft.availabilitySpan) cutFromLine(draft.availabilitySpan); setAvailabilityPick(isBusy ? 'free' : 'busy'); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="switch"
      accessibilityLabel="Busy"
      accessibilityHint="On blocks this time on your calendar. Off leaves the time free."
      accessibilityState={{ checked: isBusy }}
    >
      <Ionicons name={isBusy ? 'eye' : 'eye-outline'} size={iconSize.sm} color={colors.textSecondary} />
      <Text style={[styles.toolChipText, styles.switchLabel]} numberOfLines={1}>Busy</Text>
      <View style={[styles.switchTrack, isBusy && styles.switchTrackOn]}>
        <View style={[styles.switchKnob, isBusy && styles.switchKnobOn]} />
      </View>
    </TouchableOpacity>
  );
  const notesChip = !showNotes ? (
    <TouchableOpacity
      style={styles.toolChip}
      onPress={() => { haptics.tap(); animateLayout(); setNotesOpen(true); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel="Add notes or a link"
    >
      <Ionicons name="add" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={styles.toolChipText}>Notes</Text>
    </TouchableOpacity>
  ) : null;
  // An edit changes one occurrence, so there is no repeat to set.
  const repeatChip = !isEditing ? (
    <TouchableOpacity
      style={[styles.toolChip, effectiveRepeat !== null && styles.toolChipSet]}
      onPress={() => { haptics.tap(); Keyboard.dismiss(); setRepeatPickerVisible(true); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`Repeat: ${effectiveRepeat ? describeEventRepeatShort(effectiveRepeat) : 'never'}`}
    >
      <Ionicons name="repeat-outline" size={iconSize.sm} color={effectiveRepeat ? colors.accent : colors.textSecondary} />
      <Text style={[styles.toolChipText, effectiveRepeat !== null && styles.toolChipTextSet]} numberOfLines={1}>
        {effectiveRepeat ? describeEventRepeatShort(effectiveRepeat) : 'Repeat'}
      </Text>
    </TouchableOpacity>
  ) : null;

  // ==== render. Everything below is JSX ====
  return (
    <SheetModal
      name="QuickEventSheet"
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
      onShow={() => inputRef.current?.focus()}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={dismiss} label={isEditing ? 'Close event' : 'Close new event'} />
      {keyboardHeight > 0 && (
        <View pointerEvents="none" style={[styles.keyboardBacking, { height: keyboardHeight }]} />
      )}
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, shadows.sheet, { opacity: sheetOpacity, transform: [{ scale: scaleAnim }, { translateY: Animated.add(translateYAnim, keyboardOffsetAnim) }] }]}>
          <View style={styles.row}>
            <View style={styles.inputWrap}>
              {hasOverlay && (
                <HighlightedText
                  text={text}
                  ranges={highlightRanges}
                  style={[styles.input, styles.inputOverlay]}
                  highlightStyle={styles.inputHighlight}
                  pointerEvents="none"
                />
              )}
              <TextField
                ref={inputRef}
                style={[styles.input, hasOverlay && styles.inputHidden]}
                placeholder={isEditing ? "Event title" : "New event…"}
                placeholderTextColor={colors.textTertiary}
                value={text}
                onChangeText={setText}
                onSubmitEditing={advance}
                returnKeyType="next"
                maxLength={TITLE_MAX_LENGTH}
                // iOS's inline completion draws over the overlay; see QuickAddModal.
                autoCorrect={!hasOverlay}
                spellCheck
                blurOnSubmit={false}
                onLayout={e => setInputW(e.nativeEvent.layout.width)}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                selection={titleCaret.selection}
                onSelectionChange={titleCaret.onSelectionChange}
                inputAccessoryViewID={Platform.OS === 'ios' ? EVENT_TOKEN_ACCESSORY_ID : undefined}
                accessibilityLabel="Event, with an optional day, time and @people"
              />
              {activeMatch && (
                <View style={styles.measureWrap} pointerEvents="none">
                  <Text style={styles.measureText} onLayout={e => setPrefixW(e.nativeEvent.layout.width)}>
                    {text.slice(0, activeMatch.matchStart)}
                  </Text>
                  <Text style={styles.measureText} onLayout={e => setMatchW(e.nativeEvent.layout.width)}>
                    {text.slice(0, activeMatch.matchStart)}
                    <Text style={styles.inputHighlight}>{text.slice(activeMatch.matchStart, activeMatch.matchEnd)}</Text>
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[styles.addBtn, !canAdd && styles.addBtnDisabled]}
              onPress={next}
              disabled={!canAdd}
              accessibilityRole="button"
              accessibilityLabel={isEditing ? 'Save changes' : 'Add event'}
            >
              <Ionicons name="checkmark" size={18} color={canAdd ? colors.onAccent : colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {stepped && (
            <View
              style={styles.stepRow}
              accessible
              accessibilityRole="header"
              accessibilityLabel={`Step ${step + 1} of ${STEP_NAMES.length}, ${STEP_NAMES[step]}`}
            >
              <Text style={styles.stepTitle}>{STEP_NAMES[step]}</Text>
              <View style={styles.stepDots}>
                {STEP_NAMES.map((name, i) => (
                  <View key={name} style={[styles.stepDot, i === step && styles.stepDotOn]} />
                ))}
              </View>
            </View>
          )}

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
                {candidates ? (
                  <View style={styles.tooltipCandidateRow} onLayout={e => setBubbleW(e.nativeEvent.layout.width)}>
                    {candidates.map((candidate, i) => (
                      <PressableScale
                        key={candidate.id}
                        style={styles.tooltipCandidatePill}
                        haptic
                        onPress={() => (ambiguousMention
                          ? applyAmbiguousCandidate(candidate.id)
                          : applyMentionSuggestion(candidate as MentionSuggestionCandidate))}
                        onLayout={e => setCandidateLayoutAt(i, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })}
                      >
                        <Text style={styles.tooltipText} numberOfLines={1}>{candidate.name}</Text>
                      </PressableScale>
                    ))}
                  </View>
                ) : (
                  <View
                    style={[styles.tooltipPillRow, tooltipRowW > 0 && { maxWidth: tooltipRowW }]}
                    onLayout={e => setBubbleW(e.nativeEvent.layout.width)}
                  >
                    <PressableScale style={[styles.tooltipBubble, styles.tooltipBubbleJoined]} onPress={applyPhrase}>
                      <Ionicons name="calendar-outline" size={14} color={colors.onAccent} />
                      <Text style={styles.tooltipText} numberOfLines={1} ellipsizeMode="tail">
                        {describeStart(allDay ? startOfDay(draft.start) : draft.start)}
                      </Text>
                      <View style={styles.tooltipDot} />
                      <Text style={styles.tooltipHint}>Tap to set</Text>
                    </PressableScale>
                    <View style={styles.tooltipDivider} />
                    <PressableScale style={styles.tooltipDismiss} onPress={dismissPhrase} accessibilityLabel="Not that">
                      <Ionicons name="close" size={14} color={colors.onAccent} />
                    </PressableScale>
                  </View>
                )}
              </View>
            </Animated.View>
          )}

          {/* The card's height is capped to the room above the keyboard, so what
              sits below the title scrolls rather than spilling out of it. */}
          <View style={styles.body}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            {...scrollFade.scrollProps}
          >
            {onStep(0) && showSaved && (
              <View style={styles.savedBlock}>
                <View style={styles.savedList}>
                  <TouchableOpacity
                    style={styles.savedRow}
                    onPress={() => { haptics.tap(); animateLayout(); setSavedOpen(o => !o); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel="Saved events"
                    accessibilityValue={{ text: `${savedList.length}` }}
                    accessibilityState={{ expanded: savedOpen }}
                  >
                    <Ionicons name="bookmark" size={iconSize.sm} color={colors.accent} />
                    <Text style={styles.savedHeaderText}>Saved events</Text>
                    <Text style={styles.placeAddress}>{savedList.length}</Text>
                    <RotatingChevron open={savedOpen} size={iconSize.sm} color={colors.textSecondary} />
                  </TouchableOpacity>
                  {savedOpen && savedList.map(event => (
                    <TouchableOpacity
                      key={eventMemoryKey(event.title)}
                      style={[styles.savedRow, styles.placeRowRuled]}
                      onPress={() => pickSaved(event)}
                      onLongPress={() => confirmUnsave(event)}
                      delayLongPress={interaction.delayLongPress}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`${event.title}, ${describeSavedEvent(event)}`}
                      accessibilityHint="Fills in the event. Long press to remove it from saved."
                      accessibilityActions={[{ name: 'longpress', label: 'Remove from saved' }]}
                      onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'longpress') confirmUnsave(event); }}
                    >
                      <Ionicons name="bookmark" size={iconSize.sm} color={colors.accent} />
                      <View style={styles.savedText}>
                        <Text style={styles.placeName} numberOfLines={1}>{event.title}</Text>
                        <Text style={styles.placeAddress} numberOfLines={1}>{describeSavedEvent(event)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            {onStep(0) && savedEventSuggestions.length > 0 && (
              <View style={[styles.savedList, styles.savedBlock]}>
                {savedEventSuggestions.map((event, i) => (
                  <TouchableOpacity
                    key={eventMemoryKey(event.title)}
                    style={[styles.savedRow, i > 0 && styles.placeRowRuled]}
                    onPress={() => pickSaved(event)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Use saved event ${event.title}, ${describeSavedEvent(event)}`}
                  >
                    <Ionicons name="bookmark" size={iconSize.sm} color={colors.accent} />
                    <View style={styles.savedText}>
                      <Text style={styles.placeName} numberOfLines={1}>{event.title}</Text>
                      <Text style={styles.placeAddress} numberOfLines={1}>{describeSavedEvent(event)}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {stepped && step > 0 && (
              <View style={styles.recapRow}>
                <TouchableOpacity
                  style={styles.recapChip}
                  onPress={() => goToStep(0)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={startChosen ? `Starts: ${describeStart(effectiveStart)}. Change` : 'No date yet. Change'}
                >
                  <Ionicons name="time-outline" size={13} color={colors.accent} />
                  <Text style={[styles.recapText, !startChosen && styles.recapTextEmpty]} numberOfLines={1}>
                    {startChosen ? describeStart(effectiveStart) : 'No date yet'}
                  </Text>
                </TouchableOpacity>
                {effectiveRepeat !== null && (
                  <TouchableOpacity
                    style={styles.recapChip}
                    onPress={() => goToStep(0)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Repeat: ${describeEventRepeatShort(effectiveRepeat)}. Change`}
                  >
                    <Ionicons name="repeat-outline" size={13} color={colors.accent} />
                    <Text style={styles.recapText} numberOfLines={1}>{describeEventRepeatShort(effectiveRepeat)}</Text>
                  </TouchableOpacity>
                )}
                {step > 1 && effectiveLocation !== null && effectiveLocation.trim() !== '' && (
                  <TouchableOpacity
                    style={styles.recapChip}
                    onPress={() => goToStep(1)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Place: ${effectiveLocation}. Change`}
                  >
                    <Ionicons name="location-outline" size={13} color={colors.accent} />
                    <Text style={styles.recapText} numberOfLines={1}>{effectiveLocation}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {onStep(1) && (<>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={iconSize.sm} color={colors.textSecondary} />
              <TextField
                style={[styles.locationInput, draft.location !== null && styles.locationInputRead]}
                placeholder="Location"
                placeholderTextColor={colors.textTertiary}
                // Read from the line ("at Joe's") the field shows it and the line
                // is where it is edited, so the two can't hold different places.
                // Last time's place shows here, as an ordinary value to keep or edit.
                value={draft.location ?? (location || memoryLocation || '')}
                editable={draft.location === null}
                onChangeText={text => { setLocation(text); setSavedConfirmedKey(null); }}
                autoFocus={stepped}
                onSubmitEditing={advance}
                returnKeyType="next"
                blurOnSubmit={false}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                accessibilityLabel="Location"
              />
              {placePicked && (
                <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.accent} accessibilityLabel="Place from Apple Maps" />
              )}
            </View>

            {(savedSuggestions.length > 0 || placeResults.length > 0) && (
              <View style={styles.placeList}>
                {savedSuggestions.map((saved, index) => (
                  <TouchableOpacity
                    key={saved.id}
                    style={[styles.placeRow, index > 0 && styles.placeRowRuled]}
                    onPress={() => pickSavedPlace(saved)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Use saved place ${saved.name}`}
                  >
                    <View style={styles.savedPlaceName}>
                      <Ionicons name="bookmark-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.placeName} numberOfLines={1}>{saved.name}</Text>
                    </View>
                    <Text style={styles.placeAddress} numberOfLines={1}>{saved.text}</Text>
                  </TouchableOpacity>
                ))}
                {placeResults.map((place, index) => {
                  const subtitle = placeSubtitle(place);
                  return (
                    <TouchableOpacity
                      key={`${place.latitude},${place.longitude},${index}`}
                      style={[styles.placeRow, (index > 0 || savedSuggestions.length > 0) && styles.placeRowRuled]}
                      onPress={() => pickPlace(place)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${placeLocationText(place)}`}
                    >
                      <Text style={styles.placeName} numberOfLines={2}>{placeRowTitle(place)}</Text>
                      {subtitle && <Text style={styles.placeAddress} numberOfLines={2}>{subtitle}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {savedInUse && (
              <View style={styles.captionRow}>
                <Ionicons name="bookmark" size={13} color={colors.textSecondary} />
                <Text style={styles.captionText} numberOfLines={1}>{savedInUse.text}</Text>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); animateLayout(); setSavedConfirmedKey(null); }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use “${savedInUse.name}” as typed`}
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}

            {canSavePlace && (
              <View style={styles.placeOffer}>
                <InlineAction
                  icon="bookmark-outline"
                  label="Save place"
                  variant="neutral"
                  onPress={savePlace}
                  accessibilityLabel="Save this location as a named place"
                />
                <Text style={styles.placeOfferText}>Type its name instead of the address next time.</Text>
              </View>
            )}

            {!placeSuggestionsEnabled && wantsPlaces && (
              <View style={styles.placeOffer}>
                <InlineAction
                  icon="search-outline"
                  label="Suggest places"
                  variant="neutral"
                  onPress={() => setPlaceSuggestionsEnabled(true)}
                  accessibilityLabel="Turn on place suggestions from Apple Maps"
                />
                <Text style={styles.placeOfferText}>Looks up what you type in Apple Maps.</Text>
              </View>
            )}

            </>
            )}

            {!stepped && notesField}

            {onStep(0) && namedPeople.length > 0 && (
              <View style={styles.captionRow}>
                <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.captionText} numberOfLines={1}>With {namedPeople.join(', ')}</Text>
              </View>
            )}

            {onStep(0) && (
            <View style={styles.whenRow}>
              <TouchableOpacity
                style={styles.whenBlock}
                // Keyboard down first, or the title's token bar is lost behind the
                // picker's window — see the category chip in QuickAddModal.
                onPress={() => { haptics.tap(); Keyboard.dismiss(); setPickerVisible(true); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={allDay ? `Date: ${dayLabel(effectiveStart)}` : `Starts: ${describeStart(effectiveStart)}`}
              >
                <Text style={styles.whenLabel}>{allDay ? 'Date' : 'Starts'}</Text>
                {startChosen ? (
                  <>
                    <Text style={styles.whenValue} numberOfLines={1}>{dayLabel(effectiveStart)}</Text>
                    <Text style={styles.whenSub} numberOfLines={1}>{allDay ? 'All day' : formatTimeOfDay(effectiveStart, use24Hour)}</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.whenValue, { color: colors.textTertiary }]} numberOfLines={1}>Add date</Text>
                    <Text style={[styles.whenSub, { color: colors.textTertiary }]} numberOfLines={1}>{allDay ? 'All day' : 'Add time'}</Text>
                  </>
                )}
              </TouchableOpacity>
              {!allDay && (
                <TouchableOpacity
                  style={styles.whenBlock}
                  // With no start yet there is nothing to measure an end from, so
                  // the end chip asks for the start first (then goes on to the end).
                  onPress={() => { haptics.tap(); Keyboard.dismiss(); if (startChosen) setEndPickerVisible(true); else setPickerVisible(true); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={startChosen ? `Ends: ${describeStart(effectiveEnd)}` : 'Ends: not set'}
                >
                  <Text style={styles.whenLabel}>Ends</Text>
                  {startChosen ? (
                    <>
                      <Text style={styles.whenValue} numberOfLines={1}>{dayLabel(effectiveEnd)}</Text>
                      <Text style={styles.whenSub} numberOfLines={1}>{formatTimeOfDay(effectiveEnd, use24Hour)}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.whenValue, { color: colors.textTertiary }]} numberOfLines={1}>Add date</Text>
                      <Text style={[styles.whenSub, { color: colors.textTertiary }]} numberOfLines={1}>Add time</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
            )}

            {onStep(2) && (
            <View style={styles.toolbar}>
              <TouchableOpacity
                style={[styles.toolChip, styles.toolChipWide]}
                onPress={() => { void openCalendarPicker(); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Calendar: ${effectiveCalendar?.title ?? 'default'}`}
              >
                {effectiveCalendar?.color ? <View style={[styles.calendarDot, { backgroundColor: effectiveCalendar.color }]} /> : (
                  <Ionicons name="albums-outline" size={iconSize.sm} color={colors.textSecondary} />
                )}
                <Text style={styles.toolChipText} numberOfLines={1}>{effectiveCalendar?.title ?? 'Calendar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolChip, alertSet && styles.toolChipSet]}
                onPress={() => { haptics.tap(); Keyboard.dismiss(); setAlertPickerVisible(true); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Alert: ${describeAlert(effectiveAlert, allDay)}`}
              >
                <Ionicons name={alertSet ? 'notifications' : 'notifications-outline'} size={iconSize.sm} color={alertSet ? colors.accent : colors.textSecondary} />
                <Text style={[styles.toolChipText, alertSet && styles.toolChipTextSet]} numberOfLines={1}>
                  {describeAlert(effectiveAlert, allDay)}
                </Text>
              </TouchableOpacity>
            </View>
            )}

            {(stepped ? onStep(1) && travelRowsShown : showTravelChips) && (
              <View style={styles.toolbar}>
                <TouchableOpacity
                  style={[styles.toolChip, styles.toolChipWide, (effectiveTravelMode !== null || effectiveTravelSkip) && styles.toolChipSet, travelRowsLocked && styles.toolChipLocked]}
                  onPress={() => { haptics.tap(); Keyboard.dismiss(); setTravelModePickerVisible(true); }}
                  disabled={travelRowsLocked}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Getting there: ${travelChipLabel}`}
                >
                  <Ionicons name="navigate-outline" size={iconSize.sm} color={effectiveTravelMode !== null || effectiveTravelSkip ? colors.accent : colors.textSecondary} />
                  <Text style={[styles.toolChipText, (effectiveTravelMode !== null || effectiveTravelSkip) && styles.toolChipTextSet]} numberOfLines={1}>
                    {travelChipLabel}
                  </Text>
                </TouchableOpacity>
                {!effectiveTravelSkip && (
                <TouchableOpacity
                  style={[styles.toolChip, styles.toolChipWide, effectiveArriveEarly !== null && styles.toolChipSet, travelRowsLocked && styles.toolChipLocked]}
                  onPress={() => { haptics.tap(); Keyboard.dismiss(); setArrivePickerVisible(true); }}
                  disabled={travelRowsLocked}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Arrive: ${describeArrival(shownArriveEarly)}`}
                >
                  <Ionicons name="flag-outline" size={iconSize.sm} color={effectiveArriveEarly !== null ? colors.accent : colors.textSecondary} />
                  <Text style={[styles.toolChipText, effectiveArriveEarly !== null && styles.toolChipTextSet]} numberOfLines={1}>
                    {describeArrival(shownArriveEarly)}
                  </Text>
                </TouchableOpacity>
                )}
                {showOriginChip && (
                  <TouchableOpacity
                    style={[styles.toolChip, styles.toolChipWide, pickedOriginName !== null && styles.toolChipSet]}
                    onPress={() => { haptics.tap(); Keyboard.dismiss(); setOriginPickerVisible(true); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Start from: ${originChipLabel}`}
                  >
                    <Ionicons
                      name={originChipLabel === 'Where I am' ? 'locate-outline' : 'home-outline'}
                      size={iconSize.sm}
                      color={pickedOriginName !== null ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.toolChipText, pickedOriginName !== null && styles.toolChipTextSet]} numberOfLines={1}>
                      {originChipLabel}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {travelRowsShown && travelRowsLocked && onStep(1) && (
              <HelpText style={styles.lockedHint}>Choose a place to set how you get there.</HelpText>
            )}

            {stepped ? (
              <>
                {onStep(0) && <View style={styles.toolbar}>{allDayChip}{repeatChip}</View>}
                {onStep(2) && <View style={styles.toolbar}>{busyChip}{notesChip}</View>}
                {onStep(2) && notesField}
              </>
            ) : (
              <>
                <View style={styles.toolbar}>{allDayChip}{busyChip}</View>
                {(!showNotes || !isEditing) && <View style={styles.toolbar}>{notesChip}{repeatChip}</View>}
              </>
            )}

            {onStep(0) && conflicts.length > 0 && (
              <View style={styles.conflictBlock}>
                <TouchableOpacity
                  style={styles.captionRowTight}
                  onPress={() => { haptics.tap(); animateLayout(); setConflictsOpen(v => !v); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={conflictsOpen ? 'Hide overlapping events' : 'Show overlapping events'}
                  accessibilityState={{ expanded: conflictsOpen }}
                >
                  <Ionicons name="alert-circle-outline" size={13} color={colors.orangeText} />
                  <Text style={[styles.captionText, styles.captionWarning]} numberOfLines={1}>
                    {conflictsOpen
                      ? `Overlaps ${conflicts.length} ${conflicts.length === 1 ? 'event' : 'events'}`
                      : `Overlaps ${conflicts[0].title || 'an event'}, ${describeSpan(conflicts[0])}${conflicts.length > 1 ? ` and ${conflicts.length - 1} more` : ''}`}
                  </Text>
                  <Ionicons name={conflictsOpen ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textSecondary} />
                </TouchableOpacity>
                {conflictsOpen && conflicts.map((event, i) => (
                  <View key={`${event.id}-${event.start}-${i}`} style={styles.conflictItem}>
                    <Text style={styles.conflictTitle} numberOfLines={1}>{event.title || 'Untitled event'}</Text>
                    <Text style={styles.conflictSpan}>{describeSpan(event)}</Text>
                  </View>
                ))}
              </View>
            )}

            {onStep(0) && freeSlot !== null && rawStart === freeSlot && (
              <View style={styles.captionRow}>
                <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.captionText} numberOfLines={1}>The first free time that day</Text>
              </View>
            )}

            {onStep(0) && usingMemory && (
              <View style={styles.captionRow}>
                <Ionicons name="refresh-outline" size={13} color={colors.textSecondary} />
                <Text style={styles.captionText} numberOfLines={1}>
                  {savedEventMatch
                    ? `Filled in from your saved “${draft.title.trim()}”`
                    : `Filled in from your last “${draft.title.trim()}”`}
                </Text>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); animateLayout(); setMemoryDismissedKey(memoryKey); }}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Don’t fill in from last time"
                >
                  <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}

            {isEditing && original && (
              <View style={styles.deleteRow}>
                <InlineAction
                  icon="trash-outline"
                  label="Delete event"
                  variant="neutral"
                  tint={colors.red}
                  onPress={confirmDelete}
                  accessibilityLabel="Delete this event"
                />
              </View>
            )}
          </ScrollView>
          <ScrollEdgeFade edge="bottom" opacity={scrollFade.bottomOpacity} color={colors.bgSecondary} />
          </View>
          {stepped && (
            <View style={styles.footer}>
              {step > 0 && (
                <TouchableOpacity
                  style={[styles.footerBtn, styles.footerBack]}
                  onPress={() => goToStep(step - 1)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Back to ${STEP_NAMES[step - 1]}`}
                >
                  <Text style={styles.footerBackText}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerNext, (busy || draft.title.trim().length === 0) && styles.footerNextDisabled]}
                onPress={advance}
                disabled={busy || draft.title.trim().length === 0}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={step === lastStep ? 'Add event' : step === 0 && !startChosen ? 'Next, choose a date' : stepAdvanceLabel}
              >
                <Text style={[styles.footerNextText, (busy || draft.title.trim().length === 0) && styles.footerNextTextDisabled]}>
                  {stepAdvanceLabel}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </View>
      <TitleTokenAccessory
        nativeID={EVENT_TOKEN_ACCESSORY_ID}
        tokens={EVENT_TOKENS}
        onInsert={insertToken}
        onConfirm={applyPhrase}
        confirmVisible={phrase !== null}
      />
      <CalendarPicker
        visible={pickerVisible}
        value={rawStart}
        mode={allDay ? 'date' : 'datetime'}
        title={allDay ? 'Date' : 'Starts'}
        dayShortcuts
        lengthMinutes={allDay ? undefined : effectiveDuration}
        onOtherLength={pickStartThenEnd}
        onConfirm={pickStart}
        onCancel={() => setPickerVisible(false)}
      />
      <CalendarPicker
        visible={endPickerVisible}
        value={effectiveEnd}
        startsAt={effectiveStart}
        mode="end"
        title="Ends"
        onConfirm={pickEnd}
        onCancel={() => setEndPickerVisible(false)}
      />
      <EventOptionSheet
        visible={repeatPickerVisible}
        title="Repeat"
        options={repeatOptions}
        selectedKey={eventRepeatPresetKey(effectiveRepeat) ?? 'none'}
        onSelect={pickRepeat}
        onClose={() => setRepeatPickerVisible(false)}
      />
      <EventOptionSheet
        visible={calendarPickerVisible}
        title="Calendar"
        options={calendarOptions}
        selectedKey={effectiveCalendar?.id ?? null}
        emptyText="No calendar on this device can take new events. Turn on calendar access or add an editable calendar in Settings."
        onSelect={id => {
          // A typed "in Work calendar" would outrank the pick, so it leaves the line.
          if (draft.calendarSpan) cutFromLine(draft.calendarSpan);
          setCalendarPick(id);
        }}
        onClose={() => setCalendarPickerVisible(false)}
      />
      <EventOptionSheet
        visible={alertPickerVisible}
        title="Alert"
        options={alertOptions}
        selectedKey={effectiveAlert === null ? 'none' : String(effectiveAlert)}
        onSelect={key => {
          // A typed "alert 30m" would outrank the pick, so a pick takes it out
          // of the line rather than being dropped.
          if (draft.alertSpan) cutFromLine(draft.alertSpan);
          setAlertPick(key === 'none' ? null : Number(key));
        }}
        onClose={() => setAlertPickerVisible(false)}
      />
      <EventOptionSheet
        visible={travelModePickerVisible}
        title="Getting there"
        options={travelModeOptions}
        selectedKey={effectiveTravelSkip ? TRAVEL_SKIP_KEY : effectiveTravelMode ?? 'default'}
        onSelect={key => {
          if (draft.travelSpan) cutFromLine(draft.travelSpan);
          // The other picks stay as they were, so choosing a mode again picks up where it left off.
          setTravelSkipPick(key === TRAVEL_SKIP_KEY);
          if (key !== TRAVEL_SKIP_KEY) setTravelModePick(key === 'default' ? null : (key as TravelMode));
        }}
        onClose={() => setTravelModePickerVisible(false)}
      />
      <EventOptionSheet
        visible={arrivePickerVisible}
        title="Arrive"
        options={arriveOptions}
        selectedKey={effectiveArriveEarly === null ? 'default' : String(effectiveArriveEarly)}
        onSelect={key => {
          if (draft.arriveSpan) cutFromLine(draft.arriveSpan);
          setArriveEarlyPick(key === 'default' ? null : Number(key));
        }}
        onClose={() => setArrivePickerVisible(false)}
      />
      <EventOptionSheet
        visible={originPickerVisible}
        title="Start from"
        options={originOptions}
        selectedKey={pickedOriginName !== null ? effectiveTravelOrigin ?? 'default' : 'default'}
        onSelect={key => {
          if (draft.originSpan) cutFromLine(draft.originSpan);
          setTravelOriginPick(key === 'default' ? null : key);
        }}
        onClose={() => setOriginPickerVisible(false)}
      />
    </SheetModal>
  );
}

const TRAVEL_MODE_LABELS: Record<TravelMode, string> = { driving: 'Car', transit: 'Transit', walking: 'Walking' };
const TRAVEL_SKIP_KEY = 'skip';
const STEP_NAMES = ['When', 'Where', 'Details'] as const;

// Mirrors QuickAddModal's card, input and tooltip styles; the notes on why
// each value is what it is live there.
const makeStyles = (colors: Colors, sheetMaxHeight: number) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  keyboardBacking: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bgSecondary },
  centeredContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    padding: spacing.md,
    maxHeight: sheetMaxHeight,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  body: { flexShrink: 1, position: 'relative' },
  savedPlaceName: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inputWrap: { flex: 1, position: 'relative' },
  input: { fontSize: font.xl, fontWeight: fontWeight.semibold, color: colors.text, paddingVertical: spacing.sm },
  inputOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  inputHidden: { color: 'transparent' },
  inputHighlight: { color: colors.accent, fontWeight: fontWeight.semibold, backgroundColor: colors.accentSubtle },
  measureWrap: { position: 'absolute', top: 0, left: 0, opacity: 0 },
  measureText: { fontSize: font.xl, fontWeight: fontWeight.semibold },
  addBtn: {
    width: interaction.pillHeight,
    height: interaction.pillHeight,
    borderRadius: interaction.pillHeight / 2,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: colors.bgTertiary },
  // Zero height with the bubble overflowing it: a popover over the fields, not a
  // row that pushes them down and clips the card's last row off its capped height.
  tooltipRow: { height: 0, marginTop: -4, zIndex: 2, overflow: 'visible' },
  // Absolute so the bubble sizes itself rather than being laid out inside the
  // row's zero height, which squashed its content to a sliver.
  tooltipAnchor: { position: 'absolute', top: 0, left: 0 },
  tooltipCaret: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.accentFill,
    marginBottom: -1,
  },
  tooltipBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xsm,
    paddingHorizontal: spacing.smd,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
  tooltipPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
  },
  tooltipBubbleJoined: { flexShrink: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  tooltipDismiss: {
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: spacing.xsm,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
  tooltipDivider: { width: 1, alignSelf: 'stretch', marginVertical: 7, backgroundColor: colors.onAccent, opacity: 0.25 },
  tooltipCandidateRow: { flexDirection: 'row', alignSelf: 'flex-start', gap: spacing.xsm },
  tooltipCandidatePill: {
    paddingHorizontal: spacing.smd,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
  tooltipText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold, flexShrink: 1 },
  tooltipDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.onAccent, opacity: 0.6 },
  tooltipHint: { color: colors.onAccent, fontSize: font.xs, fontWeight: fontWeight.medium, opacity: 0.75 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    paddingHorizontal: 10,
    minHeight: interaction.pillHeight,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    marginBottom: spacing.sm,
  },
  locationInput: { flex: 1, fontSize: font.sm, color: colors.text, paddingVertical: spacing.xs },
  locationInputRead: { color: colors.accent },
  calendarDot: { width: 10, height: 10, borderRadius: 5 },
  placeList: {
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  placeRow: { paddingHorizontal: 10, paddingVertical: spacing.sm, gap: spacing.xxs },
  // The saved list folds under its own header row; the block carries the gap below.
  savedBlock: { marginBottom: spacing.sm },
  savedHeaderText: { flex: 1, color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  savedList: { borderRadius: radius.md, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 10, paddingVertical: spacing.sm },
  savedText: { flex: 1, gap: spacing.xxs },
  placeRowRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  placeName: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  placeAddress: { color: colors.textSecondary, fontSize: font.xs },
  placeOffer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  placeOfferText: { flex: 1, color: colors.textSecondary, fontSize: font.xs },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  captionText: { flex: 1, color: colors.textSecondary, fontSize: font.xs },
  // The icon carries the orange; orange text on a light card is too faint to read.
  captionWarning: { color: colors.text },
  captionRowTight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // The expanded list sits under its header row; the block carries the gap to the next element.
  conflictBlock: { marginBottom: spacing.sm },
  conflictItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md + spacing.xs, paddingTop: spacing.xs },
  conflictTitle: { flex: 1, color: colors.text, fontSize: font.xs },
  conflictSpan: { color: colors.textSecondary, fontSize: font.xs },
  deleteRow: { flexDirection: 'row', marginBottom: spacing.sm },
  toolbar: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    minHeight: interaction.pillHeight,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  // The date (and the calendar's name) take the room; the other chips keep their width.
  toolChipWide: { flex: 1 },
  // The trip rows before a place is set: shown so they can be found, not usable yet.
  toolChipLocked: { opacity: 0.4 },
  lockedHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: -spacing.xs, marginBottom: spacing.sm },
  // The step's name and where it sits among the three, between the title and the fields.
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  stepTitle: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8, textTransform: 'uppercase' },
  stepDots: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.controlBorder },
  stepDotOn: { width: 16, backgroundColor: colors.accentFill },
  // What the earlier steps decided, each one a tap back to its step.
  recapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  recapChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
  },
  recapText: { flexShrink: 1, color: colors.accent, fontSize: font.xs, fontWeight: fontWeight.semibold },
  recapTextEmpty: { color: colors.textSecondary },
  footer: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  footerBtn: { minHeight: interaction.pillHeight, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  footerBack: { backgroundColor: colors.bgTertiary },
  footerBackText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  footerNext: { flex: 1, backgroundColor: colors.accentFill },
  footerNextDisabled: { backgroundColor: colors.bgTertiary },
  footerNextText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  footerNextTextDisabled: { color: colors.textTertiary },
  toolChipSet: { backgroundColor: colors.accentSubtle },
  toolChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium, flexShrink: 1 },
  toolChipTextSet: { color: colors.accent },
  // Starts and Ends: two halves of one row, each a tap target for its own picker.
  whenRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  whenBlock: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  whenLabel: { color: colors.textTertiary, fontSize: font.xxs, fontWeight: fontWeight.semibold, letterSpacing: 0.6, textTransform: 'uppercase' },
  whenValue: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold, marginTop: 1 },
  whenSub: { color: colors.textSecondary, fontSize: font.xs },
  // The All day and Busy chips carry a switch at their trailing edge, so the label takes the room.
  switchLabel: { flex: 1, color: colors.text },
  switchTrack: { width: 30, height: 18, borderRadius: 9, backgroundColor: colors.controlBorder, justifyContent: 'center', paddingHorizontal: 2 },
  switchTrackOn: { backgroundColor: colors.accentFill },
  switchKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.onFill, alignSelf: 'flex-start' },
  switchKnobOn: { backgroundColor: colors.onAccent, alignSelf: 'flex-end' },
});
