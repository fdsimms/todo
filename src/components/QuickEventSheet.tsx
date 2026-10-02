import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
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
import { addHours } from 'date-fns/addHours';
import { SheetModal } from './SheetModal';
import { SheetScrim } from './SheetScrim';
import { SafeBlurView } from './SafeBlurView';
import { PressableScale } from './PressableScale';
import { HighlightedText } from './HighlightedText';
import { TitleTokenAccessory } from './TitleTokenAccessory';
import { CalendarPicker } from './CalendarPicker';
import { EventOptionSheet, type EventOption } from './EventOptionSheet';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, animation, type Colors } from '../theme';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { useTitleSelection } from '../hooks/useTitleSelection';
import { groupMentionTokens } from '../utils/peopleRegistry';
import { parseQuickEvent } from '../utils/quickEvent';
import {
  readQuickEventDefaults,
  writeQuickEventDefaults,
  type EventAvailability,
} from '../utils/quickEventDefaults';
import { ALERT_CHOICES, describeAlert, quickEventSaveFields } from '../utils/quickEventSave';
import {
  getCalendarPermission,
  listWritableCalendars,
  requestCalendarPermission,
  resolveEventCalendar,
} from '../utils/calendarSync';
import type { Calendar as DeviceCalendar } from 'expo-calendar/legacy';
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
import { isDemoModeActive } from '../utils/demoState';
import { TITLE_MAX_LENGTH } from '../types';
import { TextField } from './TextField';

const EVENT_TOKEN_ACCESSORY_ID = 'quickEventTitleTokenAccessory';
/** "#" and "!" name a category and a priority, which an event doesn't have. */
const EVENT_TOKENS = ['@'] as const;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Quick add for a calendar event: one line ("lunch w/ @dustin sat 12pm") in
 * the same floating card as task quick add (`QuickAddModal`), with the same
 * reading aids: the schedule phrase and each "@name" highlighted as you type,
 * a tooltip under the phrase to set it or say "not that", the pick-one pills
 * for an "@name" that is ambiguous or still being typed, and the keyboard bar
 * cut down to the one sigil an event reads ("@"). The check saves the event
 * straight into the calendar, with no system sheet (`saveEventDirect`); the
 * people named are linked once it is (`useEventPeopleStore.saveEvent`).
 *
 * **The rows Apple's form used to ask for are chips here** (calendar, alert,
 * Busy/Free) and start as the last saved event left them
 * (`quickEventDefaults.ts`), so a usual event is a title and a day. A trailing
 * "at Joe's" and "alert 30m" in the line fill the place and the alert as you
 * type, and they win over a chip's earlier pick the way a typed day wins over
 * the date chip's. What can't be set from here at all is invitees and travel
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
 */
export function QuickEventSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const people = usePersonStore(useShallow(s => s.people.filter(p => !p.archived)));
  const groups = usePersonGroupStore(useShallow(s => s.groups));
  const groupTokens = useMemo(() => groupMentionTokens(), [people, groups]);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const saveEvent = useEventPeopleStore(s => s.saveEvent);

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
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [targetCalendar, setTargetCalendar] = useState<DeviceCalendar | null>(null);
  const [calendarPickerVisible, setCalendarPickerVisible] = useState(false);
  const [alertPickerVisible, setAlertPickerVisible] = useState(false);
  const titleCaret = useTitleSelection(text);
  const [busy, setBusy] = useState(false);
  // A start set by hand (the chip's picker) or by tapping the tooltip. A
  // schedule phrase typed afterward wins back, so a stale pick can't stick
  // silently: see `rawStart` below.
  const [startOverride, setStartOverride] = useState<Date | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
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

  // ==== effects: resetting on open ====
  useEffect(() => {
    if (!visible) return;
    setText('');
    setLocation('');
    setNotesOrLink('');
    const remembered = readQuickEventDefaults();
    setCalendarId(remembered.calendarId);
    setAlertDefault(remembered.alertMinutes);
    setAlertPick(undefined);
    setAvailability(remembered.availability);
    setCalendarPickerVisible(false);
    setAlertPickerVisible(false);
    void loadCalendars(remembered.calendarId, false);
    titleCaret.resetCaret('');
    setBusy(false);
    setStartOverride(null);
    setAllDay(false);
    setPickerVisible(false);
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
      mentionOverrides: personOverrides,
    };
    const read = parseQuickEvent(text, base);
    const dismissed = read.phrase !== null && `${read.phrase.start}|${read.phrase.text}` === dismissedSignature;
    return dismissed ? parseQuickEvent(text, { ...base, ignoreSchedule: true }) : read;
  }, [text, people, groupTokens, dayResetTime, personOverrides, dismissedSignature]);

  const phrase = draft.phrase;
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

  // A live phrase wins over an earlier pick; with none, the pick holds.
  const rawStart = phrase ? draft.start : (startOverride ?? draft.start);
  const effectiveStart = allDay ? startOfDay(rawStart) : rawStart;
  // All-day events are exclusive on the end date in EventKit: one full day
  // is [date, date + 1), same convention as createAllDayEvent.
  const effectiveEnd = allDay ? addDays(effectiveStart, 1) : addHours(effectiveStart, 1);
  const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const describeStart = (d: Date) => (allDay ? dayLabel(d) : `${dayLabel(d)}, ${formatTimeOfDay(d, use24Hour)}`);
  const when = describeStart(effectiveStart);
  const whenSet = phrase !== null || startOverride !== null;
  const namedPeople = people.filter(p => draft.personIds.includes(p.id)).map(displayNameOf);
  // A place or alert typed in the line is live, the same as a typed day: it
  // wins over an earlier pick without anyone tapping it.
  const effectiveLocation = draft.location ?? (location.trim() || null);
  const effectiveAlert =
    draft.alertMinutes !== undefined ? draft.alertMinutes : alertPick !== undefined ? alertPick : alertDefault;
  const alertSet = effectiveAlert !== null;
  const canAdd = draft.title.trim().length > 0 && !busy;

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
    setStartOverride(draft.start);
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
  const pickStart = (date: Date) => {
    if (phrase) {
      const next = withTrailingSpace(phrase.lineWithout);
      setText(next);
      titleCaret.moveCaret(next);
    }
    setStartOverride(date);
    setPickerVisible(false);
  };

  // ==== the exit: write the event ====
  const next = async () => {
    if (!canAdd) return;
    haptics.tap();
    setBusy(true);
    const saved = await saveEvent(
      quickEventSaveFields({
        title: draft.title,
        start: effectiveStart,
        end: effectiveEnd,
        allDay,
        location: effectiveLocation,
        notesOrLink,
        alertMinutes: effectiveAlert,
        availability,
        calendarId: targetCalendar?.id ?? calendarId,
      }),
      draft.personIds
    );
    setBusy(false);
    // A demo's event is refused on purpose (it would reach the real calendar),
    // which isn't a failure to explain.
    if (!saved && isDemoModeActive()) return;
    if (!saved) {
      Alert.alert(
        "Couldn't add the event",
        'Check that this app can add events to your calendar in the Settings app, then try again. The event is still here.'
      );
      return;
    }
    writeQuickEventDefaults({ calendarId: saved.calendarId, alertMinutes: effectiveAlert, availability });
    dismiss();
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
      <SheetScrim onPress={dismiss} label="Close new event" />
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
                placeholder="New event…"
                placeholderTextColor={colors.textTertiary}
                value={text}
                onChangeText={setText}
                onSubmitEditing={next}
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
              accessibilityLabel="Add event"
            >
              <Ionicons name="checkmark" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>

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

          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={iconSize.sm} color={colors.textSecondary} />
            <TextField
              style={[styles.locationInput, draft.location !== null && styles.locationInputRead]}
              placeholder="Location"
              placeholderTextColor={colors.textTertiary}
              // Read from the line ("at Joe's") the field shows it and the line
              // is where it is edited, so the two can't hold different places.
              value={draft.location ?? location}
              editable={draft.location === null}
              onChangeText={setLocation}
              onSubmitEditing={next}
              returnKeyType="next"
              blurOnSubmit={false}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              accessibilityLabel="Location"
            />
          </View>

          <View style={styles.locationRow}>
            <Ionicons name="document-text-outline" size={iconSize.sm} color={colors.textSecondary} />
            <TextField
              style={styles.locationInput}
              placeholder="Notes or link"
              placeholderTextColor={colors.textTertiary}
              value={notesOrLink}
              onChangeText={setNotesOrLink}
              onSubmitEditing={next}
              returnKeyType="done"
              blurOnSubmit={false}
              autoCapitalize="none"
              keyboardAppearance={isDark ? 'dark' : 'light'}
              accessibilityLabel="Notes or link"
            />
          </View>

          {namedPeople.length > 0 && (
            <View style={styles.captionRow}>
              <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.captionText} numberOfLines={1}>With {namedPeople.join(', ')}</Text>
            </View>
          )}

          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolChip, styles.toolChipWide, whenSet && styles.toolChipSet]}
              // Keyboard down first, or the title's token bar is lost behind the
              // picker's window — see the category chip in QuickAddModal.
              onPress={() => { haptics.tap(); Keyboard.dismiss(); setPickerVisible(true); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${allDay ? 'Date' : 'Date and time'}: ${when}`}
            >
              <Ionicons name="calendar-outline" size={iconSize.sm} color={whenSet ? colors.accent : colors.textSecondary} />
              <Text style={[styles.toolChipText, whenSet && styles.toolChipTextSet]} numberOfLines={1}>{when}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolChip, allDay && styles.toolChipSet]}
              onPress={() => { haptics.tap(); setAllDay(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityLabel="All day"
              accessibilityState={{ checked: allDay }}
            >
              <Ionicons name="sunny-outline" size={iconSize.sm} color={allDay ? colors.accent : colors.textSecondary} />
              <Text style={[styles.toolChipText, allDay && styles.toolChipTextSet]}>All day</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.toolbar}>
            <TouchableOpacity
              style={[styles.toolChip, styles.toolChipWide]}
              onPress={() => { void openCalendarPicker(); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Calendar: ${targetCalendar?.title ?? 'default'}`}
            >
              {targetCalendar?.color ? <View style={[styles.calendarDot, { backgroundColor: targetCalendar.color }]} /> : (
                <Ionicons name="albums-outline" size={iconSize.sm} color={colors.textSecondary} />
              )}
              <Text style={styles.toolChipText} numberOfLines={1}>{targetCalendar?.title ?? 'Calendar'}</Text>
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
            <TouchableOpacity
              style={styles.toolChip}
              onPress={() => { haptics.tap(); setAvailability(v => (v === 'busy' ? 'free' : 'busy')); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Show as ${availability === 'busy' ? 'busy' : 'free'}. Tap to change.`}
            >
              <Text style={styles.toolChipText}>{availability === 'busy' ? 'Busy' : 'Free'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Saves to your calendar. End the line with "at (place)" and "alert 30m" to fill those in.
          </Text>
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
        title={allDay ? 'Date' : 'Date & time'}
        onConfirm={pickStart}
        onCancel={() => setPickerVisible(false)}
      />
      <EventOptionSheet
        visible={calendarPickerVisible}
        title="Calendar"
        options={calendarOptions}
        selectedKey={targetCalendar?.id ?? null}
        emptyText="No calendar on this device can be added to. Turn on calendar access, or add a calendar you can edit, in the Settings app."
        onSelect={id => {
          setCalendarId(id);
          setTargetCalendar(calendars.find(c => c.id === id) ?? null);
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
          if (draft.alertMinutes !== undefined) {
            const alertSpan = draft.clauseSpans[draft.clauseSpans.length - 1];
            const next = withTrailingSpace(text.slice(0, alertSpan[0]).trimEnd());
            setText(next);
            titleCaret.moveCaret(next);
          }
          setAlertPick(key === 'none' ? null : Number(key));
        }}
        onClose={() => setAlertPickerVisible(false)}
      />
    </SheetModal>
  );
}

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
  inputWrap: { flex: 1, position: 'relative' },
  input: { fontSize: font.md, color: colors.text, paddingVertical: spacing.sm },
  inputOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  inputHidden: { color: 'transparent' },
  inputHighlight: { color: colors.accent, fontWeight: fontWeight.semibold, backgroundColor: colors.accentSubtle },
  measureWrap: { position: 'absolute', top: 0, left: 0, opacity: 0 },
  measureText: { fontSize: font.md },
  addBtn: {
    width: interaction.pillHeight,
    height: interaction.pillHeight,
    borderRadius: interaction.pillHeight / 2,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: colors.bgTertiary },
  tooltipRow: { marginTop: -4, marginBottom: spacing.sm },
  tooltipAnchor: { alignSelf: 'flex-start' },
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
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  captionText: { flex: 1, color: colors.textSecondary, fontSize: font.xs },
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
  toolChipSet: { backgroundColor: colors.accentSubtle },
  toolChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium, flexShrink: 1 },
  toolChipTextSet: { color: colors.accent },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
});
