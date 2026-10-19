import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SheetModal } from './SheetModal';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { startOfMonth } from 'date-fns/startOfMonth';
import { addMonths } from 'date-fns/addMonths';
import { subMonths } from 'date-fns/subMonths';
import { isSameMonth } from 'date-fns/isSameMonth';
import { isSameDay } from 'date-fns/isSameDay';
import { isToday } from 'date-fns/isToday';
import { format } from 'date-fns/format';
import { addMinutes } from 'date-fns/addMinutes';
import { addDays } from 'date-fns/addDays';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors, textScale } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildCalendarGrid, dayShortcutDays, dayShortcutLabel, weekdayHeaders } from '../utils/calendarGrid';
import { dayKeyOf, formatTimeOfDay, getLogicalToday } from '../utils/dateUtils';
import { EVENT_LENGTH_PRESETS, describeEventLength, lengthToClock } from '../utils/eventLength';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetScrim } from './SheetScrim';
import { BUTTON_LABEL } from '../copy/shared';
import { pickerCardWidthFor } from '../utils/frameWidth';

interface Props {
  visible: boolean;
  value: Date | null;
  /**
   * `'end'` is an event's end: a time wheel (and length chips) for the day of
   * `startsAt`, with "Different day…" to fall back to the full picker. A time at
   * or before the start lands on the next day, so "10pm to 1am" is one wheel.
   */
  mode: 'date' | 'datetime' | 'end';
  title: string;
  /**
   * A second argument is passed only when the length chips were used, so a
   * caller that never touches the length is not handed one to pin.
   */
  onConfirm: (date: Date, lengthMinutes?: number) => void;
  onCancel: () => void;
  /** A row of Today / Tomorrow / next weekend above the grid. */
  dayShortcuts?: boolean;
  /**
   * Shows length chips under the time wheel (start of an event), starting on
   * this many minutes. With `onOtherLength`, a trailing "Other…" chip hands the
   * chosen start over so the caller can open the end picker.
   */
  lengthMinutes?: number;
  onOtherLength?: (start: Date, lengthMinutes: number | undefined) => void;
  /** The event's start, for `mode="end"`. */
  startsAt?: Date;
  /**
   * Multi-date mode: a tap toggles a day in or out of a set rather than
   * replacing the selection, and Done reports the whole set through
   * `onConfirmMultiple` (`onConfirm`/`value` are unused). Used for a task
   * that falls on several dates — see Task.seriesId.
   */
  multiple?: boolean;
  values?: Date[];
  onConfirmMultiple?: (dates: Date[]) => void;
}

// Same floating-card geometry as WhenPicker (the row reschedule / group
// reschedule picker) — this used to be a full-screen slide-up pageSheet with
// its own hand-picked spacing, which is why the two read as two different
// pickers despite doing the same job. Keep these in step with WhenPicker's
// constants if either changes.
const CAL_PADDING = 10;

export function CalendarPicker({
  visible, value, mode, title, onConfirm, onCancel,
  multiple, values, onConfirmMultiple,
  dayShortcuts, lengthMinutes, onOtherLength, startsAt,
}: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, windowWidth), [colors, windowWidth]);

  const [displayMonth, setDisplayMonth] = useState(() => value ?? new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(value);
  const [timeDate, setTimeDate] = useState<Date>(() => {
    const d = value ?? new Date();
    if (!value) d.setHours(9, 0, 0, 0);
    return d;
  });
  const [pickerReady, setPickerReady] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>(values ?? []);
  // A length picked from the chips, null until one is. `endFull` is an end
  // picker that fell back to the whole grid ("Different day…").
  const [lengthPick, setLengthPick] = useState<number | null>(null);
  const [endFull, setEndFull] = useState(false);
  const viewMode = mode === 'end' && !endFull ? 'end' : mode === 'end' ? 'datetime' : mode;
  const use24Hour = useSettingsStore(s => s.use24HourTime);

  const cardScale = useRef(new Animated.Value(0.92)).current;
  const enterAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      setPickerReady(false);
      cardScale.setValue(0.92);
      enterAnim.setValue(0);
      return;
    }
    const seed = multiple ? (values && values.length > 0 ? values[0] : null) : value;
    const base = seed ?? new Date();
    setDisplayMonth(startOfMonth(base));
    setSelectedDate(value);
    setSelectedDates(values ?? []);
    const t = new Date(base);
    if (!seed) t.setHours(9, 0, 0, 0);
    setTimeDate(t);
    setLengthPick(null);
    setEndFull(false);
    cardScale.setValue(0.92);
    enterAnim.setValue(0);
    Animated.parallel([
      Animated.timing(enterAnim, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const calendarDays = useMemo(
    () => buildCalendarGrid(displayMonth, weekStartsOn),
    [displayMonth, weekStartsOn]
  );
  const dayHeaders = useMemo(() => weekdayHeaders(weekStartsOn), [weekStartsOn]);

  const onDayPress = (day: Date) => {
    const merged = new Date(day);
    merged.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
    if (multiple) {
      // Toggle: tapping a picked day takes it back out, so correcting a
      // mistake doesn't mean cancelling and starting the set over.
      const key = dayKeyOf(day);
      setSelectedDates(prev =>
        prev.some(d => dayKeyOf(d) === key)
          ? prev.filter(d => dayKeyOf(d) !== key)
          : [...prev, merged].sort((a, b) => +a - +b)
      );
    } else {
      setSelectedDate(merged);
    }
    if (!isSameMonth(day, displayMonth)) {
      setDisplayMonth(startOfMonth(day));
    }
  };

  // The end an `'end'` picker would report: the wheel's time on the start's day, next day if not after it.
  const endFromWheel = (): Date => {
    const start = startsAt ?? timeDate;
    const result = new Date(start);
    result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
    return result.getTime() <= start.getTime() ? addDays(result, 1) : result;
  };

  // The start the picker would report right now, for the "Other…" hand-off.
  const startFromSelection = (): Date | null => {
    if (!selectedDate) return null;
    const result = new Date(selectedDate);
    result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
    return result;
  };

  const confirm = () => {
    if (multiple) {
      onConfirmMultiple?.(selectedDates);
      return;
    }
    if (viewMode === 'end') {
      onConfirm(endFromWheel());
      return;
    }
    if (!selectedDate) return;
    if (viewMode === 'datetime') {
      const result = new Date(selectedDate);
      result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
      onConfirm(result, lengthPick ?? undefined);
    } else {
      onConfirm(selectedDate);
    }
  };

  const canConfirm = multiple || viewMode === 'end' ? true : !!selectedDate;

  const shortcutDays = useMemo(
    () => (dayShortcuts ? dayShortcutDays(getLogicalToday(dayResetTime)) : []),
    [dayShortcuts, dayResetTime, visible],
  );
  const shortcutToday = useMemo(() => getLogicalToday(dayResetTime), [dayResetTime, visible]);

  // In end mode the chip showing is the one the wheel already reads as.
  const endLength = viewMode === 'end' && startsAt ? lengthToClock(startsAt, timeDate) : null;
  const shownLength = viewMode === 'end' ? endLength : (lengthPick ?? lengthMinutes ?? null);
  const showLengthChips = shownLength !== null && (viewMode === 'end' || (viewMode === 'datetime' && lengthMinutes !== undefined));
  const lengthIsPreset = shownLength !== null && (EVENT_LENGTH_PRESETS as readonly number[]).includes(shownLength);

  const pickLength = (minutes: number) => {
    if (viewMode === 'end' && startsAt) {
      setTimeDate(addMinutes(startsAt, minutes));
    } else {
      setLengthPick(minutes);
    }
  };

  const showFullEnd = () => {
    const end = endFromWheel();
    setSelectedDate(end);
    setDisplayMonth(startOfMonth(end));
    setEndFull(true);
  };

  return (
    <SheetModal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onCancel}
      onShow={() => setPickerReady(true)}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.dim, { opacity: enterAnim }]}
          pointerEvents="none"
        />
        <SheetScrim onPress={onCancel} />
        <Animated.View style={[styles.card, shadows.popover, { opacity: enterAnim, transform: [{ scale: cardScale }] }]}>
          {/* Header */}
          <View style={styles.header}>
            <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={onCancel} minWidth={28} />
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <SheetHeaderButton label={BUTTON_LABEL.done} onPress={confirm} disabled={!canConfirm} style={styles.headerDoneText} minWidth={28} />
          </View>

          {viewMode === 'end' && startsAt && (
            <View style={styles.endSummary}>
              <Text style={styles.endSummaryTitle} numberOfLines={1}>
                {`Starts ${format(startsAt, 'EEE, MMM d')} · ${formatTimeOfDay(startsAt, use24Hour)}`}
              </Text>
              <Text style={styles.endSummarySub} numberOfLines={1}>
                {`Ends ${format(endFromWheel(), 'EEE, MMM d')} · ${formatTimeOfDay(endFromWheel(), use24Hour)}`}
              </Text>
            </View>
          )}

          {viewMode !== 'end' && shortcutDays.length > 0 && (
            <View style={styles.chipRow}>
              {shortcutDays.map(day => {
                const on = selectedDate ? isSameDay(day, selectedDate) : false;
                const label = dayShortcutLabel(day, shortcutToday);
                return (
                  <TouchableOpacity
                    key={dayKeyOf(day)}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => onDayPress(day)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}, ${format(day, 'EEEE, MMMM d')}`}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Calendar section */}
          {viewMode !== 'end' && (
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
                  <Text maxFontSizeMultiplier={textScale.badge} style={styles.dayHeaderText}>{d}</Text>
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {calendarDays.map((day, idx) => {
                const inMonth = isSameMonth(day, displayMonth);
                const isSelected = multiple
                  ? selectedDates.some(d => isSameDay(day, d))
                  : selectedDate ? isSameDay(day, selectedDate) : false;
                const todayDay = isToday(day);

                return (
                  <TouchableOpacity
                    key={idx}
                    style={styles.dayCell}
                    onPress={() => onDayPress(day)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={todayDay ? `Today, ${format(day, 'EEEE, MMMM d')}` : format(day, 'EEEE, MMMM d')}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <View style={[
                      styles.dayCircle,
                      isSelected && styles.dayCircleSelected,
                      !isSelected && todayDay && styles.dayCircleToday,
                    ]}>
                      <Text maxFontSizeMultiplier={textScale.badge} style={[
                        styles.dayText,
                        !inMonth && styles.dayTextOtherMonth,
                        isSelected && styles.dayTextSelected,
                        !isSelected && todayDay && styles.dayTextToday,
                      ]}>
                        {format(day, 'd')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          )}

          {/* Picked-set summary — the grid only shows one month at a time, so
              without this a date picked in another month looks like it was lost. */}
          {multiple && (
            <>
              <View style={styles.sectionGap} />
              <View style={styles.multiSummary}>
                <Text style={styles.multiSummaryText} numberOfLines={2}>
                  {selectedDates.length === 0
                    ? 'Tap each day this task falls on'
                    : selectedDates.map(d => format(d, 'MMM d')).join('  ·  ')}
                </Text>
              </View>
            </>
          )}

          {/* Time picker (datetime mode only) */}
          {(viewMode === 'datetime' || viewMode === 'end') && pickerReady && (
            <>
              <View style={styles.sectionGap} />
              <View style={styles.timeSection}>
                <View style={styles.timePickerHeader}>
                  <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.sectionLabel}>{viewMode === 'end' ? 'End time' : 'Time'}</Text>
                </View>
                <DateTimePicker
                  value={timeDate}
                  mode="time"
                  display="spinner"
                  onChange={(_e, d) => {
                    if (d) {
                      setTimeDate(d);
                      if (selectedDate) {
                        const merged = new Date(selectedDate);
                        merged.setHours(d.getHours(), d.getMinutes(), 0, 0);
                        setSelectedDate(merged);
                      }
                    }
                  }}
                  themeVariant={isDark ? 'dark' : 'light'}
                  style={styles.timePickerWidget}
                />
              </View>
            </>
          )}

          {showLengthChips && shownLength !== null && (
            <>
              <View style={styles.sectionGap} />
              <View style={styles.chipRow}>
                {EVENT_LENGTH_PRESETS.map(minutes => {
                  const on = shownLength === minutes;
                  return (
                    <TouchableOpacity
                      key={minutes}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => pickLength(minutes)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={`Length ${describeEventLength(minutes)}`}
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{describeEventLength(minutes)}</Text>
                    </TouchableOpacity>
                  );
                })}
                {viewMode !== 'end' && onOtherLength && (
                  <TouchableOpacity
                    style={[styles.chip, !lengthIsPreset && styles.chipOn]}
                    onPress={() => {
                      const start = startFromSelection();
                      if (start) onOtherLength(start, lengthPick ?? undefined);
                    }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={lengthIsPreset ? 'Other length' : `Length ${describeEventLength(shownLength)}, change`}
                    accessibilityState={{ selected: !lengthIsPreset }}
                  >
                    <Text style={[styles.chipText, !lengthIsPreset && styles.chipTextOn]} numberOfLines={1}>
                      {lengthIsPreset ? 'Other…' : describeEventLength(shownLength)}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {viewMode === 'end' && (
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={styles.chip}
                onPress={showFullEnd}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Pick a different end day"
              >
                <Text style={styles.chipText} numberOfLines={1}>Different day…</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </Animated.View>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors, windowWidth: number) => {
  // Read per render: a Mac window or an iPad in Split View is resized after launch.
  const cardWidth = pickerCardWidthFor(windowWidth);
  const cellSize = Math.floor((cardWidth - CAL_PADDING * 2) / 7);
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dim: {
    backgroundColor: colors.backdrop,
  },
  card: {
    width: cardWidth,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
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
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  headerDoneText: {
    minWidth: 28,
    textAlign: 'right',
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionGap: {
    height: spacing.sm,
  },
  calSection: {
    paddingHorizontal: CAL_PADDING,
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
    marginBottom: spacing.xxs,
  },
  dayHeaderCell: {
    width: cellSize,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dayHeaderText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: cellSize * 6,
  },
  dayCell: {
    width: cellSize,
    height: cellSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: cellSize - 6,
    height: cellSize - 6,
    borderRadius: (cellSize - 6) / 2,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xsm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  chip: {
    flexGrow: 1,
    minWidth: 56,
    minHeight: interaction.pillHeight,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.accentFill },
  chipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipTextOn: { color: colors.onAccent },
  endSummary: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
  },
  endSummaryTitle: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  endSummarySub: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  multiSummary: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  multiSummaryText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    textAlign: 'center',
  },
  timeSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  timePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    marginBottom: spacing.xs,
  },
  timePickerWidget: {
    height: 150,
  },
  bottomSpacer: {
    height: spacing.md,
  },
});
};
