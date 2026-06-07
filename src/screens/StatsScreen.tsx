import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, subDays, isToday, startOfWeek, isSameDay } from 'date-fns';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, type Colors } from '../theme';

const BAR_HEIGHT = 96;
const HABIT_DAYS = 30;

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
  const tasks = useTaskStore(useShallow(s => s.tasks));
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
    const map = new Map<string, { count: number; recurrenceType: string; interval: number }>();
    recent.forEach(t => {
      const e = map.get(t.title);
      if (e) e.count++;
      else map.set(t.title, { count: 1, recurrenceType: t.recurrenceType, interval: t.recurrenceInterval });
    });
    return Array.from(map.entries())
      .map(([title, { count, recurrenceType, interval }]) => {
        const expected = expectedCount(recurrenceType, interval);
        return { title, count, expected, rate: Math.min(1, count / expected) };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [done, now]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Stats</Text>
        <Text style={styles.subtitle}>{done.length} completed</Text>
      </View>

      {done.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={52} color={colors.bgQuaternary} />
          <Text style={styles.emptyTitle}>No data yet</Text>
          <Text style={styles.emptySubtext}>Complete tasks to see your stats here</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Summary cards */}
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

          {/* Completed per day — last 7 days */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>COMPLETED PER DAY</Text>
            <View style={styles.card}>
              <View style={styles.chartInner}>
                {chartBars.map(({ key, label, count, today }) => (
                  <View key={key} style={styles.chartCol}>
                    <Text style={styles.barCount}>{count > 0 ? count : ' '}</Text>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${Math.max(3, Math.round((count / barMax) * 100))}%` as `${number}%`,
                            backgroundColor: today ? colors.accent : colors.bgQuaternary,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.barLabel, today && { color: colors.accent, fontWeight: '600' as const }]}>
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Streak leaderboard */}
          {streaks.length > 0 && (
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
          )}

          {/* Habit completion rates */}
          {habits.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>HABIT COMPLETION (LAST 30 DAYS)</Text>
              <View style={styles.card}>
                {habits.map(({ title, count, expected, rate }, i) => (
                  <View key={title} style={[styles.habitRow, i < habits.length - 1 && styles.rowBorder]}>
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
          )}

        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
    subtitle: { color: colors.textTertiary, fontSize: font.sm, fontWeight: '500', paddingBottom: 4 },
    scroll: { paddingHorizontal: spacing.md, paddingBottom: 40 },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    emptyTitle: {
      color: colors.textSecondary,
      fontSize: font.lg,
      fontWeight: '600',
      marginTop: spacing.md,
    },
    emptySubtext: {
      color: colors.textTertiary,
      fontSize: font.sm,
      textAlign: 'center',
      paddingHorizontal: spacing.xl,
      lineHeight: 20,
    },
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
