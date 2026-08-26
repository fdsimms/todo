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
  useWindowDimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ALARM_RING_INTERVAL_MINUTES } from '../utils/alarmChain';
import Ionicons from '@expo/vector-icons/Ionicons';
import { startOfMonth } from 'date-fns/startOfMonth';
import { addMonths } from 'date-fns/addMonths';
import { subMonths } from 'date-fns/subMonths';
import { isSameMonth } from 'date-fns/isSameMonth';
import { isSameDay } from 'date-fns/isSameDay';
import { isToday } from 'date-fns/isToday';
import { format } from 'date-fns/format';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildCalendarGrid, weekdayHeaders } from '../utils/calendarGrid';
import { parseNaturalDate } from '../utils/parseNaturalDate';
import { getLogicalNow, getReminderOffsetDate, describeReminderOffset } from '../utils/dateUtils';
import { isAlarmKitAvailable } from 'todo-alarmkit-bridge';
import { SegmentedControl } from './SegmentedControl';
import { CountStepper } from './CountStepper';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SheetScrim } from './SheetScrim';
import type { ReminderKind } from '../types';

type Mode = 'date' | 'before';

interface Props {
  visible: boolean;
  value: Date | null;
  kind: ReminderKind;
  // The task's own due date, and the reminder's current "N days before due"
  // offset if it has one — see Task.reminderOffsetDays. dueDate gates whether
  // the "Before due date" mode is even offered: there's nothing to count back
  // from without one.
  dueDate?: Date | null;
  offsetDays?: number | null;
  onConfirm: (date: Date, kind: ReminderKind, offsetDays: number | null) => void;
  onClear?: () => void;
  onCancel: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 380);
const CAL_PADDING = 10;
const CELL_SIZE = Math.floor((CARD_WIDTH - spacing.md * 2 - CAL_PADDING * 2) / 7);

const alarmKitAvailable = isAlarmKitAvailable();

const BEFORE_DAYS_MIN = 1;
const BEFORE_DAYS_MAX = 60;

export function RemindMePicker({ visible, value, kind, dueDate = null, offsetDays = null, onConfirm, onClear, onCancel }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  // Reactive, unlike the width above: read once at module load, a stale
  // height would cap the card against a screen that no longer matches the
  // one it's actually rendering on.
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, windowHeight), [colors, windowHeight]);
  const fade = useScrollEdgeFade();

  const [displayMonth, setDisplayMonth] = useState(() => value ?? new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(value);
  const [timeDate, setTimeDate] = useState<Date>(() => {
    const d = value ?? new Date();
    if (!value) d.setHours(9, 0, 0, 0);
    return d;
  });
  const [nlText, setNlText] = useState('');
  const [pickerReady, setPickerReady] = useState(false);
  const [selectedKind, setSelectedKind] = useState<ReminderKind>(kind);
  // 'before' is only ever the opening mode when there's an offset already set
  // on the task and a due date to count it from — otherwise there's nothing
  // to switch to it from, so it isn't even offered (see the toggle below).
  const [mode, setMode] = useState<Mode>(offsetDays !== null && dueDate ? 'before' : 'date');
  const [beforeDays, setBeforeDays] = useState(offsetDays ?? 1);

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
    setSelectedKind(kind);
    setMode(offsetDays !== null && dueDate ? 'before' : 'date');
    setBeforeDays(offsetDays ?? 1);
  }, [visible]);

  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const calendarDays = useMemo(
    () => buildCalendarGrid(displayMonth, weekStartsOn),
    [displayMonth, weekStartsOn]
  );
  const dayHeaders = useMemo(() => weekdayHeaders(weekStartsOn), [weekStartsOn]);

  const onNlChange = (text: string) => {
    setNlText(text);
    // Resolved against the logical day, not the wall clock: typed at 1am under
    // a 2am dayResetTime, "tomorrow" means tomorrow by the user's own day —
    // the same clock quick add and the task editor parse against.
    const parsed = parseNaturalDate(text, getLogicalNow(dayResetTime));
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
    if (mode === 'before') {
      if (!dueDate) return;
      const result = getReminderOffsetDate(dueDate, beforeDays);
      result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
      onConfirm(result, selectedKind, beforeDays);
      return;
    }
    if (!selectedDate) return;
    const result = new Date(selectedDate);
    result.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
    onConfirm(result, selectedKind, null);
  };

  const canConfirm = mode === 'before' ? !!dueDate : !!selectedDate;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
      onShow={() => setPickerReady(true)}
    >
      <View style={styles.backdrop}>
        <SheetScrim onPress={onCancel} />
        <View style={styles.card}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardShouldPersistTaps="handled"
            {...fade.scrollProps}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerSpacer} />
              <Text style={styles.headerTitle}>Remind me</Text>
              <TouchableOpacity onPress={onCancel} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* On a date vs before the task's own due date — only offered
                when there's a due date to count back from. */}
            {!!dueDate && (
              <>
                <View style={styles.modeSection}>
                  <SegmentedControl<Mode>
                    label="When"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'date', label: 'On a date' },
                      { value: 'before', label: 'Before due date' },
                    ]}
                  />
                </View>
                <View style={styles.sectionGap} />
              </>
            )}

            {mode === 'date' && (
              <>
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
                {dayHeaders.map((d, i) => (
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
              </>
            )}

            {mode === 'before' && dueDate && (
              <>
                <View style={styles.beforeSection}>
                  <Text style={styles.sectionLabel}>Before due date</Text>
                  <View style={styles.beforeRow}>
                    <CountStepper
                      value={beforeDays}
                      onChange={n => setBeforeDays(n ?? BEFORE_DAYS_MIN)}
                      min={BEFORE_DAYS_MIN}
                      max={BEFORE_DAYS_MAX}
                      label="Days before due"
                    />
                    <Text style={styles.beforeLabel}>
                      {describeReminderOffset(beforeDays)}
                    </Text>
                  </View>
                  <Text style={styles.beforeHint}>
                    Fires {format(getReminderOffsetDate(dueDate, beforeDays), 'MMM d')}, at the time below,
                    and keeps counting back this many days on every future occurrence.
                  </Text>
                </View>
                <View style={styles.sectionGap} />
              </>
            )}

            {/* Time section */}
            {pickerReady && (
              <View style={styles.timeSection}>
                <Text style={styles.sectionLabel}>Time</Text>
                {/* The spinner's native rendered height doesn't reliably
                    respect a height passed via its own `style` prop — it can
                    lay out taller than asked, which is what was pushing Ring
                    As and the Done button off the bottom of the sheet
                    (#1616). A fixed-height, overflow-hidden wrapper clips it
                    to the space this card actually has. */}
                <View style={styles.timePickerClip}>
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
              </View>
            )}

            <View style={styles.sectionGap} />

            {/* Alarm vs notification — only offered where AlarmKit can actually ring one */}
            {alarmKitAvailable && (
              <>
                <View style={styles.kindSection}>
                  <Text style={styles.sectionLabel}>Ring As</Text>
                  <View style={styles.kindToggle}>
                    <TouchableOpacity
                      style={[styles.kindOption, selectedKind === 'notification' && styles.kindOptionSelected]}
                      onPress={() => setSelectedKind('notification')}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel="Notification"
                      accessibilityState={{ selected: selectedKind === 'notification' }}
                    >
                      <Ionicons
                        name="notifications"
                        size={16}
                        color={selectedKind === 'notification' ? colors.onAccent : colors.textSecondary}
                      />
                      <Text style={[styles.kindLabel, selectedKind === 'notification' && styles.kindLabelSelected]}>
                        Notification
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.kindOption, selectedKind === 'alarm' && styles.kindOptionSelected]}
                      onPress={() => setSelectedKind('alarm')}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel="Alarm"
                      accessibilityState={{ selected: selectedKind === 'alarm' }}
                    >
                      <Ionicons
                        name="alarm"
                        size={16}
                        color={selectedKind === 'alarm' ? colors.onAccent : colors.textSecondary}
                      />
                      <Text style={[styles.kindLabel, selectedKind === 'alarm' && styles.kindLabelSelected]} numberOfLines={1}>
                        Alarm
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.kindOption, selectedKind === 'persistent' && styles.kindOptionSelected]}
                      onPress={() => setSelectedKind('persistent')}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel="Alarm until done"
                      accessibilityState={{ selected: selectedKind === 'persistent' }}
                    >
                      <Ionicons
                        name="repeat"
                        size={16}
                        color={selectedKind === 'persistent' ? colors.onAccent : colors.textSecondary}
                      />
                      <Text style={[styles.kindLabel, selectedKind === 'persistent' && styles.kindLabelSelected]} numberOfLines={1}>
                        Until done
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.kindHint}>
                    {selectedKind === 'persistent'
                      ? `Rings every ${ALARM_RING_INTERVAL_MINUTES} minutes for up to an hour, until you complete the task.`
                      : selectedKind === 'alarm'
                        ? 'Rings once, even if your phone is silent.'
                        : 'Shows a notification at this time.'}
                  </Text>
                </View>
                <View style={styles.sectionGap} />
              </>
            )}

            {/* Done button */}
            <TouchableOpacity
              style={[styles.doneBtn, !canConfirm && styles.doneBtnDisabled]}
              onPress={confirm}
              disabled={!canConfirm}
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
          <ScrollEdgeFade edge="bottom" opacity={fade.bottomOpacity} color={colors.bgSecondary} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors, windowHeight: number) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: CARD_WIDTH,
    maxHeight: windowHeight * 0.88,
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
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs + 2,
  },
  modeSection: {
    marginHorizontal: spacing.md,
  },
  beforeSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  beforeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  beforeLabel: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  beforeHint: {
    color: colors.textSecondary,
    fontSize: font.xs,
    marginTop: spacing.xs + 2,
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
  timePickerClip: {
    height: 150,
    overflow: 'hidden',
  },
  timePickerWidget: {
    height: 150,
  },
  kindSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  kindToggle: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  kindOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSecondary,
  },
  kindOptionSelected: {
    backgroundColor: colors.accent,
  },
  kindLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  kindHint: {
    color: colors.textSecondary,
    fontSize: font.xs,
    marginTop: spacing.xs,
  },
  kindLabelSelected: {
    color: colors.onAccent,
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
