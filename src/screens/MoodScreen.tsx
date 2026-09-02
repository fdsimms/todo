import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import { useShallow } from 'zustand/react/shallow';
import type { MoodLog } from '../types';
import { useMoodStore } from '../store/useMoodStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, dayKeyToDate, getCurrentDayStart } from '../utils/dateUtils';
import { segmentOf } from '../utils/rhythms';
import {
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
  moodByTimeOfDay,
  moodCompletionInsight,
  moodSummary,
  symptomMoodContrasts,
  MIN_PAIRED_DAYS,
} from '../utils/moodInsights';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { MoodLogSheet } from '../components/MoodLogSheet';

/** How many days the chart shows. Two weeks fits a phone width at a readable bar. */
const CHART_DAYS = 14;

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
    const out: { key: string; label: string; a11y: string; mood: number | null; today: boolean }[] = [];
    const cursor = getCurrentDayStart();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const date = new Date(cursor);
      date.setDate(date.getDate() - i);
      const key = dayKeyOf(date);
      const mood = byDay.get(key)?.mood ?? null;
      const today = key === todayKey;
      out.push({
        key,
        label: format(date, 'EEEEE'),
        // Each column is its own accessibility element, so the value and the
        // "nothing logged" state — which are a bar height and a 2px baseline on
        // screen, and so invisible to VoiceOver — are read out per day. Fourteen
        // elements is the trade: a single summary would lose exactly the two
        // things the chart is drawn to show. The date is spelled out because a
        // weekday initial ("W") is what the chart reads as without it.
        a11y: `${today ? 'Today, ' : ''}${format(date, 'EEEE d MMMM')}, ${
          mood === null ? 'nothing logged' : `mood ${mood.toFixed(1)} out of 5`
        }`,
        mood,
        today,
      });
    }
    return out;
  }, [days, todayKey]);

  const recent = useMemo(() => logs.slice(0, 20), [logs]);

  const openNew = () => { haptics.tap(); setEditing(null); setSheetOpen(true); };
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
        actions={[{
          icon: 'add-circle-outline',
          onPress: openNew,
          accessibilityLabel: 'Log how you\'re feeling',
        }]}
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
              // The em dash is a drawn placeholder rather than a value, so it is
              // spoken as the absence it stands for instead of as punctuation.
              accessibilityLabel={summary.averageMood === null
                ? 'Average mood, nothing logged yet'
                : `Average mood, ${summary.averageMood.toFixed(1)} out of 5`}
            />
            <Stat
              styles={styles}
              value={String(summary.streak)}
              label="Day streak"
              accessibilityLabel={`Day streak, ${summary.streak} ${summary.streak === 1 ? 'day' : 'days'}`}
            />
            <Stat
              styles={styles}
              value={String(summary.lowDays)}
              label="Low days"
              accessibilityLabel={`Low days, ${summary.lowDays}`}
            />
          </View>

          <Text style={styles.sectionTitle}>THE LAST TWO WEEKS</Text>
          <View style={styles.card}>
            <View style={styles.chartInner}>
              {chart.map(({ key, label, a11y, mood, today }) => (
                <View key={key} style={styles.chartCol} accessible accessibilityLabel={a11y}>
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
                <View
                  style={styles.splitCell}
                  accessible
                  accessibilityLabel={`${completion.completedOnGoodDays.toFixed(1)} tasks finished a day when your mood was good`}
                >
                  <Text style={styles.splitValue}>{completion.completedOnGoodDays.toFixed(1)}</Text>
                  <Text style={styles.splitLabel}>a day when good</Text>
                </View>
                <View
                  style={styles.splitCell}
                  accessible
                  accessibilityLabel={`${completion.completedOnLowDays.toFixed(1)} tasks finished a day when your mood was low`}
                >
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
                  <View
                    key={row.label}
                    style={styles.contrastRow}
                    accessible
                    // "1.8 vs 3.9" says nothing about what is being compared,
                    // and the caption carrying that is a separate element three
                    // rows down. Each row states its own comparison instead.
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you finished something in that category, ${row.moodWithout.toFixed(1)} on days you didn't`}
                  >
                    <Text style={styles.contrastLabel} numberOfLines={1}>{row.label}</Text>
                    <Text style={styles.contrastValue}>
                      {row.moodWith.toFixed(1)} vs {row.moodWithout.toFixed(1)}
                    </Text>
                  </View>
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
                {symptomRows.map(row => (
                  <View
                    key={row.label}
                    style={styles.contrastRow}
                    accessible
                    accessibilityLabel={`${row.label}, average mood ${row.moodWith.toFixed(1)} on days you logged it, ${row.moodWithout.toFixed(1)} on days you didn't`}
                  >
                    <Text style={styles.contrastLabel} numberOfLines={1}>{row.label}</Text>
                    <Text style={styles.contrastValue}>
                      {row.moodWith.toFixed(1)} vs {row.moodWithout.toFixed(1)}
                    </Text>
                  </View>
                ))}
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
                {timeRows.map(row => (
                  <View
                    key={row.segment}
                    style={styles.contrastRow}
                    accessible
                    accessibilityLabel={`${row.segment}, average mood ${row.mood.toFixed(1)} across ${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'}`}
                  >
                    <Text style={styles.contrastLabel}>
                      {row.segment.charAt(0).toUpperCase() + row.segment.slice(1)}
                    </Text>
                    <Text style={styles.contrastValue}>
                      {row.mood.toFixed(1)} · {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>RECENT ENTRIES</Text>
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
        </ScrollView>
      )}

      <MoodLogSheet
        visible={sheetOpen}
        editing={editing}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
      />
    </View>
  );
}

/**
 * One number and what it counts.
 *
 * The two `Text` nodes are a single accessibility element: read separately they
 * are "3.2" and "Average mood" with nothing joining them, and a row of three
 * tiles is six unrelated announcements. The caller supplies the sentence rather
 * than it being stitched from `value` here, because the drawn value is
 * shorthand — "—" for nothing logged, a bare count for a number of days.
 */
function Stat({ styles, value, label, accessibilityLabel }: {
  styles: ReturnType<typeof makeStyles>;
  value: string;
  label: string;
  accessibilityLabel: string;
}) {
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
});
