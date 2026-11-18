// Experiments (a stretch of days compared with the same number before it) and milestones (one
// day, compared before and after), the two "I changed something" markers on the mood log.
// A Health hub pill, split out of MoodScreen so that screen stays short; each experiment's
// read is its own page (ExperimentDetailScreen). See docs/arch/mood-log.md, "Experiments".
import { useMemo, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Milestone } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useMilestoneStore } from '../store/useMilestoneStore';
import { useExperimentStore } from '../store/useExperimentStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { buildMoodDays, milestoneMoodContrast, moodBarFraction } from '../utils/moodInsights';
import {
  describeLength, describeProgress, experimentProgress, experimentResult, experimentSpan,
  experimentStatus, experimentSummary, sortExperimentsForList,
} from '../utils/experiments';
import { startPlannedExperiment } from '../utils/experimentStart';
import { experimentStartedMessage } from '../utils/experimentLink';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { InlineAction } from '../components/InlineAction';
import { ContrastBars } from '../components/ContrastBars';
import { LazySheet } from '../components/LazySheet';
import { MilestoneSheet } from '../components/MilestoneSheet';
import { ExperimentSheet } from '../components/ExperimentSheet';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

/** The status groups an experiment's row is filed under, in the order they read. */
const EXPERIMENT_GROUPS = [
  { title: 'RUNNING', statuses: ['running'] },
  { title: 'PLANNED', statuses: ['upcoming', 'planned'] },
  { title: 'FINISHED', statuses: ['finished'] },
] as const;

/**
 * Experiments grouped by where they are (running, planned, finished), then milestones.
 *
 * Every experiment is listed whatever its data says, and its read lives on its own page. A
 * finished one says how it came out in its row, so the list answers "did it help" without a tap.
 * Milestones are the same idea with no end date: each names one split point, so every row is
 * computed independently rather than sliced from one ranked list.
 */
export function ExperimentsScreen() {
  const pullSearch = usePullToSearch();
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const tabBarHeight = useBottomTabBarHeight();

  const logs = useMoodStore(s => s.logs);
  const milestones = useMilestoneStore(s => s.milestones);
  const experiments = useExperimentStore(s => s.experiments);
  const tasks = useTaskStore(s => s.tasks);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const todayKey = dayKeyOf(getCurrentDayStart());

  const [milestoneSheetOpen, setMilestoneSheetOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [experimentSheetOpen, setExperimentSheetOpen] = useState(false);

  // Mood only: a milestone's contrast reads the mood on each side of its date.
  const days = useMemo(
    () => buildMoodDays(logs, tasks, dayResetTime, [], null, []),
    [logs, tasks, dayResetTime],
  );
  const milestoneRows = useMemo(
    () => milestones.map(milestone => ({
      milestone,
      contrast: milestoneMoodContrast(days, dayKeyOf(new Date(milestone.date))),
    })),
    [days, milestones],
  );
  const experimentRows = useMemo(
    () => sortExperimentsForList(experiments, todayKey).map(experiment => {
      const status = experimentStatus(experiment, todayKey);
      const span = experimentSpan(experiment, todayKey);
      const progress = experimentProgress(experiment, todayKey);
      const meta = !span
        ? `Planned · ${experiment.days ? describeLength(experiment.days) : 'until you stop it'} · not started`
        : status === 'running'
          ? `Day ${describeProgress(progress)} · ${experiment.endDate ? `ends ${format(dayKeyToDate(span.endKey), 'MMM d')}` : 'until you stop it'}`
          : status === 'upcoming'
            ? `Starts ${format(dayKeyToDate(span.startKey), 'MMM d')} · ${describeLength(span.lengthDays)}`
            : `Finished ${format(dayKeyToDate(span.endKey), 'MMM d')} · ${describeLength(span.lengthDays)}`;
      const summary = status === 'finished'
        ? experimentSummary(experimentResult(experiment, logs, todayKey)) ?? 'Not enough days logged to compare.'
        : null;
      return { experiment, status, progress, meta, summary };
    }),
    [experiments, logs, todayKey],
  );

  const openNewExperiment = () => { haptics.tap(); setExperimentSheetOpen(true); };
  const openNewMilestone = () => { haptics.tap(); setEditingMilestone(null); setMilestoneSheetOpen(true); };
  const openEditMilestone = (milestone: Milestone) => {
    haptics.tap();
    setEditingMilestone(milestone);
    setMilestoneSheetOpen(true);
  };
  const closeMilestoneSheet = () => { setMilestoneSheetOpen(false); setEditingMilestone(null); };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Experiments"
        actions={[{
          icon: 'add-circle-outline' as const,
          onPress: openNewExperiment,
          accessibilityLabel: 'New experiment',
        }]}
      />
      <HubPills hub="health" active="Experiments" />

      <ScrollView
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        refreshControl={pullSearch.refreshControl}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(tabBarHeight + spacing.xl, scrollTop.clearance) }]}
      >
        {experimentRows.length === 0 ? (
          <>
            <Text style={styles.sectionTitle}>EXPERIMENTS</Text>
            <View style={styles.card}>
              <Text style={[styles.pending, styles.addSpacing]}>
                Try a change for a set number of days (cutting out caffeine, an earlier
                bedtime) and compare your mood and symptoms during it with the same number
                of days before it.
              </Text>
              <InlineAction label="New experiment" onPress={openNewExperiment} variant="accent" />
            </View>
          </>
        ) : (
          EXPERIMENT_GROUPS.map(group => {
            const rows = experimentRows.filter(row => (group.statuses as readonly string[]).includes(row.status));
            if (rows.length === 0) return null;
            return (
              <View key={group.title}>
                <Text style={styles.sectionTitle}>{group.title}</Text>
                <View style={styles.card}>
                  {rows.map(({ experiment, status, progress, meta, summary }, i) => (
                    <TouchableOpacity
                      key={experiment.id}
                      style={[styles.linkRow, i > 0 && styles.rowGap]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => { haptics.tap(); navigation.navigate('ExperimentDetail', { experimentId: experiment.id }); }}
                      accessibilityRole="button"
                      accessibilityLabel={`${experiment.label}, ${meta}${summary ? `. ${summary}` : ''}`}
                    >
                      <View style={styles.linkBody}>
                        <Text style={styles.linkLabel} numberOfLines={2}>{experiment.label}</Text>
                        <Text style={styles.linkMeta}>{meta}</Text>
                        {summary && <Text style={styles.experimentSummary}>{summary}</Text>}
                        {status === 'planned' && experiment.symptoms.length > 0 && (
                          <Text style={styles.experimentWatching}>Watching {experiment.symptoms.join(', ')}</Text>
                        )}
                        {status === 'running' && progress.of !== null && (
                          <View style={styles.experimentTrack}>
                            <View style={[styles.experimentFill, { width: `${(progress.day / progress.of) * 100}%` }]} />
                          </View>
                        )}
                      </View>
                      {status === 'planned' ? (
                        <TouchableOpacity
                          style={styles.experimentStart}
                          activeOpacity={interaction.activeOpacity}
                          hitSlop={8}
                          onPress={() => {
                            haptics.tap();
                            const started = startPlannedExperiment(experiment.id);
                            if (started) Alert.alert('Experiment started', experimentStartedMessage(started));
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Start ${experiment.label} today`}
                        >
                          <Text style={styles.experimentStartText}>Start today</Text>
                        </TouchableOpacity>
                      ) : (
                        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })
        )}

        <Text style={styles.sectionTitle}>MILESTONES</Text>
        <View style={styles.card}>
          {milestoneRows.length === 0 ? (
            <Text style={[styles.pending, styles.addSpacing]}>
              Mark the day something changed (starting a medicine, a new
              job) and compare your mood before and after it.
            </Text>
          ) : (
            <View style={styles.addSpacing}>
              {milestoneRows.map(({ milestone, contrast }, i) => (
                contrast ? (
                  <ContrastBars
                    key={milestone.id}
                    first={i === 0}
                    label={milestone.label}
                    withLabel="Before"
                    withoutLabel="After"
                    withFraction={moodBarFraction(contrast.moodBefore)}
                    withoutFraction={moodBarFraction(contrast.moodAfter)}
                    withText={contrast.moodBefore.toFixed(1)}
                    withoutText={contrast.moodAfter.toFixed(1)}
                    onPress={() => openEditMilestone(milestone)}
                    accessibilityLabel={`${milestone.label}, average mood ${contrast.moodBefore.toFixed(1)} before ${format(new Date(milestone.date), 'MMMM d')}, ${contrast.moodAfter.toFixed(1)} on and after`}
                  />
                ) : (
                  <TouchableOpacity
                    key={milestone.id}
                    style={[styles.linkRow, i > 0 && styles.rowGap]}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => openEditMilestone(milestone)}
                    accessibilityRole="button"
                    accessibilityLabel={`${milestone.label}, ${format(new Date(milestone.date), 'MMMM d, yyyy')}, not enough days logged yet to compare`}
                  >
                    <View style={styles.linkBody}>
                      <Text style={styles.linkLabel} numberOfLines={1}>{milestone.label}</Text>
                      <Text style={styles.linkMeta}>
                        {format(new Date(milestone.date), 'MMM d, yyyy')} · not enough days yet
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                )
              ))}
            </View>
          )}
          <InlineAction
            label="Add milestone"
            onPress={openNewMilestone}
            variant={milestoneRows.length > 0 ? 'neutral' : 'accent'}
          />
          {milestoneRows.some(r => r.contrast) && (
            <Text style={styles.chartCaption}>
              Average mood before a milestone’s date, against on and after it.
            </Text>
          )}
        </View>
      </ScrollView>

      <LazySheet open={milestoneSheetOpen}>
        <MilestoneSheet
          visible={milestoneSheetOpen}
          milestone={editingMilestone}
          onClose={closeMilestoneSheet}
        />
      </LazySheet>
      <LazySheet open={experimentSheetOpen}>
        <ExperimentSheet
          visible={experimentSheetOpen}
          experiment={null}
          onClose={() => setExperimentSheetOpen(false)}
        />
      </LazySheet>
      <ScrollToTopButton {...scrollTop.buttonProps} />
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
  chartCaption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  pending: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  linkBody: { flex: 1 },
  linkLabel: { fontSize: font.sm, color: colors.text },
  linkMeta: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
  // Space before the action below, whichever branch (the empty-state text or the row list) sits above it.
  addSpacing: { marginBottom: spacing.md },
  // Between one row and the next — ContrastBars rows carry their own gap, but a plain
  // TouchableOpacity row needs its own.
  rowGap: { marginTop: spacing.md },
  // A finished experiment's result, under its meta line.
  experimentSummary: { fontSize: font.xs, color: colors.text, marginTop: spacing.xs, lineHeight: 17 },
  // A planned experiment's symptoms, under its meta line.
  experimentWatching: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.xs },
  // A planned experiment's Start today, in the slot a started one's chevron holds.
  experimentStart: {
    paddingVertical: spacing.xsm,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSubtle,
  },
  experimentStartText: { fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.accent },
  // A running experiment's progress, under its meta line.
  experimentTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.separator,
    marginTop: spacing.xsm,
    overflow: 'hidden',
  },
  experimentFill: { height: 4, borderRadius: radius.full, backgroundColor: colors.accent },
});
