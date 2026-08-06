import React, { useState, useEffect, useMemo } from 'react';
import {
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
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildCalendarGrid, weekdayHeaders } from '../utils/calendarGrid';
import { parseNaturalDate } from '../utils/parseNaturalDate';
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

/** Calendar identity of a date — the day the user tapped, ignoring its time. */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CELL_SIZE = Math.floor((SCREEN_WIDTH - spacing.md * 2 - spacing.xs * 6) / 7);

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

  useEffect(() => {
    if (!visible) {
      setPickerReady(false);
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
      const key = dayKey(day);
      setSelectedDates(prev =>
        prev.some(d => dayKey(d) === key)
          ? prev.filter(d => dayKey(d) !== key)
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
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
      onShow={() => setPickerReady(true)}
    >
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onCancel} />
          <Text style={styles.headerTitle}>{title}</Text>
          <SheetHeaderButton label="Done" onPress={confirm} disabled={!canConfirm} />
        </View>

        {/* Natural language input */}
        {nlEnabled && (
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
        )}

        {/* Month navigation */}
        <View style={styles.monthNav}>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setDisplayMonth(m => subMonths(m, 1))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={20} color={colors.accent} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>
            {format(displayMonth, 'MMMM yyyy')}
          </Text>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setDisplayMonth(m => addMonths(m, 1))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Ionicons name="chevron-forward" size={20} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Day-of-week headers */}
        <View style={styles.dayHeaders}>
          {dayHeaders.map((d, i) => (
            <View key={i} style={styles.dayHeaderCell}>
              <Text style={styles.dayHeaderText}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Calendar grid */}
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
                ]}>
                  <Text style={[
                    styles.dayText,
                    !inMonth && styles.dayTextOtherMonth,
                    isSelected && styles.dayTextSelected,
                    !isSelected && todayDay && styles.dayTextToday,
                  ]}>
                    {format(day, 'd')}
                  </Text>
                  {todayDay && (
                    <View style={[
                      styles.todayDot,
                      isSelected && styles.todayDotSelected,
                    ]} />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Picked-set summary — the grid only shows one month at a time, so
            without this a date picked in another month looks like it was lost. */}
        {multiple && (
          <View style={styles.multiSummary}>
            <Text style={styles.multiSummaryText} numberOfLines={2}>
              {selectedDates.length === 0
                ? 'Tap each day this task falls on'
                : selectedDates.map(d => format(d, 'MMM d')).join('  ·  ')}
            </Text>
          </View>
        )}

        {/* Time picker (datetime mode only) */}
        {mode === 'datetime' && pickerReady && (
          <View style={styles.timePicker}>
            <View style={styles.timePickerHeader}>
              <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.timePickerLabel}>Time</Text>
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
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  multiSummary: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    alignItems: 'center',
  },
  multiSummaryText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '600',
  },
  disabled: { opacity: 0.4 },
  nlInput: {
    color: colors.text,
    fontSize: font.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    margin: spacing.md,
    marginBottom: spacing.sm,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: '600',
  },
  dayHeaders: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  dayHeaderCell: {
    width: CELL_SIZE,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dayHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
  },
  dayCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  dayCircle: {
    width: CELL_SIZE - 4,
    height: CELL_SIZE - 4,
    borderRadius: (CELL_SIZE - 4) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dayCircleSelected: {
    backgroundColor: colors.accent,
  },
  dayText: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: '400',
  },
  todayDot: {
    position: 'absolute',
    bottom: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  todayDotSelected: {
    backgroundColor: colors.onAccent,
  },
  dayTextOtherMonth: {
    color: colors.textTertiary,
  },
  dayTextSelected: {
    color: colors.bg,
    fontWeight: '600',
  },
  dayTextToday: {
    color: colors.accent,
    fontWeight: '600',
  },
  timePicker: {
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  timePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  timePickerLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timePickerWidget: {
    height: 150,
  },
});
