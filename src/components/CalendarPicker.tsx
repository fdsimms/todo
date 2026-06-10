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
import { Ionicons } from '@expo/vector-icons';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, isSameMonth, isSameDay, isToday,
  format, addDays,
} from 'date-fns';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { parseNaturalDate } from '../utils/parseNaturalDate';

interface Props {
  visible: boolean;
  value: Date | null;
  mode: 'date' | 'datetime';
  title: string;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  nlEnabled?: boolean;
}

function buildCalendarGrid(displayMonth: Date): Date[] {
  const monthStart = startOfMonth(displayMonth);
  const monthEnd = endOfMonth(displayMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days: Date[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  // Ensure we always have 42 cells (6 weeks)
  while (days.length < 42) {
    days.push(addDays(days[days.length - 1], 1));
  }
  return days;
}

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CELL_SIZE = Math.floor((SCREEN_WIDTH - spacing.md * 2 - spacing.xs * 6) / 7);

export function CalendarPicker({ visible, value, mode, title, onConfirm, onCancel, nlEnabled }: Props) {
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

  useEffect(() => {
    if (!visible) {
      setPickerReady(false);
      return;
    }
    const base = value ?? new Date();
    setDisplayMonth(startOfMonth(base));
    setSelectedDate(value);
    const t = new Date(base);
    if (!value) t.setHours(9, 0, 0, 0);
    setTimeDate(t);
    setNlText('');
  }, [visible]);

  const calendarDays = useMemo(() => buildCalendarGrid(displayMonth), [displayMonth]);

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
    setSelectedDate(merged);
    if (!isSameMonth(day, displayMonth)) {
      setDisplayMonth(startOfMonth(day));
    }
  };

  const confirm = () => {
    if (!selectedDate) return;
    if (mode === 'datetime') {
      const result = new Date(selectedDate);
      result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
      onConfirm(result);
    } else {
      onConfirm(selectedDate);
    }
  };

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
          <TouchableOpacity onPress={onCancel} hitSlop={8}>
            <Text style={styles.headerBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <TouchableOpacity onPress={confirm} hitSlop={8} disabled={!selectedDate}>
            <Text style={[styles.headerBtn, styles.headerDone, !selectedDate && styles.disabled]}>
              Done
            </Text>
          </TouchableOpacity>
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
          >
            <Ionicons name="chevron-forward" size={20} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Day-of-week headers */}
        <View style={styles.dayHeaders}>
          {DAY_HEADERS.map((d, i) => (
            <View key={i} style={styles.dayHeaderCell}>
              <Text style={styles.dayHeaderText}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Calendar grid */}
        <View style={styles.grid}>
          {calendarDays.map((day, idx) => {
            const inMonth = isSameMonth(day, displayMonth);
            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
            const todayDay = isToday(day);

            return (
              <TouchableOpacity
                key={idx}
                style={styles.dayCell}
                onPress={() => onDayPress(day)}
                activeOpacity={interaction.activeOpacity}
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
  headerBtn: {
    color: colors.textSecondary,
    fontSize: font.md,
  },
  headerDone: {
    color: colors.accent,
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
    fontSize: font.sm,
    fontWeight: '400',
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
