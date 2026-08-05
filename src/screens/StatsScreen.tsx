import React, { useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';
import { isToday } from 'date-fns/isToday';
import { startOfWeek } from 'date-fns/startOfWeek';
import { isSameDay } from 'date-fns/isSameDay';
import { useTaskStore } from '../store/useTaskStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, animation, type Colors } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';
import { getRepeatedInstances, normalizeTitle } from '../utils/taskInstances';
import { timeTrackedSummary, onTimeSummary, estimateAccuracy } from '../utils/stats';
import { formatDuration } from '../utils/effort';

const BAR_HEIGHT = 96;
const HABIT_DAYS = 30;

// Sections cascade in on mount: each fades and rises with a small delay.
function StaggerIn({ index, children }: { index: number; children: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Reduce Motion: show sections at rest, no cascade.
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    Animated.timing(anim, {
      toValue: 1,
      duration: animation.duration.normal,
      delay: index * 60,
      useNativeDriver: true,
    }).start();
  }, [anim, index, reduceMotion]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

function expectedCount(recurrenceType: string, interval: number): number {
  switch (recurrenceType) {
    case 'daily':   return Math.max(1, Math.floor(HABIT_DAYS / interval));
    case 'weekly':  return Math.max(1, Math.floor(HABIT_DAYS / (7 * interval)));
    case 'monthly': return Math.max(1, Math.floor(HABIT_DAYS / (30 * interval)));
    default:        return 1;
  }
}

export function StatsScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const tasks = useTaskStore(s => s.tasks);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const reduceMotion = useReduceMotion();
  const now = useMemo(() => new Date(), []);

  const done = useMemo(
    () => tasks.filter(t => !t.parentId && t.completed && t.completedAt),
    [tasks],
  );

  const todayCount = useMemo(
    () => done.filter(t => isToday(new Date(t.completedAt!))).length,
    [done],
  );

  const weekCount = useMemo(() => {
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    return done.filter(t => new Date(t.completedAt!) >= weekStart).length;
  }, [done, now]);

  const chartBars = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const day = subDays(now, 6 - i);
      const count = done.filter(t => isSameDay(new Date(t.completedAt!), day)).length;
      return {
        key: format(day, 'yyyy-MM-dd'),
        label: format(day, 'EEE'),
        count,
        today: isToday(day),
      };
    }),
    [done, now],
  );

  const barMax = useMemo(() => Math.max(1, ...chartBars.map(b => b.count)), [chartBars]);

  // Bars grow up from the baseline once on mount (height isn't supported by
  // the native driver, so this one runs on the JS thread).
  const chartProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Reduce Motion: render bars at full height immediately.
    if (reduceMotion) {
      chartProgress.setValue(1);
      return;
    }
    Animated.timing(chartProgress, {
      toValue: 1,
      duration: animation.duration.slow,
      delay: 150,
      useNativeDriver: false,
    }).start();
  }, [chartProgress, reduceMotion]);

  const streaks = useMemo(
    () =>
      tasks
        .filter(t => !t.parentId && !t.completed && t.recurrenceType !== 'none' && t.streakCount > 0)
        .sort((a, b) => b.streakCount - a.streakCount)
        .slice(0, 10),
    [tasks],
  );

  const habits = useMemo(() => {
    const cutoff = subDays(now, HABIT_DAYS);
    const recent = done.filter(
      t => t.recurrenceType !== 'none' && new Date(t.completedAt!) >= cutoff,
    );
    // Keyed on normalizeTitle so renaming a recurring task mid-stream doesn't
    // fork its history into two habits.
    const map = new Map<string, { title: string; count: number; recurrenceType: string; interval: number }>();
    recent.forEach(t => {
      const key = normalizeTitle(t.title);
      const e = map.get(key);
      if (e) e.count++;
      else map.set(key, { title: t.title, count: 1, recurrenceType: t.recurrenceType, interval: t.recurrenceInterval });
    });
    return Array.from(map.entries())
      .map(([key, { title, count, recurrenceType, interval }]) => {
        const expected = expectedCount(recurrenceType, interval);
        return { key, title, count, expected, rate: Math.min(1, count / expected) };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [done, now]);

  // Non-recurring tasks completed more than once — the "instances" of a task
  // that isn't formally recurring (e.g. re-adding one via title autosuggest).
  const repeated = useMemo(() => getRepeatedInstances(tasks).slice(0, 10), [tasks]);

  const timeTracked = useMemo(() => timeTrackedSummary(tasks), [tasks]);
  const accuracy = useMemo(() => estimateAccuracy(tasks), [tasks]);
  const onTime = useMemo(() => onTimeSummary(tasks), [tasks]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Stats" subtitle={`${done.length} completed`} />

      {done.length === 0 ? (
        <EmptyState
          icon="bar-chart-outline"
          title="No data yet"
          subtitle="Complete tasks to see your stats here"
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >

          {/* Summary cards */}
          <StaggerIn index={0}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: colors.accent }]}>{todayCount}</Text>
              <Text style={styles.summaryLabel}>Today</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: colors.accent }]}>{weekCount}</Text>
              <Text style={styles.summaryLabel}>This week</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: colors.orange }]}>{streaks.length}</Text>
              <Text style={styles.summaryLabel}>Active streaks</Text>
            </View>
          </View>
          </StaggerIn>

          {/* Completed per day — last 7 days */}
          <StaggerIn index={1}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>COMPLETED PER DAY</Text>
            <View style={styles.card}>
              <View style={styles.chartInner}>
                {chartBars.map(({ key, label, count, today }) => (
                  <View key={key} style={styles.chartCol}>
                    <Text style={styles.barCount}>{count > 0 ? count : ' '}</Text>
                    <View style={styles.barTrack}>
                      <Animated.View
                        style={[
                          styles.bar,
                          {
                            height: chartProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', `${Math.max(3, Math.round((count / barMax) * 100))}%`],
                            }),
                            backgroundColor: today ? colors.accent : colors.bgQuaternary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.barLabel, today && { color: colors.accent, fontWeight: fontWeight.semibold }]}>
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
          </StaggerIn>

          {/* Time tracked */}
          {timeTracked.trackedCount > 0 && (
            <StaggerIn index={2}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TIME TRACKED</Text>
              <View style={styles.card}>
                <View style={[styles.row, accuracy.count > 0 && styles.rowBorder]}>
                  <Text style={styles.rowText}>
                    {formatDuration(timeTracked.totalMinutes)} across {timeTracked.trackedCount} task{timeTracked.trackedCount === 1 ? '' : 's'}
                  </Text>
                </View>
                {accuracy.count > 0 && (() => {
                  const diffPct = Math.round((accuracy.averageRatio - 1) * 100);
                  const label = diffPct === 0
                    ? 'On estimate on average'
                    : diffPct > 0
                      ? `${diffPct}% over estimate on average`
                      : `${Math.abs(diffPct)}% under estimate on average`;
                  return (
                    <View style={styles.row}>
                      <Text style={styles.rowText}>{label}</Text>
                    </View>
                  );
                })()}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* On-time completion, for tasks that had a deadline */}
          {onTime.total > 0 && (
            <StaggerIn index={3}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ON TIME</Text>
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.rowText}>
                    {onTime.onTime}/{onTime.total} completed by their deadline
                  </Text>
                  <Text style={[styles.badgeText, { color: onTime.rate >= 0.8 ? colors.green : onTime.rate >= 0.5 ? colors.orange : colors.red }]}>
                    {Math.round(onTime.rate * 100)}%
                  </Text>
                </View>
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Streak leaderboard */}
          {streaks.length > 0 && (
            <StaggerIn index={4}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>STREAK LEADERBOARD</Text>
              <View style={styles.card}>
                {streaks.map((t, i) => (
                  <View key={t.id} style={[styles.row, i < streaks.length - 1 && styles.rowBorder]}>
                    <Text style={styles.rank}>#{i + 1}</Text>
                    <Text style={styles.rowText} numberOfLines={1}>{t.title}</Text>
                    <View style={styles.badge}>
                      <Ionicons name="flame" size={13} color={colors.orange} />
                      <Text style={[styles.badgeText, { color: colors.orange }]}>{t.streakCount}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Habit completion rates */}
          {habits.length > 0 && (
            <StaggerIn index={5}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>HABIT COMPLETION (LAST 30 DAYS)</Text>
              <View style={styles.card}>
                {habits.map(({ key, title, count, expected, rate }, i) => (
                  <View key={key} style={[styles.habitRow, i < habits.length - 1 && styles.rowBorder]}>
                    <View style={styles.habitTop}>
                      <Text style={styles.rowText} numberOfLines={1}>{title}</Text>
                      <Text style={styles.habitCount}>{count}/{expected}</Text>
                    </View>
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${Math.round(rate * 100)}%` as `${number}%`,
                            backgroundColor:
                              rate >= 0.8 ? colors.green :
                              rate >= 0.5 ? colors.orange : colors.red,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.pct}>{Math.round(rate * 100)}%</Text>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

          {/* Repeated non-recurring tasks — "instances" of the same task */}
          {repeated.length > 0 && (
            <StaggerIn index={6}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>REPEATED TASKS</Text>
              <View style={styles.card}>
                {repeated.map((g, i) => (
                  <View key={g.key} style={[styles.row, i < repeated.length - 1 && styles.rowBorder]}>
                    <View style={styles.instanceMain}>
                      <Text style={styles.instanceTitle} numberOfLines={1}>{g.title}</Text>
                      <Text style={styles.instanceMeta}>
                        Last done {format(new Date(g.lastCompletedAt), 'MMM d')}
                      </Text>
                    </View>
                    <View style={styles.badge}>
                      <Ionicons name="repeat" size={13} color={colors.accent} />
                      <Text style={[styles.badgeText, { color: colors.accent }]}>{g.count}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            </StaggerIn>
          )}

        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 40 },
    summaryRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    summaryCard: {
      flex: 1,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      alignItems: 'center',
      gap: 4,
    },
    summaryValue: { fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
    summaryLabel: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
      textAlign: 'center',
    },
    section: { marginBottom: spacing.lg },
    sectionTitle: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    chartInner: {
      flexDirection: 'row',
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    chartCol: {
      flex: 1,
      alignItems: 'center',
    },
    barCount: {
      height: 16,
      color: colors.textTertiary,
      fontSize: font.xs,
      textAlign: 'center',
    },
    barTrack: {
      width: 20,
      height: BAR_HEIGHT,
      justifyContent: 'flex-end',
    },
    bar: {
      width: 20,
      borderRadius: 4,
    },
    barLabel: {
      marginTop: 4,
      color: colors.textTertiary,
      fontSize: 10,
      fontWeight: '500',
      textAlign: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      gap: spacing.sm,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    rank: {
      width: 28,
      color: colors.textTertiary,
      fontSize: font.sm,
      fontWeight: '600',
    },
    rowText: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.bgTertiary,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.full,
    },
    badgeText: { fontSize: font.sm, fontWeight: '700' },
    instanceMain: {
      flex: 1,
      gap: 2,
    },
    instanceTitle: {
      color: colors.text,
      fontSize: font.md,
    },
    instanceMeta: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
    },
    habitRow: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm + 2,
      paddingBottom: spacing.sm,
      gap: spacing.xs,
    },
    habitTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginBottom: 4,
    },
    habitCount: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
      flexShrink: 0,
    },
    track: {
      height: 6,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: radius.full,
    },
    pct: {
      color: colors.textTertiary,
      fontSize: font.xs,
      fontWeight: '500',
      textAlign: 'right',
      marginTop: 2,
    },
  });
