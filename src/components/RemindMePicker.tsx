import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, isSameMonth, isSameDay, isToday,
  format, addDays,
} from 'date-fns';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { parseNaturalDate } from '../utils/parseNaturalDate';

interface Props {
  visible: boolean;
  value: Date | null;
  onConfirm: (date: Date) => void;
  onClear?: () => void;
  onCancel: () => void;
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
  while (days.length < 42) {
    days.push(addDays(days[days.length - 1], 1));
  }
  return days;
}

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 380);
const CAL_PADDING = 10;
const CELL_SIZE = Math.floor((CARD_WIDTH - spacing.md * 2 - CAL_PADDING * 2) / 7);

export function RemindMePicker({ visible, value, onConfirm, onClear, onCancel }: Props) {
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
    const result = new Date(selectedDate);
    result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
    onConfirm(result);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
      onShow={() => setPickerReady(true)}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <View style={styles.card}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerSpacer} />
              <Text style={styles.headerTitle}>Remind Me</Text>
              <TouchableOpacity onPress={onCancel} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Natural language input */}
            <View style={styles.nlSection}>
              <TextInput
                style={styles.nlInput}
                value={nlText}
                onChangeText={onNlChange}
                onSubmitEditing={confirm}
                placeholder='e.g. "tomorrow at 9am", "next monday"'
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.sectionGap} />

            {/* Calendar section */}
            <View style={styles.calSection}>
              <Text style={styles.sectionLabel}>Date</Text>
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
                {DAY_HEADERS.map((d, i) => (
                  <View key={i} style={styles.dayHeaderCell}>
                    <Text style={styles.dayHeaderText}>{d}</Text>
                  </View>
                ))}
              </View>

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

            <View style={styles.sectionGap} />

            {/* Time section */}
            {pickerReady && (
              <View style={styles.timeSection}>
                <Text style={styles.sectionLabel}>Time</Text>
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

            <View style={styles.sectionGap} />

            {/* Done button */}
            <TouchableOpacity
              style={[styles.doneBtn, !selectedDate && styles.doneBtnDisabled]}
              onPress={confirm}
              disabled={!selectedDate}
              activeOpacity={interaction.activeOpacity}
            >
              <Text style={styles.doneBtnLabel}>Done</Text>
            </TouchableOpacity>

            {/* Clear button */}
            {onClear && (
              <>
                <View style={styles.sectionGapSm} />
                <TouchableOpacity style={styles.clearBtn} onPress={onClear} activeOpacity={interaction.activeOpacity}>
                  <Text style={styles.clearLabel}>Clear reminder</Text>
                </TouchableOpacity>
              </>
            )}

            <View style={styles.sectionGap} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: CARD_WIDTH,
    maxHeight: SCREEN_HEIGHT * 0.88,
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
  headerSpacer: {
    width: 28,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nlSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
  },
  nlInput: {
    color: colors.text,
    fontSize: font.sm,
    paddingVertical: 11,
  },
  sectionGap: {
    height: spacing.sm,
  },
  sectionGapSm: {
    height: spacing.xs,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs + 2,
  },
  calSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: CAL_PADDING,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
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
  timeSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
  },
  timePickerWidget: {
    height: 150,
  },
  doneBtn: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  doneBtnDisabled: {
    opacity: 0.4,
  },
  doneBtnLabel: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  clearBtn: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  clearLabel: {
    color: colors.red,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
});
