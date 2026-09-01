import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import { useShallow } from 'zustand/react/shallow';
import type { MoodLog } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { segmentOf } from '../utils/rhythms';
import {
  filterMoodLogs,
  moodEmoji,
  moodLabel,
  moodLogSummary,
  severityLabel,
  symptomKey,
  symptomVocabulary,
} from '../utils/moodLog';
import {
  buildMoodDays,
  categoryMoodContrasts,
  describeMoodChart,
  moodByTimeOfDay,
  moodCompletionInsight,
  moodSummary,
  symptomMoodContrasts,
  MIN_PAIRED_DAYS,
} from '../utils/moodInsights';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { MoodLogSheet } from '../components/MoodLogSheet';
import { SearchField } from '../components/SearchField';
import { SymptomManagerSheet } from '../components/SymptomManagerSheet';

/** How many days the chart shows. Two weeks fits a phone width at a readable bar. */
const CHART_DAYS = 14;

/** How many entries the history shows before "Show more". */
const PAGE_SIZE = 20;

const BAR_HEIGHT = 90;

/**
 * The mood and symptom log, and what it looks like against your tasks.
 *
 * A drawer-only screen, the same shape Waiting and Drift take: a history that
 * wants reading in aggregate rather than a list of things to work through.
 *
 * The insights half is the reason this isn't just a list. Every row in it is a
 * join between the mood log and the task history, which is the one thing a
 * standalone mood tracker can never do — see `moodInsights.ts`, which holds
 * every rule about what those numbers are allowed to claim. This screen's job
 * is to render them without adding a claim of its own: no arrows implying
 * causation, no advice, and the sample size printed beside every comparison so
 * a finding built on eleven days reads as one.
 */
export function MoodScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const logs = useMoodStore(s => s.logs);
  const removeLog = useMoodStore(s => s.removeLog);
  const tasks = useTaskStore(s => s.tasks);
  const settings = useSettingsStore(useShallow(s => ({
    dayResetTime: s.dayResetTime,
    morningStart: s.morningStart,
    afternoonStart: s.afternoonStart,
    eveningStart: s.eveningStart,
    nightStart: s.nightStart,
  })));

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<MoodLog | null>(null);
  // How the history is narrowed. Two independent controls answering different
  // questions (see filterMoodLogs), so they are two pieces of state rather
  // than one: picking a symptom off a contrast row must not clear a query
  // somebody is mid-way through typing.
  const [symptomFilter, setSymptomFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Paged rather than capped. The list used to stop dead at 20 with no way
  // past it, which after a couple of months put most of the record out of
  // reach of the screen computing statistics about it.
  const [shown, setShown] = useState(PAGE_SIZE);
  const [symptomsOpen, setSymptomsOpen] = useState(false);

  // `dundundun://mood?log=1` — the daily check-in task's link button. Stamped
  // with the arrival time rather than a boolean, and tracked against what has
  // already been handled, so tapping the same row twice opens the sheet twice:
  // the same shape PeopleScreen's openPerson uses, and for the same reason.
  const route = useRoute<{ key: string; name: string; params?: { openLog?: number } }>();
  const [handledOpenLog, setHandledOpenLog] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openLog === undefined || route.params.openLog === handledOpenLog) return;
    setHandledOpenLog(route.params.openLog);
    setEditing(null);
    setSheetOpen(true);
  }, [route.params?.openLog, handledOpenLog]);

  const todayKey = dayKeyOf(getCurrentDayStart());
  const days = useMemo(
    () => buildMoodDays(logs, tasks, settings.dayResetTime),
    [logs, tasks, settings.dayResetTime],
  );
  const summary = useMemo(() => moodSummary(days, todayKey), [days, todayKey]);
  const completion = useMemo(() => moodCompletionInsight(days), [days]);
  const categoryRows = useMemo(() => categoryMoodContrasts(days).slice(0, 4), [days]);
  // A contrast is keyed on the lowercased match key (see symptomKey), which is
  // not what the user typed — rendering it raw shows "headache" to somebody who
  // has been writing "Headache" all fortnight. The vocabulary holds the casing
  // they actually used, so the key is resolved back through it for display and
  // only falls back to itself if the name has since left the log.
  const symptomNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const name of symptomVocabulary(logs)) names.set(symptomKey(name), name);
    return names;
  }, [logs]);
  const symptomRows = useMemo(
    () => symptomMoodContrasts(days).slice(0, 4).map(row => ({
      ...row,
      label: symptomNames.get(row.label) ?? row.label,
    })),
    [days, symptomNames],
  );
  const timeRows = useMemo(
    () => moodByTimeOfDay(logs, iso => segmentOf(new Date(iso), {
      morningStart: settings.morningStart,
      afternoonStart: settings.afternoonStart,
      eveningStart: settings.eveningStart,
      nightStart: settings.nightStart,
    })),
    [logs, settings.morningStart, settings.afternoonStart, settings.eveningStart, settings.nightStart],
  );

  // The last CHART_DAYS logical days, whether or not each was logged — a gap in
  // the chart is the honest picture of a day nobody logged, and squeezing the
  // logged days together would draw a fortnight of entries out of four.
  const chart = useMemo(() => {
    const byDay = new Map(days.map(d => [d.dayKey, d]));
    const out: { dayKey: string; label: string; mood: number | null; today: boolean }[] = [];
    const cursor = getCurrentDayStart();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const date = new Date(cursor);
      date.setDate(date.getDate() - i);
      const key = dayKeyOf(date);
      out.push({
        dayKey: key,
        label: format(date, 'EEEEE'),
        mood: byDay.get(key)?.mood ?? null,
        today: key === todayKey,
      });
    }
    return out;
  }, [days, todayKey]);

  const chartLabel = useMemo(() => describeMoodChart(chart), [chart]);
  const matching = useMemo(
    () => filterMoodLogs(logs, { symptom: symptomFilter, query }),
    [logs, symptomFilter, query],
  );
  const recent = useMemo(() => matching.slice(0, shown), [matching, shown]);

  // Any change to what is being looked for starts the paging again: keeping a
  // "showing 60" from the previous filter would silently render a different
  // amount of two different searches.
  useEffect(() => { setShown(PAGE_SIZE); }, [symptomFilter, query]);

  const openNew = () => { haptics.tap(); setEditing(null); setSheetOpen(true); };
  const openEditSymptoms = () => { haptics.tap(); setSymptomsOpen(true); };

  // Built as a typed array rather than inline, so the conditional first action
  // doesn't widen `icon` from Ionicons' glyph union to plain string.
  const headerActions: ScreenHeaderAction[] = [];
  // Only once there is a vocabulary to manage: an empty rename sheet is a
  // control that does nothing, and the header should lead with the thing you
  // came here to do.
  if (symptomNames.size > 0) {
    headerActions.push({
      icon: 'pricetag-outline',
      onPress: openEditSymptoms,
      accessibilityLabel: 'Rename or merge your symptoms',
    });
  }
  headerActions.push({
    icon: 'add-circle-outline',
    onPress: openNew,
    accessibilityLabel: 'Log how you\'re feeling',
  });
  const openEdit = (log: MoodLog) => { haptics.tap(); setEditing(log); setSheetOpen(true); };

  const confirmDelete = (log: MoodLog) => {
    Alert.alert(
      'Delete this entry?',
      'It will be removed from your history and from every number on this screen.',
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

  const daysToGo = Math.max(0, MIN_PAIRED_DAYS - completion.dayCount);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Mood"
        subtitle={summary.loggedDays > 0
          ? `${summary.loggedDays} ${summary.loggedDays === 1 ? 'day' : 'days'} logged`
          : undefined}
        actions={headerActions}
      />

      {logs.length === 0 ? (
        <EmptyState
          icon="happy-outline"
          title="Nothing logged yet"
          subtitle="Record how you're feeling and anything you want to keep track of. Once there are a couple of weeks of it, this screen shows how it lines up with what you get done."
          actionLabel="Log how you're doing"
          onAction={openNew}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing.xl }]}
        >
          <View style={styles.statRow}>
            <Stat
              styles={styles}
              value={summary.averageMood === null ? '—' : summary.averageMood.toFixed(1)}
              label="Average mood"
              spoken={summary.averageMood === null
                ? 'Average mood: nothing logged yet'
                : `Average mood ${summary.averageMood.toFixed(1)} out of 5`}
            />
            <Stat
              styles={styles}
              value={String(summary.streak)}
              label="Day streak"
              spoken={`Logged ${summary.streak} ${summary.streak === 1 ? 'day' : 'days'} running`}
            />
            <Stat
              styles={styles}
              value={String(summary.lowDays)}
              label="Low days"
              spoken={`${summary.lowDays} low ${summary.lowDays === 1 ? 'day' : 'days'} on record`}
            />
          </View>

          <Text style={styles.sectionTitle}>THE LAST TWO WEEKS</Text>
          <View style={styles.card}>
            {/* One accessibility element for the whole chart: `accessible` on
                the wrapper stops the fourteen columns being fourteen stops in
                the swipe order, and describeMoodChart says in one sentence
                what the bars say at a glance. */}
            <View style={styles.chartInner} accessible accessibilityLabel={chartLabel}>
              {chart.map(({ dayKey, label, mood, today }) => (
                <View key={dayKey} style={styles.chartCol}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        {
                          // A day with no entry draws a flat baseline rather
                          // than a zero-height bar: zero is a mood on this
                          // scale's floor, and "didn't log" is not a bad day.
                          height: mood === null ? 2 : `${Math.max(6, (mood / 5) * 100)}%`,
                          backgroundColor: mood === null
                            ? colors.bgQuaternary
                            : today ? colors.accent : colors.bgQuaternary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.barLabel, today && styles.barLabelToday]}>{label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.chartCaption}>
              A flat line is a day with nothing logged.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>MOOD AND WHAT YOU FINISH</Text>
          <View style={styles.card}>
            {completion.strength === null || completion.direction === null ? (
              <Text style={styles.pending}>
                {daysToGo > 0
                  ? `Keep logging. After ${daysToGo} more ${daysToGo === 1 ? 'day' : 'days'} with a mood on ${daysToGo === 1 ? 'it' : 'them'}, this compares your mood against what you got done.`
                  : 'Not enough variation yet to compare. This fills in once your days differ a little more.'}
              </Text>
            ) : completion.strength === 'none' ? (
              <Text style={styles.finding}>
                No clear pattern between your mood and how much you finish, across {completion.dayCount} days.
              </Text>
            ) : (
              <Text style={styles.finding}>
                You tend to finish {completion.direction === 'more' ? 'more' : 'fewer'} tasks on
                {' '}better days. A {completion.strength} pattern across {completion.dayCount} days.
              </Text>
            )}
            {completion.completedOnGoodDays !== null && completion.completedOnLowDays !== null && (
              <View style={styles.splitRow}>
                <View style={styles.splitCell}>
                  <Text style={styles.splitValue}>{completion.completedOnGoodDays.toFixed(1)}</Text>
                  <Text style={styles.splitLabel}>a day when good</Text>
                </View>
                <View style={styles.splitCell}>
                  <Text style={styles.splitValue}>{completion.completedOnLowDays.toFixed(1)}</Text>
                  <Text style={styles.splitLabel}>a day when low</Text>
                </View>
              </View>
            )}
          </View>

          {categoryRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD BY KIND OF WORK</Text>
              <View style={styles.card}>
                {categoryRows.map(row => (
                  <ContrastRow
                    key={row.label}
                    styles={styles}
                    colors={colors}
                    label={row.label}
                    moodWith={row.moodWith}
                    moodWithout={row.moodWithout}
                    subject="days you finished something in it"
                  />
                ))}
                <Text style={styles.chartCaption}>
                  Your average mood on days you finished something in that category, against days you didn't.
                </Text>
              </View>
            </>
          )}

          {symptomRows.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>MOOD WITH SYMPTOMS</Text>
              <View style={styles.card}>
                {symptomRows.map(row => {
                  const active = !!symptomFilter && symptomKey(symptomFilter) === symptomKey(row.label);
                  return (
                    <ContrastRow
                      key={row.label}
                      styles={styles}
                      colors={colors}
                      label={row.label}
                      moodWith={row.moodWith}
                      moodWithout={row.moodWithout}
                      subject="days you logged it"
                      active={active}
                      onPress={() => {
                        haptics.tap();
                        setSymptomFilter(active ? null : row.label);
                      }}
                    />
                  );
                })}
                <Text style={styles.chartCaption}>
                  Your average mood on days you logged it, against days you didn't.
                </Text>
              </View>
            </>
          )}

          {timeRows.length > 1 && (
            <>
              <Text style={styles.sectionTitle}>MOOD BY TIME OF DAY</Text>
              <View style={styles.card}>
                {timeRows.map(row => {
                  const name = row.segment.charAt(0).toUpperCase() + row.segment.slice(1);
                  return (
                    <View
                      key={row.segment}
                      style={styles.contrastRow}
                      accessible
                      accessibilityLabel={`${name}: average mood ${row.mood.toFixed(1)} across ${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'}`}
                    >
                      <Text style={styles.contrastLabel}>{name}</Text>
                      <Text style={styles.contrastValue}>
                        {row.mood.toFixed(1)} · {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>
            {symptomFilter || query.trim() ? 'MATCHING ENTRIES' : 'ENTRIES'}
          </Text>

          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search notes and symptoms"
            style={styles.search}
            accessibilityLabel="Search your mood entries"
          />

          {!!symptomFilter && (
            <TouchableOpacity
              style={styles.filterPill}
              onPress={() => { haptics.tap(); setSymptomFilter(null); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Showing days with ${symptomFilter}. Tap to show all days`}
            >
              <Text style={styles.filterPillText} numberOfLines={1}>{symptomFilter}</Text>
              <Ionicons name="close" size={iconSize.sm} color={colors.accent} />
            </TouchableOpacity>
          )}

          {matching.length === 0 ? (
            <Text style={styles.noMatches}>
              Nothing matches. Clear the search to see everything you've logged.
            </Text>
          ) : (
            <Text style={styles.matchCount}>
              {matching.length === logs.length
                ? `${logs.length} ${logs.length === 1 ? 'entry' : 'entries'}`
                : `${matching.length} of ${logs.length}`}
            </Text>
          )}

          {recent.map(log => (
            <TouchableOpacity
              key={log.id}
              style={styles.entryRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => openEdit(log)}
              onLongPress={() => confirmDelete(log)}
              delayLongPress={interaction.delayLongPress}
              accessibilityLabel={`${format(dayKeyToDate(log.dayKey), 'EEEE d MMMM')}: ${moodLogSummary(log)}`}
            >
              <Text style={styles.entryEmoji}>
                {log.mood === null ? '·' : moodEmoji(log.mood)}
              </Text>
              <View style={styles.entryBody}>
                <Text style={styles.entryTitle} numberOfLines={1}>
                  {log.mood === null ? 'Logged' : moodLabel(log.mood)}
                </Text>
                <Text style={styles.entryMeta} numberOfLines={1}>
                  {format(new Date(log.loggedAt), 'EEE d MMM, h:mm a')}
                </Text>
                {log.symptoms.length > 0 && (
                  <Text style={styles.entrySymptoms} numberOfLines={2}>
                    {log.symptoms.map(s => `${s.name} (${severityLabel(s.severity).toLowerCase()})`).join(', ')}
                  </Text>
                )}
                {!!log.note && (
                  <Text style={styles.entryNote} numberOfLines={2}>{log.note}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}

          {matching.length > recent.length && (
            <TouchableOpacity
              style={styles.showMore}
              onPress={() => { haptics.tap(); setShown(n => n + PAGE_SIZE); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Show more entries. ${matching.length - recent.length} still to show`}
            >
              <Text style={styles.showMoreText}>
                Show {Math.min(PAGE_SIZE, matching.length - recent.length)} more
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <MoodLogSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
      />

      <SymptomManagerSheet
        visible={symptomsOpen}
        onClose={() => setSymptomsOpen(false)}
      />
    </View>
  );
}

/**
 * One "with it / without it" comparison.
 *
 * Shared by the category and symptom blocks, which had shipped as identical
 * markup twice over. Read raw the two `Text` nodes are "headache" then
 * "1.8 vs 3.9", which says nothing about what is being compared, so the row is
 * one accessibility element with the sentence spelled out.
 *
 * `onPress` is what makes a symptom row the way into its own days; the
 * category rows pass nothing and stay plain, since there is no per-category
 * lens on the history to send anybody to.
 */
function ContrastRow({ styles, colors, label, moodWith, moodWithout, subject, onPress, active }: {
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  label: string;
  moodWith: number;
  moodWithout: number;
  /** How the comparison reads out loud: "days you logged it". */
  subject: string;
  onPress?: () => void;
  active?: boolean;
}) {
  const spoken = `${label}: average mood ${moodWith.toFixed(1)} on ${subject}, `
    + `${moodWithout.toFixed(1)} on days you didn't`;
  const body = (
    <>
      <Text style={[styles.contrastLabel, active && styles.contrastLabelActive]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.contrastValue}>
        {moodWith.toFixed(1)} vs {moodWithout.toFixed(1)}
      </Text>
      {!!onPress && (
        <Ionicons
          name={active ? 'close-circle' : 'chevron-forward'}
          size={iconSize.sm}
          color={active ? colors.accent : colors.textTertiary}
        />
      )}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.contrastRow} accessible accessibilityLabel={spoken}>{body}</View>
    );
  }
  return (
    <TouchableOpacity
      style={styles.contrastRow}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={active ? `${spoken}. Showing these days` : `${spoken}. Show these days`}
      accessibilityState={{ selected: !!active }}
    >
      {body}
    </TouchableOpacity>
  );
}

/**
 * One header number.
 *
 * `accessible` on the wrapper rather than labels on the two `Text` nodes: read
 * separately they are "3.2" and "Average mood", two unrelated items in the
 * swipe order with nothing tying them together. `spoken` exists because the
 * visible value is often too terse to say out loud on its own, so the caller
 * hands over the sentence it wants rather than the screen reader assembling
 * one from a number and a heading.
 */
function Stat({ styles, value, label, spoken }: {
  styles: ReturnType<typeof makeStyles>;
  value: string;
  label: string;
  spoken: string;
}) {
  return (
    <View style={styles.statCell} accessible accessibilityLabel={spoken}>
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
  chartInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  chartCol: { flex: 1, alignItems: 'center' },
  barTrack: { width: 12, height: BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 12, borderRadius: 4 },
  barLabel: { marginTop: 4, color: colors.textTertiary, fontSize: 10, fontWeight: '500' },
  barLabelToday: { color: colors.accent, fontWeight: fontWeight.semibold },
  chartCaption: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.sm },
  pending: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  finding: { fontSize: font.md, color: colors.text, lineHeight: 22 },
  splitRow: { flexDirection: 'row', marginTop: spacing.md },
  splitCell: { flex: 1, alignItems: 'center' },
  splitValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  splitLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2 },
  contrastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  contrastLabel: { flex: 1, fontSize: font.sm, color: colors.text },
  // Accent while its days are the ones on screen, so the filter and the row
  // that set it read as the same thing.
  contrastLabelActive: { color: colors.accent, fontWeight: fontWeight.medium },
  contrastValue: { fontSize: font.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  entryEmoji: { fontSize: font.lg, width: 28, textAlign: 'center' },
  entryBody: { flex: 1 },
  entryTitle: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  entryMeta: { fontSize: font.xs, color: colors.textSecondary, marginTop: 2 },
  entrySymptoms: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs },
  entryNote: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.xs },
  search: { marginBottom: spacing.sm },
  // Mirrors LogbookScreen's own active-filter pill: what is currently
  // narrowing the list, shown as the thing that removes it.
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    marginBottom: spacing.sm,
  },
  filterPillText: { fontSize: font.sm, color: colors.accent, fontWeight: fontWeight.medium },
  matchCount: {
    fontSize: font.xs,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  noMatches: {
    fontSize: font.sm,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
  },
  showMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  showMoreText: { fontSize: font.sm, color: colors.accent, fontWeight: fontWeight.medium },
});
