import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { navigateToTab, navigationRef } from '../navigation/navigationRef';
import { format } from 'date-fns/format';
import { addDays } from 'date-fns/addDays';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHealthStore } from '../store/useHealthStore';
import { useDemoStore } from '../store/useDemoStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart, getCurrentLogicalDayKey, getLogicalDayKey } from '../utils/dateUtils';
import { navigateToSettingsEntry } from '../navigation/openSettings';
import { openHealthApp } from '../utils/healthBridge';
import {
  averageReading,
  formatReading,
  latestReading,
  readingsSince,
  type BloodPressureReading,
} from '../utils/bloodPressureLog';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { pulsesSince, standalonePulses, type PulseEntry } from '../utils/pulseLog';
import { BloodPressureChart } from '../components/BloodPressureChart';
import { LogBloodPressureSheet } from '../components/LogBloodPressureSheet';
import { SegmentedControl } from '../components/SegmentedControl';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { BLOOD_PRESSURE_HISTORY_DAYS } from '../store/useHealthStore';

/**
 * How much of the fetched year the screen shows. A display slice over readings
 * already in memory, so switching costs nothing further from Health.
 */
const RANGES: readonly { days: number; label: string; spoken: string }[] = [
  { days: 7, label: '1W', spoken: 'week' },
  { days: 30, label: '1M', spoken: 'month' },
  { days: 180, label: '6M', spoken: '6 months' },
  { days: 365, label: '1Y', spoken: 'year' },
];
const DEFAULT_RANGE_DAYS = 30;

/** Rows shown in the list. The count and average still cover the whole range. */
const MAX_LISTED = 50;

/**
 * Blood pressure read back from Apple Health.
 *
 * **This screen owns no data**, the rule `docs/arch/health-data.md` sets for
 * every reading: it re-reads Health on every visit and keeps nothing. A reading
 * from this app and one a cuff sent over Bluetooth are the same thing once
 * they are in Health.
 *
 * **It forms no opinion.** No "normal" or "high", no colour on a number, no
 * chart bands, no goal and no task fired off a reading, for the reason
 * `weightLog.ts` gives. The average is arithmetic over the readings listed
 * below it.
 */
export function BloodPressureScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const screenSettings = useScreenSettings('BloodPressure', 'Blood pressure settings');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const healthReadEnabled = useSettingsStore(s => s.healthReadEnabled);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const demoActive = useDemoStore(s => s.active);
  const bloodPressure = useHealthStore(s => s.bloodPressure);
  const loading = useHealthStore(s => s.loadingBloodPressure);
  const refreshBloodPressure = useHealthStore(s => s.refreshBloodPressure);
  const pulses = useHealthStore(s => s.pulses);
  const refreshPulses = useHealthStore(s => s.refreshPulses);

  const [logOpen, setLogOpen] = useState(false);
  const [rangeDays, setRangeDays] = useState(DEFAULT_RANGE_DAYS);
  const activeRange = RANGES.find(r => r.days === rangeDays) ?? RANGES[1];

  // On every visit, not only the first: the screen stays mounted for the
  // session, so a reading a cuff sent to Health never showed otherwise.
  useFocusEffect(
    useCallback(() => {
      if (healthReadEnabled) {
        void refreshBloodPressure();
        void refreshPulses();
      }
    }, [healthReadEnabled, refreshBloodPressure, refreshPulses]),
  );

  const readings = useMemo(() => bloodPressure ?? [], [bloodPressure]);
  const latest = useMemo(() => latestReading(readings), [readings]);
  const rangeStart = useMemo(() => addDays(getCurrentDayStart(), -(rangeDays - 1)), [rangeDays]);
  const inRange = useMemo(() => readingsSince(readings, rangeStart), [readings, rangeStart]);
  const average = useMemo(() => averageReading(inRange), [inRange]);
  const listed = useMemo(() => inRange.slice(-MAX_LISTED).reverse(), [inRange]);
  // Pulses typed in here and Apple's resting rate, newest first, minus the ones
  // already shown on a reading's own row.
  const standalone = useMemo(() => standalonePulses(pulses ?? [], readings), [pulses, readings]);
  const listedPulses = useMemo(
    () => pulsesSince(standalone, rangeStart).slice(-MAX_LISTED).reverse(),
    [standalone, rangeStart],
  );

  // The person's own day boundary: a reading taken at 1 AM with a 2 AM day start
  // belongs to the day before the calendar date it carries.
  const todayKey = getCurrentLogicalDayKey();
  const yesterdayKey = dayKeyOf(addDays(getCurrentDayStart(), -1));
  const dayLabel = (at: Date): string => {
    const key = getLogicalDayKey(at);
    if (key === todayKey) return 'Today';
    if (key === yesterdayKey) return 'Yesterday';
    return format(at, at.getFullYear() === new Date().getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy');
  };
  const timeLabel = (at: Date) => format(at, use24Hour ? 'HH:mm' : 'h:mm a');

  // `dundundun://bloodpressure?log=1` — the blood pressure request's link
  // button. WeightScreen's handshake: stamped with the arrival time and tracked
  // against what has been handled, so tapping the same row twice opens the sheet
  // twice, with `returnTo` handing the person back to the tab they came from.
  const route = useRoute<{
    key: string;
    name: string;
    params?: { openLog?: number; returnTo?: string };
  }>();
  const [handledOpenLog, setHandledOpenLog] = useState<number | undefined>(undefined);
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openLog === undefined || route.params.openLog === handledOpenLog) return;
    setHandledOpenLog(route.params.openLog);
    setReturnTo(route.params.returnTo);
    setLogOpen(true);
  }, [route.params?.openLog, route.params?.returnTo, handledOpenLog]);

  const openLog = () => { haptics.tap(); setReturnTo(undefined); setLogOpen(true); };
  const closeLog = () => {
    setLogOpen(false);
    if (returnTo) {
      navigateToTab(returnTo);
      setReturnTo(undefined);
    }
  };

  const header = (
    <>
      <ScreenHeader
        title="Blood pressure"
        subtitle={latest ? `${formatReading(latest)} ${dayLabel(latest.at).toLowerCase()}` : undefined}
        actions={withScreenSettings(!healthReadEnabled || demoActive ? [] : [
          {
            icon: 'add-circle-outline' as const,
            onPress: openLog,
            accessibilityLabel: 'Record blood pressure',
          },
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />
      <HubPills hub="health" active="BloodPressure" />
    </>
  );

  // Demo mode never reads or writes Health, so this comes before the switch
  // below, which can still be on inside the demo database (WeightScreen's order).
  if (demoActive) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="pulse-outline"
          title="Not available in demo mode"
          subtitle="Demo mode doesn’t read Apple Health. Leave demo mode to see your own readings."
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
          icon="pulse-outline"
          title="Apple Health is off"
          subtitle="Turn on Read Apple Health in Settings to see your blood pressure here. Readings already in Health show up right away."
          actionLabel="Open Settings"
          onAction={() => { haptics.tap(); navigateToSettingsEntry(navigationRef, 'healthRead'); }}
          bottomOffset={tabBarHeight}
        />
      </View>
    );
  }

  // A screen with pulses and no readings is still a screen with something to
  // show, so the empty state is for neither.
  if (readings.length === 0 && standalone.length === 0) {
    const waiting = loading || bloodPressure === null;
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="pulse-outline"
          title={waiting ? 'Reading Health…' : 'No readings yet'}
          // A refused read and an empty one are the same answer from Health, so
          // the copy covers both without claiming either. Blood pressure joined
          // the read list after the first types, and the app never asks again
          // on its own, so the button goes to the access row.
          subtitle={waiting
            ? undefined
            : `Nothing recorded in the last ${BLOOD_PRESSURE_HISTORY_DAYS} days, or Health isn’t sharing blood pressure. If you allowed access before this was added, check Health access in Settings.`}
          actionLabel={waiting ? undefined : 'Record blood pressure'}
          onAction={waiting ? undefined : openLog}
          bottomOffset={tabBarHeight}
        />
        <LogBloodPressureSheet visible={logOpen} onClose={closeLog} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        refreshControl={pullSearch.refreshControl}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(tabBarHeight + spacing.xl, scrollTop.clearance) }]}
      >
        {latest && (
          <>
            <Text style={styles.sectionTitle}>MOST RECENT</Text>
            <View
              style={styles.card}
              accessible
              accessibilityLabel={`Most recent reading, ${latest.systolic} over ${latest.diastolic} millimeters of mercury, ${dayLabel(latest.at)} at ${timeLabel(latest.at)}`}
            >
              <Text style={styles.latestValue}>
                {formatReading(latest)}
                <Text style={styles.unit}> mmHg</Text>
              </Text>
              <Text style={styles.latestWhen}>
                {dayLabel(latest.at)}, {timeLabel(latest.at)}
                {latest.pulse !== null ? `, pulse ${latest.pulse}` : ''}
              </Text>
            </View>
          </>
        )}

        <View style={styles.rangeRow}>
          <SegmentedControl
            options={RANGES.map(r => ({
              value: r.days,
              label: r.label,
              accessibilityLabel: `Show the last ${r.spoken}`,
            }))}
            value={rangeDays}
            onChange={next => setRangeDays(next)}
            label="Range"
          />
        </View>

        {readings.length > 0 && (
        <View style={styles.statRow}>
          <View
            style={styles.statCell}
            accessible
            accessibilityLabel={average === null
              ? `Average, nothing recorded in the last ${activeRange.spoken}`
              : `Average over the last ${activeRange.spoken}, ${average.systolic} over ${average.diastolic}`}
          >
            <Text style={styles.statValue}>{average === null ? '—' : formatReading(average)}</Text>
            <Text style={styles.statLabel}>Average</Text>
          </View>
          <View style={styles.statCell} accessible accessibilityLabel={`${inRange.length} readings in the last ${activeRange.spoken}`}>
            <Text style={styles.statValue}>{inRange.length}</Text>
            <Text style={styles.statLabel}>Readings</Text>
          </View>
        </View>
        )}

        {inRange.length > 0 && (
          <View style={styles.card}>
            <BloodPressureChart
              readings={inRange}
              startMs={rangeStart.getTime()}
              endMs={Date.now()}
              summary={`Chart of ${inRange.length} blood pressure readings over the last ${activeRange.spoken}, top and bottom numbers. The readings are listed below the chart.`}
            />
          </View>
        )}

        {listed.length === 0 ? (
          readings.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.empty}>Nothing recorded in this range.</Text>
            </View>
          ) : null
        ) : (
          <>
            <Text style={styles.sectionTitle}>READINGS</Text>
            <View style={[styles.card, styles.listCard]}>
              {listed.map((reading: BloodPressureReading, i) => (
                <View
                  key={`${reading.at.toISOString()}-${i}`}
                  style={[styles.row, i > 0 && styles.rowDivider]}
                  accessible
                  accessibilityLabel={`${reading.systolic} over ${reading.diastolic}, ${dayLabel(reading.at)} at ${timeLabel(reading.at)}${reading.pulse !== null ? `, pulse ${reading.pulse}` : ''}`}
                >
                  <View style={styles.rowWhen}>
                    <Text style={styles.rowDay}>{dayLabel(reading.at)}</Text>
                    <Text style={styles.rowTime}>
                      {timeLabel(reading.at)}
                      {reading.pulse !== null ? `, pulse ${reading.pulse}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>
                    {formatReading(reading)}
                    <Text style={styles.rowUnit}> mmHg</Text>
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {listedPulses.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>PULSE</Text>
            <View style={[styles.card, styles.listCard]}>
              {listedPulses.map((pulse: PulseEntry, i) => (
                <View
                  key={`${pulse.at.toISOString()}-${pulse.kind}-${i}`}
                  style={[styles.row, i > 0 && styles.rowDivider]}
                  accessible
                  accessibilityLabel={`${pulse.kind === 'resting' ? 'Resting heart rate from Health' : 'Pulse'} ${pulse.bpm} beats per minute, ${dayLabel(pulse.at)}${pulse.kind === 'logged' ? ` at ${timeLabel(pulse.at)}` : ''}`}
                >
                  <View style={styles.rowWhen}>
                    <Text style={styles.rowDay}>{dayLabel(pulse.at)}</Text>
                    {/* A resting rate is Apple's one figure for the day, so it
                        carries no time and says whose it is: only the other
                        kind was typed in here. */}
                    <Text style={styles.rowTime}>
                      {pulse.kind === 'resting' ? 'Resting, from Health' : timeLabel(pulse.at)}
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>
                    {pulse.bpm}
                    <Text style={styles.rowUnit}> bpm</Text>
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* This screen keeps no copy of a reading, so there is nothing here to
            edit or delete (docs/arch/health-data.md). Correcting one happens in
            the Health app, so this opens the door to it. */}
        <TouchableOpacity
          style={styles.healthLinkRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); void openHealthApp(); }}
          accessibilityRole="button"
          accessibilityLabel="Open the Health app"
          accessibilityHint="View or correct a past reading in Apple Health, where your blood pressure history is kept"
        >
          <Ionicons name="heart-outline" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={styles.healthLinkText}>View or edit past readings in Health</Text>
          <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      </ScrollView>
      <LogBloodPressureSheet visible={logOpen} onClose={closeLog} />
      {pullSearch.sheet}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md },
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
  listCard: { paddingVertical: spacing.xs },
  latestValue: { fontSize: font.xxl, fontWeight: fontWeight.bold, color: colors.text },
  unit: { fontSize: font.lg, fontWeight: fontWeight.medium, color: colors.textSecondary },
  latestWhen: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xxs },
  rangeRow: { marginBottom: spacing.md },
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
  empty: { fontSize: font.md, color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.smd,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowWhen: { flexShrink: 1 },
  rowDay: { fontSize: font.md, color: colors.text },
  rowTime: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  rowValue: { fontSize: font.lg, fontWeight: fontWeight.semibold, color: colors.text },
  rowUnit: { fontSize: font.xs, fontWeight: fontWeight.regular, color: colors.textSecondary },
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
