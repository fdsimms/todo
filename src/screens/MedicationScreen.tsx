import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import type { MedicationLog } from '../types';
import { useMedicationStore } from '../store/useMedicationStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  formatDose,
  frequencyTrend,
  medicationStats,
  type MedicationStat,
} from '../utils/medicationLog';
import {
  medicationExportCsv,
  medicationExportFileName,
  medicationExportSummary,
} from '../utils/medicationExport';
import {
  writeExportFile, shareCsvFile, discardBackupFile, canShare,
} from '../utils/backupFile';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { MedicationLogSheet } from '../components/MedicationLogSheet';

/** How many recent doses the list shows before it stops. */
const RECENT_LIMIT = 25;

/**
 * The window a frequency comparison is drawn over, and the stretch it is
 * compared against.
 *
 * A fortnight rather than a week: a week is short enough that one bad weekend
 * doubles the count, and long enough stretches make the comparison too slow to
 * notice a real change in. It is one constant rather than a picker because a
 * window the reader chooses is one they can shop around until it says
 * something.
 */
const TREND_DAYS = 14;

/**
 * What you have taken — see `src/utils/medicationLog.ts` for every rule,
 * including why the scheduled half of this lives on tasks instead and what
 * this screen deliberately does not draw.
 *
 * Everything above the frequency card is a tally and has no threshold, the
 * same call `SymptomDetailScreen` makes: `moodInsights.ts`'s minimums govern
 * comparisons between two variables, and counting one is not a comparison.
 * Somebody who has taken something twice is entitled to see both of those
 * days. The one card that *is* a comparison carries its own gates.
 */
export function MedicationScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const logs = useMedicationStore(s => s.logs);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<MedicationLog | null>(null);
  const [sharing, setSharing] = useState(false);

  const stats = useMemo(() => medicationStats(logs), [logs]);
  const recent = useMemo(() => logs.slice(0, RECENT_LIMIT), [logs]);
  const today = useMemo(() => dayKeyOf(getCurrentDayStart()), []);

  /**
   * Hand the whole log to the share sheet as CSV.
   *
   * No range picker, unlike the mood export's sheet: that one has windows
   * because a mood log accumulates several entries a day for years, where a
   * medication record is the thing a clinician wants whole. The summary is
   * confirmed before anything is written rather than after, which is the half
   * of that sheet worth keeping here: what is about to leave the device gets
   * said in words first.
   */
  const share = async () => {
    if (logs.length === 0 || sharing) return;
    haptics.tap();
    const confirmed = await new Promise<boolean>(resolve => {
      Alert.alert('Share your medication log', medicationExportSummary(logs), [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Share', onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;

    setSharing(true);
    let uri: string | null = null;
    try {
      if (!(await canShare())) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
      uri = writeExportFile(medicationExportCsv(logs), medicationExportFileName(new Date()));
      await shareCsvFile(uri, 'Share your medication log');
    } catch {
      Alert.alert('Export failed', 'The file could not be written. Try again.');
    } finally {
      // Deleted the moment the share sheet closes, exactly as the mood export
      // and the backup do: a health record accumulating in the app's own
      // storage would be a second copy of the most sensitive thing here.
      if (uri) discardBackupFile(uri);
      setSharing(false);
    }
  };

  const openNew = () => { haptics.tap(); setEditing(null); setSheetOpen(true); };
  const openEdit = (log: MedicationLog) => { haptics.tap(); setEditing(log); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const header = (
    <>
      <ScreenHeader
        title="Medications"
        subtitle={stats.length > 0 ? `${stats.length} recorded` : undefined}
        actions={[
          // Only once there is something to share, the same condition the mood
          // screen's own share action carries.
          ...(logs.length > 0 ? [{
            icon: 'share-outline' as const,
            onPress: share,
            loading: sharing,
            accessibilityLabel: 'Share your medication log',
          }] : []),
          {
            icon: 'add-circle-outline' as const,
            onPress: openNew,
            accessibilityLabel: 'Record a dose',
          },
        ]}
      />
      <HubPills hub="history" active="Medications" />
    </>
  );

  if (logs.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="medkit-outline"
          title="Nothing recorded yet"
          subtitle="Anything you take on a schedule is best kept as a repeating task, which records the dose when you check it off. Record something here when you take it as needed instead."
          actionLabel="Record a dose"
          onAction={openNew}
          bottomOffset={tabBarHeight}
        />
        <MedicationLogSheet visible={sheetOpen} log={editing} onClose={closeSheet} />
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
        <Text style={styles.sectionTitle}>WHAT YOU TAKE</Text>
        <View style={styles.card}>
          {stats.map((stat, index) => (
            <MedicationRow
              key={stat.key}
              stat={stat}
              today={today}
              logs={logs}
              first={index === 0}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>RECENT</Text>
        <View style={styles.card}>
          {recent.map((log, index) => (
            <TouchableOpacity
              key={log.id}
              style={[styles.doseRow, index === 0 && styles.firstRow]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => openEdit(log)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${log.name} on ${format(new Date(log.takenAt), 'MMM d')}`}
            >
              <View style={styles.doseText}>
                <Text style={styles.doseName} numberOfLines={1}>{log.name}</Text>
                <Text style={styles.doseMeta} numberOfLines={1}>
                  {[
                    format(new Date(log.takenAt), 'EEE, MMM d · h:mm a'),
                    formatDose(log),
                    log.asNeeded ? 'as needed' : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          {logs.length > RECENT_LIMIT && (
            <Text style={styles.moreNote}>
              Showing the last {RECENT_LIMIT} of {logs.length}.
            </Text>
          )}
        </View>
      </ScrollView>
      <MedicationLogSheet visible={sheetOpen} log={editing} onClose={closeSheet} />
    </View>
  );
}

/**
 * One medication's tally, and its frequency comparison where there is one.
 *
 * The comparison is offered only for something taken as needed. For a
 * scheduled medicine "how often did I take it" is a question about adherence,
 * which the task carrying it already answers with a streak — and reporting a
 * fall here would read as a finding about the medicine rather than about a
 * fortnight of forgetting.
 */
function MedicationRow({
  stat, today, logs, first, styles, colors,
}: {
  stat: MedicationStat;
  today: string;
  logs: readonly MedicationLog[];
  first: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const trend = stat.asNeeded ? frequencyTrend(logs, stat.key, today, TREND_DAYS) : null;

  return (
    <View style={[styles.medRow, first && styles.firstRow]}>
      <View style={styles.medHeader}>
        <Text style={styles.medName} numberOfLines={1}>{stat.name}</Text>
        {stat.asNeeded && (
          <Text style={styles.medBadge}>AS NEEDED</Text>
        )}
      </View>
      <Text style={styles.medMeta}>
        {[
          `${stat.doses} ${stat.doses === 1 ? 'dose' : 'doses'} over ${stat.days} ${stat.days === 1 ? 'day' : 'days'}`,
          stat.typicalDose ? `usually ${stat.typicalDose}` : null,
          `last on ${format(new Date(stat.lastTakenAt), 'MMM d')}`,
        ].filter(Boolean).join(' · ')}
      </Text>
      {trend && (
        <Text style={[styles.medTrend, { color: colors.textSecondary }]}>
          {trend.recent} in the last {trend.days} days, against {trend.previous} the {trend.days} before.
        </Text>
      )}
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
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  firstRow: { borderTopWidth: 0 },
  medRow: {
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  medHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  medName: {
    flex: 1,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  medBadge: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
    color: colors.textSecondary,
  },
  medMeta: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  medTrend: {
    fontSize: font.sm,
    marginTop: spacing.xs,
  },
  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  doseText: { flex: 1 },
  doseName: {
    fontSize: font.md,
    color: colors.text,
  },
  doseMeta: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  moreNote: {
    fontSize: font.xs,
    color: colors.textTertiary,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
});
