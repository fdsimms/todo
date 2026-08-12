import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { startOfMonth } from 'date-fns/startOfMonth';
import { addMonths } from 'date-fns/addMonths';
import { subMonths } from 'date-fns/subMonths';
import { isSameMonth } from 'date-fns/isSameMonth';
import { isSameDay } from 'date-fns/isSameDay';
import { isToday } from 'date-fns/isToday';
import { format } from 'date-fns/format';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildCalendarGrid, weekdayHeaders } from '../utils/calendarGrid';
import { parseNaturalDate } from '../utils/parseNaturalDate';
import { dayKeyOf } from '../utils/dateUtils';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  value: Date | null;
  mode: 'date' | 'datetime';
  title: string;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  nlEnabled?: boolean;
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
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 380);
const CAL_PADDING = 10;
const CELL_SIZE = Math.floor((CARD_WIDTH - CAL_PADDING * 2) / 7);

export function CalendarPicker({
  visible, value, mode, title, onConfirm, onCancel, nlEnabled,
  multiple, values, onConfirmMultiple,
}: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [displayMonth, setDisplayMonth] = useState(() => value ?? new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(value);
  const [timeDate, setTimeDate] = useState<Date>(() => {
    const d = value ?? new Date();
    if (!value) d.setHours(9, 0, 0, 0);
    return d;
  });
  const [nlText, setNlText] = useState('');
  const [pickerReady, setPickerReady] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>(values ?? []);

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
    setNlText('');
    cardScale.setValue(0.92);
    enterAnim.setValue(0);
    Animated.parallel([
      Animated.timing(enterAnim, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const calendarDays = useMemo(
    () => buildCalendarGrid(displayMonth, weekStartsOn),
    [displayMonth, weekStartsOn]
  );
  const dayHeaders = useMemo(() => weekdayHeaders(weekStartsOn), [weekStartsOn]);

  const onNlChange = (text: string) => {
    setNlText(text);
    const parsed = parseNaturalDate(text);
    if (parsed) {
      setSelectedDate(parsed);
      setDisplayMonth(startOfMonth(parsed));
      setTimeDate(parsed);
    }
  };

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

  const confirm = () => {
    if (multiple) {
      onConfirmMultiple?.(selectedDates);
      return;
    }
    if (!selectedDate) return;
    if (mode === 'datetime') {
      const result = new Date(selectedDate);
      result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
      onConfirm(result);
    } else {
      onConfirm(selectedDate);
    }
  };

  const canConfirm = multiple ? true : !!selectedDate;

  return (
    <Modal
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
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <Animated.View style={[styles.card, { opacity: enterAnim, transform: [{ scale: cardScale }] }]}>
          {/* Header */}
          <View style={styles.header}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={onCancel} minWidth={28} />
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <SheetHeaderButton label="Done" onPress={confirm} disabled={!canConfirm} style={styles.headerDoneText} minWidth={28} />
          </View>

          {/* Natural language input */}
          {nlEnabled && (
            <View style={styles.nlSection}>
              <TextInput
                style={styles.nlInput}
                value={nlText}
                onChangeText={onNlChange}
                onSubmitEditing={confirm}
                placeholder='Type a date — "next monday", "in 3 days"…'
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          {nlEnabled && <View style={styles.sectionGap} />}

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
                      <Text style={[
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
          {mode === 'datetime' && pickerReady && (
            <>
              <View style={styles.sectionGap} />
              <View style={styles.timeSection}>
                <View style={styles.timePickerHeader}>
                  <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.sectionLabel}>Time</Text>
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

          <View style={styles.bottomSpacer} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
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
    letterSpacing: 0.5,
  },
  sectionGap: {
    height: spacing.sm,
  },
  nlSection: {
    marginHorizontal: spacing.md,
  },
  nlInput: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
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
    gap: 6,
    marginBottom: spacing.xs,
  },
  timePickerWidget: {
    height: 150,
  },
  bottomSpacer: {
    height: spacing.md,
  },
});
