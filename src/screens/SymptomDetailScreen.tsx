import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import type { MoodLog, SymptomSeverity } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { severityLabel } from '../utils/moodLog';
import {
  logsWithSymptom, symptomSeverityOnDay, symptomStatFor,
} from '../utils/moodHistory';
import {
  MIN_PAIRED_DAYS, buildMoodDays, symptomFoodContrasts, symptomMoodContrasts,
} from '../utils/moodInsights';
import { foodDayInputs } from '../utils/nutritionStats';
import { useFoodLogStore, FOOD_INSIGHT_DAYS } from '../store/useFoodLogStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { MoodEntryRow } from '../components/MoodEntryRow';
import { MoodLogSheet } from '../components/MoodLogSheet';
import { ContrastBars } from '../components/ContrastBars';

type RootStackParamList = {
  SymptomDetail: {
    /** The match key (see `symptomKey`), not the display name. */
    symptomKey: string;
  };
};

/** How many days the severity strip covers. A fortnight, like the mood chart. */
const CHART_DAYS = 14;

const BAR_HEIGHT = 60;

/**
 * One symptom: how often, how bad, when it last happened, and every entry
 * carrying it.
 *
 * The symptom half of the feature had no page of its own. A symptom appeared in
 * the log sheet's pill grid, and — only past `MIN_PAIRED_DAYS` and only if it
 * made the top four by gap size — as one row of a mood contrast. So the
 * ordinary question a person tracking a symptom has ("how often is this
 * happening, and is it getting worse?") had no answer anywhere in the app,
 * while the much stronger claim about its relationship to their mood did.
 *
 * **Everything above the contrast card is a tally, and tallies have no
 * threshold.** `moodInsights.ts`'s rules govern comparisons between two
 * variables; counting one variable is not a comparison, so a symptom logged
 * twice shows both of those days here rather than being withheld until ten of
 * them exist. The one card that *is* a comparison is the mood contrast, and it
 * comes straight from `symptomMoodContrasts` with its own gates intact rather
 * than being recomputed loosely for a page about one symptom.
 */
export function SymptomDetailScreen() {
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<RouteProp<RootStackParamList, 'SymptomDetail'>>();
  const key = route.params.symptomKey;
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMoodStore(s => s.logs);
  const removeLog = useMoodStore(s => s.removeLog);
  const tasks = useTaskStore(s => s.tasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);

  const [editing, setEditing] = useState<MoodLog | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const stat = useMemo(() => symptomStatFor(logs, key), [logs, key]);
  const entries = useMemo(() => logsWithSymptom(logs, key), [logs, key]);

  // The last fortnight, whether or not each day carried it — the gaps are the
  // picture. Same walk the Mood screen's chart makes, for the same reason: only
  // drawing the days it appeared on would compress a month of headaches into a
  // solid fortnight of them.
  const strip = useMemo(() => {
    const out: { key: string; label: string; a11y: string; severity: SymptomSeverity | null }[] = [];
    const cursor = getCurrentDayStart();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const date = new Date(cursor);
      date.setDate(date.getDate() - i);
      const dayKey = dayKeyOf(date);
      const severity = symptomSeverityOnDay(logs, key, dayKey);
      out.push({
        key: dayKey,
        label: format(date, 'EEEEE'),
        a11y: `${format(date, 'EEEE d MMMM')}: ${severity === null ? 'not logged' : severityLabel(severity)}`,
        severity,
      });
    }
    return out;
  }, [logs, key]);

  // The food log's own window, on the same terms the Mood screen reads it —
  // see `loadInsightWindow`, and `kitchenEnabled` gating it for the reason the
  // readings card is gated on `healthReadEnabled`.
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const foodEntries = useFoodLogStore(s => s.insightEntries);
  const loadFoodInsightWindow = useFoodLogStore(s => s.loadInsightWindow);
  useFocusEffect(
    useCallback(() => {
      if (!kitchenEnabled) return;
      const today = getCurrentDayStart();
      loadFoodInsightWindow(
        dayKeyOf(addDays(today, -(FOOD_INSIGHT_DAYS - 1))),
        dayKeyOf(today),
      );
    }, [kitchenEnabled, loadFoodInsightWindow]),
  );

  const days = useMemo(() => buildMoodDays(
    logs, tasks, dayResetTime, [], null,
    kitchenEnabled ? foodDayInputs(foodEntries) : [],
  ), [logs, tasks, dayResetTime, kitchenEnabled, foodEntries]);

  // The contrast, with `moodInsights`' own gates rather than a looser read for
  // one symptom: below MIN_PAIRED_DAYS, or with too few days on either side,
  // there is simply no row and the card does not render.
  const contrast = useMemo(
    () => symptomMoodContrasts(days).find(row => row.label === key) ?? null,
    [days, key],
  );

  // How often it turned up on the days a food was logged. The most loaded read
  // in the app, which is why it is scoped to the one symptom this page is
  // about rather than searching every symptom against every food — see
  // `symptomFoodContrasts`. Four rows, like every other contrast list.
  const foodRows = useMemo(
    () => (kitchenEnabled ? symptomFoodContrasts(days, key).slice(0, 4) : []),
    [days, key, kitchenEnabled],
  );
  // The label as it was typed, not the lowercased match key.
  const foodNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of foodEntries) {
      const label = entry.label.trim();
      if (label) names.set(label.toLowerCase(), label);
    }
    return names;
  }, [foodEntries]);

  const confirmDelete = (log: MoodLog) => {
    Alert.alert(
      'Delete this entry?',
      'It will be removed from your history and from every number on the Mood screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { haptics.warning(); removeLog(log.id); },
        },
      ],
    );
  };

  if (!stat) {
    // Every entry carrying it was deleted while this page was open. The
    // vocabulary is derived from the entries (see `symptomVocabulary`), so the
    // symptom stops existing the moment its last entry does.
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title="" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="pulse-outline"
          title="This symptom is gone"
          subtitle="Every entry that mentioned it has been deleted."
        />
      </View>
    );
  }

  const todayKey = dayKeyOf(getCurrentDayStart());
  const lastLabel = stat.lastDayKey === todayKey
    ? 'Today'
    : format(dayKeyToDate(stat.lastDayKey), 'd MMM');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader title={stat.name} onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={styles.statRow}>
          <View
            style={styles.statCell}
            accessible
            accessibilityLabel={`Logged on ${stat.dayCount} ${stat.dayCount === 1 ? 'day' : 'days'}`}
          >
            <Text style={styles.statValue}>{stat.dayCount}</Text>
            <Text style={styles.statLabel}>{stat.dayCount === 1 ? 'Day' : 'Days'}</Text>
          </View>
          <View style={styles.statCell} accessible accessibilityLabel={`Last logged ${lastLabel}`}>
            <Text style={styles.statValue}>{lastLabel}</Text>
            <Text style={styles.statLabel}>Last logged</Text>
          </View>
          <View
            style={styles.statCell}
            accessible
            accessibilityLabel={`Worst it got, ${severityLabel(worstSeverity(stat.daysBySeverity))}`}
          >
            <Text style={styles.statValue}>
              {severityLabel(worstSeverity(stat.daysBySeverity))}
            </Text>
            <Text style={styles.statLabel}>At worst</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>THE LAST TWO WEEKS</Text>
        <View style={styles.card}>
          <View style={styles.stripInner}>
            {strip.map(day => (
              <View key={day.key} style={styles.stripCol} accessible accessibilityLabel={day.a11y}>
                <View style={styles.barTrack}>
                  {day.severity !== null && (
                    <View
                      style={[
                        styles.bar,
                        {
                          height: (day.severity / 3) * BAR_HEIGHT,
                          backgroundColor: severityColor(day.severity, colors),
                        },
                      ]}
                    />
                  )}
                </View>
                <Text style={styles.barLabel}>{day.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.caption}>
            How bad it got each day. A day with no bar is a day you didn't log it.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>HOW BAD IT GETS</Text>
        <View style={styles.card}>
          {([3, 2, 1] as SymptomSeverity[]).map(severity => (
            <View
              key={severity}
              style={styles.severityRow}
              accessible
              accessibilityLabel={`${severityLabel(severity)}: ${stat.daysBySeverity[severity]} ${stat.daysBySeverity[severity] === 1 ? 'day' : 'days'}`}
            >
              <View style={[styles.severityDot, { backgroundColor: severityColor(severity, colors) }]} />
              <Text style={styles.severityLabel}>{severityLabel(severity)}</Text>
              <Text style={styles.severityCount}>
                {stat.daysBySeverity[severity]} {stat.daysBySeverity[severity] === 1 ? 'day' : 'days'}
              </Text>
            </View>
          ))}
          <Text style={styles.caption}>
            Counted at the worst it reached each day.
          </Text>
        </View>

        {contrast && (
          <>
            <Text style={styles.sectionTitle}>MOOD ON THOSE DAYS</Text>
            <View style={styles.card}>
              <View style={styles.splitRow}>
                <View
                  style={styles.splitCell}
                  accessible
                  accessibilityLabel={`Average mood ${contrast.moodWith.toFixed(1)} across ${contrast.withDays} days with it`}
                >
                  <Text style={styles.splitValue}>{contrast.moodWith.toFixed(1)}</Text>
                  <Text style={styles.splitLabel}>With it ({contrast.withDays})</Text>
                </View>
                <View
                  style={styles.splitCell}
                  accessible
                  accessibilityLabel={`Average mood ${contrast.moodWithout.toFixed(1)} across ${contrast.withoutDays} days without it`}
                >
                  <Text style={styles.splitValue}>{contrast.moodWithout.toFixed(1)}</Text>
                  <Text style={styles.splitLabel}>Without it ({contrast.withoutDays})</Text>
                </View>
              </View>
              <Text style={styles.caption}>
                Your average mood on days you logged it, against days you didn't. This is a
                comparison of two averages, not a cause.
              </Text>
            </View>
          </>
        )}

        {foodRows.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>BY WHAT YOU ATE</Text>
            <View style={styles.card}>
              {foodRows.map((row, i) => (
                <ContrastBars
                  key={row.label}
                  first={i === 0}
                  wide
                  label={foodNames.get(row.label) ?? row.label}
                  withLabel="Had it"
                  withoutLabel="Didn’t"
                  withFraction={row.rateWith}
                  withoutFraction={row.rateWithout}
                  withText={`${row.withHits} of ${row.withDays} ${row.withDays === 1 ? 'day' : 'days'}`}
                  withoutText={`${row.withoutHits} of ${row.withoutDays} ${row.withoutDays === 1 ? 'day' : 'days'}`}
                  accessibilityLabel={`${foodNames.get(row.label) ?? row.label}: logged on ${row.withHits} of the ${row.withDays} days you had it, and ${row.withoutHits} of the ${row.withoutDays} days you didn't`}
                />
              ))}
              <Text style={styles.caption}>
                How often you logged {stat.name.toLowerCase()} on the days you had that food,
                against the days you logged food without it. This counts days. It cannot tell a
                food apart from everything else about the days you had it.
              </Text>
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>
          {entries.length} {entries.length === 1 ? 'ENTRY' : 'ENTRIES'}
        </Text>
        {entries.map(log => (
          <MoodEntryRow
            key={log.id}
            log={log}
            highlightSymptomKey={key}
            onPress={() => { haptics.tap(); setEditing(log); setSheetOpen(true); }}
            onLongPress={() => confirmDelete(log)}
          />
        ))}
      </ScrollView>

      <MoodLogSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
      />
    </View>
  );
}

/** The worst severity this symptom has ever reached. Falls back to mild. */
function worstSeverity(daysBySeverity: Record<SymptomSeverity, number>): SymptomSeverity {
  if (daysBySeverity[3] > 0) return 3;
  if (daysBySeverity[2] > 0) return 2;
  return 1;
}

/**
 * Mild, moderate, severe as three steps of warning rather than three arbitrary
 * hues — the scale is ordered, so the colours have to be too, and the app
 * already reads yellow-through-red that way everywhere else.
 */
function severityColor(severity: SymptomSeverity, colors: Colors): string {
  if (severity === 3) return colors.red;
  if (severity === 2) return colors.orange;
  return colors.warning;
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
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  statValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
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
  stripInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  stripCol: { flex: 1, alignItems: 'center' },
  barTrack: { width: 12, height: BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 12, borderRadius: 4 },
  barLabel: { marginTop: 4, color: colors.textTertiary, fontSize: 10, fontWeight: '500' },
  caption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  severityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  severityDot: { width: 8, height: 8, borderRadius: radius.full },
  severityLabel: { flex: 1, fontSize: font.sm, color: colors.text },
  severityCount: { fontSize: font.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  splitRow: { flexDirection: 'row' },
  splitCell: { flex: 1, alignItems: 'center' },
  splitValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  splitLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2 },
});
