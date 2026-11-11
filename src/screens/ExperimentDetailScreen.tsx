import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { format } from 'date-fns/format';
import { useExperimentStore } from '../store/useExperimentStore';
import { useMilestoneStore } from '../store/useMilestoneStore';
import { useMoodStore } from '../store/useMoodStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { severityLabel } from '../utils/moodLog';
import { moodBarFraction } from '../utils/moodInsights';
import {
  experimentProgress,
  experimentResult,
  overlappingChanges,
  roundedSeverity,
  symptomRate,
  type ExperimentSymptomRead,
} from '../utils/experiments';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { ContrastBars } from '../components/ContrastBars';
import { ExperimentSheet } from '../components/ExperimentSheet';
import { LazySheet } from '../components/LazySheet';
import { HelpText } from '../components/HelpText';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

type RootStackParamList = {
  ExperimentDetail: { experimentId: string };
};

function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

function shortDay(dayKey: string): string {
  return format(dayKeyToDate(dayKey), 'MMM d');
}

/**
 * One experiment: how far along it is, and mood and symptoms during it against
 * the same number of days before it. See `docs/arch/mood-log.md`,
 * "Experiments", and `src/utils/experiments.ts` for the read and its gates.
 *
 * Symptoms come in two groups on purpose. The ones picked in advance are what
 * the experiment was set up to test; every other symptom with enough days is
 * shown under them, labeled as not what it was set up to test, because a
 * dozen compared after the fact will always turn up one that looks different
 * by chance.
 *
 * Everything that might also explain a difference (a milestone in either
 * stretch, another experiment overlapping it) is named at the bottom rather
 * than left for the reader to remember.
 */
export function ExperimentDetailScreen() {
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<RouteProp<RootStackParamList, 'ExperimentDetail'>>();
  const id = route.params.experimentId;
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const experiments = useExperimentStore(s => s.experiments);
  const milestones = useMilestoneStore(s => s.milestones);
  const logs = useMoodStore(s => s.logs);
  const experiment = experiments.find(e => e.id === id) ?? null;
  const [sheetOpen, setSheetOpen] = useState(false);

  const todayKey = dayKeyOf(getCurrentDayStart());
  const result = useMemo(
    () => (experiment ? experimentResult(experiment, logs, todayKey) : null),
    [experiment, logs, todayKey],
  );
  const changes = useMemo(
    () => (experiment ? overlappingChanges(experiment, milestones, experiments) : []),
    [experiment, milestones, experiments],
  );

  if (!experiment || !result) {
    // Deleted from its own sheet, or on another phone while this was open.
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title="" onBack={() => navigation.goBack()} />
        <EmptyState icon="flask-outline" title="This experiment is gone" subtitle="It was deleted." />
      </View>
    );
  }

  const { span, status } = result;
  const progress = experimentProgress(experiment, todayKey);
  const comparedTo = `the ${days(span.lengthDays)} before it started`;

  const statCells = status === 'running'
    ? [
      { value: `Day ${progress.day}`, label: `of ${progress.of}` },
      { value: shortDay(span.startKey), label: 'Started' },
      { value: shortDay(span.endKey), label: 'Ends' },
    ]
    : status === 'upcoming'
      ? [
        { value: shortDay(span.startKey), label: 'Starts' },
        { value: shortDay(span.endKey), label: 'Ends' },
        { value: String(span.lengthDays), label: span.lengthDays === 1 ? 'Day' : 'Days' },
      ]
      : [
        { value: shortDay(span.startKey), label: 'Started' },
        { value: shortDay(span.endKey), label: 'Ended' },
        { value: String(span.lengthDays), label: span.lengthDays === 1 ? 'Day' : 'Days' },
      ];

  const symptomBars = (row: ExperimentSymptomRead, i: number) => {
    if (!row.comparable) {
      const why = row.firstLoggedKey === null
        ? 'Not logged yet, so there’s nothing to compare.'
        : row.firstLoggedKey > span.baselineFromKey
          ? `First logged ${shortDay(row.firstLoggedKey)}, so there aren’t enough days to compare yet.`
          : 'Not enough days logged to compare yet.';
      return (
        <View key={row.key} style={i > 0 ? styles.rowGap : undefined} accessible accessibilityLabel={`${row.name}. ${why}`}>
          <Text style={styles.rowLabel}>{row.name}</Text>
          <Text style={styles.rowDetail}>{why}</Text>
        </View>
      );
    }
    const severityLine = row.before.averageSeverity !== null && row.during.averageSeverity !== null
      ? `Usually ${severityLabel(roundedSeverity(row.before.averageSeverity)).toLowerCase()} before, ${severityLabel(roundedSeverity(row.during.averageSeverity)).toLowerCase()} during`
      : undefined;
    const beforeText = `${row.before.daysWith} of ${days(row.before.loggedDays)}`;
    const duringText = `${row.during.daysWith} of ${days(row.during.loggedDays)}`;
    return (
      <ContrastBars
        key={row.key}
        first={i === 0}
        wide
        label={row.name}
        detail={severityLine}
        withLabel="Before"
        withoutLabel="During"
        withFraction={symptomRate(row.before)}
        withoutFraction={symptomRate(row.during)}
        withText={beforeText}
        withoutText={duringText}
        accessibilityLabel={`${row.name}: logged on ${beforeText} you logged before, and ${duringText} during.${severityLine ? ` ${severityLine}.` : ''}`}
      />
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader
        title={experiment.label}
        onBack={() => navigation.goBack()}
        actions={
          <TouchableOpacity
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setSheetOpen(true); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Edit experiment"
          >
            <Ionicons name="create-outline" size={iconSize.md} color={colors.textSecondary} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + spacing.xl, scrollTop.clearance) }]}
      >
        <View style={styles.statRow}>
          {statCells.map(cell => (
            <View key={cell.label} style={styles.statCell} accessible accessibilityLabel={`${cell.label} ${cell.value}`}>
              <Text style={styles.statValue}>{cell.value}</Text>
              <Text style={styles.statLabel}>{cell.label}</Text>
            </View>
          ))}
        </View>

        {experiment.note && (
          <View style={styles.card}>
            <Text style={styles.noteLabel}>What you expected</Text>
            <Text style={styles.note}>{experiment.note}</Text>
          </View>
        )}

        {status === 'upcoming' ? (
          <View style={styles.card}>
            <Text style={styles.pending}>
              Starts {format(dayKeyToDate(span.startKey), 'EEEE, MMMM d')}. Once it has a few days
              logged, your mood and symptoms during it will show here against {comparedTo}.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>MOOD</Text>
            <View style={styles.card}>
              {result.mood ? (
                <>
                  <ContrastBars
                    first
                    label="Average mood"
                    withLabel="Before"
                    withoutLabel="During"
                    withFraction={moodBarFraction(result.mood.moodBefore)}
                    withoutFraction={moodBarFraction(result.mood.moodDuring)}
                    withText={result.mood.moodBefore.toFixed(1)}
                    withoutText={result.mood.moodDuring.toFixed(1)}
                    accessibilityLabel={`Average mood ${result.mood.moodBefore.toFixed(1)} over ${days(result.mood.beforeDays)} before, ${result.mood.moodDuring.toFixed(1)} over ${days(result.mood.duringDays)} during`}
                  />
                  <HelpText style={styles.caption}>
                    Your average mood on the {days(result.mood.beforeDays)} you logged one in {comparedTo},
                    and the {days(result.mood.duringDays)} {status === 'running' ? 'so far' : 'during it'}.
                  </HelpText>
                </>
              ) : (
                <Text style={styles.pending}>
                  Not enough days with a mood logged to compare yet. So far: {days(result.loggedDaysBefore)} logged
                  before it started, {days(result.loggedDaysDuring)} during.
                </Text>
              )}
            </View>

            <Text style={styles.sectionTitle}>SYMPTOMS</Text>
            <View style={styles.card}>
              {result.picked.length === 0 ? (
                <Text style={styles.pending}>No symptoms picked to watch. Edit the experiment to pick some.</Text>
              ) : (
                result.picked.map(symptomBars)
              )}
              {result.picked.some(r => r.comparable) && (
                <Text style={styles.caption}>
                  How many of the days you logged had each symptom, and how bad it usually got.
                  This compares two stretches of time and can’t show what caused a difference.
                </Text>
              )}
            </View>

            {result.others.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>OTHER SYMPTOMS</Text>
                <View style={styles.card}>
                  {result.others.map(symptomBars)}
                  <Text style={styles.caption}>
                    You didn’t pick these as what this experiment was meant to change. With several
                    symptoms compared, one can look different by chance.
                  </Text>
                </View>
              </>
            )}
          </>
        )}

        {changes.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>ALSO CHANGED IN THIS STRETCH</Text>
            <View style={styles.card}>
              {changes.map((change, i) => (
                <View
                  key={`${change.kind}:${change.id}`}
                  style={i > 0 ? styles.rowGap : undefined}
                  accessible
                  accessibilityLabel={`${change.kind === 'milestone' ? 'Milestone' : 'Experiment'}: ${change.label}, ${format(dayKeyToDate(change.dayKey), 'MMMM d')}`}
                >
                  <Text style={styles.rowLabel}>{change.label}</Text>
                  <Text style={styles.rowDetail}>
                    {change.kind === 'milestone' ? 'Milestone' : 'Experiment starting'} {shortDay(change.dayKey)}
                  </Text>
                </View>
              ))}
              <Text style={styles.caption}>
                Dated inside this experiment or the days it’s compared with, so it may account for
                some of a difference.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <LazySheet open={sheetOpen}>
        <ExperimentSheet
          visible={sheetOpen}
          experiment={experiment}
          onClose={() => setSheetOpen(false)}
        />
      </LazySheet>
      <ScrollToTopButton {...scrollTop.buttonProps} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
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
  noteLabel: { fontSize: font.xs, color: colors.textSecondary, marginBottom: spacing.xs },
  note: { fontSize: font.md, color: colors.text, lineHeight: 20 },
  pending: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  caption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  rowGap: { marginTop: spacing.md },
  rowLabel: { fontSize: font.sm, color: colors.text },
  rowDetail: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
});
