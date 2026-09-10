import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore, WEIGHT_HISTORY_DAYS } from '../store/useHealthStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyToDate } from '../utils/dateUtils';
import {
  formatWeight,
  kgToUnit,
  latestWeight,
  weightChange,
  weightReadings,
} from '../utils/weightLog';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { WeightChart } from '../components/WeightChart';
import { LogWeightSheet } from '../components/LogWeightSheet';

/**
 * Body weight over the last six months, read from Apple Health.
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

  useEffect(() => {
    if (healthReadEnabled) void refreshWeight();
  }, [healthReadEnabled, refreshWeight]);

  const points = weightSeries ?? [];
  const readings = useMemo(() => weightReadings(points), [points]);
  const latest = useMemo(() => latestWeight(points), [points]);
  const change = useMemo(() => weightChange(points), [points]);

  const openLog = () => { haptics.tap(); setLogOpen(true); };

  const changeValue = change === null
    ? '—'
    : `${change.deltaKg > 0 ? '+' : ''}${kgToUnit(change.deltaKg, unit).toFixed(1)}`;

  const header = (
    <>
      <ScreenHeader
        title="Weight"
        subtitle={latest ? formatWeight(latest.kilograms, unit) : undefined}
        actions={[{
          icon: 'add-circle-outline' as const,
          onPress: openLog,
          accessibilityLabel: 'Record a weight',
        }]}
      />
      <HubPills hub="history" active="Weight" />
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
        <LogWeightSheet visible={logOpen} onClose={() => setLogOpen(false)} />
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
              ? 'Change, not enough readings'
              : `Change, ${kgToUnit(change.deltaKg, unit).toFixed(1)} ${unit} across ${change.readings} readings`}
          />
          <Stat
            styles={styles}
            value={String(readings.length)}
            label="Weigh-ins"
            accessibilityLabel={`${readings.length} weigh-ins`}
          />
        </View>

        <Text style={styles.sectionTitle}>THE LAST SIX MONTHS</Text>
        <View style={styles.card}>
          <WeightChart points={points} unit={unit} />
          <Text style={styles.chartCaption}>
            Each dot is a day you weighed in. The line breaks where more than two
            weeks passed without one.
          </Text>
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
                {format(dayKeyToDate(change.first.dayKey), 'd MMM')}, and{' '}
                {formatWeight(change.last.kilograms, unit)} on{' '}
                {format(dayKeyToDate(change.last.dayKey), 'd MMM')}.
              </Text>
              <Text style={styles.chartCaption}>
                From {change.readings} weigh-ins. Recorded in Apple Health.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      <LogWeightSheet visible={logOpen} onClose={() => setLogOpen(false)} />
    </View>
  );
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
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: font.xl, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
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
  finding: { fontSize: font.md, color: colors.text, lineHeight: 22 },
});
