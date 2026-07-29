import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, isSameMonth, isSameDay,
  format, addDays,
} from 'date-fns';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getLogicalToday, getLogicalTomorrow, isBeforeDayReset } from '../utils/dateUtils';
import type { TimeOfDay, Effort } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { suggestTaskDate } from '../services/aiSuggestions';

interface Props {
  visible: boolean;
  value?: Date | null;
  timeSegments?: TimeOfDay[];
  // Context for the AI "Suggest" date feature.
  taskTitle?: string;
  taskNotes?: string;
  taskEffort?: Effort;
  taskEstimatedMinutes?: number | null;
  onConfirm: (date: Date | null, timeSegments: TimeOfDay[]) => void;
  onClear?: () => void;
  onCancel: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 380);
const CAL_PADDING = 10;
const CELL_SIZE = Math.floor((CARD_WIDTH - CAL_PADDING * 2) / 7);

// How long the selection "pop" plays before the modal commits and closes.
const CONFIRM_DELAY_MS = 320;

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const SEGMENTS: { key: TimeOfDay; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'morning', label: 'Morning', icon: 'sunny-outline' },
  { key: 'afternoon', label: 'Afternoon', icon: 'partly-sunny-outline' },
  { key: 'evening', label: 'Evening', icon: 'moon-outline' },
];

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const noonOf = (d: Date) => {
  const n = new Date(d);
  n.setHours(12, 0, 0, 0);
  return n;
};

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

export function WhenPicker({
  visible, value, timeSegments: initialSegments,
  taskTitle, taskNotes, taskEffort, taskEstimatedMinutes,
  onConfirm, onClear, onCancel,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tasks = useTaskStore(s => s.tasks);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);

  const [displayMonth, setDisplayMonth] = useState(() => new Date());
  const [segments, setSegments] = useState<TimeOfDay[]>([]);
  // Day currently being confirmed — drives the brief "you picked it" feedback.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<{ key: string; reason: string } | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const popAnim = useRef(new Animated.Value(1)).current;
  // Drives the card's entrance pop — layered on top of the Modal's native
  // fade so opening reads as a snappy spring rather than a flat crossfade.
  const cardScale = useRef(new Animated.Value(0.92)).current;
  const pendingRef = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = useMemo(() => getLogicalToday(dayResetTime), [visible, dayResetTime]);
  const tomorrow = useMemo(() => getLogicalTomorrow(dayResetTime), [visible, dayResetTime]);
  const tomorrowKey = dayKey(tomorrow);
  const dateClarification = useMemo(() => isBeforeDayReset(dayResetTime), [visible, dayResetTime]);

  useEffect(() => {
    if (visible) {
      setDisplayMonth(startOfMonth(value ?? new Date()));
      setSegments(initialSegments ?? []);
      setPendingKey(null);
      setAiLoading(false);
      setSuggestion(null);
      setSuggestError(null);
      pendingRef.current = false;
      popAnim.setValue(1);
      cardScale.setValue(0.92);
      Animated.spring(cardScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }).start();
    }
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [visible]);

  const calendarDays = useMemo(() => buildCalendarGrid(displayMonth), [displayMonth]);

  const toggleSegment = (seg: TimeOfDay) => {
    setSegments(prev =>
      prev.includes(seg) ? [] : [seg]
    );
  };

  // Play a quick pop + haptic on the chosen target, then commit & close.
  const confirmWithFeedback = (date: Date | null, key: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingKey(key);
    if (date) setDisplayMonth(startOfMonth(date));
    haptics.success();
    popAnim.setValue(0.7);
    Animated.spring(popAnim, {
      toValue: 1.16,
      useNativeDriver: true,
      friction: 4,
      tension: 180,
    }).start();
    confirmTimer.current = setTimeout(() => onConfirm(date, segments), CONFIRM_DELAY_MS);
  };

  const handleDayPress = (day: Date) => {
    confirmWithFeedback(noonOf(day), isSameDay(day, today) ? 'today' : dayKey(day));
  };

  const handleToday = () => confirmWithFeedback(noonOf(today), 'today');
  const handleTomorrow = () => confirmWithFeedback(noonOf(tomorrow), tomorrowKey);

  const handleSuggest = async () => {
    if (aiLoading || pendingRef.current) return;
    setAiLoading(true);
    setSuggestion(null);
    setSuggestError(null);
    haptics.impactLight();
    try {
      const res = await suggestTaskDate(taskTitle ?? '', taskNotes ?? '', taskEffort ?? 0, tasks, taskEstimatedMinutes ?? null);
      const suggested = noonOf(new Date(`${res.date}T12:00:00`));
      setSuggestion({ key: res.date, reason: res.reason });
      setDisplayMonth(startOfMonth(suggested));
      haptics.success();
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : 'Could not suggest a date.');
      haptics.error();
    } finally {
      setAiLoading(false);
    }
  };

  const suggestionLabel = suggestion
    ? `${format(new Date(`${suggestion.key}T12:00:00`), 'EEE, MMM d')} — ${suggestion.reason}`
    : null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <Animated.View style={[styles.card, { transform: [{ scale: cardScale }] }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <Text style={styles.headerTitle}>When?</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Time of day — its own section, distinct from the date shortcuts */}
          <View style={styles.timeSection}>
            <Text style={styles.sectionLabel}>Time of day</Text>
            <View style={styles.segmentRow}>
              {SEGMENTS.map(seg => {
                const active = segments.includes(seg.key);
                const segColor = {
                  morning: colors.timeMorning,
                  afternoon: colors.timeAfternoon,
                  evening: colors.timeEvening,
                }[seg.key];
                return (
                  <TouchableOpacity
                    key={seg.key}
                    style={[styles.segmentPill, active && { backgroundColor: segColor + '33' }]}
                    onPress={() => {
                      haptics.tap();
                      toggleSegment(seg.key);
                    }}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Ionicons
                      name={seg.icon}
                      size={14}
                      color={active ? segColor : colors.textSecondary}
                    />
                    <Text style={[styles.segmentLabel, active && { color: segColor, fontWeight: fontWeight.semibold }]}>
                      {seg.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.sectionGap} />

          {/* Date shortcuts — separate section: choosing a day is its own thing */}
          <View style={styles.quickSection}>
            <Text style={styles.sectionLabel}>Pick a day</Text>
            <View style={styles.quickRow}>
              <QuickButton
                styles={styles}
                colors={colors}
                icon="star"
                iconColor="#FFD60A"
                label={dateClarification ? `Today · ${format(today, 'MMM d')}` : 'Today'}
                pending={pendingKey === 'today'}
                popAnim={popAnim}
                onPress={handleToday}
              />
              <QuickButton
                styles={styles}
                colors={colors}
                icon="sunny"
                iconColor={colors.timeMorning}
                label={dateClarification ? `Tomorrow · ${format(tomorrow, 'MMM d')}` : 'Tomorrow'}
                pending={pendingKey === tomorrowKey}
                popAnim={popAnim}
                onPress={handleTomorrow}
              />
              {!!anthropicApiKey && (
                <TouchableOpacity
                  style={[styles.quickButton, styles.suggestButton]}
                  onPress={handleSuggest}
                  activeOpacity={interaction.activeOpacity}
                  disabled={aiLoading}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color={colors.purple} />
                  ) : (
                    <Ionicons name="sparkles" size={15} color={colors.purple} />
                  )}
                  {!aiLoading && (
                    <Text style={[styles.quickButtonLabel, { color: colors.purple, fontWeight: fontWeight.semibold }]}>
                      Suggest
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {(suggestionLabel || suggestError) && (
              <View style={styles.suggestBanner}>
                <Ionicons
                  name={suggestError ? 'alert-circle' : 'sparkles'}
                  size={13}
                  color={suggestError ? colors.red : colors.purple}
                />
                <Text style={[styles.suggestBannerText, suggestError && { color: colors.red }]} numberOfLines={2}>
                  {suggestError ?? suggestionLabel}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.sectionGap} />

          {/* Calendar section */}
          <View style={styles.calSection}>
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
                const isSelected = value ? isSameDay(day, value) : false;
                const todayDay = isSameDay(day, today);
                const key = todayDay ? 'today' : dayKey(day);
                const isPending = pendingKey === key && pendingRef.current;
                const isSuggested = suggestion?.key === dayKey(day);

                return (
                  <TouchableOpacity
                    key={idx}
                    style={styles.dayCell}
                    onPress={() => handleDayPress(day)}
                    activeOpacity={interaction.activeOpacity}
                  >
                    <Animated.View style={[
                      styles.dayCircle,
                      isSelected && !isPending && styles.dayCircleSelected,
                      !isSelected && !isPending && todayDay && styles.dayCircleToday,
                      !isPending && isSuggested && styles.dayCircleSuggested,
                      isPending && styles.dayCirclePending,
                      isPending && { transform: [{ scale: popAnim }] },
                    ]}>
                      {isPending ? (
                        <Ionicons name="checkmark-sharp" size={CELL_SIZE * 0.46} color={colors.onAccent} />
                      ) : (
                        <Text style={[
                          styles.dayText,
                          !inMonth && styles.dayTextOtherMonth,
                          isSelected && styles.dayTextSelected,
                          !isSelected && todayDay && styles.dayTextToday,
                          isSuggested && styles.dayTextSuggested,
                        ]}>
                          {format(day, 'd')}
                        </Text>
                      )}
                    </Animated.View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Clear button */}
          {onClear && (
            <>
              <View style={styles.sectionGap} />
              <TouchableOpacity style={styles.clearBtn} onPress={onClear} activeOpacity={interaction.activeOpacity}>
                <Text style={styles.clearLabel}>Clear</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function QuickButton({
  styles, colors, icon, iconColor, label, pending, popAnim, onPress,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  label: string;
  pending: boolean;
  popAnim: Animated.Value;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.quickButton}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
    >
      <Animated.View style={[styles.quickButtonInner, pending && { transform: [{ scale: popAnim }] }]}>
        <Ionicons
          name={pending ? 'checkmark-circle' : icon}
          size={15}
          color={pending ? colors.accent : iconColor}
        />
        <Text style={[styles.quickButtonLabel, pending && styles.quickButtonLabelActive]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
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
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs + 2,
  },
  timeSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  segmentPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.bgQuaternary,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  quickSection: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.bgQuaternary,
  },
  quickButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quickButtonLabel: {
    color: colors.text,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  quickButtonLabelActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  suggestButton: {
    backgroundColor: colors.purple + '22',
  },
  suggestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: 2,
  },
  suggestBannerText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: 16,
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
  dayCircleSuggested: {
    borderWidth: 1.5,
    borderColor: colors.purple,
    backgroundColor: colors.purple + '22',
  },
  dayCirclePending: {
    backgroundColor: colors.accent,
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
  dayTextSuggested: {
    color: colors.purple,
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
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
