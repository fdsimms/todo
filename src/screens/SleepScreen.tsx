import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { navigationRef } from '../navigation/navigationRef';
import { format } from 'date-fns/format';
import { addDays } from 'date-fns/addDays';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore, SLEEP_HISTORY_DAYS } from '../store/useHealthStore';
import { useDemoStore } from '../store/useDemoStore';
import { useMoodStore } from '../store/useMoodStore';
import { useTaskStore } from '../store/useTaskStore';
import { retentionCutoff } from '../utils/retention';
import { MIN_PAIRED_DAYS, buildMoodDays, describeHealthInsight, healthInsight } from '../utils/moodInsights';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getLogicalDayKey } from '../utils/dateUtils';
import { navigateToSettingsEntry } from '../navigation/openSettings';
import { openHealthApp } from '../utils/healthBridge';
import {
  averageSleepStages,
  formatClockMinutes,
  formatSleepDuration,
  nightsInWindow,
  sleepReadings,
  sleepSummary,
  type SleepNight,
} from '../utils/sleepLog';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { SleepHoursChart, SleepStagesBar, SleepTimesChart } from '../components/SleepChart';
import { SleepGoalSheet } from '../components/SleepGoalSheet';
import { InlineAction } from '../components/InlineAction';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

/**
 * Sleep, as Apple Health recorded it: when each day's main sleep started and
 * ended, how long the day's sleep added up to, and how that sits against a
 * goal the person typed in.
 *
 * Built on the Weight screen's shape, for its reasons (`docs/arch/health-data.md`):
 * a window read from Health on focus and never stored, a range picker that
 * only re-slices what was read, and nothing to edit here because Health is the
 * record. The rules about what may be said live in `src/utils/sleepLog.ts`:
 * no score, no recommended amount, and no "last night", since a nap counts
 * toward its own day.
 */

type SleepRangeDays = 7 | 14 | 30 | 90;

const SLEEP_RANGES: { days: SleepRangeDays; label: string; spoken: string }[] = [
  { days: 7, label: '1W', spoken: 'week' },
  { days: 14, label: '2W', spoken: 'two weeks' },
  { days: 30, label: '1M', spoken: 'month' },
  { days: 90, label: '3M', spoken: 'three months' },
];

const DEFAULT_RANGE_DAYS: SleepRangeDays = 14;

export function SleepScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const screenSettings = useScreenSettings('Sleep', 'Sleep settings');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const goal = useSettingsStore(s => s.sleepGoalMinutes);
  const demoActive = useDemoStore(s => s.active);
  const allNights = useHealthStore(s => s.sleepNights);
  const loadingSleep = useHealthStore(s => s.loadingSleep);
  const refreshSleep = useHealthStore(s => s.refreshSleep);
  const moodLogs = useMoodStore(s => s.logs);
  const tasks = useTaskStore(s => s.tasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const completedRetentionDays = useSettingsStore(s => s.completedRetentionDays);

  const [goalOpen, setGoalOpen] = useState(false);
  const [rangeDays, setRangeDays] = useState<SleepRangeDays>(DEFAULT_RANGE_DAYS);
  const activeRange = SLEEP_RANGES.find(r => r.days === rangeDays) ?? SLEEP_RANGES[1];

  // On every visit, for `WeightScreen`'s reason: the screen stays mounted for
  // the session, and a night the watch synced while the app was open would
  // otherwise never show. refreshSleep guards itself against overlapping reads.
  useFocusEffect(
    useCallback(() => {
      if (healthReadEnabled) void refreshSleep();
    }, [healthReadEnabled, refreshSleep]),
  );

  const nights = allNights ?? [];
  const todayKey = getLogicalDayKey(new Date());
  const dayKeys = useMemo(() => {
    const today = dayKeyToDate(todayKey);
    return Array.from({ length: rangeDays }, (_, i) => dayKeyOf(addDays(today, i - (rangeDays - 1))));
  }, [todayKey, rangeDays]);
  const visible = useMemo(() => nightsInWindow(nights, rangeDays, todayKey), [nights, rangeDays, todayKey]);
  const summary = useMemo(() => sleepSummary(visible, goal), [visible, goal]);
  const stageAverage = useMemo(() => averageSleepStages(visible), [visible]);
  const latest: SleepNight | null = nights.length > 0 ? nights[nights.length - 1] : null;

  // Sleep against what you got done and how you felt, over the whole read
  // window rather than the zoomed range: the comparison needs MIN_PAIRED_DAYS
  // days with both halves, which a week can't hold. The same pairing and copy
  // the Mood screen's MOVEMENT AND SLEEP card uses (`healthInsight`), fed this
  // screen's own nights so nothing reads Health twice. A pairing short of
  // enough days drops out rather than rendering empty.
  const completionsKnownFrom = useMemo(() => {
    const cutoff = retentionCutoff(completedRetentionDays, new Date(), dayResetTime);
    return cutoff === null ? null : dayKeyOf(cutoff);
  }, [completedRetentionDays, dayResetTime]);
  const findings = useMemo(() => {
    if (nights.length === 0) return [];
    const days = buildMoodDays(moodLogs, tasks, dayResetTime, sleepReadings(nights), completionsKnownFrom);
    const rows: { key: string; text: string }[] = [];
    for (const against of ['completed', 'mood'] as const) {
      const text = describeHealthInsight(healthInsight(days, 'sleepHours', against));
      if (text) rows.push({ key: against, text });
    }
    return rows;
  }, [nights, moodLogs, tasks, dayResetTime, completionsKnownFrom]);

  const openGoal = () => { haptics.tap(); setGoalOpen(true); };

  const header = (
    <>
      <ScreenHeader
        title="Sleep"
        subtitle={latest ? `${formatSleepDuration(latest.minutes)} ${relativeDay(latest.dayKey, todayKey)}` : undefined}
        actions={withScreenSettings(!healthReadEnabled || demoActive ? [] : [
          {
            icon: 'target' as const,
            onPress: openGoal,
            active: goal !== null,
            accessibilityLabel: goal === null ? 'Set a sleep goal' : 'Edit your sleep goal',
          },
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />
      <HubPills hub="health" active="Sleep" />
    </>
  );

  // Demo mode never reads Health, so this is checked before the switch below,
  // which can still be on inside the demo database (WeightScreen's order).
  if (demoActive) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="moon-outline"
          title="Not available in demo mode"
          subtitle="Sleep comes from Apple Health, which demo mode does not read. Leave demo mode to see your own sleep."
          bottomOffset={tabBarHeight}
        />
      </View>
    );
  }

  if (!healthReadEnabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="moon-outline"
          title="Apple Health is off"
          subtitle="Turn on reading Apple Health in Settings to see your sleep here. Anything a watch or another app has already recorded shows up straight away."
          actionLabel="Open Settings"
          onAction={() => { haptics.tap(); navigateToSettingsEntry(navigationRef, 'healthRead'); }}
          bottomOffset={tabBarHeight}
        />
      </View>
    );
  }

  if (nights.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="moon-outline"
          title={loadingSleep || allNights === null ? 'Reading Health…' : 'No sleep recorded'}
          // A refused read and an empty one are the same answer from Health.
          // Sleep was added to the read list after steps, and the app never
          // asks again on its own, so an install that allowed steps earlier
          // gets no sleep until the access row is tapped. The button goes there.
          subtitle={loadingSleep || allNights === null
            ? undefined
            : `Nothing recorded in the last ${SLEEP_HISTORY_DAYS} days, or Health is not sharing sleep with this app. If you allowed Health access before sleep was added, check Health access in Settings.`}
          actionLabel={loadingSleep || allNights === null ? undefined : 'Check Health access'}
          onAction={loadingSleep || allNights === null
            ? undefined
            : () => { haptics.tap(); navigateToSettingsEntry(navigationRef, 'healthAccess'); }}
          bottomOffset={tabBarHeight}
        />
        <SleepGoalSheet visible={goalOpen} onClose={() => setGoalOpen(false)} />
      </View>
    );
  }

  const rangePhrase = `last ${activeRange.spoken}`;
  const extraMinutes = latest ? latest.minutes - latest.mainMinutes : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        refreshControl={pullSearch.refreshControl}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        {latest && (
          <>
            <Text style={styles.sectionTitle}>MOST RECENT</Text>
            <View
              style={styles.card}
              accessible
              accessibilityLabel={`Most recent sleep, ended ${relativeDay(latest.dayKey, todayKey)}: ${
                formatClockMinutes(clock(latest.asleepAt), use24Hour)} to ${
                formatClockMinutes(clock(latest.wokeAt), use24Hour)}, ${formatSleepDuration(latest.mainMinutes)} asleep.`}
            >
              <Text style={styles.latestDay}>Ended {relativeDay(latest.dayKey, todayKey)}</Text>
              <Text style={styles.latestRange}>
                {formatClockMinutes(clock(latest.asleepAt), use24Hour)} to {formatClockMinutes(clock(latest.wokeAt), use24Hour)}
              </Text>
              <Text style={styles.finding}>{formatSleepDuration(latest.mainMinutes)} asleep</Text>
              {/* Rounded to whole minutes before comparing, so two figures
                  that print the same never claim a difference. */}
              {Math.round(extraMinutes) >= 1 && (
                <Text style={styles.chartCaption}>
                  Plus {formatSleepDuration(extraMinutes)} at other times that day, {formatSleepDuration(latest.minutes)} in all.
                </Text>
              )}
              {goal !== null && (
                <Text style={styles.chartCaption}>{describeAgainstGoal(latest.minutes, goal)}</Text>
              )}
              {latest.stages !== null && (
                <View style={styles.stages}>
                  <SleepStagesBar stages={latest.stages} label="Most recent sleep" />
                </View>
              )}
            </View>
          </>
        )}

        <View style={styles.rangeRow}>
          <SegmentedControl
            options={SLEEP_RANGES.map(r => ({
              value: r.days,
              label: r.label,
              accessibilityLabel: `Show the last ${r.spoken}`,
            }))}
            value={rangeDays}
            onChange={next => { haptics.tap(); setRangeDays(next); }}
            label="Chart range"
          />
        </View>

        <View style={styles.statRow}>
          <Stat
            styles={styles}
            value={summary.averageMinutes === null ? '—' : formatShortDuration(summary.averageMinutes)}
            label="Average asleep"
            accessibilityLabel={summary.averageMinutes === null
              ? `Average asleep, nothing recorded in the ${rangePhrase}`
              : `Average asleep over the ${rangePhrase}, ${formatSleepDuration(summary.averageMinutes)}`}
          />
          <Stat
            styles={styles}
            value={summary.averageAsleepAt === null ? '—' : formatClockMinutes(summary.averageAsleepAt, use24Hour)}
            label="Fell asleep"
            accessibilityLabel={summary.averageAsleepAt === null
              ? 'Average time you fell asleep, too varied to average'
              : `Average time you fell asleep, ${formatClockMinutes(summary.averageAsleepAt, use24Hour)}`}
          />
          <Stat
            styles={styles}
            value={summary.averageWokeAt === null ? '—' : formatClockMinutes(summary.averageWokeAt, use24Hour)}
            label="Woke up"
            accessibilityLabel={summary.averageWokeAt === null
              ? 'Average time you woke up, too varied to average'
              : `Average time you woke up, ${formatClockMinutes(summary.averageWokeAt, use24Hour)}`}
          />
        </View>

        {visible.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.finding}>Nothing recorded in this range.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>WHEN YOU SLEPT</Text>
            <View style={styles.card}>
              <SleepTimesChart dayKeys={dayKeys} nights={visible} use24Hour={use24Hour} />
              <Text style={styles.chartCaption}>
                Each bar is a day&apos;s main stretch of sleep, from falling asleep (top) to waking (bottom).
                A blank day is one with nothing recorded.
              </Text>
            </View>

            {stageAverage !== null && (
              <>
                <Text style={styles.sectionTitle}>STAGES</Text>
                <View style={styles.card}>
                  <SleepStagesBar stages={stageAverage.stages} label="Average" />
                  <Text style={styles.chartCaption}>
                    Average of the main stretch, over the {stageAverage.nights}{' '}
                    {stageAverage.nights === 1 ? 'day' : 'days'} in this range that recorded stages.
                    Stages come from Apple Watch; sleep tracked by the iPhone alone has none.
                  </Text>
                </View>
              </>
            )}

            <Text style={styles.sectionTitle}>HOURS ASLEEP</Text>
            <View style={styles.card}>
              <SleepHoursChart dayKeys={dayKeys} nights={visible} goalMinutes={goal} />
              <Text style={styles.chartCaption}>
                Time asleep recorded against each day, naps included.
                {goal !== null && ' The dashed line is your goal.'}
              </Text>
              {goal !== null && summary.atGoal !== null ? (
                <Text style={[styles.finding, styles.goalLine]}>
                  {summary.atGoal} of {summary.nights} {summary.nights === 1 ? 'day' : 'days'} recorded reached{' '}
                  {formatSleepDuration(goal)}.
                </Text>
              ) : (
                <View style={styles.goalAction}>
                  <InlineAction label="Set a sleep goal" icon="target" onPress={openGoal} />
                </View>
              )}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>WITH YOUR DAYS</Text>
        <View style={styles.card}>
          {findings.length > 0 ? (
            findings.map(f => <Text key={f.key} style={styles.finding}>{f.text}</Text>)
          ) : (
            <Text style={styles.finding}>
              Shows up once {MIN_PAIRED_DAYS} days have both sleep recorded and a mood entry or a finished task.
            </Text>
          )}
          <Text style={styles.chartCaption}>
            Over the last {SLEEP_HISTORY_DAYS} days. Each day&apos;s sleep is the sleep that ended that day.
            These are patterns between two numbers, not causes.
          </Text>
        </View>

        {/* Nothing here is kept, so there is nothing to edit or delete on this
            screen; correcting a night happens in Health, beside whatever
            recorded it. Same door the Weight screen opens. */}
        <TouchableOpacity
          style={styles.healthLinkRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); void openHealthApp(); }}
          accessibilityRole="button"
          accessibilityLabel="Open the Health app"
          accessibilityHint="View or correct your sleep in Apple Health, where it is kept"
        >
          <Ionicons name="heart-outline" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={styles.healthLinkText}>View or edit sleep in Health</Text>
          <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      </ScrollView>
      <SleepGoalSheet visible={goalOpen} onClose={() => setGoalOpen(false)} />
      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

function clock(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** "today", "yesterday", or "Sat, Oct 3". Says which day the sleep ended in, never "last night". */
function relativeDay(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return 'today';
  if (dayKey === dayKeyOf(addDays(dayKeyToDate(todayKey), -1))) return 'yesterday';
  return format(dayKeyToDate(dayKey), 'EEE, MMM d');
}

/** "7h 23m": the stat tile's narrow form of `formatSleepDuration`. */
function formatShortDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * A day's total against the goal, as a distance. No colour and no verdict:
 * the goal is the person's own number, and this is arithmetic against it.
 */
function describeAgainstGoal(minutes: number, goal: number): string {
  const gap = Math.round(goal - minutes);
  if (gap <= 0) return `Reached your ${formatSleepDuration(goal)} goal.`;
  return `${formatSleepDuration(gap)} under your ${formatSleepDuration(goal)} goal.`;
}

interface StatProps {
  styles: ReturnType<typeof makeStyles>;
  value: string;
  label: string;
  accessibilityLabel: string;
}

function Stat({ styles, value, label, accessibilityLabel }: StatProps) {
  return (
    <View style={styles.statCell} accessible accessibilityLabel={accessibilityLabel}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCell: {
    flex: 1,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  statValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs, textAlign: 'center' },
  rangeRow: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  latestDay: { fontSize: font.sm, color: colors.textSecondary },
  latestRange: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text, marginTop: spacing.xxs },
  finding: { fontSize: font.md, color: colors.text, lineHeight: 22, marginTop: spacing.xxs },
  goalLine: { marginTop: spacing.smd },
  stages: { marginTop: spacing.md },
  goalAction: { flexDirection: 'row', marginTop: spacing.smd },
  chartCaption: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.sm },
  healthLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  healthLinkText: { flex: 1, fontSize: font.sm, color: colors.textSecondary },
});
