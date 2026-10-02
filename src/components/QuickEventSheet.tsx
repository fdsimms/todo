import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
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
import { TITLE_MAX_LENGTH } from '../types';

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
 * cut down to the one sigil an event reads ("@"). The arrow opens Apple's
 * new-event sheet filled in from it, where the calendar (Google included) is
 * picked and the event is saved; the people named are linked once it is
 * (`useEventPeopleStore.createEvent`).
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
 * The system sheet is presented on top of this one while it is still open, and
 * this one closes only once the event is saved. A cancel there lands back here
 * with the line intact, and presenting from a sheet mid-dismissal is the thing
 * UIKit refuses.
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
  const createEvent = useEventPeopleStore(s => s.createEvent);

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

  // ==== effects: resetting on open ====
  useEffect(() => {
    if (!visible) return;
    setText('');
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
    const ranges = [...draft.mentionSpans];
    if (activeMatch) ranges.push([activeMatch.matchStart, activeMatch.matchEnd]);
    return mergeRanges(ranges);
  }, [draft.mentionSpans, activeMatch?.matchStart, activeMatch?.matchEnd]);
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

  // ==== the exit: open the calendar's own form ====
  const next = async () => {
    if (!canAdd) return;
    haptics.tap();
    setBusy(true);
    const saved = await createEvent(
      { title: draft.title, start: effectiveStart, end: effectiveEnd, allDay },
      draft.personIds
    );
    setBusy(false);
    if (saved) dismiss();
  };

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
              <TextInput
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
              accessibilityLabel="Continue to the calendar's event form"
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
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

          <Text style={styles.hint}>
            The arrow opens your calendar's event form with this filled in. Pick the calendar and save there.
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
  // The date is the one value that needs the room; All day keeps its width.
  toolChipWide: { flex: 1 },
  toolChipSet: { backgroundColor: colors.accentSubtle },
  toolChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium, flexShrink: 1 },
  toolChipTextSet: { color: colors.accent },
  hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
});
