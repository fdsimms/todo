import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, isSameMonth, isSameDay, isToday,
  format, addDays, startOfDay,
} from 'date-fns';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, type Colors } from '../theme';
import type { TimeOfDay } from '../types';

interface Props {
  visible: boolean;
  value?: Date | null;
  onConfirm: (date: Date | null, timeOfDay: TimeOfDay | null) => void;
  onClear?: () => void;
  onCancel: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 380);
const CAL_PADDING = 10;
const CELL_SIZE = Math.floor((CARD_WIDTH - CAL_PADDING * 2) / 7);

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
  // Always pad to 42 cells (6 rows) so the grid height never shifts
  while (days.length < 42) {
    days.push(addDays(days[days.length - 1], 1));
  }
  return days;
}

export function WhenPicker({ visible, value, onConfirm, onClear, onCancel }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [displayMonth, setDisplayMonth] = useState(() => new Date());

  useEffect(() => {
    if (visible) {
      setDisplayMonth(startOfMonth(value ?? new Date()));
    }
  }, [visible]);

  const calendarDays = useMemo(() => buildCalendarGrid(displayMonth), [displayMonth]);

  const todayNoon = () => {
    const d = startOfDay(new Date());
    d.setHours(12, 0, 0, 0);
    return d;
  };

  const quickOptions: {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    deferUntil: Date | null;
    timeOfDay: TimeOfDay | null;
  }[] = [
    {
      label: 'Today',
      icon: 'star',
      iconColor: '#FFD60A',
      deferUntil: null,
      timeOfDay: null,
    },
    {
      label: 'This Morning',
      icon: 'sunny-outline',
      iconColor: colors.orange,
      deferUntil: null,
      timeOfDay: 'morning',
    },
    {
      label: 'This Afternoon',
      icon: 'partly-sunny-outline',
      iconColor: colors.accent,
      deferUntil: null,
      timeOfDay: 'afternoon',
    },
    {
      label: 'This Evening',
      icon: 'moon-outline',
      iconColor: colors.purple,
      deferUntil: null,
      timeOfDay: 'evening',
    },
  ];

  const handleDayPress = (day: Date) => {
    if (isToday(day)) {
      onConfirm(null, null);
      return;
    }
    const noon = new Date(day);
    noon.setHours(12, 0, 0, 0);
    onConfirm(noon, null);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>When?</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Quick picks */}
          <View style={styles.quickSection}>
            {quickOptions.map((opt, idx) => {
              const isActive = value
                ? (isToday(value) && opt.timeOfDay === null && opt.label === 'Today')
                : false;
              return (
                <React.Fragment key={opt.label}>
                  <TouchableOpacity
                    style={styles.quickRow}
                    onPress={() => onConfirm(opt.deferUntil, opt.timeOfDay)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.quickLeft}>
                      <Ionicons name={opt.icon} size={18} color={opt.iconColor} />
                      <Text style={styles.quickLabel}>{opt.label}</Text>
                    </View>
                    {isActive && (
                      <Ionicons name="checkmark" size={18} color={colors.accent} />
                    )}
                  </TouchableOpacity>
                  {idx < quickOptions.length - 1 && <View style={styles.inlineSep} />}
                </React.Fragment>
              );
            })}
          </View>

          <View style={styles.sectionGap} />

          {/* Calendar section */}
          <View style={styles.calSection}>
            {/* Month navigation */}
            <View style={styles.monthNav}>
              <TouchableOpacity
                onPress={() => setDisplayMonth(m => subMonths(m, 1))}
                hitSlop={8}
                style={styles.navBtn}
              >
                <Ionicons name="chevron-back" size={16} color={colors.accent} />
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{format(displayMonth, 'MMMM yyyy')}</Text>
              <TouchableOpacity
                onPress={() => setDisplayMonth(m => addMonths(m, 1))}
                hitSlop={8}
                style={styles.navBtn}
              >
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
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
                const isSelected = value ? isSameDay(day, value) : false;
                const todayDay = isToday(day);

                return (
                  <TouchableOpacity
                    key={idx}
                    style={styles.dayCell}
                    onPress={() => handleDayPress(day)}
                    activeOpacity={0.7}
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

          {/* Clear button */}
          {onClear && (
            <>
              <View style={styles.sectionGap} />
              <TouchableOpacity style={styles.clearBtn} onPress={onClear} activeOpacity={0.75}>
                <Text style={styles.clearLabel}>Clear</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
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
    justifyContent: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    position: 'relative',
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  closeBtn: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  quickLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quickLabel: {
    color: colors.text,
    fontSize: font.md,
  },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: 42,
  },
  sectionGap: {
    height: spacing.sm,
  },
  calSection: {
    paddingHorizontal: CAL_PADDING,
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
    color: colors.bg,
    fontWeight: fontWeight.semibold,
  },
  dayTextToday: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  clearBtn: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  clearLabel: {
    color: '#FFFFFF',
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
