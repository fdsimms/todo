import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRoute } from '@react-navigation/native';
import { navigationRef } from '../navigation/navigationRef';
import { format } from 'date-fns/format';
import { addDays } from 'date-fns/addDays';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore, WEIGHT_HISTORY_DAYS } from '../store/useHealthStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyToDate, getLogicalToday } from '../utils/dateUtils';
import {
  formatWeight,
  kgToUnit,
  latestWeight,
  weightChange,
  weightReadings,
  type WeightUnit,
} from '../utils/weightLog';
import {
  daysToTarget,
  goalDirection,
  goalPace,
  goalProgress,
  pacePlotPoints,
  weightSinceGoalStart,
} from '../utils/weightGoal';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { WeightChart } from '../components/WeightChart';
import { LogWeightSheet } from '../components/LogWeightSheet';
import { WeightGoalSheet } from '../components/WeightGoalSheet';
import { SegmentedControl } from '../components/SegmentedControl';

/**
 * How much of the fetched window the chart actually draws.
 *
 * `WEIGHT_HISTORY_DAYS` (`useHealthStore.ts`) is the fetch ceiling — one
 * Health query, taken once — and this is purely a display zoom over the
 * points already in memory, so switching ranges costs nothing. A closed set of
 * four is `SegmentedControl`'s job per CLAUDE.md's picker table, not a
 * `PillGroup`: there is no open-ended vocabulary here, just one of four fixed
 * spans.
 */
type WeightChartRangeDays = 30 | 90 | 180 | 365;

const WEIGHT_CHART_RANGES: readonly {
  days: WeightChartRangeDays;
  label: string;
  sectionTitle: string;
}[] = [
  { days: 30, label: '1M', sectionTitle: 'THE LAST MONTH' },
  { days: 90, label: '3M', sectionTitle: 'THE LAST 3 MONTHS' },
  { days: 180, label: '6M', sectionTitle: 'THE LAST 6 MONTHS' },
  { days: 365, label: '1Y', sectionTitle: 'THE LAST YEAR' },
];

/**
 * Six months by default — a middle ground wide enough to show real movement
 * and narrow enough that a year's worth of daily dots isn't the first thing
 * anybody sees.
 */
const DEFAULT_RANGE_DAYS: WeightChartRangeDays = 180;

/**
 * Body weight over a selectable window, read from Apple Health.
 *
 * **This screen owns no data.** Everything on it is a read of HealthKit,
 * re-taken on mount and after a weigh-in is recorded, and nothing is stored —
 * the rule `docs/arch/health-data.md` sets out for every health reading, which
 * matters most for the one number here. The practical consequence worth
 * knowing: a weight recorded in this app and a weight recorded by a smart scale
 * are the same kind of thing once they are in Health, and this screen cannot
 * tell them apart. That is the feature, not a limitation — somebody moving off
 * another tracker sees their existing history the moment they turn the read on.
 *
 * **What it deliberately does not do.** No goal weight, no BMI, no healthy
 * range, no "you're trending up", no task fired off a reading. That restraint
 * is the whole reason weight was allowed across the line the arch doc's
 * "deliberately not built yet" list draws: the app records and draws a number
 * somebody measured, and forms no opinion about the body it came from. The
 * change figure is two readings and the gap between them, with the number of
 * weigh-ins printed beside it, in the voice `MoodScreen` uses for every
 * comparison it makes.
 */

export function WeightScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const unit = useSettingsStore(s => s.weightUnit);
  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const weightSeries = useHealthStore(s => s.weightSeries);
  const loadingWeight = useHealthStore(s => s.loadingWeight);
  const refreshWeight = useHealthStore(s => s.refreshWeight);

  const [logOpen, setLogOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [rangeDays, setRangeDays] = useState<WeightChartRangeDays>(DEFAULT_RANGE_DAYS);
  const activeRange = WEIGHT_CHART_RANGES.find(r => r.days === rangeDays) ?? WEIGHT_CHART_RANGES[2];

  // `dundundun://weight?log=1` — the weigh-in request's link button. Stamped
  // with the arrival time rather than a boolean, and tracked against what has
  // already been handled, so tapping the same row twice opens the sheet twice:
  // the same shape `MoodScreen`'s own `openLog` uses, for the same reason.
  const route = useRoute<{
    key: string;
    name: string;
    params?: { openLog?: number; returnTo?: string; openGoal?: number };
  }>();
  const [handledOpenLog, setHandledOpenLog] = useState<number | undefined>(undefined);
  const [handledOpenGoal, setHandledOpenGoal] = useState<number | undefined>(undefined);
  // Where to hand the user back once the sheet this opens closes — the tab
  // they tapped the weigh-in request from, carried by `resetToWeight`'s
  // `returnTo` param. Cleared whenever the sheet is opened by hand (the "+"
  // button, the empty state) so a manual visit never inherits a stale value
  // left over from an earlier link tap.
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openLog === undefined || route.params.openLog === handledOpenLog) return;
    setHandledOpenLog(route.params.openLog);
    setReturnTo(route.params.returnTo);
    setLogOpen(true);
  }, [route.params?.openLog, route.params?.returnTo, handledOpenLog]);

  // The same stamped-param handshake for the goal sheet, which the Settings row
  // for a weight goal lands on. No `returnTo`: see `resetToWeightGoal`.
  useEffect(() => {
    if (route.params?.openGoal === undefined || route.params.openGoal === handledOpenGoal) return;
    setHandledOpenGoal(route.params.openGoal);
    setGoalOpen(true);
  }, [route.params?.openGoal, handledOpenGoal]);

  useEffect(() => {
    if (healthReadEnabled) void refreshWeight();
  }, [healthReadEnabled, refreshWeight]);

  const points = weightSeries ?? [];
  // Whether Health has anything at all, over the full fetch window — this is
  // what decides between the empty state and the chart, independent of which
  // range is currently zoomed to. "Latest" reads the same way: the most recent
  // weigh-in is the most recent one full stop, not "the most recent one inside
  // whatever span happens to be selected".
  const readings = useMemo(() => weightReadings(points), [points]);
  const latest = useMemo(() => latestWeight(points), [points]);

  // The selected range is purely a slice of what's already in memory — no
  // second Health query. `slice`'s negative-safe `Math.max` handles a range
  // wider than the data actually fetched.
  const visiblePoints = useMemo(
    () => points.slice(Math.max(0, points.length - rangeDays)),
    [points, rangeDays],
  );
  const visibleReadings = useMemo(() => weightReadings(visiblePoints), [visiblePoints]);
  const change = useMemo(() => weightChange(visiblePoints), [visiblePoints]);

  // The goal reads the *whole* series rather than the chart's range: progress
  // is measured from the day the goal was set, which may well be further back
  // than the range currently shown, and a card that changed its mind about how
  // far along you are when you tapped "1M" would be reporting the control
  // rather than the goal.
  const goal = useSettingsStore(useShallow(s => s.weightGoal));
  const goalWeightKg = useMemo(
    () => (goal === null ? null : weightSinceGoalStart(goal, points)),
    [goal, points],
  );
  const progress = goal !== null && goalWeightKg !== null ? goalProgress(goal, goalWeightKg) : null;
  const pace = goal !== null && goalWeightKg !== null
    ? goalPace(goal, goalWeightKg, getLogicalToday())
    : null;
  const remainingDays = goal !== null && goalWeightKg !== null
    ? daysToTarget(goal, goalWeightKg)
    : null;

  // Against the *visible* slice, since its vertices are indexed into whatever
  // the chart was handed. The goal card above reads the whole series instead,
  // for the reason given there.
  const pacePoints = useMemo(
    () => (goal === null ? [] : pacePlotPoints(goal, visiblePoints)),
    [goal, visiblePoints],
  );

  const openGoal = () => {
    haptics.tap();
    setGoalOpen(true);
  };

  const openLog = () => { haptics.tap(); setReturnTo(undefined); setLogOpen(true); };
  const closeLog = () => {
    setLogOpen(false);
    if (returnTo) {
      navigationRef.navigate(returnTo);
      setReturnTo(undefined);
    }
  };

  const changeValue = change === null
    ? '—'
    : `${change.deltaKg > 0 ? '+' : ''}${kgToUnit(change.deltaKg, unit).toFixed(1)}`;

  // Both header actions open a sheet, and neither sheet is mounted in the
  // Health-off branch below — nor could usefully be, since a weight can only be
  // recorded by writing it to Health and a goal has nothing to measure against.
  // So the actions come off rather than sitting there doing nothing when
  // tapped, which is what "Record a weight" did before this. The empty state is
  // what points at Settings.
  const header = (
    <>
      <ScreenHeader
        title="Weight"
        subtitle={latest ? formatWeight(latest.kilograms, unit) : undefined}
        actions={!healthReadEnabled ? [] : [
          {
            icon: 'flag-outline' as const,
            onPress: openGoal,
            // Tinted while a goal is set, the same way the Daily targets row
            // in Settings marks itself once something is set there.
            active: goal !== null,
            accessibilityLabel: goal === null ? 'Set a weight goal' : 'Edit your weight goal',
          },
          {
            icon: 'add-circle-outline' as const,
            onPress: openLog,
            accessibilityLabel: 'Record a weight',
          },
        ]}
      />
      <HubPills hub="health" active="Weight" />
    </>
  );

  // Reading is off, so there is nothing to draw and nothing this screen can do
  // about it from here — the switch and its permission sheet live in Settings,
  // and a sweep is never allowed to raise that sheet.
  if (!healthReadEnabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="scale-outline"
          title="Apple Health is off"
          subtitle="Turn on reading Apple Health in Settings to see your weight here. Anything you have already recorded, on a scale or in another app, shows up straight away."
          bottomOffset={tabBarHeight}
        />
      </View>
    );
  }

  if (readings.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="scale-outline"
          title={loadingWeight ? 'Reading Health…' : 'No weigh-ins yet'}
          // "Nothing recorded" and "Health did not share it" are the same
          // answer from HealthKit and there is no way to tell them apart, so
          // the copy has to cover both without claiming either.
          subtitle={loadingWeight
            ? undefined
            : `Nothing recorded in the last ${WEIGHT_HISTORY_DAYS} days, or Health is not sharing weight with this app. Record one and it is saved straight to Health.`}
          actionLabel={loadingWeight ? undefined : 'Record a weight'}
          onAction={loadingWeight ? undefined : openLog}
          bottomOffset={tabBarHeight}
        />
        <LogWeightSheet visible={logOpen} onClose={closeLog} />
        {/* Mounted here as well as in the main branch: the header (and so its
            goal action) is shared by every branch, and a button whose sheet
            isn't mounted does nothing at all. The sheet's own first line is
            what says a goal needs a weigh-in to measure from. */}
        <WeightGoalSheet
          visible={goalOpen}
          onClose={() => setGoalOpen(false)}
          currentKg={latest?.kilograms ?? null}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        <View style={styles.statRow}>
          <Stat
            styles={styles}
            value={latest ? kgToUnit(latest.kilograms, unit).toFixed(1) : '—'}
            label={`Latest (${unit})`}
            accessibilityLabel={latest
              ? `Latest weight, ${formatWeight(latest.kilograms, unit)}`
              : 'Latest weight, nothing recorded'}
          />
          <Stat
            styles={styles}
            value={changeValue}
            label={`Change (${unit})`}
            accessibilityLabel={change === null
              ? 'Change, not enough readings in this range'
              : `Change, ${kgToUnit(change.deltaKg, unit).toFixed(1)} ${unit} across ${change.readings} readings`}
          />
          <Stat
            styles={styles}
            value={String(visibleReadings.length)}
            label="Weigh-ins"
            accessibilityLabel={`${visibleReadings.length} weigh-ins in this range`}
          />
        </View>

        {goal !== null && (
          <>
            <Text style={styles.sectionTitle}>YOUR GOAL</Text>
            <View style={styles.card}>
              {progress === null ? (
                <Text style={styles.finding}>
                  Nothing recorded since you set this goal. Record a weight to see
                  how it is going.
                </Text>
              ) : (
                <>
                  <Text style={styles.finding}>
                    {formatWeight(goalWeightKg!, unit)} now, aiming for{' '}
                    {formatWeight(goal.targetKg, unit)}.
                  </Text>

                  {/* One bar, one colour, no end state that reads as a failure —
                      the same call targetProgress makes about its own. */}
                  <View
                    style={styles.goalTrack}
                    accessible
                    accessibilityLabel={`${Math.round(progress.fraction * 100)} percent of the way from ${formatWeight(goal.startKg, unit)} to ${formatWeight(goal.targetKg, unit)}`}
                  >
                    <View style={[styles.goalFill, { width: `${progress.fraction * 100}%` }]} />
                  </View>

                  <Text style={styles.goalLine}>
                    {progress.reached
                      ? `Reached, from ${formatWeight(goal.startKg, unit)}.`
                      : `${formatWeight(Math.abs(progress.remainingKg), unit)} to go, from ${formatWeight(goal.startKg, unit)}.`}
                  </Text>

                  {/* Ahead and behind are said about the rate the user picked,
                      never about them: no colour, no arrow, no advice. See the
                      note at the top of weightGoal.ts. */}
                  {pace !== null && goalDirection(goal) !== 'maintain' && !progress.reached && (
                    <Text style={styles.goalLine}>
                      {describePace(pace.aheadKg, unit)} Your pace would have put you at{' '}
                      {formatWeight(pace.paceKg, unit)} by now.
                    </Text>
                  )}

                  {remainingDays !== null && (
                    <Text style={styles.goalLine}>
                      At this rate, {format(addDays(getLogicalToday(), remainingDays), 'MMM d, yyyy')}.
                    </Text>
                  )}

                  <Text style={styles.chartCaption}>
                    Measured from your weigh-ins in Apple Health. Reaching it
                    completes nothing and nothing is written anywhere.
                  </Text>
                </>
              )}
            </View>
          </>
        )}

        <View style={styles.rangeRow}>
          <SegmentedControl
            options={WEIGHT_CHART_RANGES.map(r => ({
              value: r.days,
              label: r.label,
              // SegmentedControl reads a spoken label straight off the option
              // (unlike SettingsSegments, which derives it) — computed here
              // rather than left to the bare "1M"/"3M" a screen reader would
              // otherwise read as literal letters.
              accessibilityLabel: `Show the last ${
                r.days === 30 ? 'month' : r.days === 365 ? 'year' : `${r.days / 30} months`
              }`,
            }))}
            value={rangeDays}
            onChange={next => { haptics.tap(); setRangeDays(next); }}
            label="Chart range"
          />
        </View>

        <Text style={styles.sectionTitle}>{activeRange.sectionTitle}</Text>
        <View style={styles.card}>
          {visibleReadings.length === 0 ? (
            <Text style={styles.finding}>Nothing recorded in this range.</Text>
          ) : (
            <>
              <WeightChart
        points={visiblePoints}
        unit={unit}
        targetKg={goal?.targetKg ?? null}
        pacePoints={pacePoints}
      />
              <Text style={styles.chartCaption}>
                Each dot is a day you weighed in. The line breaks where more than
                two weeks passed without one. The fainter line is a 7-day average.
                {goal !== null && ' The dashed lines are your target and the pace you set.'}
              </Text>
            </>
          )}
        </View>

        {change !== null && (
          <>
            <Text style={styles.sectionTitle}>ACROSS THIS WINDOW</Text>
            <View style={styles.card}>
              {/* Two readings and the distance between them, with the sample
                  size stated. Not a trend line, and not a verdict: see the
                  file note above for why this screen stops here. */}
              <Text style={styles.finding}>
                {formatWeight(change.first.kilograms, unit)} on{' '}
                {format(dayKeyToDate(change.first.dayKey), 'MMM d')}, and{' '}
                {formatWeight(change.last.kilograms, unit)} on{' '}
                {format(dayKeyToDate(change.last.dayKey), 'MMM d')}.
              </Text>
              <Text style={styles.chartCaption}>
                From {change.readings} weigh-ins. Recorded in Apple Health.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      <LogWeightSheet visible={logOpen} onClose={closeLog} />
      <WeightGoalSheet
        visible={goalOpen}
        onClose={() => setGoalOpen(false)}
        currentKg={latest?.kilograms ?? null}
      />
    </View>
  );
}

/**
 * The gap against the user's own chosen pace, in words.
 *
 * **A fact, not a verdict.** It names the distance and which side of the pace
 * line it falls, with no colour, no arrow and nothing about whether that is
 * good — the standard `weightChange` and every contrast on the Mood screen
 * already hold themselves to. "On pace" gets its own phrasing because a gap of
 * 20 grams rendered as "0.0 kg ahead" reads as a rounding bug.
 */
function describePace(aheadKg: number, unit: WeightUnit): string {
  if (Math.abs(aheadKg) < ON_PACE_BAND_KG) return 'On your pace.';
  const distance = formatWeight(Math.abs(aheadKg), unit);
  return aheadKg > 0 ? `${distance} ahead of your pace.` : `${distance} behind your pace.`;
}

/**
 * How close to the pace line counts as on it, in kilograms.
 *
 * A tenth of a kilogram, which is the precision a weight is displayed to: a gap
 * smaller than the shown number can express has nothing to report.
 */
const ON_PACE_BAND_KG = 0.1;

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
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
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
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  chartCaption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  // One colour and one direction. The bar is an aid to the numbers beside it,
  // which stay the record — the rule ContrastBars states for its own pair.
  goalTrack: {
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    overflow: 'hidden',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  goalFill: { height: '100%', borderRadius: radius.sm, backgroundColor: colors.accent },
  goalLine: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  finding: { fontSize: font.md, color: colors.text, lineHeight: 22 },
});
